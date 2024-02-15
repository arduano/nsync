import { z } from "zod";

export const storeRoot = z.object({
  nixPath: z.string(),
  gitRevision: z.string(),
});

export interface CommandImplementation<
  Args extends object,
  Schema extends z.ZodObject<any>
> {
  kind: string;
  schema: Schema;
  build: (
    args: Args,
    shared: InstructionBuilderSharedArgs
  ) => Promise<z.infer<z.ZodObject<any>>>;
  execute: (
    args: z.infer<Schema>,
    shared: InstructionExecutionSharedArgs
  ) => Promise<void>;
}

export type InstructionBuilderSharedArgs = {
  // The store and archive to temporarily write to when building
  workdirStorePath: string;
  workdirArchivePath: string;

  // Path to the instruction folder that's currently being built
  instructionFolderPath: string;

  // Progress callback for CLI
  progressCallback: (message: string) => void;
};

export type InstructionExecutionSharedArgs = {
  // The environment stores to work with
  storePath: string;
  clientStateStorePath: string;

  // Path to the instruction folder that's currently being executed
  instructionFolderPath: string;

  // Progress callback for CLI
  progressCallback: (message: string) => void;
};
