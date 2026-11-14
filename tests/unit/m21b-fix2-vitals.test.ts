// @vitest-environment node
import { afterEach, beforeAll, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as pause } from 'node:timers/promises';
import { startServer, type AuthoritativeServer } from '../../server/server';
import { HeadlessClient } from '../helpers/m21b-client';
import { MessageType as T, BlockActionKind as B } from '../../src/net/protocol';
import { hashString } from '../../src/engine/rng';
import { buildPortal } from '../../src/world/portals';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { resolveBedRespawn } from '../../src/gameplay/death-beds';

let server: AuthoritativeServer;
let root = '';
const clients: HeadlessClient[] = [];
beforeAll(async () => {
  await promisify(execFile)('npm', ['run', 'build:server']);
}, 30000);
afterEach(async () => {
  for (const c of clients) c.close();
  clients.length = 0;
  await server?.stop();
  if (root) await rm(root, { recursive: true, force: true });
});
async function boot() {
  root = await mkdtemp(join(tmpdir(), 'm21b-fix2-'));
  server = await startServer(
    { world: root, seed: hashString('blockcraft-test-seed-42'), port: 0, viewDistance: 1 },
    new URL('../../dist-server/generation-worker.js', import.meta.url),
  );
}
async function connect(name: string) {
  const c = await new HeadlessClient(server.port).open();
  clients.push(c);
  const hello = await c.login(name);
  const vitals = await c.wait(T.PlayerVitals);
  return { c, hello, vitals };
}
it('sends join/change/20-tick refresh vitals and ignores alive respawn', async () => {
  await boot();
  const { c, vitals } = await connect('Ada');
  expect(vitals).toMatchObject({
    health: 20,
    hunger: 20,
    dead: false,
    mode: 'survival',
    air: 300,
    deathCause: '',
  });
  const p = server.dimensions.get('overworld')!.actors[0]!.player;
  p.survival.damage(3, 'fall');
  expect(await c.wait(T.PlayerVitals, (v) => v.health === 17)).toMatchObject({ dead: false });
  // Clear earlier snapshots; an unchanged snapshot arrives by the next 20-tick boundary.
  c.messages.length = 0;
  expect(await c.wait(T.PlayerVitals, (v) => v.health === 17, 1600)).toMatchObject({ hunger: 20 });
  const pos = [...p.pos];
  c.send({ type: T.RespawnRequest });
  await pause(150);
  expect(c.messages.some((m) => m.type === T.PlayerRespawn)).toBe(false);
  expect(p.pos).toEqual(pos);
});
it('death drops inventory, removes the model, ignores dead intent/actions, reconnects dead and respawns at spawn', async () => {
  await boot();
  const a = await connect('Ada');
  const b = await connect('Bo');
  await b.c.wait(T.EntitySpawn, (m) => m.id === a.hello.entityId);
  const dim = server.dimensions.get('overworld')!,
    p = dim.actors[0]!.player;
  p.inventory.slots[0] = { id: 'stone', count: 3, slot: 0 };
  p.survival.damage(100, 'drowning');
  expect(await a.c.wait(T.PlayerVitals, (v) => v.dead)).toMatchObject({
    health: 0,
    deathCause: 'Drowned',
    xpLevel: 0,
  });
  expect(p.inventory.slots[0]).toBeNull();
  expect(dim.items.pool.some((i) => i.active && i.item.id === 'stone' && i.count === 3)).toBe(true);
  await b.c.wait(T.EntityRemove, (m) => m.id === a.hello.entityId);
  const pos = [...p.pos];
  const state = dim.world.getBlockStateId(0, 64, 0);
  a.c.send({ type: T.PlayerInput, sequence: 1, movement: [1, 1], look: [2, 1], actions: 63 });
  a.c.send({
    type: T.BlockAction,
    action: B.FinishBreak,
    x: 0,
    y: 64,
    z: 0,
    face: 'top',
    heldSlot: 0,
    sequence: 1,
  });
  await a.c.wait(T.PlayerCorrection, (m) => m.acknowledged === 1);
  expect(p.pos).toEqual(pos);
  expect(dim.world.getBlockStateId(0, 64, 0)).toBe(state);
  a.c.close();
  await pause(150);
  const re = await connect('Ada');
  expect(re.vitals).toMatchObject({ dead: true, deathCause: 'Drowned' });
  re.c.send({ type: T.RespawnRequest });
  const spawn = await re.c.wait(T.PlayerRespawn);
  expect(spawn.position).toEqual([0.5, dim.world.getHeight(0, 0) + 1, 0.5]);
  expect(await re.c.wait(T.PlayerVitals, (v) => !v.dead)).toMatchObject({
    health: 20,
    hunger: 20,
    air: 300,
    saturation: 0,
    burning: false,
    deathCause: '',
  });
  await b.c.wait(T.EntitySpawn, (m) => m.id === re.hello.entityId);
});
it('resolves a valid bed with the same shared respawn routine', async () => {
  await boot();
  const { c } = await connect('Ada');
  const dim = server.dimensions.get('overworld')!,
    p = dim.actors[0]!.player;
  const registry = BlockRegistry.getInstance();
  dim.world.fill(4, 249, 4, 8, 253, 8, 'air');
  dim.world.fill(4, 249, 4, 8, 249, 8, 'stone');
  dim.world.setBlockStateId(
    5,
    250,
    5,
    registry.getStateId('bed', { facing: 'south', part: 'foot' })!,
  );
  dim.world.setBlockStateId(
    5,
    250,
    6,
    registry.getStateId('bed', { facing: 'south', part: 'head' })!,
  );
  p.spawnPoint = [5.5, 250.5625, 5.5];
  const expected = resolveBedRespawn(dim.world, p.spawnPoint, [0, 0, 0], (x, y, z, h) =>
    p.collision.free(x, y, z, h),
  );
  expect(expected).toEqual(p.spawnPoint);
  p.survival.damage(100, 'lava');
  await c.wait(T.PlayerVitals, (v) => v.dead);
  c.send({ type: T.RespawnRequest });
  expect((await c.wait(T.PlayerRespawn)).position).toEqual(expected);
  expect(await c.wait(T.PlayerVitals, (v) => !v.dead)).toMatchObject({ health: 20, air: 300 });
});

