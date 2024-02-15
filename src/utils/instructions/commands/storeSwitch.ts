import { z } from "zod";
import { buildSystemFlake } from "../../nixFlake";
import {
  storeRoot,
  InstructionBuilderSharedArgs,
  CommandImplementation,
} from "../common";

export const storeSwitchCommandSchema = z.object({
  // Command to "apply the nix package as the next generation and switch to it"
  kind: z.literal("switch"),
  item: storeRoot,
  mode: z.union([z.literal("immediate"), z.literal("next-reboot")]),
});

export type BuildStoreSwitchCommandArgs = {
  kind: "switch";
  flakeGitUri: string;
  hostname: string;
  rev: string;
  mode: "immediate" | "next-reboot";
};

export async function buildStoreSwitchCommand(
  { kind, flakeGitUri, hostname, rev, mode }: BuildStoreSwitchCommandArgs,
  { workdirStorePath, progressCallback }: InstructionBuilderSharedArgs
): Promise<z.infer<typeof storeSwitchCommandSchema>> {
  progressCallback("Building switch command");

  const newRevBuildInfo = await buildSystemFlake({
    flakeGitUri,
    hostname,
    storeAbsolutePath: workdirStorePath,
    rev,
  });

  return {
    kind,
    item: {
      nixPath: newRevBuildInfo.output,
      gitRevision: rev,
    },
    mode,
  };
}

export const storeSwitchCommand = {
  kind: "switch" as const,
  schema: storeSwitchCommandSchema,
  build: buildStoreSwitchCommand,
} satisfies CommandImplementation<
  BuildStoreSwitchCommandArgs,
  typeof storeSwitchCommandSchema
>;
