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
import {
  copyArchiveToStore,
  copyOutputToArchive,
  makeArchiveSubset,
} from "./utils/nixArchive";
import {
  compressInstructionDir,
  decompressInstructionDir,
  makeDirInstruction,
  readDirInstruction,
} from "./utils/instructions";
import path from "path";
import fs from "fs";
import { buildSystemUpdateInstruction } from "./utils/operations";
import {
  copyNarinfoFilesToCache,
  getNarinfoFileListForRevisions,
} from "./utils/clientStore";

const absolutePath = "/home/arduano/programming/spiralblue/vms/test-flake";

// Base = e7a4e422fed320cbd580669d142fd8f538edac89
// Python+opencv = 1fe3947a35dd67dcc1ca1fd813070c8fb7b19b8d
// Python = e61616302545726f0f429a45d166d1cd794357ac

// const pastRevs = ["5e93f72a2a85affa0eb4f6106b00b08c75c93475"];
const pastRevs: string[] = ["bb60c1fc88e454cceed98ec3af0e0750481536b5"];
const newRev = "f76088a37336f3226065a6405b81494b06eced20";
const hostname = "testvm";

const dummy = command({
  name: "dummy command for testing",
  args: {
    // someArg: positional({ type: string, displayName: "some arg" }),
  },
  handler: async ({}) => {
    await buildSystemUpdateInstruction({
      destinationPath: `${absolutePath}/.nix/instruction.tar.xz`,
      hostname,
      pastRevs,
      newRev,
      nixFlakeAbsolutePath: absolutePath,
    });
  },
});

const dummy2 = command({
  name: "dummy command for testing",
  args: {
    // someArg: positional({ type: string, displayName: "some arg" }),
  },
  handler: async ({}) => {
    const instructionPath = `${absolutePath}/.nix/instruction.tar.xz`;
    const workdirPath = `${absolutePath}/.nix/tmp/installer-workdir`;
    const clientStateStorePath = `${absolutePath}/.nix/tmp/client-state-store`;
    const storePath = `${absolutePath}/.nix2`;

    // Make workdir
    await fs.promises.mkdir(workdirPath, { recursive: true });

    console.log("Decompressing instruction");

    // Extract instruction
    await decompressInstructionDir({
      destinationDir: workdirPath,
      instructionPath,
    });

    // Read instruction
    const instruction = await readDirInstruction(workdirPath);

    if (instruction.kind !== "switch") {
      throw new Error("Invalid instruction kind");
    }

    // Copy all the narinfo files into the archive
    const archivePath = path.join(workdirPath, instruction.item.archivePath);

    // Assert the archive exists
    if (!fs.existsSync(archivePath)) {
      throw new Error("Archive does not exist");
    }

    const existingNarinfoFiles = await fs.promises.readdir(archivePath);
    const existingNarinfoPaths = existingNarinfoFiles.map((file) =>
      path.join(archivePath, file)
    );
    const existingNarinfoFilePaths = [];
    for (const narinfoPath of existingNarinfoPaths) {
      const stat = await fs.promises.stat(narinfoPath);
      if (stat.isFile()) {
        existingNarinfoFilePaths.push(narinfoPath);
      }
    }

    const narinfoFiles = await getNarinfoFileListForRevisions({
      storePath: storePath,
      clientStateStorePath: clientStateStorePath,
      revs: instruction.deltaDependencyRevs,
    });

    for (const narinfoFile of narinfoFiles) {
      const narinfoFilename = path.basename(narinfoFile);

      const destinationPath = path.join(archivePath, narinfoFilename);

      await fs.promises.copyFile(narinfoFile, destinationPath);
    }

    console.log("Copying nix store items to the store");

    // Copy the item into the store
    await copyArchiveToStore({
      archivePath,
      item: instruction.item.itemPath,
      storePath,
    });

    console.log("Updating local config");

    await copyNarinfoFilesToCache({
      clientStateStorePath,
      narinfoFilePaths: existingNarinfoFilePaths,
    });

    console.log("Cleaning up");

    // Cleanup workdir
    await fs.promises.rm(workdirPath, { recursive: true });
  },
});

const build = command({
  name: "build the current flake, nothing else",
  args: {
    // someArg: positional({ type: string, displayName: "some arg" }),
  },
  handler: async ({}) => {
    const nixStorePath = `${absolutePath}/.nix`;
    const tempWorkdirPath = `${nixStorePath}/tmp`;
    const nixArchivePath = `${nixStorePath}/archive`;

    console.log("Building");

    const newRevBuildInfo = await buildSystemFlake({
      flakeAbsolutePath: absolutePath,
      hostname,
      storeAbsolutePath: nixStorePath,
    });
  },
});

const app = subcommands({
  name: "Nix remote transfer",
  cmds: { dummy, dummy2, build },
});

run(app, process.argv.slice(2));
