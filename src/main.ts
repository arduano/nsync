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
import { buildSystemUpdateInstruction } from "./utils/operations";

const absolutePath = "/home/arduano/programming/spiralblue/vms/test-flake";

// Base = e7a4e422fed320cbd580669d142fd8f538edac89
// Python+opencv = 1fe3947a35dd67dcc1ca1fd813070c8fb7b19b8d
// Python = e61616302545726f0f429a45d166d1cd794357ac

// const pastRevs = ["5e93f72a2a85affa0eb4f6106b00b08c75c93475"];
const pastRevs: string[] = [];
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
  cmds: { dummy, build },
});

run(app, process.argv.slice(2));
