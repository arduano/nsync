import {
  command,
  run,
  string,
  positional,
  flag,
  option,
  subcommands,
} from "cmd-ts";
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
  assertInstructionDirValid,
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
  getClientStoreNarinfoCachePathAsStorePath,
  getNarinfoFileListForNixPaths,
} from "./utils/clientStore";
import {
  getNixStoreGenerations,
  makeNewSystemGeneration,
} from "./utils/nixGenerations";
import { getAbsoluteNarinfoListInDir } from "./utils/files";
import { ensurePathAbsolute } from "./utils/helpers";

const absolutePath = "/home/arduano/programming/spiralblue/vms/test-flake";

// Base = e7a4e422fed320cbd580669d142fd8f538edac89
// Python+opencv = 1fe3947a35dd67dcc1ca1fd813070c8fb7b19b8d
// Python = e61616302545726f0f429a45d166d1cd794357ac

// Base 2 = bb60c1fc88e454cceed98ec3af0e0750481536b5
// Base 2 with `hello` = f76088a37336f3226065a6405b81494b06eced20

// const pastRevs = ["5e93f72a2a85affa0eb4f6106b00b08c75c93475"];
const pastRevs: string[] = ["bb60c1fc88e454cceed98ec3af0e0750481536b5"];
const newRev = "bb60c1fc88e454cceed98ec3af0e0750481536b5";
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

const cmd = command({
  name: "my number",
  args: {
    myNumber: option({
      type: string,
      long: "my-number",
      short: "n",
    }),
  },
  handler: async ({ myNumber }) => {},
});

const dummy2 = command({
  name: "dummy command for testing",
  args: {
    workdirPath: option({
      type: string,
      long: "workdir",
      description: "workdir path",
      defaultValue: () => `${absolutePath}/.nix/tmp/installer-workdir`,
    }),
    instructionPath: option({
      type: string,
      long: "instruction",
      description: "instruction path",
      // defaultValue: () => `${absolutePath}/.nix/instruction_increment.tar.xz`,
      defaultValue: () => `${absolutePath}/.nix/instruction_full.tar.xz`,
    }),
    storePath: option({
      type: string,
      long: "store",
      description: "store path",
      defaultValue: () => `${absolutePath}/.nix2`,
    }),
    clientStateStorePath: option({
      type: string,
      long: "clientState",
      description: "client state path",
      defaultValue: () => `${absolutePath}/.nix/tmp/client-state-store`,
    }),
    addGeneration: flag({
      long: "add-gen",
      description: "Add a generation to the store with the new system build",
    }),
  },
  handler: async ({
    workdirPath,
    instructionPath,
    clientStateStorePath,
    storePath,
    addGeneration,
  }) => {
    workdirPath = ensurePathAbsolute(workdirPath);
    instructionPath = ensurePathAbsolute(instructionPath);
    clientStateStorePath = ensurePathAbsolute(clientStateStorePath);
    storePath = ensurePathAbsolute(storePath);

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

    // Ensure that all the dependent nix paths are in both the store and the client state store
    let dependentNixPaths = instruction.deltaDependencies.map((d) => d.nixPath);
    for (let dependentPath in dependentNixPaths) {
      try {
        await getPathInfo({
          storePath: storePath == "/" ? undefined : storePath,
          pathName: dependentPath,
        });
      } catch (e) {
        console.error(
          "Failed to execute instruction because a dependent derivation is missing in the nix store"
        );
        console.error("Dependent path: " + dependentPath);
        return 1;
      }

      try {
        let storePath =
          getClientStoreNarinfoCachePathAsStorePath(clientStateStorePath);
        await getPathInfo({
          storePath,
          pathName: dependentPath,
        });
      } catch (e) {
        console.error(
          "Failed to execute instruction because a dependent derivation is missing in the client state store"
        );
        console.error("Dependent path: " + dependentPath);
        return 1;
      }
    }

    await assertInstructionDirValid(workdirPath);

    // Copy all the narinfo files into the archive
    const archivePath = path.join(workdirPath, instruction.item.archivePath);

    const existingNarinfoFilePaths = await getAbsoluteNarinfoListInDir(
      archivePath
    );

    const narinfoFiles = await getNarinfoFileListForNixPaths({
      storePath: storePath == "/" ? undefined : storePath,
      clientStateStorePath: clientStateStorePath,
      nixPaths: instruction.deltaDependencies.map((d) => d.nixPath),
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
      storePath: storePath == "/" ? undefined : storePath,
    });

    console.log("Updating local config");

    await copyNarinfoFilesToCache({
      clientStateStorePath,
      narinfoFilePaths: existingNarinfoFilePaths,
    });

    console.log("Updating system generations");

    await makeNewSystemGeneration({
      storePath,
      nixItemPath: instruction.item.itemPath,
      executeActivation: addGeneration ? "switch" : undefined,
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

const listGenerations = command({
  name: "list the generations",
  args: {
    // someArg: positional({ type: string, displayName: "some arg" }),
  },
  handler: async ({}) => {
    const generations = await getNixStoreGenerations(
      "/nix/var/nix/profiles/system"
    );
    console.log(generations);
  },
});

const app = subcommands({
  name: "Nix remote transfer",
  cmds: { dummy, dummy2, build, listGenerations },
});

run(app, process.argv.slice(2));
