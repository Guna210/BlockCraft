import { execSync } from 'child_process';

const shard = process.env.VERIFY_E2E_SHARD;
const skipStatic = process.env.VERIFY_SKIP_STATIC === '1';

const steps = [
  { name: 'typecheck', static: true, command: 'npm run typecheck' },
  { name: 'lint', static: true, command: 'npm run lint' },
  { name: 'placeholders', static: true, command: 'npm run lint:placeholders' },
  { name: 'unit', static: true, command: 'npm run test:unit -- --run' },
  { name: 'e2e', command: shard ? `npm run test:e2e -- --shard=${shard}` : 'npm run test:e2e' },
];

let hasError = false;
const results = [];

for (const step of steps) {
  if (skipStatic && step.static) {
    results.push({ step: step.name, status: 'skipped (shard)' });
    continue;
  }
  console.log(`\n--- Running ${step.name} ---`);
  try {
    execSync(step.command, { stdio: 'inherit' });
    results.push({ step: step.name, status: '✓ passed' });
  } catch (e) {
    results.push({ step: step.name, status: '✗ failed' });
    hasError = true;
  }
}

console.log('\n--- Verify Summary ---');
console.table(results);

if (hasError) {
  process.exit(1);
}
