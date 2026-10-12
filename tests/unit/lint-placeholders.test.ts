import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

const scriptPath = path.join(process.cwd(), 'scripts', 'lint-placeholders.mjs');

interface ExecFileSyncError extends Error {
  status: number | null;
  stdout: string | Buffer;
  stderr: string | Buffer;
}

function isExecFileSyncError(error: unknown): error is ExecFileSyncError {
  return error instanceof Error && 'status' in error;
}

function runPlaceholderLint(fixtureDir: string) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath], {
      cwd: fixtureDir,
      encoding: 'utf8',
    });
    return { exitCode: 0, output: stdout };
  } catch (error) {
    if (!isExecFileSyncError(error) || error.status === null) {
      throw error;
    }
    const stdout = error.stdout.toString();
    const stderr = error.stderr.toString();
    return { exitCode: error.status, output: `${stdout}${stderr}` };
  }
}

function displayPath(fixtureDir: string, filePath: string) {
  return path.relative(fixtureDir, filePath).split(path.sep).join('/');
}

describe('lint:placeholders', () => {
  it('reports every forbidden pattern in nested src and server files', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-placeholders-'));
    const srcRoot = path.join(fixtureDir, 'src');
    const serverRoot = path.join(fixtureDir, 'server');
    const srcFile = path.join(srcRoot, 'nested', 'patterns.data');
    const serverFile = path.join(serverRoot, 'nested', 'patterns.data');

    try {
      fs.mkdirSync(path.dirname(srcFile), { recursive: true });
      fs.mkdirSync(path.dirname(serverFile), { recursive: true });
      fs.writeFileSync(srcFile, `${forbidden.join('\n')}\n`, 'utf8');
      fs.writeFileSync(serverFile, `${forbidden.join('\n')}\n`, 'utf8');

      const { exitCode, output } = runPlaceholderLint(fixtureDir);
      expect(exitCode).toBe(1);

      for (const filePath of [srcFile, serverFile]) {
        const fileDisplayPath = displayPath(fixtureDir, filePath);
        for (const [index, pattern] of forbidden.entries()) {
          expect(output).toContain(`${fileDisplayPath}:${index + 1}:${pattern}`);
        }
      }
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('passes a clean fixture and ignores a mixed-case todo', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-placeholders-'));
    const srcRoot = path.join(fixtureDir, 'src');
    const mixedCaseFile = path.join(srcRoot, 'nested', 'mixed-case.data');

    try {
      fs.mkdirSync(srcRoot);
      fs.mkdirSync(path.join(fixtureDir, 'server'));
      expect(runPlaceholderLint(fixtureDir).exitCode).toBe(0);

      fs.mkdirSync(path.dirname(mixedCaseFile), { recursive: true });
      fs.writeFileSync(mixedCaseFile, 'todo\n', 'utf8');

      const { exitCode, output } = runPlaceholderLint(fixtureDir);
      expect(exitCode).toBe(0);
      expect(output).not.toContain(displayPath(fixtureDir, mixedCaseFile));
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('passes a clean fixture when server is missing', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-placeholders-'));

    try {
      fs.mkdirSync(path.join(fixtureDir, 'src'));
      expect(runPlaceholderLint(fixtureDir).exitCode).toBe(0);
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
