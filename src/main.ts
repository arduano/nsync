import {
  command,
  run,
  string,
  positional,
  flag,
  option,
  subcommands,
  array,
  multioption,
  optional,
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
import {
  BuildCommandArgs,
  buildInstructionFolder,
  executeInstructionFolder,
} from "./utils/instructions/common";
import {
  compressInstructionDir,
  decompressInstructionDir,
} from "./utils/instructions/compression";
import { customAlphabet, nanoid } from "nanoid";

const fileId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 10);

// const absolutePath = "/home/arduano/programming/spiralblue/vms/test-flake";

// Base = e7a4e422fed320cbd580669d142fd8f538edac89
// Python+opencv = 1fe3947a35dd67dcc1ca1fd813070c8fb7b19b8d
// Python = e61616302545726f0f429a45d166d1cd794357ac

// Base 2 = bb60c1fc88e454cceed98ec3af0e0750481536b5
// Base 2 with `hello` = f76088a37336f3226065a6405b81494b06eced20

// const pastRevs = ["5e93f72a2a85affa0eb4f6106b00b08c75c93475"];
// const pastRevs: string[] = ["bb60c1fc88e454cceed98ec3af0e0750481536b5"];
// const newRev = "f76088a37336f3226065a6405b81494b06eced20";
// const hostname = "testvm";

function splitFlakeArgToUriAndHostname(flake: string) {
  if (!flake.includes("#")) {
    throw new Error(
      "Invalid flake address. A hostname is required, e.g. `github:owner/repo#hostname` or `/path/to/flake#hostname`"
    );
  }

  const [uri, hostname] = flake.split("#");

  if (hostname.includes("?")) {
    throw new Error(
      "Invalid flake address. Query strings aren't supported in flake addresses in nsync."
    );
  }

  return [uri, hostname] as const;
}

function getWorkdirFromFlakeArg(flake: string) {
  // If the flake is a local path, then the workdir is path/.nsync
  // A flake path is local if there is no `:` in the path.

  if (flake.includes(":")) {
    return undefined;
  }

  const [path, _] = flake.split("#");
  const absolutePath = ensurePathAbsolute(path);

  return `${absolutePath}/.nsync`;
}

const create = command({
  name: "create",
  description:
    "Create a new system build instruction, specifying the new git ref and the other git refs it depends on.",
  args: {
    flakeUriWithHostname: positional({
      type: string,
      description:
        "The location and hostname of the flake. Uses nix-like flake addresses, e.g. `github:owner/repo#hostname`",
    }),
    output: option({
      type: string,
      long: "output",
      short: "o",
      description: "The output path. The format is a .tar.xz file.",
    }),
    workdirPath: option({
      type: optional(string),
      long: "workdir",
      short: "w",
      description:
        "The working directory path, where the nix store is built and the instruction is built before being compressed. Defaults to `.nsync` inside the flake's directory, or if the flake is remote, then this is a required argument.",
    }),
    dependencyRefs: multioption({
      type: array(string),
      long: "deps",
      short: "d",
      description:
        "The git refs that the new system build depends on. Only the changes will be transferred. Defaults to no dependencies, building the full system.",
    }),
    newRef: option({
      type: string,
      long: "new",
      short: "n",
      description:
        "The new git ref to build the system with. This is the ref that the system will switch to after the instruction is executed.",
    }),
    reboot: flag({
      long: "reboot",
      short: "r",
      description:
        "Reboot the receiving system after the instruction is executed",
    }),
  },
  handler: async ({
    flakeUriWithHostname,
    workdirPath,
    reboot,
    dependencyRefs,
    newRef,
    output,
  }) => {
    const [flakeUri, hostname] =
      splitFlakeArgToUriAndHostname(flakeUriWithHostname);
    const guessedWorkdirPath = getWorkdirFromFlakeArg(flakeUri);

    if (!guessedWorkdirPath && !workdirPath) {
      throw new Error(
        "If the flake is remote, then the workdir path is required. Use the --workdir or -w option."
      );
    }

    workdirPath = workdirPath || guessedWorkdirPath!;

    const workdirStorePath = `${workdirPath}`;
    const workdirArchivePath = `${workdirPath}/archive`;
    const instructionFolderPath = `${workdirPath}/tmp/${fileId()}`;

    const buildArgs: BuildCommandArgs[] = [];
    buildArgs.push({
      kind: "load",
      archiveFolderName: "archive",
      deltaDependencyRefs: dependencyRefs,
      partialNarinfos: true,
      newRef,
      hostname,
      flakeUri,
    });
    buildArgs.push({
      kind: "switch",
      mode: "immediate",
      flakeUri,
      hostname,
      ref: newRef,
    });

    if (reboot) {
      buildArgs.push({
        kind: "reboot",
        delay: 5,
      });
    }

    // Build the instruction
    await buildInstructionFolder(buildArgs, {
      instructionFolderPath,
      workdirStorePath,
      workdirArchivePath,
      progressCallback: (progress) => {
        console.log(progress);
      },
    });

    // Compress the instruction
    await compressInstructionDir({
      destinationPath: output,
      instructionDir: instructionFolderPath,
    });

    // Cleanup
    await fs.promises.rm(instructionFolderPath, { recursive: true });
  },
});

const exec = command({
  name: "Execute an instruction from an archive",
  args: {
    workdirPath: option({
      type: optional(string),
      long: "workdir",
      short: "w",
      description:
        "The work directory to extract the instruction to. Defaults to a folder inside /tmp",
    }),
    instructionPath: option({
      type: string,
      long: "instruction",
      short: "i",
      description: "The instruction to execute. This is a .tar.xz file.",
    }),
    storePath: option({
      type: string,
      long: "store",
      short: "s",
      description: "The store path to write to. Defaults to /",
      defaultValue: () => "/",
    }),
    clientStateStorePath: option({
      type: string,
      long: "client-state",
      short: "c",
      description: "The client state path. Defaults to /var/lib/nsync",
      defaultValue: () => "/var/lib/nsync",
    }),
  },
  handler: async ({
    workdirPath,
    instructionPath,
    clientStateStorePath,
    storePath,
  }) => {
    workdirPath = workdirPath || `/tmp/nsync-${fileId()}`;

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

    await executeInstructionFolder({
      clientStateStorePath,
      instructionFolderPath: workdirPath,
      storePath,
      progressCallback: (progress) => {
        console.log(progress);
      },
    });

    console.log("Cleaning up");

    // Cleanup workdir
    await fs.promises.rm(workdirPath, { recursive: true });
  },
});

const app = subcommands({
  name: "Nix TCP-less remote transfer",
  cmds: { create, exec },
});

run(app, process.argv.slice(2));
