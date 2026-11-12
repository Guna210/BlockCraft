// @vitest-environment node
import { buildPortal, portalArrivalPoint } from '../../src/world/portals';
import type { ChestEntityState } from '../../src/gameplay/chests';
import type { KilnState } from '../../src/gameplay/kiln';
import { PrimedChargeC } from '../../src/entity/blast-charge';
import { EntityKindC, HealthC } from '../../src/entity/ecs/components';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as pause } from 'node:timers/promises';
import { startServer, type AuthoritativeServer } from '../../server/server';
import { HeadlessClient } from '../helpers/m21b-client';
import {
  MessageType as T,
  BlockActionKind as B,
  InventoryAction as A,
  PROTOCOL_VERSION,
  encodeMessage,
  decodeMessage,
  BinaryWriter,
} from '../../src/net/protocol';
import { hashString } from '../../src/engine/rng';
import { deserializeColumn } from '../../src/persist/column-format';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { STRUCTURE_REGISTRATIONS } from '../../src/gen/structures/registrations';
import { createHollowdeepPipeline } from '../../src/gen/hollowdeep';
import { ChunkColumn } from '../../src/world/column';
import { World } from '../../src/world/world';
import { GenerationPool } from '../../server/generation';
import { deserializeColumnBinary } from '../../src/persist/column-format';
import { weatherManager } from '../../src/world/weather';
import { TransformC } from '../../src/entity/ecs/components';
import { decodeRegion } from '../../server/storage';
import * as storage from '../../server/storage';

const seed = hashString('blockcraft-test-seed-42');
const worker = new URL('../../dist-server/generation-worker.js', import.meta.url);
let server: AuthoritativeServer | null = null;
let root = '';
const clients: HeadlessClient[] = [];
beforeAll(async () => {
  await promisify(execFile)('npm', ['run', 'build:server'], { cwd: process.cwd() });
}, 30000);
afterEach(async () => {
  for (const client of clients) client.close();
  clients.length = 0;
  await server?.stop();
  server = null;
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});
async function boot(delayMs = 0): Promise<AuthoritativeServer> {
  root ||= await mkdtemp(join(tmpdir(), 'm21b-'));
  server = await startServer({ world: root, seed, port: 0, viewDistance: 1, delayMs }, worker);
  return server;
}
async function connect(name?: string): Promise<HeadlessClient> {
  const client = await new HeadlessClient(server!.port).open();
  clients.push(client);
  if (name) await client.login(name);
  return client;
}
async function setupBlock(
  a: HeadlessClient,
  b?: HeadlessClient,
  id = 'stone',
): Promise<{ x: number; y: number; z: number; face: 'west' }> {
  const actor = server!.dimensions.get('overworld')!.actors[0]!;
  const world = actor.dimension.world;
  await a.wait(T.ChunkData, (message) => message.cx === 0 && message.cz === 0);
  if (b) await b.wait(T.ChunkData, (message) => message.cx === 0 && message.cz === 0);
  const y = 250;
  actor.player.teleport(2.5, y, 4.5, 0, 0);
  actor.player.setGameMode('creative');
  actor.player.flying = true;
  world.setBlock(4, y + 1, 4, id);
  const target = { x: 4, y: y + 1, z: 4, face: 'west' as const };
  await a.wait(T.BlockUpdate, (m) => m.x === target.x && m.y === target.y);
  if (b) await b.wait(T.BlockUpdate, (m) => m.x === target.x && m.y === target.y);
  return target;
}
function block(
  client: HeadlessClient,
  action: B,
  target: { x: number; y: number; z: number; face: 'west' },
  sequence: number,
): void {
  client.send({ type: T.BlockAction, action, ...target, heldSlot: 0, sequence });
}

