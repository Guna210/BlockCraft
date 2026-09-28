import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const milestone = process.env.MILESTONE;
if (!milestone) {
  console.error('Error: MILESTONE environment variable must be set for verify:quick');
  process.exit(1);
}

const e2eGlob = `tests/e2e/${milestone.toLowerCase()}*.spec.ts`;

const steps = [
  { name: 'typecheck', command: 'npm run typecheck' },
  { name: 'lint', command: 'npm run lint' },
  { name: 'placeholders', command: 'npm run lint:placeholders' },
  { name: 'unit', command: 'npm run test:unit -- --run' },
  { name: 'e2e', command: `npm run test:e2e -- ${e2eGlob}` },
];

let hasError = false;
const results = [];

for (const step of steps) {
  console.log(`\n--- Running ${step.name} ---`);
  try {
    execSync(step.command, { stdio: 'inherit' });
    results.push({ step: step.name, status: '✓ passed' });
  } catch (e) {
    results.push({ step: step.name, status: '✗ failed' });
    hasError = true;
  }
}

console.log('\n--- Verify Quick Summary ---');
console.table(results);

if (hasError) {
  process.exit(1);
}
