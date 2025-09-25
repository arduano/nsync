import signale from "signale";

type CustomLogTypes = "progress";

const supportsColor = Boolean(
  process.stdout?.isTTY && (process.stdout.getColorDepth?.() ?? 1) > 1,
);

const baseLogger = new signale.Signale<CustomLogTypes>({
  types: {
    progress: {
      badge: supportsColor ? "…" : "-",
      color: supportsColor ? "magenta" : "white",
      label: "progress",
    },
  },
  config: {
    displayTimestamp: false,
    displayDate: false,
    displayFilename: false,
    underlineLabel: false,
    underlineMessage: false,
    uppercaseLabel: false,
  },
});

if (!supportsColor) {
  baseLogger.config({
    displayBadge: false,
  });
}

const commandLogger = new signale.Signale<"command">({
  types: {
    command: {
      badge: "$",
      color: supportsColor ? "cyan" : "white",
      label: "",
    },
  },
  config: {
    displayScope: false,
    displayLabel: false,
    displayTimestamp: false,
    displayDate: false,
    displayFilename: false,
    underlineLabel: false,
    underlineMessage: false,
  },
});

const cyan = (text: string) =>
  supportsColor ? `\u001b[36m${text}\u001b[39m` : text;
const dim = (text: string) =>
  supportsColor ? `\u001b[2m${text}\u001b[22m` : text;

export const logger = {
  log: baseLogger.log.bind(baseLogger),
  info: baseLogger.info.bind(baseLogger),
  warn: baseLogger.warn.bind(baseLogger),
  error: baseLogger.error.bind(baseLogger),
  note: baseLogger.note.bind(baseLogger),
  success: baseLogger.success.bind(baseLogger),
  debug: baseLogger.debug.bind(baseLogger),
  progress(message: string) {
    baseLogger.progress(message);
  },
  command(command: string, options?: { cwd?: string }) {
    const suffix = options?.cwd ? dim(` (cwd: ${options.cwd})`) : "";
    commandLogger.command(`${cyan(command)}${suffix}`);
  },
};

export { supportsColor };
