import path from "path";
import fs from "fs";
import { z } from "zod";
import { getPathHashFromPath, getPathInfoTreeSearch } from "./nixStore";

export async function getClientStateNarinfoCachePath(clientStatePath: string) {
  return path.join(clientStatePath, "narinfo-cache");
}

export async function getClientStateDataFilePAth(clientStatePath: string) {
  return path.join(clientStatePath, "state.json");
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

type ReadClientStoreConfigArgs = {
  clientStateStorePath: string;
  storePath: string;
};

const defaultStateConfig: ClientStateForSingleStoreConfig = {
  generations: [],
};

export async function readClientStoreConfig({
  clientStateStorePath,
  storePath,
}: ReadClientStoreConfigArgs) {
  const stateDataPath = await getClientStateDataFilePAth(clientStateStorePath);

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

type GetNarinfoFileListForRevisionsArgs = {
  storePath: string;
  clientStateStorePath: string;
  revs: string[];
};

/**
 * Takes the absolute store path, the client state store path, and the git revisions.
 * Returns the list of .narinfo files (absolute paths) that represent the git revisions.
 */
export async function getNarinfoFileListForRevisions({
  storePath,
  clientStateStorePath,
  revs,
}: GetNarinfoFileListForRevisionsArgs) {
  const clientStateConfig = await readClientStoreConfig({
    clientStateStorePath,
    storePath,
  });

  const generations = clientStateConfig.generations.filter((gen) =>
    revs.includes(gen.gitRevision)
  );

  const roots = generations.map((gen) => gen.nixPath);
  const pathInfos = await getPathInfoTreeSearch({
    rootPathNames: roots,
    storePath,
  });

  let cacheFolder = await getClientStateNarinfoCachePath(clientStateStorePath);

  return pathInfos.map((pathInfo) => {
    let hash = getPathHashFromPath(pathInfo.path);
    let filename = `${hash}.narinfo`;
    return path.join(cacheFolder, filename);
  });
}
