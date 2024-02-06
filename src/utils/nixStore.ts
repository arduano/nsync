import { z } from "zod";
import { $, execaCommand } from "execa";

const pathInfoData = z.object({
  ca: z.string().optional(),
  deriver: z.string().optional(),
  narHash: z.string(),
  narSize: z.number(),
  path: z.string(),
  references: z.array(z.string()),
  signatures: z.array(z.string()).optional(),
  registrationTime: z.number().optional(),
  url: z.string().optional(),
  valid: z.boolean(),
});
const pathInfoDataArray = z.array(pathInfoData);

export type RelevantNixPathInfo = {
  narHash: string;
  narSize: number;
  path: string;
  references: string[];
  registrationTime?: number;
  url?: string;
  valid: boolean;
};

function mapParsedPathInfoToRelevantPathInfo(
  parsed: z.infer<typeof pathInfoData>
): RelevantNixPathInfo {
  return {
    narHash: parsed.narHash,
    narSize: parsed.narSize,
    path: parsed.path,
    references: parsed.references,
    registrationTime: parsed.registrationTime,
    url: parsed.url,
    valid: parsed.valid,
  };
}

type GetPathInfoArgs = {
  storePath: string;
  pathName: string;
};

/**
 * Given a store path and an item path name, get the info about the item path.
 */
export async function getPathInfo({
  storePath,
  pathName,
}: GetPathInfoArgs): Promise<RelevantNixPathInfo> {
  const result = await $`nix path-info --json --store ${storePath} ${pathName}`;
  if (result.failed) {
    throw new Error(result.stderr);
  }

  const parsed = pathInfoDataArray.safeParse(JSON.parse(result.stdout));
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }

  return mapParsedPathInfoToRelevantPathInfo(parsed.data[0]);
}

type GetPathsInfoArgs = {
  storePath: string;
  pathNames: string[];
};

/**
 * Given a store path and a item path names, get the info about the item paths.
 * Returns a map from path to info.
 */
export async function getPathsInfo({
  storePath: storePath,
  pathNames,
}: GetPathsInfoArgs): Promise<Record<string, RelevantNixPathInfo>> {
  const result =
    await $`nix path-info --json --store ${storePath} ${pathNames}`;
  if (result.failed) {
    throw new Error(result.stderr);
  }

  const parsed = pathInfoDataArray.safeParse(JSON.parse(result.stdout));
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }

  const entries = parsed.data.map((item) => [
    item.path,
    mapParsedPathInfoToRelevantPathInfo(item),
  ]);

  return Object.fromEntries(entries);
}

type GetPathInfoTreeSearchArgs = {
  storePath: string;
  rootPathName: string;
};

/**
 * Given a store path and a root path name, get all the infos on all the pathnames that are in the dependency tree.
 */
export async function getPathInfoTreeSearch({
  storePath,
  rootPathName,
}: GetPathInfoTreeSearchArgs): Promise<RelevantNixPathInfo[]> {
  const pathInfos: RelevantNixPathInfo[] = [];
  const foundPaths = new Set<string>();

  let queue = [rootPathName];
  foundPaths.add(rootPathName);

  while (queue.length > 0) {
    const infos = await getPathsInfo({
      storePath: storePath,
      pathNames: queue,
    });
    queue = [];

    for (let info of Object.values(infos)) {
      pathInfos.push(info);
      for (const reference of info.references) {
        if (!foundPaths.has(reference)) {
          queue.push(reference);
          foundPaths.add(reference);
        }
      }
    }
  }

  return pathInfos;
}

/**
 * Given an item path, get the path hash of the path. The path hash is under `/nix/store/<hash>-<name>`.
 */
export function getPathHashFromPath(itemPath: string) {
  let hash = itemPath.split("/").pop()?.split("-")?.[0];

  if (!hash) {
    throw new Error(`Could not get hash from item path: ${itemPath}`);
  }

  return hash;
}

type GetStoreDeltaPathsDeltaArgs = {
  storePath: string;
  fromRootPathNames: string[];
  toRootPathName: string;
};

/**
 * Given a store path, a from root path name and a to root path name, get the path information and difference.
 */
export async function getStoreDeltaPathsDelta({
  storePath,
  fromRootPathNames,
  toRootPathName,
}: GetStoreDeltaPathsDeltaArgs) {
  const fromItems = await Promise.all(
    fromRootPathNames.map((pathName) =>
      getPathInfoTreeSearch({
        storePath: storePath,
        rootPathName: pathName,
      })
    )
  );
  const toItems = await getPathInfoTreeSearch({
    storePath: storePath,
    rootPathName: toRootPathName,
  });

  const fromPathsSet = new Set(
    fromItems.flatMap((group) => group.map((info) => info.path))
  );
  const added = toItems.filter((item) => !fromPathsSet.has(item.path));

  return {
    allResultingItems: toItems,
    added,
  };
}
