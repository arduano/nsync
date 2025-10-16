import { z } from "zod";
import type { GitPointer } from "../../utils/git";
import { buildSystemFlake } from "../../utils/nixFlake";
import type {
  InstructionBuilderSharedArgs,
  CommandImplementation,
  InstructionExecutionSharedArgs,
} from "../schemas";
import { storeRoot } from "../schemas";
import { makeNewSystemGeneration } from "../../utils/nixGenerations";

const storeSwitchCommandSchema = z.object({
  // Command to "apply the nix package as the next generation and switch to it"
  kind: z.literal("switch"),
  item: storeRoot,
  mode: z.union([z.literal("immediate"), z.literal("next-reboot")]),
});

type BuildStoreSwitchCommandArgs = {
  kind: "switch";
  flakeUri: string;
  hostname: string;
  gitPointer: GitPointer;
  mode: "immediate" | "next-reboot";
};

async function buildStoreSwitchCommand(
  { kind, flakeUri, hostname, gitPointer, mode }: BuildStoreSwitchCommandArgs,
  { workdirStorePath, progressCallback }: InstructionBuilderSharedArgs,
): Promise<z.infer<typeof storeSwitchCommandSchema>> {
  progressCallback("Building switch command");

  const buildInfo = await buildSystemFlake({
    flakeUri,
    hostname,
    storeAbsolutePath: workdirStorePath,
    gitPointer,
  });

  return {
    kind,
    item: {
      nixPath: buildInfo.output,
      gitRevision: buildInfo.gitRevision.value,
    },
    mode,
  };
}

async function executeStoreSwitchCommand(
  args: z.infer<typeof storeSwitchCommandSchema>,
  shared: InstructionExecutionSharedArgs,
): Promise<void> {
  const executeActivation = args.mode === "immediate" ? "switch" : undefined;

  await makeNewSystemGeneration({
    storePath: shared.storePath,
    nixItemPath: args.item.nixPath,
    executeActivation,
  });
}

export const storeSwitchCommand = {
  kind: "switch" as const,
  schema: storeSwitchCommandSchema,
  build: buildStoreSwitchCommand,
  execute: executeStoreSwitchCommand,
} satisfies CommandImplementation<
  BuildStoreSwitchCommandArgs,
  typeof storeSwitchCommandSchema
>;
