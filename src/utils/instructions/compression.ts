import { execaCommand } from "execa";
import fs from "fs";

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
