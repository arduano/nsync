import path from "path";
import fs from "fs";
import { exists } from "../helpers";
import { execThirdPartyCommand } from "../errors";

export async function getNixStoreGenerations(profilePrefix: string) {
  const folderName = path.dirname(profilePrefix);
  const basename = path.basename(profilePrefix);
  const folderItems = fs.readdirSync(folderName);

  // Filter by items that are symlinks
  const linkFiles = await Promise.all(
    folderItems.map(async (item) => {
      const itemPath = path.join(folderName, item);
      const stat = await fs.promises.lstat(itemPath);
      if (!stat.isSymbolicLink()) {
        return null;
      } else {
        return {
          item,
          link: await fs.promises.readlink(itemPath),
        };
      }
    }),
  );

  const links = linkFiles.filter(exists);
  const currentGenerationLink = links.find((link) => link.item == basename);

  if (!currentGenerationLink) {
    return null;
  }

  const generations = links
    .map((link) => {
      if (!link.item.startsWith(`${basename}-`)) {
        return null;
      }

      const regex = /(\d+)-link$/;
      const match = regex.exec(link.item);
      if (!match) {
        return null;
      }

      const generation = parseInt(match[1]);

      return {
        generation,
        nixItemLink: link.link,
        linkPath: path.join(folderName, link.item),
        linkFilename: link.item,
      };
    })
    .filter(exists);

  const currentGeneration = generations.find(
    (item) => item.linkFilename === currentGenerationLink.link,
  );

  const highestGenerationNumber = generations.reduce(
    (acc, item) => (item.generation > acc ? item.generation : acc),
    0,
  );

  const highestGeneration = generations.find(
    (item) => item.generation === highestGenerationNumber,
  );

  return {
    currentGeneration,
    highestGeneration,
    generations,
  };
}

const systemProfilesRelativePath = "nix/var/nix/profiles/system";

type GetNixStoreSystemGenerationsArgs = {
  storePath: string;
};

export async function getNixStoreSystemGenerations({
  storePath,
}: GetNixStoreSystemGenerationsArgs) {
  const normalizedStorePath = path.resolve(storePath);
  const prefix = path.join(normalizedStorePath, systemProfilesRelativePath);
  return getNixStoreGenerations(prefix);
}

type MakeNewSystemGenerationArgs = {
  storePath: string;
  nixItemPath: string;
  executeActivation?: "switch" | "boot";
};

/**
 * Creates a new system generation for the current nix store, and optionally activates it.
 */
export async function makeNewSystemGeneration({
  storePath,
  nixItemPath,
  executeActivation,
}: MakeNewSystemGenerationArgs) {
  const normalizedStorePath = path.resolve(storePath);
  const generationData = await getNixStoreSystemGenerations({
    storePath: normalizedStorePath,
  });
  const generations = generationData?.generations ?? [];

  // Sort by generation number
  generations.sort((a, b) => a.generation - b.generation);

  // Get the largest generation
  const lastGeneration =
    generations.length == 0 ? null : generations[generations.length - 1];
  const lastGenerationNumber = lastGeneration?.generation ?? 0;

  const newGenerationNumber = lastGenerationNumber + 1;

  const newGenerationLinkName = `-${newGenerationNumber}-link`;
  const systemProfilesPrefixHost = path.join(
    normalizedStorePath,
    systemProfilesRelativePath,
  );
  const systemProfilesPrefixCommand =
    normalizedStorePath === "/"
      ? systemProfilesPrefixHost
      : `/${systemProfilesRelativePath}`;
  const newGenerationLinkPath =
    systemProfilesPrefixHost + newGenerationLinkName;

  await fs.promises.symlink(nixItemPath, newGenerationLinkPath);

  if (executeActivation) {
    const runCommand = async (
      command: string,
      failedMessage: string,
      options?: Parameters<typeof execThirdPartyCommand>[2],
    ) => {
      if (normalizedStorePath === "/") {
        return execThirdPartyCommand(command, failedMessage, options);
      }

      const { env, ...otherOptions } = options ?? {};
      const envAssignments = Object.entries(env ?? {})
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => {
          const escaped = String(value).replace(/'/g, "'\\''");
          return `${key}='${escaped}'`;
        })
        .join(" ");

      const commandWithEnv = envAssignments
        ? `${envAssignments} ${command}`
        : command;

      return execThirdPartyCommand(
        [
          "nixos-enter",
          "--root",
          normalizedStorePath,
          "--command",
          commandWithEnv,
        ],
        failedMessage,
        otherOptions,
      );
    };

    await runCommand(
      `nix-env --switch-generation -p ${systemProfilesPrefixCommand} ${newGenerationNumber}`,
      `Failed to switch to generation ${newGenerationNumber} for profile prefix "${systemProfilesPrefixHost}"`,
    );

    const activationCommand = path.join(
      systemProfilesPrefixCommand,
      "bin/switch-to-configuration",
    );
    await runCommand(
      `${activationCommand} ${executeActivation}`,
      `Failed to activate the new generation using ${activationCommand} ${executeActivation}`,
      {
        env: {
          NIXOS_INSTALL_BOOTLOADER: "1",
        },
      },
    );
  }
}

type CleanupOldGenerationsArgs = {
  storePath: string;
  keepGenerationCount: number;
};

/**
 * Cleans up old generations of the nix store, keeping only the last `keepGenerationCount` generations.
 * Also, current generations can't be deleted either.
 */
export async function cleanupOldGenerations({
  storePath,
  keepGenerationCount,
}: CleanupOldGenerationsArgs) {
  const generationData = await getNixStoreSystemGenerations({ storePath });
  if (!generationData || !generationData.currentGeneration) {
    // If it fails to fetch generations, or the current generation, then skip
    return;
  }

  const generations = generationData.generations;
  const currentGeneration = generationData.currentGeneration;

  // Sort by generation number
  generations.sort((a, b) => a.generation - b.generation);

  // Delete all generations from 0 to N-keepGenerationCount
  const generationsToDelete = generations.slice(
    0,
    generations.length - keepGenerationCount,
  );

  for (const generation of generationsToDelete) {
    if (generation.generation === currentGeneration.generation) {
      continue;
    }

    await fs.promises.unlink(generation.linkPath);
  }

  // Run gc
  await execThirdPartyCommand("nix store gc", "Failed to run nix store gc");
}
