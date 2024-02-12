import path from "path";
import fs from "fs";
import { z } from "zod";
import { getPathHashFromPath, getPathInfoTreeSearch } from "./nixStore";

export function getClientStateNarinfoCachePath(clientStatePath: string) {
  return path.join(clientStatePath, "narinfo-cache");
}

export function getClientStateDataFilePath(clientStatePath: string) {
  return path.join(clientStatePath, "state.json");
}

export function getClientStoreNarinfoCachePathAsStorePath(
  clientStatePath: string
) {
  let cacheFolder = getClientStateNarinfoCachePath(clientStatePath);
  return `file://${cacheFolder}`;
}

const clientStateForSingleStoreConfig = z.object({
  generations: z.array(
    z.object({
      generationLinkName: z.string(),
      nixPath: z.string(),
      gitRevision: z.string(),
    })
  ),
});

const clientStateConfig = z.record(
  // Record key = store path
  clientStateForSingleStoreConfig
);

type ClientStateForSingleStoreConfig = z.infer<
  typeof clientStateForSingleStoreConfig
>;
type ClientStateConfig = z.infer<typeof clientStateConfig>;

const defaultStateConfig: ClientStateForSingleStoreConfig = {
  generations: [],
};

type ReadClientStoreConfigArgs = {
  clientStateStorePath: string;
  storePath: string;
};

export async function readClientStoreConfig({
  clientStateStorePath,
  storePath,
}: ReadClientStoreConfigArgs) {
  const stateDataPath = await getClientStateDataFilePath(clientStateStorePath);

  if (!fs.existsSync(stateDataPath)) {
    return defaultStateConfig;
  }

  let stateConfig;
  try {
    const fileText = await fs.promises.readFile(stateDataPath, "utf-8");
    stateConfig = clientStateConfig.safeParse(JSON.parse(fileText));
  } catch (e) {
    throw new Error("Error reading client state file");
  }

  if (!stateConfig.success) {
    throw new Error("Invalid/corrupt state file");
  }

  return stateConfig.data[storePath] ?? defaultStateConfig;
}

type SaveClientStoreConfigArgs = {
  clientStateStorePath: string;
  storePath: string;
  config: ClientStateForSingleStoreConfig;
};

export async function saveClientStoreConfig({
  clientStateStorePath,
  storePath,
  config,
}: SaveClientStoreConfigArgs) {
  const stateDataPath = await getClientStateDataFilePath(clientStateStorePath);

  let stateConfig: ClientStateConfig = {};
  if (fs.existsSync(stateDataPath)) {
    let fileText = await fs.promises.readFile(stateDataPath, "utf-8");
    const parsed = clientStateConfig.safeParse(JSON.parse(fileText));
    if (!parsed.success) {
      throw new Error("Invalid/corrupt state file");
    }

    stateConfig = parsed.data;
  }

  stateConfig[storePath] = config;

  await fs.promises.writeFile(
    stateDataPath,
    JSON.stringify(stateConfig, null, 2),
    "utf-8"
  );
}

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

  let cacheFolder = await getClientStateNarinfoCachePath(clientStateStorePath);

  return pathInfos.map((pathInfo) => {
    let hash = getPathHashFromPath(pathInfo.path);
    let filename = `${hash}.narinfo`;
    return path.join(cacheFolder, filename);
  });
}

type AddRevToClientStoreConfigArgs = {
  clientStateStorePath: string;
  generationLinkName: string;
  storePath: string;
  rev: string;
  nixPath: string;
};

/**
 * Adds a revision to the client store config.
 */
export async function addRevToClientStoreConfig({
  clientStateStorePath,
  generationLinkName,
  storePath,
  rev,
  nixPath,
}: AddRevToClientStoreConfigArgs) {
  const config = await readClientStoreConfig({
    clientStateStorePath,
    storePath,
  });

  config.generations.push({
    generationLinkName,
    gitRevision: rev,
    nixPath,
  });

  await saveClientStoreConfig({
    clientStateStorePath,
    storePath,
    config,
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
  let cacheFolder = await getClientStateNarinfoCachePath(clientStateStorePath);

  await fs.promises.mkdir(cacheFolder, { recursive: true });

  for (const narinfoPath of narinfoFilePaths) {
    let filename = path.basename(narinfoPath);
    let destinationPath = path.join(cacheFolder, filename);
    await fs.promises.copyFile(narinfoPath, destinationPath);
  }
}
