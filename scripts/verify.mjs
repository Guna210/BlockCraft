import { execSync } from 'child_process';

const steps = [
  { name: 'typecheck', command: 'npm run typecheck' },
  { name: 'lint', command: 'npm run lint' },
  { name: 'placeholders', command: 'npm run lint:placeholders' },
  { name: 'unit', command: 'npm run test:unit -- --run' },
  { name: 'e2e', command: 'npm run test:e2e' },
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

console.log('\n--- Verify Summary ---');
console.table(results);

if (hasError) {
  process.exit(1);
}
