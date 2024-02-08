import path from "path";
import fs from "fs";
import { copyOutputToArchive, makeArchiveSubset } from "./nixArchive";
import { FlakeBuildResult, buildSystemFlake } from "./nixFlake";
import { getStoreDeltaPathsDelta } from "./nixStore";
import { compressInstructionDir, makeDirInstruction } from "./instructions";

type BuildSystemUpdateInstructionArgs = {
  nixFlakeAbsolutePath: string;
  workdirPath?: string;
  destinationPath: string | "-";
  hostname: string;
  pastRevs: string[];
  newRev: string;
};

export async function buildSystemUpdateInstruction({
  nixFlakeAbsolutePath,
  workdirPath,
  destinationPath,
  hostname,
  pastRevs,
  newRev,
}: BuildSystemUpdateInstructionArgs) {
  const flakePath = nixFlakeAbsolutePath;
  if (!workdirPath) {
    workdirPath = `${flakePath}/.nix`;
  }
  const nixStorePath = workdirPath;
  const tempWorkdirPath = `${workdirPath}/tmp`;
  const nixArchivePath = `${workdirPath}/archive`;

  console.log("Building previous revisions");

  const oldRevBuildInfos: FlakeBuildResult[] = [];
  for (const rev of pastRevs) {
    console.log(`Building revision ${rev}`);
    const info = await buildSystemFlake({
      flakeAbsolutePath: flakePath,
      hostname,
      storeAbsolutePath: nixStorePath,
      rev,
    });

    oldRevBuildInfos.push(info);
  }

  console.log("Building new revision");
  const newRevBuildInfo = await buildSystemFlake({
    flakeAbsolutePath: flakePath,
    hostname,
    storeAbsolutePath: nixStorePath,
    rev: newRev,
  });

  console.log("Copying to archive");

  await copyOutputToArchive({
    storePath: nixStorePath,
    archivePath: nixArchivePath,
    item: newRevBuildInfo.output,
  });

  console.log("Getting path info");

  const pathInfo = await getStoreDeltaPathsDelta({
    storePath: nixStorePath,
    fromRootPathNames: oldRevBuildInfos.map((info) => info.output),
    toRootPathName: newRevBuildInfo.output,
  });

  console.log("Building new archive");

  let pastRevsStr = pastRevs.length > 0 ? pastRevs.join("-") : "root";
  const commandDirPath = path.join(
    tempWorkdirPath,
    `subset-from-${pastRevsStr}-to-${newRev}`
  );
  const newArchivePath = path.join(commandDirPath, "archive");

  console.log(
    `${pathInfo.added.length} paths added, with a total ${pathInfo.allResultingItems.length} store items.`
  );

  // Delete old command dir path if exists
  await fs.promises.rm(commandDirPath, { force: true, recursive: true });

  await makeArchiveSubset({
    archivePath: nixArchivePath,
    destinationPath: newArchivePath,
    infoItemPaths: pathInfo.added.map((info) => info.path),
    dataItemPaths: pathInfo.added.map((info) => info.path),
  });

  console.log("Making sync store instruction");

  await makeDirInstruction({
    data: {
      kind: "switch",
      item: {
        archivePath: "archive",
        itemPath: newRevBuildInfo.output,
      },
      deltaDependencyRevs: pastRevs,
      newRev,
    },
    destinationFolder: commandDirPath,
  });

  await compressInstructionDir({
    dirPath: commandDirPath,
    destinationPath,
  });

  // Delete the command dir path
  // await fs.promises.rm(commandDirPath, { force: true, recursive: true });
}

// type Copy = {
//   archivePath: string;
//   storePath?: string;
// }

// export async function applySystemUpdateFromArchive()
