// @vitest-environment node
import { it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../../server/server';
import { HeadlessClient } from '../helpers/m21b-client';
import { MessageType as T, ActionFlag, BlockActionKind as B } from '../../src/net/protocol';
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
    const joined = (await a.wait(T.PlayerList)).players;
    expect(joined.map((player) => player.name)).toEqual(['list-A']);
    expect(joined.every((player) => Number.isInteger(player.pingMs) && player.pingMs >= 0)).toBe(
      true,
    );
    await b.login('list-B');
    const both = await a.wait(T.PlayerList, (m) => m.players.length === 2);
    expect(both.players.map((p) => p.name)).toEqual(['list-A', 'list-B']);
    await b.wait(T.PlayerList, (m) => m.players.length === 2);
    a.messages.length = 0;
    const periodic = await a.wait(T.PlayerList, (m) => m.players.length === 2, 5000);
    expect(periodic.players.every((p) => Number.isInteger(p.pingMs) && p.pingMs >= 0)).toBe(true);
    const actor = server.dimensions.get('overworld')!.actors[0]!;
    actor.player.setGameMode('creative');
    actor.player.flying = true;
    actor.player.teleport(0.5, 250, 0.5, 0, 0);
    a.send({ type: T.PlayerInput, sequence: 1, movement: [1, 0], look: [0, 0], actions: 0 });
    const first = await a.wait(T.PlayerCorrection, (m) => m.acknowledged === 1);
    for (let i = 0; i < 4; i++)
      expect(
        (await a.wait(T.PlayerCorrection, (m) => m.acknowledged === 1)).position[0],
      ).toBeGreaterThan(first.position[0]);
    a.send({ type: T.PlayerInput, sequence: 2, movement: [1, 0], look: [0, 0], actions: 0 });
    expect(
      (await a.wait(T.PlayerCorrection, (m) => m.acknowledged === 2)).position[0],
    ).toBeGreaterThan(first.position[0]);
    // Held combat input cannot bypass the explicit validated BlockAction edit path.
    a.send({
      type: T.PlayerInput,
      sequence: 3,
      movement: [0, 0],
      look: [0, 0],
      actions: ActionFlag.Attack,
    });
    await a.wait(T.PlayerCorrection, (m) => m.acknowledged === 3);
    actor.player.teleport(2.5, 250, 4.5, 0, 0);
    actor.dimension.world.setBlock(4, 251, 4, 'stone');
    await a.wait(T.BlockUpdate, (m) => m.x === 4 && m.y === 251 && m.z === 4);
    for (let i = 0; i < 4; i++) await a.wait(T.PlayerCorrection, (m) => m.acknowledged === 3);
    expect(actor.dimension.world.getBlock(4, 251, 4).id).toBe('stone');
    for (const [index, action] of [B.StartBreak, B.FinishBreak].entries())
      a.send({
        type: T.BlockAction,
        action,
        x: 4,
        y: 251,
        z: 4,
        face: 'west',
        heldSlot: 0,
        sequence: index + 1,
      });
    await a.wait(T.BlockUpdate, (m) => m.x === 4 && m.y === 251 && m.z === 4 && m.stateId === 0);
    expect(actor.dimension.world.getBlock(4, 251, 4).id).toBe('air');
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
