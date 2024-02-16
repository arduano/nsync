import path from "path";
import fs from "fs";
import { exists } from "./helpers";

/**
 * Gets the list of absolute paths to items in a directory that pass a filter.
 */
async function getAbsoluteFilteredItemsListInDir(
  dir: string,
  filter: (filename: string) => boolean | Promise<boolean>,
) {
  const files = await fs.promises.readdir(dir);
  const filteredFiles = await Promise.all(
    files.map(async (file) => {
      const fullPath = path.join(dir, file);
      return (await filter(file)) ? fullPath : null;
    }),
  );

  return filteredFiles.filter(exists);
}

/**
 * Gets the list of absolute paths of all the files in a directory. Child directories are not included.
 */
export async function getAbsoluteNarinfoListInDir(dir: string) {
  return getAbsoluteFilteredItemsListInDir(dir, async (file) => {
    const fullPath = path.join(dir, file);
    const stat = await fs.promises.stat(fullPath);
    return stat.isFile() && file.endsWith(".narinfo");
  });
}
