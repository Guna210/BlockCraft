import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const forbidden = [
  'TODO',
  'FIXME',
  'XXX',
  'stub',
  'not implemented',
  "throw new Error('unimplemented')",
];

function isExecSyncError(error: unknown): error is Error & { status: number | null } {
  return error instanceof Error && 'status' in error;
}

function runPlaceholderLint() {
  const captureDirectory = fs.mkdtempSync(
    path.join(process.cwd(), 'tests', 'unit', '.lint-placeholders-output-'),
  );
  const outputPath = path.join(captureDirectory, 'output.txt');
  const quoteShellArgument = (argument: string) => {
    if (process.platform === 'win32') {
      return `"${argument}"`;
    }
    return `'${argument.replaceAll("'", "'\\''")}'`;
  };

  try {
    let exitCode = 0;
    try {
      execSync(`npm run lint:placeholders > ${quoteShellArgument(outputPath)} 2>&1`, {
        stdio: 'ignore',
      });
    } catch (error) {
      if (!isExecSyncError(error) || error.status === null) {
        throw error;
      }
      exitCode = error.status;
    }
    return { exitCode, output: fs.readFileSync(outputPath, 'utf8') };
  } finally {
    fs.rmSync(captureDirectory, { recursive: true, force: true });
  }
}

function displayPath(filePath: string) {
  return path.relative(process.cwd(), filePath).split(path.sep).join('/');
}

function onlyFindsExistingLintTestFile(output: string) {
  const matches = output.split(/\r?\n/).filter((line) => /^(src|server)\/.+:\d+:/.test(line));
  return matches.length > 0 && matches.every((line) => line.startsWith('src/temp_todo_test.ts:'));
}

async function runUntilExistingLintTestFileIsRemoved() {
  let result = runPlaceholderLint();
  const deadline = Date.now() + 2000;

  while (
    result.exitCode === 1 &&
    onlyFindsExistingLintTestFile(result.output) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    result = runPlaceholderLint();
  }

  return result;
}

describe('lint:placeholders', () => {
  it('reports every forbidden pattern in nested src and server files', () => {
    const srcRoot = path.join(process.cwd(), 'src');
    const serverRoot = path.join(process.cwd(), 'server');
    const serverExisted = fs.existsSync(serverRoot);
    let srcTempRoot: string | undefined;
    let serverTempRoot: string | undefined;

    try {
      srcTempRoot = fs.mkdtempSync(path.join(srcRoot, '.lint-placeholders-'));
      if (!serverExisted) {
        fs.mkdirSync(serverRoot);
      }
      serverTempRoot = fs.mkdtempSync(path.join(serverRoot, '.lint-placeholders-'));
      const srcFile = path.join(srcTempRoot, 'nested', 'patterns.data');
      const serverFile = path.join(serverTempRoot, 'nested', 'patterns.data');

      fs.mkdirSync(path.dirname(srcFile), { recursive: true });
      fs.mkdirSync(path.dirname(serverFile), { recursive: true });
      fs.writeFileSync(srcFile, `${forbidden.join('\n')}\n`, 'utf8');
      fs.writeFileSync(serverFile, `${forbidden.join('\n')}\n`, 'utf8');

      const { exitCode, output } = runPlaceholderLint();
      expect(exitCode).toBe(1);

      for (const filePath of [srcFile, serverFile]) {
        const fileDisplayPath = displayPath(filePath);
        for (const [index, pattern] of forbidden.entries()) {
          expect(output).toContain(`${fileDisplayPath}:${index + 1}:${pattern}`);
        }
      }
    } finally {
      if (srcTempRoot) {
        fs.rmSync(srcTempRoot, { recursive: true, force: true });
      }
      if (serverTempRoot) {
        fs.rmSync(serverTempRoot, { recursive: true, force: true });
      }
      if (!serverExisted) {
        fs.rmSync(serverRoot, { recursive: true, force: true });
      }
    }
  });

  it('passes a clean tree and ignores a mixed-case todo', async () => {
    const srcRoot = path.join(process.cwd(), 'src');
    let srcTempRoot: string | undefined;

    try {
      srcTempRoot = fs.mkdtempSync(path.join(srcRoot, '.lint-placeholders-'));
      const mixedCaseFile = path.join(srcTempRoot, 'nested', 'mixed-case.data');
      fs.mkdirSync(path.dirname(mixedCaseFile), { recursive: true });

      const cleanResult = await runUntilExistingLintTestFileIsRemoved();
      expect(cleanResult.exitCode).toBe(0);

      fs.writeFileSync(mixedCaseFile, 'todo\n', 'utf8');
      const mixedCaseResult = await runUntilExistingLintTestFileIsRemoved();
      expect(mixedCaseResult.exitCode).toBe(0);
      expect(mixedCaseResult.output).not.toContain(displayPath(mixedCaseFile));
    } finally {
      if (srcTempRoot) {
        fs.rmSync(srcTempRoot, { recursive: true, force: true });
      }
    }
  });
});
