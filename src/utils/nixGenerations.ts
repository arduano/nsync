import path from "path";
import fs from "fs";
import { exists } from "./helpers";
import { execa, execaCommand } from "execa";

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
    })
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
    (item) => item.linkFilename === currentGenerationLink.link
  );

  const highestGenerationNumber = generations.reduce(
    (acc, item) => (item.generation > acc ? item.generation : acc),
    0
  );

  const highestGeneration = generations.find(
    (item) => item.generation === highestGenerationNumber
  );

  return {
    currentGeneration,
    highestGeneration,
    generations,
  };
}

const systemProfilesPrefix = "/nix/var/nix/profiles/system";

type GetNixStoreSystemGenerationsArgs = {
  storePath: string;
};

export async function getNixStoreSystemGenerations({
  storePath,
}: GetNixStoreSystemGenerationsArgs) {
  let prefix = path.join(storePath, systemProfilesPrefix);
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
  let generationData = await getNixStoreSystemGenerations({ storePath });
  let generations = generationData?.generations ?? [];

  // Sort by generation number
  generations.sort((a, b) => a.generation - b.generation);

  // Get the largest generation
  let lastGeneration = generations[generations.length - 1];
  let lastGenerationNumber = lastGeneration?.generation ?? 0;

  let newGenerationNumber = lastGenerationNumber + 1;

  let newGenerationLinkName = `-${newGenerationNumber}-link`;
  let newGenerationPathPrefix = path.join(storePath, systemProfilesPrefix);
  let newGenerationLinkPath = newGenerationPathPrefix + newGenerationLinkName;

  await fs.promises.symlink(nixItemPath, newGenerationLinkPath);

  if (executeActivation) {
    await execaCommand(
      `nix-env --switch-generation -p ${newGenerationPathPrefix} ${newGenerationNumber}`
    );

    let activationCommand = path.join(
      newGenerationPathPrefix,
      "bin/switch-to-configuration"
    );
    await execaCommand(`${activationCommand} ${executeActivation}`, {
      env: {
        NIXOS_INSTALL_BOOTLOADER: "1",
      },
    });
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
  let generationData = await getNixStoreSystemGenerations({ storePath });
  if (!generationData || !generationData.currentGeneration) {
    // If it fails to fetch generations, or the current generation, then skip
    return;
  }

  let generations = generationData.generations;
  let currentGeneration = generationData.currentGeneration;

  // Sort by generation number
  generations.sort((a, b) => a.generation - b.generation);

  // Delete all generations from 0 to N-keepGenerationCount
  let generationsToDelete = generations.slice(
    0,
    generations.length - keepGenerationCount
  );

  for (let generation of generationsToDelete) {
    if (generation.generation === currentGeneration.generation) {
      continue;
    }

    await fs.promises.unlink(generation.linkPath);
  }

  // Run gc
  await execaCommand("nix store gc");
}
