import { z } from "zod";
import {
  CommandImplementation,
  InstructionBuilderSharedArgs,
  storeRoot,
} from "../common";
import { FlakeBuildResult, buildSystemFlake } from "../../nixFlake";
import { copyOutputToArchive, makeArchiveSubset } from "../../nixArchive";
import { getStoreDeltaPathsDelta } from "../../nixStore";
import path from "path";
import fs from "fs";

export const loadArchiveDeltaCommandSchema = z.object({
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

export type BuildLoadArchiveDeltaCommandArgs = {
  kind: "load";
  flakeGitUri: string;
  hostname: string;
  archiveFolderName: string;
  deltaDependencyRevs: string[];
  partialNarinfos: boolean;
  newRev: string;
};

export async function buildLoadArchiveDeltaCommand(
  {
    kind,
    archiveFolderName,
    flakeGitUri,
    hostname,
    deltaDependencyRevs,
    partialNarinfos,
    newRev,
  }: BuildLoadArchiveDeltaCommandArgs,
  {
    instructionFolderPath,
    workdirArchivePath,
    workdirStorePath,
    progressCallback,
  }: InstructionBuilderSharedArgs
): Promise<z.infer<typeof loadArchiveDeltaCommandSchema>> {
  progressCallback("Building previous revisions");

  type BuildInfo = FlakeBuildResult & { rev: string };
  const oldRevBuildInfos: BuildInfo[] = [];
  for (const rev of deltaDependencyRevs) {
    progressCallback(`Building revision ${rev}`);
    const info = await buildSystemFlake({
      flakeGitUri,
      hostname,
      storeAbsolutePath: workdirStorePath,
      rev,
    });

    oldRevBuildInfos.push({
      rev,
      ...info,
    });
  }

  progressCallback("Building new revision");
  const newRevBuildInfo = await buildSystemFlake({
    flakeGitUri,
    hostname,
    storeAbsolutePath: workdirStorePath,
    rev: newRev,
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
    `${pathInfo.added.length} paths added, with a total ${pathInfo.allResultingItems.length} store items.`
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
      gitRevision: newRev,
      nixPath: newRevBuildInfo.output,
    },
    partialNarinfos,
  };
}

export const loadArchiveDeltaCommand = {
  kind: "load" as const,
  schema: loadArchiveDeltaCommandSchema,
  build: buildLoadArchiveDeltaCommand,
} satisfies CommandImplementation<
  BuildLoadArchiveDeltaCommandArgs,
  typeof loadArchiveDeltaCommandSchema
>;
