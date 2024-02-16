import path from "path";
import fs from "fs";
import { z } from "zod";
import { getPathHashFromPath, getPathInfoTreeSearch } from "./nixStore";

function getClientStateNarinfoCachePath(clientStatePath: string) {
  return path.join(clientStatePath, "narinfo-cache");
}

export function getClientStoreNarinfoCachePathAsStorePath(
  clientStatePath: string,
) {
  const cacheFolder = getClientStateNarinfoCachePath(clientStatePath);
  return `file://${cacheFolder}`;
}

const clientStateForSingleStoreConfig = z.object({
  generations: z.array(
    z.object({
      generationLinkName: z.string(),
      nixPath: z.string(),
      gitRevision: z.string(),
    }),
  ),
});

const clientStateConfig = z.record(
  // Record key = store path
  clientStateForSingleStoreConfig,
);

type ClientStateForSingleStoreConfig = z.infer<
  typeof clientStateForSingleStoreConfig
>;

type GetNarinfoFileListForRevisionsArgs = {
  storePath?: string;
  clientStateStorePath: string;
  nixPaths: string[];
};

/**
 * Takes the absolute store path, the client state store path, and the git revisions.
 * Returns the list of .narinfo files (absolute paths) that represent the git revisions.
 */
export async function getNarinfoFileListForNixPaths({
  storePath,
  clientStateStorePath,
  nixPaths,
}: GetNarinfoFileListForRevisionsArgs) {
  const pathInfos = await getPathInfoTreeSearch({
    rootPathNames: nixPaths,
    storePath,
  });

  const cacheFolder =
    await getClientStateNarinfoCachePath(clientStateStorePath);

  return pathInfos.map((pathInfo) => {
    const hash = getPathHashFromPath(pathInfo.path);
    const filename = `${hash}.narinfo`;
    return path.join(cacheFolder, filename);
  });
}

type CopyNarinfoFilesToCacheArgs = {
  narinfoFilePaths: string[];
  clientStateStorePath: string;
};

/**
 * Copies the narinfo files to the cache folder.
 */
export async function copyNarinfoFilesToCache({
  narinfoFilePaths,
  clientStateStorePath,
}: CopyNarinfoFilesToCacheArgs) {
  const cacheFolder =
    await getClientStateNarinfoCachePath(clientStateStorePath);

  await fs.promises.mkdir(cacheFolder, { recursive: true });

  for (const narinfoPath of narinfoFilePaths) {
    const filename = path.basename(narinfoPath);
    const destinationPath = path.join(cacheFolder, filename);
    await fs.promises.copyFile(narinfoPath, destinationPath);
  }
}
