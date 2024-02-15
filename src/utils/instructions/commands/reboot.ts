import { z } from "zod";
import { CommandImplementation } from "../common";

export const rebootCommandSchema = z.object({
  // Command to trigger a reboot
  kind: z.literal("reboot"),

  // Delay in seconds before the reboot is triggered
  delay: z.number().int().positive().optional(),
});

export type BuildRebootCommandArgs = {
  kind: "reboot";
  delay?: number;
};

export async function buildRebootCommand({
  kind,
  delay,
}: BuildRebootCommandArgs): Promise<z.infer<typeof rebootCommandSchema>> {
  return {
    kind,
    delay,
  };
}

export const rebootCommand = {
  kind: "reboot" as const,
  schema: rebootCommandSchema,
  build: buildRebootCommand,
} satisfies CommandImplementation<
  BuildRebootCommandArgs,
  typeof rebootCommandSchema
>;