describe('M21b authoritative Node clients', () => {
  it('handshakes and rejects incompatible versions, duplicate and empty names, and full servers', async () => {
    await boot();
    const first = await connect();
    const hello = await first.login('Ada');
    expect(hello.seed).toBe(seed);
    expect(hello.dimension).toBe('overworld');
    const mismatch = await connect();
    mismatch.send({ type: T.ClientHello, version: PROTOCOL_VERSION - 1, name: 'Old' });
    expect((await mismatch.wait(T.LoginReject)).reason).toContain('version');
    const duplicate = await connect();
    duplicate.send({ type: T.ClientHello, version: PROTOCOL_VERSION, name: 'ada' });
    expect((await duplicate.wait(T.LoginReject)).reason).toContain('already');
    const empty = await connect();
    empty.send({ type: T.ClientHello, version: PROTOCOL_VERSION, name: ' ' });
    expect((await empty.wait(T.LoginReject)).reason).toContain('nonempty');
    server!.options.maxPlayers = 1;
    const full = await connect();
    full.send({ type: T.ClientHello, version: PROTOCOL_VERSION, name: 'Bea' });
    expect((await full.wait(T.LoginReject)).reason).toContain('full');
  });
  it('streams a deflated M17 column identical to local generation', async () => {
    await boot();
    const client = await connect('Ada');
    const data = await client.wait(T.ChunkData);
    const received = await deserializeColumn(data.payload);
    const local = new ChunkColumn(data.cx, data.cz);
    createDefaultPipeline(STRUCTURE_REGISTRATIONS).generateColumn(seed, data.cx, data.cz, local);
    const expected = new World(false),
      actual = new World(false);
    expected.setColumn(local);
    actual.setColumn(received);
    expect(actual.worldHash(data.cx * 16, data.cz * 16, data.cx * 16 + 15, data.cz * 16 + 15)).toBe(
      expected.worldHash(data.cx * 16, data.cz * 16, data.cx * 16 + 15, data.cz * 16 + 15),
    );
  });
  it('worker generation matches worldHash samples in both dimensions', async () => {
    const pool = new GenerationPool(1, worker);
    try {
      for (const dimension of ['overworld', 'hollowdeep'] as const)
        for (const [cx, cz] of [
          [0, 0],
          [-1, 2],
        ] as const) {
          const generated = await pool.generate(seed, dimension, cx, cz),
            local = new ChunkColumn(cx, cz);
          const pipeline =
            dimension === 'overworld'
              ? createDefaultPipeline(STRUCTURE_REGISTRATIONS)
              : createHollowdeepPipeline();
          pipeline.generateColumn(seed, cx, cz, local);
          const expected = new World(false),
            actual = new World(false);
          expected.setColumn(local);
          actual.setColumn(deserializeColumnBinary(generated.bytes));
          expect(actual.worldHash(cx * 16, cz * 16, cx * 16 + 15, cz * 16 + 15)).toBe(
            expected.worldHash(cx * 16, cz * 16, cx * 16 + 15, cz * 16 + 15),
          );
        }
    } finally {
      await pool.close();
    }
  });
  it('broadcasts an accepted block edit to a second client', async () => {
    await boot();
    const a = await connect('Ada'),
      b = await connect('Bea');
    const target = await setupBlock(a, b);
    block(a, B.StartBreak, target, 1);
    block(a, B.FinishBreak, target, 2);
    expect((await a.wait(T.BlockUpdate, (m) => m.x === target.x && m.y === target.y)).stateId).toBe(
      0,
    );
    expect((await b.wait(T.BlockUpdate, (m) => m.x === target.x && m.y === target.y)).stateId).toBe(
      0,
    );
  });
  it('rejects a break 20 blocks away and retains the real block for both clients', async () => {
    await boot();
    const a = await connect('Ada'),
      b = await connect('Bea');
    const target = await setupBlock(a, b);
    const actor = server!.dimensions.get('overworld')!.actors[0]!;
    actor.player.teleport(target.x - 20, target.y - 1, target.z + 0.5, 0, 0);
    const state = actor.dimension.world.getBlockStateId(target.x, target.y, target.z);
    block(a, B.StartBreak, target, 1);
    block(a, B.FinishBreak, target, 2);
    expect((await a.wait(T.BlockUpdate)).stateId).toBe(state);
    await pause(100);
    expect(actor.dimension.world.getBlockStateId(target.x, target.y, target.z)).toBe(state);
    expect(
      b.messages.filter(
        (m) => m.type === T.BlockUpdate && m.x === target.x && m.y === target.y && m.stateId === 0,
      ),
    ).toHaveLength(0);
  });
  it('rejects finishing a survival break too fast', async () => {
    await boot();
    const a = await connect('Ada');
    const target = await setupBlock(a);
    const actor = server!.dimensions.get('overworld')!.actors[0]!;
    actor.player.setGameMode('survival');
    block(a, B.StartBreak, target, 1);
    block(a, B.FinishBreak, target, 2);
    expect((await a.wait(T.BlockUpdate)).stateId).not.toBe(0);
    expect(actor.dimension.world.getBlockStateId(target.x, target.y, target.z)).not.toBe(0);
  });
  it('corrects speed/teleport-sized inputs and processes sequence numbers without extra simulation', async () => {
    await boot();
    const a = await connect('Ada');
    const target = await setupBlock(a);
    const player = server!.dimensions.get('overworld')!.actors[0]!.player;
    const x = player.pos[0];
    a.send({ type: T.PlayerInput, sequence: 1, movement: [10000, 0], look: [0, 0], actions: 4 });
    const correction = await a.wait(T.PlayerCorrection, (m) => m.acknowledged === 1);
    expect(correction.position[0] - x).toBeLessThanOrEqual(0.6);
    expect(correction.position[0]).toBeLessThan(target.x);
    expect(Math.hypot(correction.velocity[0], correction.velocity[2])).toBeLessThanOrEqual(10.9);
    a.send({ type: T.PlayerInput, sequence: 0, movement: [-1, 0], look: [0, 0], actions: 0 });
    expect((await a.wait(T.PlayerCorrection, (m) => m.acknowledged === 1)).acknowledged).toBe(1);
  });
  it('rejects invalid inventory revisions and ownership and sends full authoritative snapshots', async () => {
    await boot();
    const a = await connect('Ada');
    const initial = await a.wait(T.InventorySync);
    a.send({
      type: T.InventoryTransaction,
      requestId: 1,
      windowId: 0,
      revision: initial.revision + 1,
      action: A.LeftClick,
      slot: 0,
      slots: [],
    });
    expect((await a.wait(T.InventoryResult)).accepted).toBe(false);
    expect((await a.wait(T.InventorySync)).slots).toEqual(initial.slots);
    a.send({
      type: T.InventoryTransaction,
      requestId: 2,
      windowId: 0,
      revision: initial.revision,
      action: A.LeftClick,
      slot: 100,
      slots: [],
    });
    expect((await a.wait(T.InventoryResult)).accepted).toBe(false);
    expect((await a.wait(T.InventorySync)).slots).toEqual(initial.slots);
  });
  it('broadcasts chat and supplies join/periodic time and weather changes', async () => {
    await boot();
    const a = await connect('Ada'),
      b = await connect('Bea');
    expect((await a.wait(T.TimeSync)).time).toBeGreaterThanOrEqual(6000);
    expect((await b.wait(T.WeatherSync)).weather).toBe('clear');
    a.send({ type: T.ChatSend, text: 'Hello\n\r\u0000\u007f\u0085 🌱' });
    expect((await b.wait(T.ChatBroadcast)).text).toBe('Hello 🌱');
    weatherManager.setWeather('rain');
    expect((await b.wait(T.WeatherSync, (m) => m.weather === 'rain')).weather).toBe('rain');
    expect((await a.wait(T.TimeSync, (m) => m.time >= 6100)).time).toBeGreaterThanOrEqual(6100);
  });
  it('times out a silent client after 15 seconds', async () => {
    await boot();
    const a = await connect('Ada');
    a.autoPong = false;
    expect((await a.wait(T.Disconnect, () => true, 18000)).reason).toContain('timeout');
  });
  it('adds approximately N milliseconds of round-trip delay in order', async () => {
    await boot(150);
    const a = await connect('Ada');
    const start = performance.now();
    a.send({ type: T.Ping, id: 123 });
    a.send({ type: T.Ping, id: 124 });
    expect((await a.wait(T.Pong)).id).toBe(123);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(elapsed).toBeLessThan(300);
    expect((await a.wait(T.Pong)).id).toBe(124);
  });
  it('persists edits on restart and writes no unmodified column to a region', async () => {
    await boot();
    const a = await connect('Ada');
    const target = await setupBlock(a);
    block(a, B.StartBreak, target, 1);
    block(a, B.FinishBreak, target, 2);
    await a.wait(T.BlockUpdate, (m) => m.x === target.x && m.y === target.y && m.stateId === 0);
    await server!.save();
    const files = (await readdir(join(root, 'overworld'))).filter((file) => /^r\./.test(file));
    expect(files).toEqual(['r.0.0.bin']);
    const { readFile } = await import('node:fs/promises');
    expect([...decodeRegion(await readFile(join(root, 'overworld', files[0]!))).keys()]).toEqual([
      0,
    ]);
    a.close();
    await server!.stop();
    server = null;
    await boot();
    const b = await connect('Ada');
    const data = await b.wait(T.ChunkData, (m) => m.cx === 0 && m.cz === 0);
    expect(
      (await deserializeColumn(data.payload)).getBlockStateId(target.x, target.y, target.z),
    ).toBe(0);
  });
  it('sends entity spawn, quantized movement deltas and remove per recipient', async () => {
    await boot();
    const a = await connect('Ada');
    await a.wait(T.ChunkData);
    const dimension = server!.dimensions.get('overworld')!,
      player = dimension.actors[0]!.player;
    const id = dimension.mobs.spawn('tuftbuck', player.pos[0] + 2, player.pos[1], player.pos[2]);
    expect((await a.wait(T.EntitySpawn, (m) => m.id === id)).kind).toBe('tuftbuck');
    dimension.ecs.get(id, TransformC)!.pos[0] += 0.5;
    const move = await a.wait(T.EntityMove, (m) => m.id === id && !!m.changes.x);
    expect(move.changes.x).toHaveProperty('delta');
    dimension.ecs.destroy(id);
    expect((await a.wait(T.EntityRemove, (m) => m.id === id)).id).toBe(id);
  });
  it('uses shared placement orientation and preserves inventory on rejected placement', async () => {
    await boot();
    const a = await connect('Ada');
    const target = await setupBlock(a);
    const actor = server!.dimensions.get('overworld')!.actors[0]!;
    actor.player.inventory.insert('oak_log', 2);
    block(a, B.Place, target, 1);
    const placed = await a.wait(T.BlockUpdate, (m) => m.x === target.x - 1 && m.y === target.y);
    expect(actor.dimension.world.getBlock(placed.x, placed.y, placed.z)).toEqual({
      id: 'oak_log',
      state: { axis: 'x' },
    });
    actor.player.setGameMode('survival');
    block(a, B.Place, target, 2);
    await a.wait(T.BlockUpdate, (m) => m.x === target.x - 1 && m.y === target.y);
    expect(actor.player.inventory.held?.count).toBe(2);
  });
  it('persists inventory, vitals, chest state, an active kiln and creatures', async () => {
    await boot();
    const a = await connect('Ada');
    await a.wait(T.ChunkData, (m) => m.cx === 0 && m.cz === 0);
    const dimension = server!.dimensions.get('overworld')!,
      world = dimension.world,
      player = dimension.actors[0]!.player;
    player.inventory.insert('iron_pickaxe', 1, { damage: 7 });
    player.health = 13;
    player.hunger = 12;
    world.setBlock(8, 250, 8, 'chest');
    world.getBlockEntity<ChestEntityState>(8, 250, 8)!.slots[0] = { id: 'iron_ingot', count: 3 };
    world.setBlock(10, 250, 8, 'kiln');
    const kiln = world.getBlockEntity<KilnState>(10, 250, 8)!;
    kiln.input = { id: 'iron_ore', count: 2, damage: null };
    kiln.fuel = { id: 'coal', count: 1, damage: null };
    kiln.cookProgress = 50;
    const id = dimension.mobs.spawn('tuftbuck', 8.5, 251, 8.5);
    dimension.ecs.get(id, HealthC)!.current = 7;
    await pause(100);
    await server!.stop();
    server = null;
    a.close();
    await boot();
    const b = await connect('Ada');
    await b.wait(T.ChunkData, (m) => m.cx === 0 && m.cz === 0);
    const restored = server!.dimensions.get('overworld')!;
    expect(restored.actors[0]!.player.inventory.held).toMatchObject({
      id: 'iron_pickaxe',
      count: 1,
      damage: 7,
    });
    expect(restored.actors[0]!.player.health).toBe(13);
    expect(restored.actors[0]!.player.hunger).toBe(12);
    expect(restored.world.getBlockEntity<ChestEntityState>(8, 250, 8)!.slots[0]).toEqual({
      id: 'iron_ingot',
      count: 3,
    });
    expect(
      restored.world.getBlockEntity<KilnState>(10, 250, 8)!.cookProgress,
    ).toBeGreaterThanOrEqual(50);
    const restoredId = restored.ecs
      .query(EntityKindC)
      .find(
        (entity) =>
          restored.ecs.get(entity, EntityKindC)!.type === 'tuftbuck' &&
          restored.ecs.get(entity, HealthC)!.current === 7,
      );
    expect(restoredId).toBeDefined();
  });
  it('ticks items once and allows a second player to pick up items and attract mobs', async () => {
    await boot();
    const a = await connect('Ada'),
      b = await connect('Bea');
    await a.wait(T.ChunkData);
    await b.wait(T.ChunkData);
    const dimension = server!.dimensions.get('overworld')!,
      first = dimension.actors[0]!,
      second = dimension.actors[1]!;
    first.player.teleport(2.5, 250, 2.5);
    first.player.setGameMode('creative');
    first.player.flying = true;
    second.player.teleport(10.5, 250, 10.5);
    second.player.setGameMode('creative');
    second.player.flying = true;
    const item = dimension.items.spawn('dirt', 1, 10.5, 250.5, 10.5, {
      velocity: [0, 0, 0],
      pickupDelay: 0,
    })!;
    await b.wait(T.InventorySync, (m) => m.slots.some((stack) => stack?.id === 'dirt'));
    expect(item.age).toBeLessThan(20);
    expect(first.player.inventory.held).toBeNull();
    const mob = dimension.mobs.spawn('hollow', 11.5, 250, 10.5);
    dimension.mobs.focus(mob);
    expect(dimension.mobs.player()).toBe(second.mob);
  });
  it('travels through shared portals into a lazy second dimension and back', async () => {
    await boot();
    const a = await connect('Ada');
    await a.wait(T.ChunkData);
    const dimension = server!.dimensions.get('overworld')!,
      actor = dimension.actors[0]!;
    expect(server!.dimensions.size).toBe(1);
    buildPortal(dimension.world, dimension.portals, { x: 4, y: 100, z: 4, axis: 'x' });
    actor.player.setGameMode('creative');
    actor.player.flying = true;
    actor.player.teleport(4.5, 100, 4.5);
    await a.wait(T.ServerHello, (m) => m.dimension === 'hollowdeep', 12000);
    const destination = server!.dimensions.get('hollowdeep')!,
      arrived = destination.actors[0]!;
    expect(server!.dimensions.size).toBe(2);
    const portal = destination.portals.all()[0]!;
    arrived.player.teleport(portal.x + 0.5, portal.y, portal.z + 2.5);
    await pause(2200);
    arrived.player.teleport(...portalArrivalPoint(portal));
    const returned = await a.wait(T.ServerHello, (m) => m.dimension === 'overworld', 12000);
    expect(Math.hypot(returned.spawn[0] - 4.5, returned.spawn[2] - 4.5)).toBeLessThan(8);
  });
  it('sends clean shutdown reasons to every connected client', async () => {
    await boot();
    const a = await connect('Ada'),
      b = await connect('Bea');
    const first = a.wait(T.Disconnect),
      second = b.wait(T.Disconnect);
    await server!.stop();
    server = null;
    expect((await first).reason).toContain('shutting down');
    expect((await second).reason).toContain('shutting down');
  });
  it('orders block actions after the input look they follow on the wire', async () => {
    await boot();
    const a = await connect('Ada');
    await setupBlock(a);
    const actor = server!.dimensions.get('overworld')!.actors[0]!;
    actor.dimension.world.setBlock(2, 251, 6, 'stone');
    await a.wait(T.BlockUpdate, (m) => m.x === 2 && m.y === 251 && m.z === 6);
    a.send({
      type: T.PlayerInput,
      sequence: 1,
      movement: [0, 0],
      look: [Math.PI / 2, 0],
      actions: 0,
    });
    const target = { x: 2, y: 251, z: 6, face: 'north' as const, heldSlot: 0 };
    a.send({ type: T.BlockAction, action: B.StartBreak, ...target, sequence: 1 });
    a.send({ type: T.BlockAction, action: B.FinishBreak, ...target, sequence: 2 });
    expect(
      (await a.wait(T.BlockUpdate, (m) => m.x === 2 && m.y === 251 && m.z === 6)).stateId,
    ).toBe(0);
  });
  it('accepts legal inventory operations without creating or losing counts', async () => {
    await boot();
    const a = await connect('Ada');
    await a.wait(T.InventorySync);
    server!.dimensions.get('overworld')!.actors[0]!.player.inventory.insert('dirt', 64);
    const initial = await a.wait(T.InventorySync, (m) => m.slots[0]?.count === 64);
    a.send({
      type: T.InventoryTransaction,
      requestId: 1,
      windowId: 0,
      revision: initial.revision,
      action: A.LeftClick,
      slot: 0,
      slots: [],
    });
    const result = await a.wait(T.InventoryResult);
    expect(result.accepted).toBe(true);
    const picked = await a.wait(T.InventorySync, (m) => m.revision === result.revision);
    expect(picked.slots[0]).toBeNull();
    expect(picked.cursor?.count).toBe(64);
    a.send({
      type: T.InventoryTransaction,
      requestId: 2,
      windowId: 0,
      revision: result.revision,
      action: A.RightClick,
      slot: 20,
      slots: [],
    });
    const placed = await a.wait(T.InventoryResult);
    expect(placed.accepted).toBe(true);
    const final = await a.wait(T.InventorySync, (m) => m.revision === placed.revision);
    expect(final.slots[20]?.count).toBe(1);
    expect(final.cursor?.count).toBe(63);
  });
  it('worker relighting propagates and removes block light across a loaded column border', async () => {
    await boot();
    const a = await connect('Ada');
    await a.wait(T.ChunkData);
    const dimension = server!.dimensions.get('overworld')!;
    await dimension.ensureColumn(1, 0);
    dimension.world.setBlock(15, 250, 4, 'torch');
    await expect.poll(() => dimension.world.getLight(16, 250, 4).block, { timeout: 8000 }).toBe(13);
    dimension.world.setBlock(15, 250, 4, 'air');
    await expect.poll(() => dimension.world.getLight(16, 250, 4).block, { timeout: 8000 }).toBe(0);
  });
  it('keeps restored Blast Charges frozen until their terrain is loaded, then resumes the shared fuse and physics', async () => {
    await boot();
    const a = await connect('Ada');
    await a.wait(T.ChunkData);
    const dimension = server!.dimensions.get('overworld')!;
    const id = dimension.charges.restore(100.5, 250, 100.5, 80);
    await pause(100);
    expect(dimension.ecs.get(id, PrimedChargeC)!.fuse).toBe(80);
    expect(dimension.ecs.get(id, TransformC)!.pos[1]).toBe(250);
    await dimension.ensureColumn(6, 6);
    await pause(100);
    expect(dimension.ecs.get(id, PrimedChargeC)!.fuse).toBeLessThan(80);
    expect(dimension.ecs.get(id, TransformC)!.pos[1]).not.toBe(250);
    expect(dimension.ecs.get(id, PrimedChargeC)!.vel[1]).toBeLessThan(0.12);
  });
  it('rejects extreme placement coordinates without encoding an overflowing adjacent coordinate', async () => {
    await boot();
    const a = await connect('Ada');
    a.send({
      type: T.BlockAction,
      action: B.Place,
      x: 2147483647,
      y: 250,
      z: 0,
      face: 'east',
      heldSlot: 0,
      sequence: 1,
    });
    expect((await a.wait(T.BlockUpdate)).x).toBe(2147483647);
    a.send({ type: T.Ping, id: 456 });
    expect((await a.wait(T.Pong)).id).toBe(456);
  });
  it('waits for a disconnect save before loading a reconnecting inventory', async () => {
    await boot();
    const a = await connect('Ada');
    await a.wait(T.InventorySync);
    const player = server!.dimensions.get('overworld')!.actors[0]!.player;
    player.inventory.insert('dirt', 5);
    await server!.save();
    player.inventory.held!.count = 2;
    const write = storage.atomicWrite;
    const slowWrite = vi.spyOn(storage, 'atomicWrite').mockImplementation(async (path, bytes) => {
      if (path.includes('/players/')) await pause(200);
      return write(path, bytes);
    });
    try {
      a.close();
      await expect.poll(() => server!.dimensions.get('overworld')!.actors.length).toBe(0);
      const b = await connect('Ada');
      expect((await b.wait(T.InventorySync)).slots[0]?.count).toBe(2);
    } finally {
      slowWrite.mockRestore();
    }
  });
  it('round-trips every BlockAction variant without changing the M21a fuzz test', () => {
    for (const action of [B.StartBreak, B.FinishBreak, B.AbortBreak, B.Place]) {
      const message = {
        type: T.BlockAction as const,
        action,
        x: -2,
        y: 319,
        z: 123,
        face: 'north' as const,
        heldSlot: 8,
        sequence: 0xffffffff,
      };
      expect(decodeMessage(encodeMessage(message, new BinaryWriter()))).toEqual({
        ok: true,
        message,
      });
    }
  });
});
