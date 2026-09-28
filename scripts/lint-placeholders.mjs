import { execSync } from 'child_process';
import fs from 'fs';

const forbidden = [
  'TODO',
  'FIXME',
  'XXX',
  'stub',
  'not implemented',
  "throw new Error('unimplemented')",
];

function grep(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }

  let found = false;
  const pattern = forbidden.join('|');
  try {
    const output = execSync(`grep -rnE "${pattern}" ${dir}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    if (output.trim()) {
      console.error(`Found placeholders in ${dir}:`);
      console.error(output);
      found = true;
    }
  } catch (e) {
    if (e.status !== 1) {
      console.error(`Error running grep on ${dir}:`, e.message);
    }
  }
  return found;
}

let hasPlaceholders = false;
hasPlaceholders = grep('src') || hasPlaceholders;
hasPlaceholders = grep('server') || hasPlaceholders;

if (hasPlaceholders) {
  process.exit(1);
}
