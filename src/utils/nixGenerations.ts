import path from "path";
import fs from "fs";

function exists<T>(value: T | undefined | null): value is T {
  return value != null;
}

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
