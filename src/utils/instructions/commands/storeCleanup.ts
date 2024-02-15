import { z } from "zod";
import {
  CommandImplementation,
  InstructionExecutionSharedArgs,
} from "../schemas";
import { cleanupOldGenerations } from "../../nixGenerations";

const storeCleanupCommandSchema = z.object({
  // Command to "clean up the nix store"
  kind: z.literal("cleanup"),

  // Number of generations to keep. The currently active generation will always be kept.
  generationsToKeep: z.number().int().positive(),
});

type BuildStoreCleanupCommandArgs = {
  kind: "cleanup";
  generationsToKeep: number;
};

async function buildStoreCleanupCommand({
  kind,
  generationsToKeep,
}: BuildStoreCleanupCommandArgs): Promise<
  z.infer<typeof storeCleanupCommandSchema>
> {
  return {
    kind,
    generationsToKeep,
  };
}

async function executeStoreCleanupCommand(
  args: z.infer<typeof storeCleanupCommandSchema>,
  shared: InstructionExecutionSharedArgs
): Promise<void> {
  await cleanupOldGenerations({
    keepGenerationCount: args.generationsToKeep,
    storePath: "/",
  });
}

export const storeCleanupCommand = {
  kind: "cleanup" as const,
  schema: storeCleanupCommandSchema,
  build: buildStoreCleanupCommand,
  execute: executeStoreCleanupCommand,
} satisfies CommandImplementation<
  BuildStoreCleanupCommandArgs,
  typeof storeCleanupCommandSchema
>;
