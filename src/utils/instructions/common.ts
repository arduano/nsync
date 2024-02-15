import { z } from "zod";
import { doesNixPathExist } from "../nixStore";
import { getClientStoreNarinfoCachePathAsStorePath } from "../clientStore";
import path from "path";
import fs from "fs";
import { loadArchiveDeltaCommand } from "./commands/loadArchive";
import { storeSwitchCommand } from "./commands/storeSwitch";
import { storeCleanupCommand } from "./commands/storeCleanup";
import { rebootCommand } from "./commands/reboot";
import { mapTuple, unreachable } from "../helpers";
import {
  CommandImplementation,
  InstructionBuilderSharedArgs,
  InstructionExecutionSharedArgs,
} from "./schemas";

const commandList = [
  loadArchiveDeltaCommand,
  storeSwitchCommand,
  storeCleanupCommand,
  rebootCommand,
] as const;

type CommandImplementationArgs<T> = T extends CommandImplementation<
  infer Args,
  any
>
  ? Args
  : never;

type Command = (typeof commandList)[number];

export type BuildCommandArgs = CommandImplementationArgs<Command>;

const instructionCommand = z.union(
  mapTuple(commandList, (c: Command) => c.schema)
);
const instructionSchema = z.array(instructionCommand);

type Instruction = z.infer<typeof instructionSchema>;
type InstructionCommand = z.infer<typeof instructionCommand>;

type AssertInstructionCanBeAppliedArgs = {
  storePath?: string;
  clientStateStorePath: string;
  instruction: Instruction;
};

export async function assertInstructionCanBeApplied({
  storePath,
  clientStateStorePath,
  instruction,
}: AssertInstructionCanBeAppliedArgs): Promise<Error | undefined> {
  const addedNixPaths: string[] = [];

  const hasStorePath = async (path: string) => {
    if (addedNixPaths.includes(path)) {
      return true;
    }

    // Check if the store path exists
    const exists = await doesNixPathExist({
      storePath,
      pathName: path,
    });

    return exists;
  };

  const hasCachedNarinfoStorePath = async (path: string) => {
    if (addedNixPaths.includes(path)) {
      return true;
    }

    // Check if the path exists in the narinfo cache
    let storePath =
      getClientStoreNarinfoCachePathAsStorePath(clientStateStorePath);
    const exists = await doesNixPathExist({
      storePath,
      pathName: path,
    });

    return exists;
  };

  for (const step of instruction) {
    switch (step.kind) {
      case "load": {
        // Assert that all dependencies exist in the store

        for (const dep of step.deltaDependencies) {
          // Check store path
          const storePathExists = await hasStorePath(dep.nixPath);
          if (!storePathExists) {
            return new Error(
              `Failed to execute "load" instruction because a dependent derivation is missing in the nix store: ${dep.nixPath}`
            );
          }

          // Check narinfo cache if necessary
          if (step.partialNarinfos) {
            const cachePathExists = await hasCachedNarinfoStorePath(
              dep.nixPath
            );
            if (!cachePathExists) {
              return new Error(
                `Failed to execute "load" instruction because a dependent derivation is missing in the narinfo cache: ${dep.nixPath}`
              );
            }
          }
        }

        // Add the path for future steps to use
        addedNixPaths.push(step.item.nixPath);

        break;
      }
      case "switch": {
        // Assert that the new rev exists in the store
        const storePathExists = await hasStorePath(step.item.nixPath);
        if (!storePathExists) {
          return new Error(
            `Failed to execute "switch" instruction because the new derivation is missing in the nix store: ${step.item.nixPath}`
          );
        }

        // Add the path for future steps to use
        addedNixPaths.push(step.item.nixPath);

        break;
      }
      case "cleanup": {
        // No need to check anything for cleanup steps
        break;
      }
      case "reboot": {
        // No need to check anything for reboot steps
        break;
      }
      default: {
        unreachable(step);
      }
    }
  }

  return undefined;
}

export async function buildInstructionFolder(
  commandsArgs: BuildCommandArgs[],
  shared: InstructionBuilderSharedArgs
) {
  const instructionFolderPath = shared.instructionFolderPath;

  // Delete the folder first if it exists
  await fs.promises.rm(instructionFolderPath, { force: true, recursive: true });

  // Create the instruction folder again
  await fs.promises.mkdir(instructionFolderPath, { recursive: true });

  const commands: InstructionCommand[] = [];
  for (const commandArgs of commandsArgs) {
    const impl = commandList.find((c) => c.kind === commandArgs.kind)!;
    const command = await impl.build(commandArgs as any, shared);
    commands.push(command);
  }

  // Verify that the instruction matches the schema, for sanity checking
  const parsed = instructionSchema.safeParse(commands);
  if (parsed.success === false) {
    throw new Error(
      `Failed to build instruction because it doesn't match the schema. This is a bug.`
    );
  }

  // Write the instruction to the folder
  const instructionPath = path.join(instructionFolderPath, "instruction.json");
  await fs.promises.writeFile(
    instructionPath,
    JSON.stringify(commands, null, 2)
  );
}

export async function executeInstructionFolder(
  shared: InstructionExecutionSharedArgs
) {
  const instructionFile = path.join(
    shared.instructionFolderPath,
    "instruction.json"
  );

  const instructionText = await fs.promises.readFile(instructionFile, "utf-8");
  const instruction = instructionSchema.parse(JSON.parse(instructionText));

  // Assert that the instruction can be applied
  const error = await assertInstructionCanBeApplied({
    storePath: shared.storePath,
    clientStateStorePath: shared.clientStateStorePath,
    instruction,
  });

  if (error) {
    throw error;
  }

  // Execute the instruction
  for (const command of instruction) {
    const impl = commandList.find((c) => c.kind === command.kind)!;
    await impl.execute(command as any, shared);
  }
}
