import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const forbidden = [
  'TODO',
  'FIXME',
  'XXX',
  'stub',
  'not implemented',
  "throw new Error('unimplemented')",
];

async function findPlaceholders(directory, relativeDirectory, isRoot = false) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isRoot && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  entries.sort((left, right) => {
    if (left.name < right.name) return -1;
    if (left.name > right.name) return 1;
    return 0;
  });

  const matches = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const relativePath = path.join(relativeDirectory, entry.name);

    if (entry.isDirectory()) {
      matches.push(...(await findPlaceholders(entryPath, relativePath)));
      continue;
    }

    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }

    const contents = await readFile(entryPath, 'utf8');
    const lines = contents.split(/\r\n|\n|\r/);
    const displayPath = relativePath.split(path.sep).join('/');

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (forbidden.some((placeholder) => line.includes(placeholder))) {
        matches.push(`${displayPath}:${index + 1}:${line}`);
      }
    }
  }

  return matches;
}

async function main() {
  let hasPlaceholders = false;
  for (const root of ['src', 'server']) {
    const matches = await findPlaceholders(path.join(process.cwd(), root), root, true);
    if (matches.length > 0) {
      console.error(`Found placeholders in ${root}:`);
      console.error(`${matches.join('\n')}\n`);
      hasPlaceholders = true;
    }
  }

  process.exitCode = hasPlaceholders ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
