import { z } from "zod";
import { $, execa, execaCommand } from "execa";

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
  storePath?: string;
  pathName: string;
};

/**
 * Given a store path and an item path name, get the info about the item path.
 */
export async function getPathInfo({
  storePath,
  pathName,
}: GetPathInfoArgs): Promise<RelevantNixPathInfo | null> {
  const storeArg = storePath ? `--store ${storePath}` : "";
  const result = await execaCommand(
    `nix path-info --json ${storeArg} ${pathName}`
  );
  if (result.failed) {
    throw new Error(result.stderr);
  }

  const parsed = pathInfoDataArray.safeParse(JSON.parse(result.stdout));
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }

  return mapParsedPathInfoToRelevantPathInfo(parsed.data[0]);
}

type DoesNixPathExistArgs = {
  storePath?: string;
  pathName: string;
};

/**
 * Given a store path and an item path name, check if the path exists.
 */
export async function doesNixPathExist({
  storePath,
  pathName,
}: DoesNixPathExistArgs): Promise<boolean> {
  try {
    await getPathInfo({ storePath, pathName });
    return true;
  } catch (e) {
    console.log(e);
    return false;
  }
}

type GetPathsInfoArgs = {
  storePath?: string;
  pathNames: string[];
};

/**
 * Given a store path and a item path names, get the info about the item paths.
 * Returns a map from path to info.
 */
export async function getPathsInfo({
  storePath,
  pathNames,
}: GetPathsInfoArgs): Promise<Record<string, RelevantNixPathInfo>> {
  if (pathNames.length === 0) {
    return {};
  }

  const storeArg = storePath ? `--store ${storePath}` : "";
  const result = await execaCommand(
    `nix path-info --json ${storeArg} ${pathNames.join(" ")}`
  );
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

  let map = Object.fromEntries(entries);

  // Ensure all paths are present
  for (let pathName of pathNames) {
    if (!map[pathName]) {
      throw new Error(
        `Could not find path info for ${pathName}, it's likely absent`
      );
    }
  }

  return map;
}

type GetPathInfoTreeSearchArgs = {
  storePath?: string;
  rootPathNames: string[];
};

/**
 * Given a store path and a root path name, get all the infos on all the pathnames that are in the dependency tree.
 */
export async function getPathInfoTreeSearch({
  storePath,
  rootPathNames,
}: GetPathInfoTreeSearchArgs): Promise<RelevantNixPathInfo[]> {
  const pathInfos: RelevantNixPathInfo[] = [];

  let queue = [...rootPathNames];
  const foundPaths = new Set<string>(...rootPathNames);

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
  storePath?: string;
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
        rootPathNames: [pathName],
      })
    )
  );
  const toItems = await getPathInfoTreeSearch({
    storePath: storePath,
    rootPathNames: [toRootPathName],
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
