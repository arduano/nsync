import type { Options as ExecaOptions } from "execa";
import { execa, execaCommand } from "execa";

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
      // eslint-disable-next-line no-console
      console.error();
      // eslint-disable-next-line no-console
      console.error(error.message);
      // eslint-disable-next-line no-console
      console.error(error.description);
      return 1;
    } else {
      throw error;
    }
  }
}

export async function execThirdPartyCommand(
  command: string | [string, ...string[]],
  failedMessage: string,
  options?: ExecaOptions,
) {
  try {
    const execaOptions = {
      stderr: "inherit" as const,
      ...options,
    };

    const result = Array.isArray(command)
      ? await execa(command[0], command.slice(1), execaOptions)
      : await execaCommand(command, execaOptions);
    return result;
  } catch (e: any) {
    throw execErrorToCommandError(e, failedMessage);
  }
}

export function execErrorToCommandError(e: any, failedMessage: string) {
  const command = e.command as string;
  const stdout = e.stdout as string | undefined;
  const stderr = e.stderr as string | undefined;

  const commandName = command.split(" ")[0];

  const lines: string[] = [];
  if (stdout) {
    lines.push(`${commandName} stdout: ${stdout}`);
  }
  if (stderr) {
    lines.push(`${commandName} stderr: ${stderr}`);
  }

  return new CommandError(failedMessage, lines.join("\n"));
}
