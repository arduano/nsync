export class CommandError extends Error {
  constructor(
    message: string,
    readonly description: string,
  ) {
    super(message);
  }
}

export function wrapCommandError<T>(
  fn: () => Promise<void>,
): () => Promise<number> {
  return async () => {
    try {
      await fn();
      return 0;
    } catch (error) {
      if (error instanceof CommandError) {
        // eslint-disable-next-line no-console
        console.error(error.message);
        // eslint-disable-next-line no-console
        console.error(error.description);
        return 1;
      } else {
        throw error;
      }
    }
  };
}
