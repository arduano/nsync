import { $, execaCommand } from "execa";
import { z } from "zod";

type GetFlakeExportsArgs = {
  flakeGitUri: string;
  rev?: string;
};

/**
 * Given a path and a revision, get the `nix flake show` result of the flake, which generally shows all the flake exports.
 */
export async function getFlakeInfo({ flakeGitUri, rev }: GetFlakeExportsArgs) {
  let revArg = rev ? `?rev=${rev}` : "";

  const result = await execaCommand(
    `nix flake show --json ${flakeGitUri}${revArg}`
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
  flakeGitUri: string;
  rev?: string;
};

const configurationsSchema = z.object({
  nixosConfigurations: z.record(z.unknown()).optional(),
});

/**
 * Given a path and a revision, get the hostnames of the flake.
 */
export async function getFlakeHostnames({
  flakeGitUri,
  rev,
}: GetFlakeHostnamesArgs) {
  const flakeInfo = await getFlakeInfo({ flakeGitUri, rev });
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
  flakeGitUri: string;
  storeAbsolutePath: string;
  hostname: string;
  rev?: string;
};

const flakeBuildCommandResult = z
  .array(
    z.object({
      drvPath: z.string(),
      outputs: z.object({
        out: z.string(),
      }),
    })
  )
  .length(1);

/**
 * Given a path, a hostname and a revision, build the flake, with the nix store root being the buildPath.
 * If rev is not provided, it defaults to the current revision.
 */
export async function buildSystemFlake({
  flakeGitUri,
  hostname,
  rev,
  storeAbsolutePath: buildPath,
}: BuildFlakeArgs) {
  let hostnames = await getFlakeHostnames({ flakeGitUri, rev });

  if (!hostnames.includes(hostname)) {
    throw new Error(
      `No flake configuration found for hostname: ${hostname}. Available hostnames: ${hostnames.join(
        ", "
      )}`
    );
  }

  const nixStoreRoot = buildPath;
  const revArg = rev ? `?rev=${rev}` : "";
  const attr = `nixosConfigurations.${hostname}.config.system.build.toplevel`;

  const command = execaCommand(
    `nix build --json --no-link --store ${nixStoreRoot} ${flakeGitUri}${revArg}#${attr}`,
    {
      stderr: "inherit",
    }
  );

  // Pipe stderr to the host
  const result = await command;

  if (result.failed) {
    throw new Error(result.stderr);
  }

  try {
    const parsedResult = flakeBuildCommandResult.parse(
      JSON.parse(result.stdout)
    );

    const parsed = {
      derivation: parsedResult[0].drvPath,
      output: parsedResult[0].outputs.out,
    };

    return parsed;
  } catch (e) {
    throw new Error(`Error parsing flake build command result: ${e}`);
  }
}

export type FlakeBuildResult = Awaited<ReturnType<typeof buildSystemFlake>>;
