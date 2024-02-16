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
    return wrapCommandError(async () => {
      const [flakeUri, hostname] =
        splitFlakeArgToUriAndHostname(flakeUriWithHostname);
      const guessedWorkdirPath = getWorkdirFromFlakeArg(flakeUri);

      if (!guessedWorkdirPath && !workdirPath) {
        throw new CommandError(
          "Used a remote flake without specifying a workdir",
          "If the flake is remote, then the workdir path is required. Use the --workdir or -w option. Local flakes default the workdir to './.nsync' inside the flake's directory.",
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
          // eslint-disable-next-line no-console
          console.warn(progress);
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
        // eslint-disable-next-line no-console
        console.warn(progress);
      };

      workdirPath = workdirPath || `/tmp/nsync-${fileId()}`;

      workdirPath = ensurePathAbsolute(workdirPath);
      instructionPath = ensurePathAbsolute(instructionPath);
      storePath = ensurePathAbsolute(storePath);

      // Make workdir
      await fs.promises.mkdir(workdirPath, { recursive: true });

      progressCallback("Decompressing instruction");

      // Extract instruction
      await decompressInstructionDir({
        destinationDir: workdirPath,
        instructionPath,
      });

      await executeInstructionFolder({
        instructionFolderPath: workdirPath,
        storePath,
        progressCallback,
      });

      progressCallback("Cleaning up");

      // Cleanup workdir
      await fs.promises.rm(workdirPath, { recursive: true });
    });
  },
});

const app = subcommands({
  name: "Nix TCP-less remote transfer",
  cmds: { create, exec },
});

void run(app, process.argv.slice(2));
