import { execaCommand } from "execa";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { getPathHashFromPath, getPathsInfo } from "./nixStore";

type CopyOutputToArchiveArgs = {
  storePath?: string;
  item: string;
  archivePath: string;
};

/**
 * Given a store path, a derivation and an archive path, copy the output path of the derivation to the archive path.
 */
export async function copyOutputToArchive({
  storePath,
  item,
  archivePath,
}: CopyOutputToArchiveArgs) {
  const storeArg = storePath ? `--store ${storePath}` : "";
  const command = execaCommand(
    `nix copy --to file://${archivePath} ${storeArg} ${item}`,
    {
      stderr: "inherit",
    }
  );

  const result = await command;

  if (result.failed) {
    throw new Error(result.stderr);
  }
}

type GetArchiveDetailsArgs = {
  archivePath: string;
};

/**
 * Given an archive path, give all the details about the archive.
 */
export async function getArchiveDetails({
  archivePath,
}: GetArchiveDetailsArgs) {
  const command = execaCommand(`nix show-derivation ${archivePath}`, {
    stderr: "inherit",
  });

  const result = await command;

  if (result.failed) {
    throw new Error(result.stderr);
  }

  return result.stdout;
}

type MakeArchiveSubsetArgs = {
  archivePath: string;
  destinationPath: string;
  infoItemPaths: string[];
  dataItemPaths: string[];
};

/**
 * Given an archive path, a destination path, info item hashes and data item hashes, make a subset of the archive.
 * Data item hashes must be a subset of info item hashes.
 */
export async function makeArchiveSubset({
  archivePath,
  destinationPath,
  infoItemPaths,
  dataItemPaths,
}: MakeArchiveSubsetArgs) {
  // Make the destination folder, deleting the old one if exists
  await fs.promises.rm(destinationPath, { recursive: true, force: true });
  await fs.promises.mkdir(destinationPath, { recursive: true });

  // Copy the narinfos
  for (const itemPath of infoItemPaths) {
    const hash = getPathHashFromPath(itemPath);

    const infoFilename = `${hash}.narinfo`;
    const narinfoPath = path.join(archivePath, infoFilename);
    const destinationNarinfoPath = path.join(destinationPath, infoFilename);
    await fs.promises.copyFile(narinfoPath, destinationNarinfoPath);
  }

  // Copy the data files
  const archiveDataItemInfos = await getPathsInfo({
    storePath: `file://${archivePath}`,
    pathNames: dataItemPaths,
  });
  for (const info of Object.values(archiveDataItemInfos)) {
    const url = info.url;
    if (!url) {
      throw new Error(`No url in archive for data item ${info.path}`);
    }

    const urlFolder = path.dirname(url);
    const urlFile = path.basename(url);

    const narPath = path.join(archivePath, urlFolder, urlFile);
    const destinationNarPathFolder = path.join(destinationPath, urlFolder);
    const destinationNarPath = path.join(destinationNarPathFolder, urlFile);
    await fs.promises.mkdir(destinationNarPathFolder, { recursive: true });
    await fs.promises.copyFile(narPath, destinationNarPath);
  }
}

type CopyArchiveToStoreArgs = {
  archivePath: string;
  item: string;
  storePath?: string;
};

export async function copyArchiveToStore({
  item,
  archivePath,
  storePath,
}: CopyArchiveToStoreArgs) {
  const storeArg = storePath ? `--store=${storePath}` : "";
  const command = execaCommand(
    `nix copy --from file://${archivePath} ${storeArg} ${item}`,
    {
      stderr: "inherit",
    }
  );

  const result = await command;

  if (result.failed) {
    throw new Error(result.stderr);
  }
}
