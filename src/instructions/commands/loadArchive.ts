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
import { getStoreDeltaPathsDelta } from "../../utils/nixStore";
import path from "path";
import fs from "fs";
import { getAbsoluteNarinfoListInDir } from "../../files";
import {
  copyNarinfoFilesToCache,
  getNarinfoFileListForNixPaths,
} from "../../utils/clientStore";

const loadArchiveDeltaCommandSchema = z.object({
  // Command to "load a partial nix archive into the system"
  kind: z.literal("load"),

  // Path of the archive within the instruction, e.g. `archive`
  archivePath: z.string(),

  // The other items that this item depends on to be loaded
  deltaDependencies: z.array(storeRoot),

  // Whether the .narinfo files in the archive are partial
  partialNarinfos: z.boolean(),

  // The item to load
  item: storeRoot,
});

type BuildLoadArchiveDeltaCommandArgs = {
  kind: "load";
  flakeUri: string;
  hostname: string;
  archiveFolderName: string;
  deltaDependencyRefs: string[];
  partialNarinfos: boolean;
  newRef: string;
};

async function buildLoadArchiveDeltaCommand(
  {
    kind,
    archiveFolderName,
    flakeUri,
    hostname,
    deltaDependencyRefs,
    partialNarinfos,
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

    // If the narinfos are partial, only add the added paths to the info item paths
    infoItemPaths: partialNarinfos
      ? pathInfo.added.map((info) => info.path)
      : pathInfo.allResultingItems.map((info) => info.path),

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
    partialNarinfos,
  };
}

async function executeLoadArchiveDeltaCommand(
  {
    archivePath,
    deltaDependencies,
    item,
    partialNarinfos,
  }: z.infer<typeof loadArchiveDeltaCommandSchema>,
  {
    storePath,
    clientStateStorePath,
    instructionFolderPath,
    progressCallback,
  }: InstructionExecutionSharedArgs,
): Promise<void> {
  // Copy all the narinfo files into the archive
  const absoluteArchivePath = path.join(instructionFolderPath, archivePath);

  const existingNarinfoFilePaths =
    await getAbsoluteNarinfoListInDir(absoluteArchivePath);

  const narinfoFiles = await getNarinfoFileListForNixPaths({
    storePath: storePath == "/" ? undefined : storePath,
    clientStateStorePath,
    nixPaths: deltaDependencies.map((d) => d.nixPath),
  });

  for (const narinfoFile of narinfoFiles) {
    const narinfoFilename = path.basename(narinfoFile);

    const destinationPath = path.join(absoluteArchivePath, narinfoFilename);

    await fs.promises.copyFile(narinfoFile, destinationPath);
  }

  progressCallback("Copying nix store items to the store");

  // Copy the item into the store
  await copyArchiveToStore({
    archivePath: absoluteArchivePath,
    item: item.nixPath,
    storePath: storePath == "/" ? undefined : storePath,
  });

  progressCallback("Updating local config");

  await copyNarinfoFilesToCache({
    clientStateStorePath,
    narinfoFilePaths: existingNarinfoFilePaths,
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
