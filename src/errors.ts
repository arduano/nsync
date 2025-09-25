import type { Options as ExecaOptions } from "execa";
import { execa, execaCommand } from "execa";

import { logger } from "./logger";

export class CommandError extends Error {
  constructor(
    message: string,
    readonly description: string,
  ) {
    super(message);
  }
}

export async function wrapCommandError<T>(
  fn: () => Promise<void>,
): Promise<number> {
  try {
    await fn();
    return 0;
  } catch (error) {
    if (error instanceof CommandError) {
      logger.error(error.message);
      logger.note(error.description);
      return 1;
    } else {
      throw error;
    }
  }
}

export async function execThirdPartyCommand(
  command: string | [string, ...string[]],
  failedMessage: string,
  options?: ExecaOptions & { logCommand?: boolean },
) {
  const { logCommand = true, ...otherOptions } = options || {};
  try {
    const execaOptions = {
      stderr: "inherit" as const,
      ...otherOptions,
    };

    if (logCommand) {
      const formattedCommand = Array.isArray(command)
        ? command
            .map((part) =>
              /\s/.test(part) || part.includes('"')
                ? JSON.stringify(part)
                : part,
            )
            .join(" ")
        : command;
      const cwd =
        typeof execaOptions.cwd === "string" ? execaOptions.cwd : undefined;
      logger.command(formattedCommand, { cwd });
    }

    const result = Array.isArray(command)
      ? await execa(command[0], command.slice(1), execaOptions)
      : await execaCommand(command, execaOptions);
    return result;
  } catch (e: any) {
    throw execErrorToCommandError(e, failedMessage);
  }
}

export function execErrorToCommandError(e: any, failedMessage: string) {
  const command =
    typeof e.command === "string" && e.command.length > 0
      ? e.command
      : "(unknown command)";
  const stdout = e.stdout as string | undefined;
  const stderr = e.stderr as string | undefined;
  const exitCode = typeof e.exitCode === "number" ? e.exitCode : undefined;
  const signal = e.signal as string | undefined;
  const shortMessage = e.shortMessage as string | undefined;
  const originalMessage = e.originalMessage as string | undefined;
  const cwd = e.cwd ?? e.options?.cwd;
  const timedOut = Boolean(e.timedOut);
  const isCanceled = Boolean(e.isCanceled);

  const commandName =
    typeof e.command === "string" && e.command.length > 0
      ? e.command.split(" ")[0]
      : "command";

  const lines: string[] = [];
  lines.push(`Command: ${command}`);
  if (cwd) {
    lines.push(`Working directory: ${cwd}`);
  }
  if (exitCode !== undefined) {
    lines.push(`Exit code: ${exitCode}`);
  } else {
    lines.push(`Exit code: unknown`);
  }
  if (signal) {
    lines.push(`Signal: ${signal}`);
  }
  if (timedOut) {
    lines.push("Timed out: true");
  }
  if (isCanceled) {
    lines.push("Canceled: true");
  }
  if (shortMessage) {
    lines.push(`Error: ${shortMessage}`);
  } else if (originalMessage) {
    lines.push(`Error: ${originalMessage}`);
  }
  const stdoutContent =
    typeof stdout === "string" && stdout.length > 0 ? stdout : "(empty)";
  lines.push(`${commandName} stdout: ${stdoutContent}`);

  const stderrContent =
    typeof stderr === "string" && stderr.length > 0 ? stderr : "(empty)";
  lines.push(`${commandName} stderr: ${stderrContent}`);

  return new CommandError(failedMessage, lines.join("\n"));
}
