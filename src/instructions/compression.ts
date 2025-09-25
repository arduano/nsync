import { execaCommand } from "execa";
import fs from "fs";
import { CommandError, execErrorToCommandError } from "../errors";

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
    throw new CommandError(
      "Failed to compress instruction",
      "Failed to get stdout from the tar command",
    );
  }

  // Don't need strong compression, as most of the items are already compressed
  const xzCompressCommand = execaCommand(`xz -zc -2 -`, {
    stdin: tarFilesCommand.stdout,
    stdout: "pipe",
    stderr: "inherit",
    buffer: false,
  });

  if (!xzCompressCommand.stdout) {
    throw new CommandError(
      "Failed to compress instruction",
      "Failed to get stdout from the xz command",
    );
  }

  if (destinationPath === "-") {
    xzCompressCommand.stdout.pipe(process.stdout);
  } else {
    const destinationFile = fs.createWriteStream(destinationPath);
    xzCompressCommand.stdout.pipe(destinationFile);
  }

  try {
    // Wait for xz to complete
    await xzCompressCommand;
    await tarFilesCommand;
  } catch (e) {
    throw execErrorToCommandError(e, "Failed to compress instruction");
  }
}

type DecompressInstructionDirArgs = {
  instructionPath: string;
  destinationDir: string;
};

export async function decompressInstructionDir({
  instructionPath,
  destinationDir,
}: DecompressInstructionDirArgs) {
  console.log(`[decompressInstructionDir] Starting decompression`);
  console.log(`[decompressInstructionDir] instructionPath: ${instructionPath}`);
  console.log(`[decompressInstructionDir] destinationDir: ${destinationDir}`);

  const xzDecompressCommand = execaCommand(`xz -d -c ${instructionPath}`, {
    stdout: "pipe",
    stderr: "inherit",
    buffer: false,
  });

  if (!xzDecompressCommand.stdout) {
    console.error(`[decompressInstructionDir] xz command did not provide stdout`);
    throw new CommandError(
      "Failed to decompress instruction",
      "Failed to get stdout from the xz command",
    );
  } else {
    console.log(`[decompressInstructionDir] xz command stdout is available`);
  }

  const tarExtractCommand = execaCommand(`tar -xf - -C ${destinationDir}`, {
    stdin: xzDecompressCommand.stdout,
    stderr: "inherit",
    buffer: false,
  });

  console.log(`[decompressInstructionDir] tar command started`);

  try {
    // Wait for tar to complete
    await tarExtractCommand;
    console.log(`[decompressInstructionDir] tar extraction completed`);
    // await xzDecompressCommand;
    // console.log(`[decompressInstructionDir] xz decompression completed`);
  } catch (e) {
    console.error(`[decompressInstructionDir] Error during decompression:`, e);
    throw execErrorToCommandError(e, "Failed to decompress instruction");
  }
  console.log(`[decompressInstructionDir] Decompression finished successfully`);
}
