import { z } from "zod";
import { CommandError, execThirdPartyCommand } from "../errors";
import path from "path";

const pathInfoValidData = z.object({
  ca: z.string().optional(),
  deriver: z.string().optional(),
  narHash: z.string(),
  narSize: z.number(),
  path: z.string(),
  references: z.array(z.string()),
  signatures: z.array(z.string()).optional(),
  registrationTime: z.number().optional(),
  url: z.string().optional(),
  valid: z.literal(true),
});

const pathInfoInvalidData = z.object({
  path: z.string(),
  valid: z.literal(false),
});

const pathInfoData = z.union([pathInfoValidData, pathInfoInvalidData]);

const pathInfoDataArray = z.array(pathInfoData);

type NixPathInfo = z.infer<typeof pathInfoValidData>;

function mapParsedPathInfoToRelevantPathInfo(
  parsed: z.infer<typeof pathInfoData>,
): NixPathInfo {
  if (!parsed.valid) {
    throw new CommandError(
      "Failed to get store path info",
      `The path info is invalid, it likely doesn't exist: ${parsed.path}`,
    );
  }

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
}: GetPathInfoArgs): Promise<NixPathInfo | null> {
  const storeArg = storePath ? `--store ${storePath}` : "";
  const result = await execThirdPartyCommand(
    `nix path-info --json ${storeArg} ${pathName}`,
    "Failed to get store path info",
  );

  const parsed = pathInfoDataArray.safeParse(JSON.parse(result.stdout));
  if (!parsed.success) {
    throw new CommandError(
      "Failed to get store path info",
      `Failed to parse the store path info JSON: ${parsed.error.message}`,
    );
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
}: GetPathsInfoArgs): Promise<Record<string, NixPathInfo>> {
  if (pathNames.length === 0) {
    return {};
  }

  const storeArg = storePath ? `--store ${storePath}` : "";
  const result = await execThirdPartyCommand(
    `nix path-info --json ${storeArg} ${pathNames.join(" ")}`,
    "Failed to get store path info",
  );

  const parsed = pathInfoDataArray.safeParse(JSON.parse(result.stdout));
  if (!parsed.success) {
    throw new CommandError(
      "Failed to get store path info",
      `Failed to parse the store path info JSON: ${parsed.error.message}`,
    );
  }

  const entries = parsed.data.map((item) => [
    item.path,
    mapParsedPathInfoToRelevantPathInfo(item),
  ]);

  const map = Object.fromEntries(entries);

  // Ensure all paths are present
  for (const pathName of pathNames) {
    if (!map[pathName]) {
      throw new CommandError(
        "Failed to get store path info",
        `Could not find path info for "${pathName}", it's likely absent`,
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
}: GetPathInfoTreeSearchArgs): Promise<NixPathInfo[]> {
  const pathInfos: NixPathInfo[] = [];

  let queue = [...rootPathNames];
  const foundPaths = new Set<string>(...rootPathNames);

  while (queue.length > 0) {
    const infos = await getPathsInfo({
      storePath,
      pathNames: queue,
    });
    queue = [];

    for (const info of Object.values(infos)) {
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
 * Given an item path, folder name of the path. The folder name is under `/nix/store/<name>`.
 */
export function getNixPathFolderName(itemPath: string) {
  if (!itemPath.startsWith("/nix/store/")) {
    throw new CommandError(
      "Failed analysing store dependencies",
      `The path is not a store path: ${itemPath}`,
    );
  }

  return path.basename(itemPath);
}

/**
 * Given an item path, get the path hash of the path. The path hash is under `/nix/store/<hash>-<name>`.
 */
export function getPathHashFromPath(itemPath: string) {
  const folder = getNixPathFolderName(itemPath);
  const hash = folder.split("-")[0];
  return hash;
}

export function nixPathInfoToNarinfoFileString(info: NixPathInfo) {
  const lines: string[] = [];

  const references = info.references.map((r) => getNixPathFolderName(r));

  lines.push(`StorePath: ${info.path}`);
  lines.push(`URL: ${info.url ?? "virtual_generated"}`);
  lines.push(`Compression: none`);
  lines.push(`FileHash: ${info.narHash}`);
  lines.push(`FileSize: ${info.narSize}`);
  lines.push(`NarHash: ${info.narHash}`);
  lines.push(`NarSize: ${info.narSize}`);
  lines.push(`References: ${references.join(" ")}`);
  if (info.signatures) {
    lines.push(`Sig: ${info.signatures.join(" ")}`);
  }

  return lines.join("\n") + "\n";
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
        storePath,
        rootPathNames: [pathName],
      }),
    ),
  );
  const toItems = await getPathInfoTreeSearch({
    storePath,
    rootPathNames: [toRootPathName],
  });

  const fromPathsSet = new Set(
    fromItems.flatMap((group) => group.map((info) => info.path)),
  );
  const added = toItems.filter((item) => !fromPathsSet.has(item.path));

  return {
    allResultingItems: toItems,
    added,
  };
}
