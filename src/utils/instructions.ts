import { z } from "zod";
import { makeArchiveSubset } from "./nixArchive";
import path from "path";
import fs from "fs";
import { execaCommand } from "execa";

const archiveItemRef = z.object({
  archivePath: z.string(),
  itemPath: z.string(),
});

const storeSwitchCommand = z.object({
  kind: z.literal("switch"),
  item: archiveItemRef,
  deltaDependencyRevs: z.array(z.string()),
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
  dirPath,
  destinationPath,
}: {
  dirPath: string;
  destinationPath: string;
}) {
  const tarFilesCommand = execaCommand(`tar -cf - -C ${dirPath} .`, {
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
