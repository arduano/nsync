import { $ } from "execa";
import { z } from "zod";

type GetFlakeExportsArgs = {
  absolutePath: string;
  rev?: string;
};

/**
 * Given a path and a revision, get the `nix flake show` result of the flake, which generally shows all the flake exports.
 */
export async function getFlakeInfo({ absolutePath, rev }: GetFlakeExportsArgs) {
  let gitUrl = `git+file://${absolutePath}`;
  if (rev) {
    gitUrl += `?rev=${rev}`;
  }

  const result = await $`nix flake show --json ${gitUrl}`;
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
  absolutePath: string;
  rev?: string;
};

const configurationsSchema = z.object({
  nixosConfigurations: z.record(z.unknown()).optional(),
});

/**
 * Given a path and a revision, get the hostnames of the flake.
 */
export async function getFlakeHostnames({
  absolutePath,
  rev,
}: GetFlakeHostnamesArgs) {
  const flakeInfo = await getFlakeInfo({ absolutePath, rev });
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
