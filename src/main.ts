import { command, run, string, positional, subcommands } from "cmd-ts";
import {
  FlakeBuildResult,
  buildSystemFlake,
  getFlakeHostnames,
  getFlakeInfo,
  getGitRevisions,
} from "./utils/nixFlake";
import {
  getPathInfo,
  getPathInfoTreeSearch,
  getStoreDeltaPathsDelta,
} from "./utils/nixStore";
import { copyOutputToArchive, makeArchiveSubset } from "./utils/nixArchive";
import {
  compressInstructionDir,
  makeDirInstruction,
} from "./utils/instructions";
import path from "path";
import fs from "fs";

const absolutePath = "/home/arduano/programming/spiralblue/vms/test-flake";

const dummy = command({
  name: "dummy command for testing",
  args: {
    // someArg: positional({ type: string, displayName: "some arg" }),
  },
  handler: async ({}) => {
    const nixStorePath = `${absolutePath}/.nix`;
    const tempWorkdirPath = `${nixStorePath}/tmp`;
    const nixArchivePath = `${nixStorePath}/archive`;

    console.log("Building previous revisions");

    const pastRevs = ["4e9311059d7e2b4bdade9e401566c34d0c72a5d2"];
    const newRev = "029352bf021d316d0e3bbd54c5a5f6c634b5512f";
    const hostname = "testvm";

    const oldRevBuildInfos: FlakeBuildResult[] = [];
    for (const rev of pastRevs) {
      console.log(`Building revision ${rev}`);
      const info = await buildSystemFlake({
        flakeAbsolutePath: absolutePath,
        hostname,
        storeAbsolutePath: nixStorePath,
        rev,
      });

      oldRevBuildInfos.push(info);
    }

    console.log("Building new revision");
    const newRevBuildInfo = await buildSystemFlake({
      flakeAbsolutePath: absolutePath,
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

    const commandDirPath = path.join(
      tempWorkdirPath,
      `subset-from-${pastRevs.join("-")}-to-${newRev}`
    );
    const newArchivePath = path.join(commandDirPath, "archive");

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
      destinationPath: path.join(tempWorkdirPath, "instruction.tar.xz"),
    });

    // Delete the command dir path
    await fs.promises.rm(commandDirPath, { force: true, recursive: true });
  },
});

const app = subcommands({
  name: "Nix remote transfer",
  cmds: { dummy },
});

run(app, process.argv.slice(2));
