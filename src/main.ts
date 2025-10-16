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
  oneOf,
} from "cmd-ts";

import fs from "fs";

import { ensurePathAbsolute } from "./helpers";
import type { BuildCommandArgs } from "./instructions/common";
import {
  buildInstructionFolder,
  executeInstructionFolder,
} from "./instructions/common";
import {
  compressInstructionDir,
  decompressInstructionDir,
} from "./instructions/compression";
import { customAlphabet } from "nanoid";
import { CommandError, wrapCommandError } from "./errors";
import { parseGitPointer } from "./utils/git";
import { logger } from "./logger";

const fileId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 10);

function splitFlakeArgToUriAndHostname(flake: string) {
  if (!flake.includes("#")) {
    throw new CommandError(
      `Invalid flake address: "${flake}"`,
      "A hostname is required, e.g. `github:owner/repo#hostname` or `/path/to/flake#hostname`",
    );
  }

  const [uri, hostname] = flake.split("#");

  if (hostname.includes("?")) {
    throw new CommandError(
      `Invalid flake address: "${flake}"`,
      "Query strings aren't supported in flake addresses in nsync. Use the flake uri and hostname, e.g. `github:owner/repo#hostname` or `/path/to/flake#hostname`",
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

function isRoot() {
  const hasVar = !!process.env.SUDO_UID; // SUDO_UID is undefined when not root
  const rootUid = process.getuid?.() == 0; // getuid() returns 0 for root
  return hasVar || rootUid;
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
    workdirStorePath: option({
      type: optional(string),
      long: "workdir-store",
      description:
        "The working directory path for the temporary nix store used while building instructions. Defaults to the workdir path.",
    }),
    workdirArchivePath: option({
      type: optional(string),
      long: "workdir-archive",
      description:
        "The working directory path for the temporary archive used while building instructions. Defaults to `${workdir}/archive`.",
    }),
    switchMode: option({
      type: oneOf(["immediate", "next-reboot"] as const),
      defaultValue: () => "next-reboot" as const,
      long: "switch-mode",
      description:
        'How to apply the new system generation on the target. Defaults to "next-reboot".',
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
    workdirPath: workdirPathOption,
    workdirStorePath: workdirStorePathOption,
    workdirArchivePath: workdirArchivePathOption,
    switchMode,
    reboot,
    dependencyRefs,
    newRef,
    output,
  }) => {
    return wrapCommandError(async () => {
      const [flakeUri, hostname] =
        splitFlakeArgToUriAndHostname(flakeUriWithHostname);
      const guessedWorkdirPath = getWorkdirFromFlakeArg(flakeUri);

      if (!guessedWorkdirPath && !workdirPathOption) {
        throw new CommandError(
          "Used a remote flake without specifying a workdir",
          "If the flake is remote, then the workdir path is required. Use the --workdir or -w option. Local flakes default the workdir to './.nsync' inside the flake's directory.",
        );
      }

      const workdirPath = workdirPathOption ?? guessedWorkdirPath!;

      const workdirStorePath = workdirStorePathOption ?? workdirPath;
      const workdirArchivePath =
        workdirArchivePathOption ?? `${workdirPath}/archive`;
      const instructionFolderPath = `${workdirPath}/tmp/${fileId()}`;

      const dependencyPointers = dependencyRefs.flat().map(parseGitPointer);
      const newPointer = parseGitPointer(newRef);

      const buildArgs: BuildCommandArgs[] = [];
      buildArgs.push({
        kind: "load",
        archiveFolderName: "archive",
        deltaDependencyPointers: dependencyPointers,
        newPointer,
        hostname,
        flakeUri,
      });
      buildArgs.push({
        kind: "switch",
        mode: switchMode,
        flakeUri,
        hostname,
        gitPointer: newPointer,
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
          logger.progress(progress);
        },
      });

      // Compress the instruction
      await compressInstructionDir({
        destinationPath: output,
        instructionDir: instructionFolderPath,
      });

      // Cleanup
      await fs.promises.rm(instructionFolderPath, { recursive: true });
    });
  },
});

const exec = command({
  name: "exec",
  description: "Execute an instruction on the current system",
  args: {
    instructionPath: positional({
      type: string,
      description: "The instruction to execute. This is a .tar.xz file.",
    }),
    workdirPath: option({
      type: optional(string),
      long: "workdir",
      short: "w",
      description:
        "The work directory to extract the instruction to. Defaults to a folder inside /tmp",
    }),
    storePath: option({
      type: string,
      long: "store",
      short: "s",
      description: "The store path to write to. Defaults to /",
      defaultValue: () => "/",
    }),
  },
  handler: async ({ workdirPath, instructionPath, storePath }) => {
    return wrapCommandError(async () => {
      if (!isRoot()) {
        throw new CommandError(
          "This command must be run as root",
          "Root access is required, as this command will write to the nix store, and modify system generations.",
        );
      }

      const progressCallback = (progress: string) => {
        logger.progress(progress);
      };

      workdirPath = workdirPath || `/tmp/nsync-${fileId()}`;

      workdirPath = ensurePathAbsolute(workdirPath);
      instructionPath = ensurePathAbsolute(instructionPath);
      storePath = ensurePathAbsolute(storePath);

      try {
        // Make workdir
        await fs.promises.mkdir(workdirPath, { recursive: true });

        progressCallback(`Decompressing instruction to ${workdirPath}`);

        // Extract instruction
        await decompressInstructionDir({
          destinationDir: workdirPath,
          instructionPath,
        });

        progressCallback(`Executing instruction in ${workdirPath}`);

        await executeInstructionFolder({
          instructionFolderPath: workdirPath,
          storePath,
          progressCallback,
        });
      } finally {
        progressCallback("Cleaning up");

        // Cleanup workdir
        await fs.promises.rm(workdirPath, { recursive: true });
      }
    });
  },
});

const app = subcommands({
  name: "nsync",
  description: "Nix TCP-less remote transfer",
  cmds: { create, exec },
});

void run(app, process.argv.slice(2));
