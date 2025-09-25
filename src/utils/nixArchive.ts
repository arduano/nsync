import fs from "fs";
import path from "path";
import { getPathHashFromPath, getPathsInfo } from "./nixStore";
import { CommandError, execThirdPartyCommand } from "../errors";

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
  await execThirdPartyCommand(
    `nix copy --to file://${archivePath} ${storeArg} ${item}`,
    `Failed to copy store path "${item}" to archive at "${archivePath}"`,
  );
}

type GetArchiveDetailsArgs = {
  archivePath: string;
};

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
      throw new CommandError(
        "Failed to make a partial archive for instruction",
        `No url in the archive for data item ${info.path}`,
      );
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
  const storeArg = storePath ? `--store ${storePath}` : "";
  // TODO: This command must always be run as sudo, due to https://github.com/NixOS/nix/issues/1761
  // We could try incorporating signatures in the future.
  await execThirdPartyCommand(
    `nix copy --no-check-sigs --from file://${archivePath} ${storeArg} ${item}`,
    `Failed to copy archive from "${archivePath}" into store path "${item}"`,
  );
}
