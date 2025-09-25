import { z } from "zod";
import { CommandError, execThirdPartyCommand } from "../errors";
import {
  GitPointer,
  GitRef,
  GitRev,
  isGitRev,
  makeGitRev,
} from "./git";

type FetchFlakeRevisionArgs = {
  flakeUri: string;
  pointer?: GitRef;
};

async function fetchFlakeRevision({
  flakeUri,
  pointer,
}: FetchFlakeRevisionArgs): Promise<GitRev> {
  const pointerLabel = pointer
    ? `git ref "${pointer.value}"`
    : "the flake's default revision";
  const refArg = pointer ? `?ref=${pointer.value}` : "";

  const result = await execThirdPartyCommand(
    `nix flake metadata --json ${flakeUri}${refArg}`,
    `Failed to get the flake git revision for ${pointerLabel}`,
  );

  let rev: string | undefined;
  try {
    rev = JSON.parse(result.stdout).revision as string | undefined;
  } catch (e) {
    throw new CommandError(
      `Failed to get the flake git revision for ${pointerLabel}`,
      `Failed to extract the revision from the flake info JSON: ${result.stdout}`,
    );
  }

  if (!rev) {
    throw new CommandError(
      `Failed to get the flake git revision for ${pointerLabel}`,
      `No revision found in the flake info JSON: ${result.stdout}`,
    );
  }

  return makeGitRev(rev);
}

type ResolveGitRevisionArgs = {
  flakeUri: string;
  pointer?: GitPointer;
};

export async function resolveGitRevision({
  flakeUri,
  pointer,
}: ResolveGitRevisionArgs): Promise<GitRev> {
  if (!pointer) {
    return fetchFlakeRevision({ flakeUri });
  }

  if (isGitRev(pointer)) {
    return pointer;
  }

  return fetchFlakeRevision({ flakeUri, pointer });
}

type GetFlakeHostnamesArgs = {
  flakeUri: string;
  rev?: GitRev;
};

const hostnamesSchema = z.array(z.string());

/**
 * Given a path and a revision, get the hostnames of the flake.
 */
export async function getFlakeHostnames({
  flakeUri,
  rev,
}: GetFlakeHostnamesArgs) {
  const revArg = rev ? `?rev=${rev.value}` : "";
  const flakeRef = `${flakeUri}${revArg}`;
  const flakeRefLiteral = JSON.stringify(flakeRef);
  const expr = `builtins.attrNames (builtins.getFlake ${flakeRefLiteral}).nixosConfigurations`;
  const exprArg = JSON.stringify(expr);

  const result = await execThirdPartyCommand(
    `nix eval --json --expr ${exprArg}`,
    "Failed to get flake hostnames",
  );

  try {
    const hostnames = hostnamesSchema.parse(JSON.parse(result.stdout));
    return hostnames;
  } catch (e) {
    throw new CommandError(
      "Failed to get flake hostnames",
      `Failed to parse the flake hostnames JSON: ${result.stdout}`,
    );
  }
}

type BuildFlakeArgs = {
  flakeUri: string;
  storeAbsolutePath: string;
  hostname: string;
  gitPointer?: GitPointer;
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
  gitPointer,
  storeAbsolutePath: buildPath,
}: BuildFlakeArgs) {
  const gitRev = await resolveGitRevision({ flakeUri, pointer: gitPointer });

  const hostnames = await getFlakeHostnames({ flakeUri, rev: gitRev });

  if (!hostnames.includes(hostname)) {
    const knownHostnames =
      hostnames.length > 0 ? hostnames.join(", ") : "(none)";
    throw new CommandError(
      `Failed to build system flake for hostname "${hostname}"`,
      `No flake configuration found for hostname: ${hostname}. Available hostnames: ${knownHostnames}`,
    );
  }

  const nixStoreRoot = buildPath;
  const attr = `nixosConfigurations.${hostname}.config.system.build.toplevel`;

  const result = await execThirdPartyCommand(
    `nix build --json --no-link --store ${nixStoreRoot} ${flakeUri}?rev=${gitRev.value}#${attr}`,
    "Failed to build system flake",
  );

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
    throw new CommandError(
      "Failed to build system flake",
      `Failed to parse the flake build command JSON: ${result.stdout}`,
    );
  }
}

export type FlakeBuildResult = Awaited<ReturnType<typeof buildSystemFlake>>;
