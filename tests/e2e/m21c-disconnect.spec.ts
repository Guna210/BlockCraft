import { test, expect } from '../harness/fixture';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertHealthy, connect, second } from './helpers/m21c';
test('terminating an owned server disconnects both players cleanly', async ({ page, browser }) => {
  const root = await mkdtemp(join(tmpdir(), 'm21c-disconnect-'));
  const processServer = spawn(
    process.execPath,
    [
      'dist-server/main.js',
      '--port',
      '0',
      '--world',
      root,
      '--seed',
      'blockcraft-test-seed-42',
      '--reset-world',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = new Promise<void>((resolve) => processServer.once('exit', () => resolve()));
  const b = await second(browser);
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Server readiness timeout')), 20000);
      processServer.stdout.on('data', (chunk) => {
        output += String(chunk);
        const match = output.match(/listening on (\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      processServer.once('error', reject);
    });
    await connect(page, `disconnect-A-${Date.now().toString(36)}`, port);
    await connect(b.page, `disconnect-B-${Date.now().toString(36)}`, port);
    processServer.kill('SIGTERM');
    await exited;
    for (const client of [page, b.page]) {
      await expect(client.locator('#disconnect-screen')).toBeVisible();
      await expect(client.locator('#disconnect-reason')).not.toBeEmpty();
      expect(await client.evaluate(() => window.__blockcraft!.getNetStats!().connected)).toBe(
        false,
      );
      await client.getByRole('button', { name: 'Back to main menu' }).click();
      await expect(client.getByRole('button', { name: 'Multiplayer', exact: true })).toBeVisible();
      await expect(client.locator('.remote-name')).toHaveCount(0);
    }
    await assertHealthy(b.page, b.errors);
  } finally {
    if (processServer.exitCode === null) processServer.kill('SIGTERM');
    await exited;
    await b.context.close();
    await rm(root, { recursive: true, force: true });
  }
});
