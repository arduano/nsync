import { z } from "zod";
import { buildSystemFlake } from "../../nixFlake";
import {
  storeRoot,
  InstructionBuilderSharedArgs,
  CommandImplementation,
  InstructionExecutionSharedArgs,
} from "../schemas";
import { makeNewSystemGeneration } from "../../nixGenerations";

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
  ref: string;
  mode: "immediate" | "next-reboot";
};

async function buildStoreSwitchCommand(
  { kind, flakeUri, hostname, ref, mode }: BuildStoreSwitchCommandArgs,
  { workdirStorePath, progressCallback }: InstructionBuilderSharedArgs
): Promise<z.infer<typeof storeSwitchCommandSchema>> {
  progressCallback("Building switch command");

  const buildInfo = await buildSystemFlake({
    flakeUri,
    hostname,
    storeAbsolutePath: workdirStorePath,
    ref: ref,
  });

  return {
    kind,
    item: {
      nixPath: buildInfo.output,
      gitRevision: buildInfo.gitRevision,
    },
    mode,
  };
}

async function executeStoreSwitchCommand(
  args: z.infer<typeof storeSwitchCommandSchema>,
  shared: InstructionExecutionSharedArgs
): Promise<void> {
  await makeNewSystemGeneration({
    storePath: "/",
    nixItemPath: args.item.nixPath,
    executeActivation: "switch",
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