it('refreshes vitals after portal travel and respawns across dimensions using replacement ServerHello', async () => {
  await boot();
  const { c } = await connect('Ada');
  await c.wait(T.ChunkData);
  const dim = server.dimensions.get('overworld')!,
    p = dim.actors[0]!.player;
  buildPortal(dim.world, dim.portals, { x: 4, y: 100, z: 4, axis: 'x' });
  p.setGameMode('creative');
  p.flying = true;
  p.teleport(4.5, 100, 4.5);
  await c.wait(T.ServerHello, (m) => m.dimension === 'hollowdeep', 15000);
  expect(await c.wait(T.PlayerVitals, (v) => v.mode === 'creative')).toMatchObject({
    dead: false,
    health: 20,
  });
  const arrived = server.dimensions.get('hollowdeep')!.actors[0]!.player;
  arrived.setGameMode('survival');
  arrived.survival.damage(100, 'void');
  await c.wait(T.PlayerVitals, (v) => v.dead);
  c.messages.length = 0;
  c.send({ type: T.RespawnRequest });
  const hello = await c.wait(T.ServerHello, (m) => m.dimension === 'overworld');
  expect(hello.spawn).toEqual([0.5, dim.world.getHeight(0, 0) + 1, 0.5]);
  expect(await c.wait(T.PlayerVitals, (v) => !v.dead)).toMatchObject({
    health: 20,
    mode: 'survival',
    deathCause: '',
  });
  expect(c.messages.some((m) => m.type === T.PlayerRespawn)).toBe(false);
});
