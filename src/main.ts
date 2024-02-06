import { command, run, string, positional, subcommands } from "cmd-ts";
import {
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

    console.log("Building previous revision");
    const pastRev = "4e9311059d7e2b4bdade9e401566c34d0c72a5d2";
    const newRev = "029352bf021d316d0e3bbd54c5a5f6c634b5512f";

    const info1 = await buildSystemFlake({
      flakeAbsolutePath: absolutePath,
      hostname: "testvm",
      storeAbsolutePath: nixStorePath,
      rev: pastRev,
    });

    console.log("Building new revision");

    const info2 = await buildSystemFlake({
      flakeAbsolutePath: absolutePath,
      hostname: "testvm",
      storeAbsolutePath: nixStorePath,
      rev: newRev,
    });

    console.log("Copying to archive");

    await copyOutputToArchive({
      storePath: nixStorePath,
      archivePath: nixArchivePath,
      item: info2.output,
    });

    console.log("Getting path info");

    const pathInfo = await getStoreDeltaPathsDelta({
      storePath: nixStorePath,
      fromRootPathName: info1.output,
      toRootPathName: info2.output,
    });

    console.log("Building new archive");

    const newArchivePath = `${tempWorkdirPath}/subset-${pastRev}-${newRev}`;

    await makeArchiveSubset({
      archivePath: nixArchivePath,
      destinationPath: newArchivePath,
      dataItemPaths: pathInfo.added.map((info) => info.path),
      infoItemPaths: pathInfo.allToItems.map((info) => info.path),
    });
  },
});

const app = subcommands({
  name: "Nix remote transfer",
  cmds: { dummy },
});

run(app, process.argv.slice(2));
