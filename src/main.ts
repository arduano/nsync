import { command, run, string, positional, subcommands } from "cmd-ts";
import {
  getFlakeHostnames,
  getFlakeInfo,
  getGitRevisions,
} from "./utils/queryFlake";

const absolutePath = "/home/arduano/programming/spiralblue/vms/test-flake";

const dummy = command({
  name: "dummy command for testing",
  args: {
    // someArg: positional({ type: string, displayName: "some arg" }),
  },
  handler: async ({}) => {
    const info = await getGitRevisions({
      absolutePath,
      //   rev: "a37ffb16348fc42b261ae785014ce9787182a419",
    });

    console.log(info);
  },
});

const app = subcommands({
  name: "Nix remote transfer",
  cmds: { dummy },
});

run(app, process.argv.slice(2));
