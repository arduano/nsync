import { z } from "zod";
import { CommandImplementation } from "../common";

export const storeCleanupCommandSchema = z.object({
  // Command to "clean up the nix store"
  kind: z.literal("cleanup"),

  // Number of generations to keep. The currently active generation will always be kept.
  generationsToKeep: z.number().int().positive(),
});

export type BuildStoreCleanupCommandArgs = {
  kind: "cleanup";
  generationsToKeep: number;
};

export async function buildStoreCleanupCommand({
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

export const storeCleanupCommand = {
  kind: "cleanup" as const,
  schema: storeCleanupCommandSchema,
  build: buildStoreCleanupCommand,
} satisfies CommandImplementation<
  BuildStoreCleanupCommandArgs,
  typeof storeCleanupCommandSchema
>;
