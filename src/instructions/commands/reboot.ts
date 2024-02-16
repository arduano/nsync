import { z } from "zod";
import type {
  CommandImplementation,
  InstructionExecutionSharedArgs,
} from "../schemas";
import { execaCommand } from "execa";
import fs from "fs";

const rebootCommandSchema = z.object({
  // Command to trigger a reboot
  kind: z.literal("reboot"),

  // Delay in seconds before the reboot is triggered
  delay: z.number().int().positive().optional(),
});

type BuildRebootCommandArgs = {
  kind: "reboot";
  delay?: number;
};

async function buildRebootCommand({
  kind,
  delay,
}: BuildRebootCommandArgs): Promise<z.infer<typeof rebootCommandSchema>> {
  return {
    kind,
    delay,
  };
}

async function executeRebootCommand(
  args: z.infer<typeof rebootCommandSchema>,
  shared: InstructionExecutionSharedArgs,
): Promise<void> {
  // Delete the instruction workdir as it won't be needed after the reboot
  await fs.promises.rmdir(shared.instructionFolderPath, { recursive: true });

  if (args.delay) {
    await new Promise((resolve) => setTimeout(resolve, args.delay! * 1000));
  }

  await execaCommand("reboot");
}

export const rebootCommand = {
  kind: "reboot" as const,
  schema: rebootCommandSchema,
  build: buildRebootCommand,
  execute: executeRebootCommand,
} satisfies CommandImplementation<
  BuildRebootCommandArgs,
  typeof rebootCommandSchema
>;
