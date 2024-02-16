import { $, execaCommand } from "execa";
import { z } from "zod";

type GetFlakeRevisionFromRefArgs = {
  flakeUri: string;
  ref?: string;
};

/**
 * Given a path and a git ref, get the git revision of the flake.
 */
export async function getRevisionFromRef({
  flakeUri,
  ref,
}: GetFlakeRevisionFromRefArgs) {
  const refArg = ref ? `?ref=${ref}` : "";

  const result = await execaCommand(
    `nix flake metadata --json ${flakeUri}${refArg}`,
  );
  if (result.failed) {
    throw new Error(result.stderr);
  }

  try {
    return JSON.parse(result.stdout).revision as string;
  } catch (e) {
    throw new Error(`Failed to parse flake info JSON: ${result.stdout}`);
  }
}

type GetFlakeExportsArgs = {
  flakeUri: string;
  rev?: string;
};

/**
 * Given a path and a revision, get the `nix flake show` result of the flake, which generally shows all the flake exports.
 */
export async function getFlakeInfo({ flakeUri, rev }: GetFlakeExportsArgs) {
  const revArg = rev ? `?rev=${rev}` : "";

  const result = await execaCommand(
    `nix flake show --json ${flakeUri}${revArg}`,
  );
  if (result.failed) {
    throw new Error(result.stderr);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (e) {
    throw new Error(`Failed to parse flake info JSON: ${result.stdout}`);
  }
}

type GetFlakeHostnamesArgs = {
  flakeUri: string;
  rev?: string;
};

const configurationsSchema = z.object({
  nixosConfigurations: z.record(z.unknown()).optional(),
});

/**
 * Given a path and a revision, get the hostnames of the flake.
 */
export async function getFlakeHostnames({
  flakeUri,
  rev,
}: GetFlakeHostnamesArgs) {
  const flakeInfo = await getFlakeInfo({ flakeUri, rev });
  const parsed = configurationsSchema.safeParse(flakeInfo);
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }

  const configurations = parsed.data.nixosConfigurations;
  if (!configurations) {
    return [];
  }

  const hostnames = Object.keys(configurations);
  return hostnames;
}

type GetGitRevisionsArgs = {
  absolutePath: string;
};

/**
 * Get the git revisions of a flake.
 */
export async function getGitRevisions({ absolutePath }: GetGitRevisionsArgs) {
  const result = await $`git -C ${absolutePath} log --pretty=format:%H`;
  if (result.failed) {
    throw new Error(result.stderr);
  }

  return result.stdout.split("\n");
}

type CheckFlakeDirtyArgs = {
  absolutePath: string;
};

/**
 * Check if a flake is dirty (i.e. has uncommitted changes).
 */
export async function checkFlakeDirty({ absolutePath }: CheckFlakeDirtyArgs) {
  const result = await $`git -C ${absolutePath} status --porcelain`;
  if (result.failed) {
    throw new Error(result.stderr);
  }

  return result.stdout.trim() !== "";
}

type BuildFlakeArgs = {
  flakeUri: string;
  storeAbsolutePath: string;
  hostname: string;
  ref?: string;
};

const flakeBuildCommandResult = z
  .array(
    z.object({
      drvPath: z.string(),
      outputs: z.object({
        out: z.string(),
      }),
    }),
  )
  .length(1);

/**
 * Given a path, a hostname and a revision, build the flake, with the nix store root being the buildPath.
 * If rev is not provided, it defaults to the current revision.
 */
export async function buildSystemFlake({
  flakeUri,
  hostname,
  ref,
  storeAbsolutePath: buildPath,
}: BuildFlakeArgs) {
  const gitRev = await getRevisionFromRef({ flakeUri, ref });

  const hostnames = await getFlakeHostnames({ flakeUri, rev: gitRev });

  if (!hostnames.includes(hostname)) {
    throw new Error(
      `No flake configuration found for hostname: ${hostname}. Available hostnames: ${hostnames.join(
        ", ",
      )}`,
    );
  }

  const nixStoreRoot = buildPath;
  const attr = `nixosConfigurations.${hostname}.config.system.build.toplevel`;

  const command = execaCommand(
    `nix build --json --no-link --store ${nixStoreRoot} ${flakeUri}?rev=${gitRev}#${attr}`,
    {
      stderr: "inherit",
    },
  );

  // Pipe stderr to the host
  const result = await command;

  if (result.failed) {
    throw new Error(result.stderr);
  }

  try {
    const parsedResult = flakeBuildCommandResult.parse(
      JSON.parse(result.stdout),
    );

    const parsed = {
      derivation: parsedResult[0].drvPath,
      output: parsedResult[0].outputs.out,
      gitRevision: gitRev,
    };

    return parsed;
  } catch (e) {
    throw new Error(`Error parsing flake build command result: ${e}`);
  }
}

export type FlakeBuildResult = Awaited<ReturnType<typeof buildSystemFlake>>;
