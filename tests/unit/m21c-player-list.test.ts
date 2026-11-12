// @vitest-environment node
import { it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../../server/server';
import { HeadlessClient } from '../helpers/m21b-client';
import { MessageType as T } from '../../src/net/protocol';
it('broadcasts names and measured ping on join, periodically, and on leave', async () => {
  await promisify(execFile)('npm', ['run', 'build:server']);
  const root = await mkdtemp(join(tmpdir(), 'm21c-list-'));
  const server = await startServer(
    { port: 0, world: root, seed: 42, viewDistance: 1 },
    new URL('../../dist-server/generation-worker.js', import.meta.url),
  );
  const a = await new HeadlessClient(server.port).open();
  const b = await new HeadlessClient(server.port).open();
  try {
    await a.login('list-A');
    expect((await a.wait(T.PlayerList)).players).toEqual([{ name: 'list-A', pingMs: 0 }]);
    await b.login('list-B');
    const both = await a.wait(T.PlayerList, (m) => m.players.length === 2);
    expect(both.players.map((p) => p.name)).toEqual(['list-A', 'list-B']);
    await b.wait(T.PlayerList, (m) => m.players.length === 2);
    a.messages.length = 0;
    const periodic = await a.wait(T.PlayerList, (m) => m.players.length === 2, 5000);
    expect(periodic.players.every((p) => Number.isInteger(p.pingMs) && p.pingMs >= 0)).toBe(true);
    b.close();
    expect((await a.wait(T.PlayerList, (m) => m.players.length === 1)).players[0]!.name).toBe(
      'list-A',
    );
  } finally {
    a.close();
    b.close();
    await server.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
