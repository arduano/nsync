type MakeSyncStoreDirArgs = {
  archivePath: string;
  destinationPath: string;
  infoItemPaths: string[];
  dataItemPaths: string[];

  fromRev?: string;
  toRev: string;
};

/**
 * Given an archive path, a destination path, and a list of item paths, make a subset of the archive.
 */
