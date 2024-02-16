import { z } from "zod";
import type {
  CommandImplementation,
  InstructionBuilderSharedArgs,
  InstructionExecutionSharedArgs,
} from "../schemas";
import { storeRoot } from "../schemas";
import type { FlakeBuildResult } from "../../utils/nixFlake";
import { buildSystemFlake } from "../../utils/nixFlake";
import {
  copyArchiveToStore,
  copyOutputToArchive,
  makeArchiveSubset,
} from "../../utils/nixArchive";
import {
  getPathHashFromPath,
  getPathInfoTreeSearch,
  getStoreDeltaPathsDelta,
  nixPathInfoToNarinfoFileString,
} from "../../utils/nixStore";
import path from "path";
import fs from "fs";

const loadArchiveDeltaCommandSchema = z.object({
  // Command to "load a partial nix archive into the system"
  kind: z.literal("load"),

  // Path of the archive within the instruction, e.g. `archive`
  archivePath: z.string(),

  // The other items that this item depends on to be loaded
  deltaDependencies: z.array(storeRoot),

  // The item to load
  item: storeRoot,
});

type BuildLoadArchiveDeltaCommandArgs = {
  kind: "load";
  flakeUri: string;
  hostname: string;
  archiveFolderName: string;
  deltaDependencyRefs: string[];
  newRef: string;
};

async function buildLoadArchiveDeltaCommand(
  {
    kind,
    archiveFolderName,
    flakeUri,
    hostname,
    deltaDependencyRefs,
    newRef: newRev,
  }: BuildLoadArchiveDeltaCommandArgs,
  {
    instructionFolderPath,
    workdirArchivePath,
    workdirStorePath,
    progressCallback,
  }: InstructionBuilderSharedArgs,
): Promise<z.infer<typeof loadArchiveDeltaCommandSchema>> {
  progressCallback("Building previous revisions");

  type BuildInfo = FlakeBuildResult & { rev: string };
  const oldRevBuildInfos: BuildInfo[] = [];
  for (const ref of deltaDependencyRefs) {
    progressCallback(`Building revision ${ref}`);
    const info = await buildSystemFlake({
      flakeUri,
      hostname,
      storeAbsolutePath: workdirStorePath,
      ref,
    });

    oldRevBuildInfos.push({
      rev: info.gitRevision,
      ...info,
    });
  }

  progressCallback("Building new revision");
  const newRevBuildInfo = await buildSystemFlake({
    flakeUri,
    hostname,
    storeAbsolutePath: workdirStorePath,
    ref: newRev,
  });

  progressCallback("Copying to archive");

  await copyOutputToArchive({
    storePath: workdirStorePath,
    archivePath: workdirArchivePath,
    item: newRevBuildInfo.output,
  });

  progressCallback("Getting path info");

  const pathInfo = await getStoreDeltaPathsDelta({
    storePath: workdirStorePath,
    fromRootPathNames: oldRevBuildInfos.map((info) => info.output),
    toRootPathName: newRevBuildInfo.output,
  });

  progressCallback(
    `${pathInfo.added.length} paths added, with a total ${pathInfo.allResultingItems.length} store items.`,
  );

  progressCallback("Building new archive");

  const archiveFolderPath = path.join(instructionFolderPath, archiveFolderName);

  // Delete old command dir path if exists
  await fs.promises.rm(archiveFolderPath, { force: true, recursive: true });

  await makeArchiveSubset({
    archivePath: workdirArchivePath,
    destinationPath: archiveFolderPath,
    infoItemPaths: pathInfo.added.map((info) => info.path),
    dataItemPaths: pathInfo.added.map((info) => info.path),
  });

  return {
    kind,
    archivePath: archiveFolderName,
    deltaDependencies: oldRevBuildInfos.map((build) => ({
      gitRevision: build.rev,
      nixPath: build.output,
    })),
    item: {
      gitRevision: newRevBuildInfo.gitRevision,
      nixPath: newRevBuildInfo.output,
    },
  };
}

async function executeLoadArchiveDeltaCommand(
  {
    archivePath,
    deltaDependencies,
    item,
  }: z.infer<typeof loadArchiveDeltaCommandSchema>,
  {
    storePath,
    instructionFolderPath,
    progressCallback,
  }: InstructionExecutionSharedArgs,
): Promise<void> {
  // Copy all the narinfo files into the archive
  const absoluteArchivePath = path.join(instructionFolderPath, archivePath);

  progressCallback("Searching for existing dependency paths");

  const pathInfos = await getPathInfoTreeSearch({
    rootPathNames: deltaDependencies.map((d) => d.nixPath),
    storePath,
  });

  progressCallback("Generating virtual narinfo files");

  for (const info of pathInfos) {
    const hash = getPathHashFromPath(info.path);
    const narinfoFilename = `${hash}.narinfo`;
    const destinationPath = path.join(absoluteArchivePath, narinfoFilename);

    // Check if the file already exists
    const exists = await fs.promises.access(destinationPath).then(
      () => true,
      () => false,
    );
    if (exists) {
      continue;
    }

    const narinfoText = nixPathInfoToNarinfoFileString(info);

    await fs.promises.writeFile(destinationPath, narinfoText);
  }

  progressCallback("Copying nix store items to the store");

  // Copy the item into the store
  await copyArchiveToStore({
    archivePath: absoluteArchivePath,
    item: item.nixPath,
    storePath: storePath == "/" ? undefined : storePath,
  });
}

export const loadArchiveDeltaCommand = {
  kind: "load" as const,
  schema: loadArchiveDeltaCommandSchema,
  build: buildLoadArchiveDeltaCommand,
  execute: executeLoadArchiveDeltaCommand,
} satisfies CommandImplementation<
  BuildLoadArchiveDeltaCommandArgs,
  typeof loadArchiveDeltaCommandSchema
>;
