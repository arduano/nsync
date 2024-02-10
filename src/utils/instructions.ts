import { z } from "zod";
import { makeArchiveSubset } from "./nixArchive";
import path from "path";
import fs from "fs";
import { execaCommand } from "execa";

const archiveItemRef = z.object({
  // Path of the archive within the instruction, e.g. `archive`
  archivePath: z.string(),
  // Path of the root nix item to copy, e.g. `/nix/store/whatever`
  itemPath: z.string(),
});

const storeRoot = z.object({
  nixPath: z.string(),
  gitRevision: z.string(),
});

const storeSwitchCommand = z.object({
  kind: z.literal("switch"),
  item: archiveItemRef,
  deltaDependencies: z.array(storeRoot),
  newRev: z.string(),
});

type StoreSwitchCommand = z.infer<typeof storeSwitchCommand>;

type MakeDirInstructionArgs = {
  data: StoreSwitchCommand;
  destinationFolder: string;
};

/**
 * Given an archive path, a destination path, and the details about what to copy/create, make
 * a directory with the store delta and details about the new generation.
 */
export async function makeDirInstruction({
  data,
  destinationFolder,
}: MakeDirInstructionArgs) {
  const instructionDestinationPath = path.join(
    destinationFolder,
    "instruction.json"
  );

  await fs.promises.writeFile(
    instructionDestinationPath,
    JSON.stringify(data, null, 2)
  );
}

type CompressInstructionDirArgs = {
  instructionDir: string;
  destinationPath: string | "-";
};

export async function compressInstructionDir({
  instructionDir,
  destinationPath,
}: CompressInstructionDirArgs) {
  const tarFilesCommand = execaCommand(`tar -cf - -C ${instructionDir} .`, {
    stdout: "pipe",
    stderr: "inherit",
    buffer: false,
  });

  if (!tarFilesCommand.stdout) {
    throw new Error("Failed to get stdout for tar");
  }

  const xzCompressCommand = execaCommand(`xz -zce -9 -`, {
    stdin: tarFilesCommand.stdout,
    stdout: "pipe",
    stderr: "inherit",
    buffer: false,
  });

  if (!xzCompressCommand.stdout) {
    throw new Error("Failed to get stdout for xz");
  }

  if (destinationPath === "-") {
    xzCompressCommand.stdout.pipe(process.stdout);
  } else {
    const destinationFile = fs.createWriteStream(destinationPath);
    xzCompressCommand.stdout.pipe(destinationFile);
  }

  // Wait for xz to complete
  await xzCompressCommand;
  await tarFilesCommand;
}

type DecompressInstructionDirArgs = {
  instructionPath: string;
  destinationDir: string;
};

export async function decompressInstructionDir({
  instructionPath,
  destinationDir,
}: DecompressInstructionDirArgs) {
  const xzDecompressCommand = execaCommand(`xz -d -c ${instructionPath}`, {
    stdout: "pipe",
    stderr: "inherit",
    buffer: false,
  });

  if (!xzDecompressCommand.stdout) {
    throw new Error("Failed to get stdout for xz");
  }

  const tarExtractCommand = execaCommand(`tar -xf - -C ${destinationDir}`, {
    stdin: xzDecompressCommand.stdout,
    stderr: "inherit",
    buffer: false,
  });

  // Wait for tar to complete
  await tarExtractCommand;
  await xzDecompressCommand;
}

export async function readDirInstruction(dir: string) {
  const instructionPath = path.join(dir, "instruction.json");

  try {
    const instructionData = await fs.promises.readFile(
      instructionPath,
      "utf-8"
    );
    const json = JSON.parse(instructionData);
    const parsed = storeSwitchCommand.safeParse(json);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    return parsed.data;
  } catch (e) {
    throw new Error("Invalid instruction data");
  }
}

export async function assertInstructionDirValid(dir: string) {
  const instruction = await readDirInstruction(dir);

  switch (instruction.kind) {
    case "switch":
      const archivePath = path.join(dir, instruction.item.archivePath);
      if (!fs.existsSync(archivePath)) {
        throw new Error("Archive does not exist");
      }
      break;
  }
}
