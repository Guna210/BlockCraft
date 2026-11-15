// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer, type AuthoritativeServer } from '../../server/server';
import { HeadlessClient } from '../helpers/m21b-client';
import { buildPortal } from '../../src/world/portals';
import { hashString } from '../../src/engine/rng';
import { crafting } from '../../src/gameplay/crafting';
import type { ChestEntityState } from '../../src/gameplay/chests';
import type { KilnState } from '../../src/gameplay/kiln';
import {
  BlockActionKind as B,
  InventoryAction as A,
  MessageType as T,
  type Messages,
} from '../../src/net/protocol';

const seed = hashString('blockcraft-m21b-fix-containers');
const worker = new URL('../../dist-server/generation-worker.js', import.meta.url);
const build = promisify(execFile);
let server: AuthoritativeServer | null = null;
let root = '';
let requestId = 0;
const clients: HeadlessClient[] = [];

beforeAll(async () => {
  await build('npm', ['run', 'build:server'], { cwd: process.cwd() });
}, 30000);

afterEach(async () => {
  for (const client of clients) client.close();
  clients.length = 0;
  await server?.stop();
  server = null;
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
  requestId = 0;
});

async function boot(): Promise<AuthoritativeServer> {
  root ||= await mkdtemp(join(tmpdir(), 'm21b-fix-containers-'));
  server = await startServer({ world: root, seed, port: 0, viewDistance: 1 }, worker);
  return server;
}

async function connect(name: string): Promise<HeadlessClient> {
  const client = await new HeadlessClient(server!.port).open();
  clients.push(client);
  await client.login(name);
  await client.wait(T.ChunkData, (message) => message.cx === 0 && message.cz === 0);
  return client;
}

function setupWorld(kind: 'chest' | 'kiln' | 'workbench', actors = 1) {
  const dimension = server!.dimensions.get('overworld')!;
  const world = dimension.world;
  world.fill(0, 249, 0, 12, 249, 12, 'stone');
  for (let i = 0; i < actors; i++) {
    const player = dimension.actors[i]!.player;
    player.setGameMode('survival');
    player.teleport(2.5 + i, 250, 4.5, 0, 0);
    player.onGround = true;
    player.vel[0] = player.vel[1] = player.vel[2] = 0;
  }
  world.setBlock(4, 251, 4, kind, kind === 'chest' ? { facing: 'north', pair: 'single' } : {});
  return { dimension, world, x: 4, y: 251, z: 4 };
}

async function openWindow(
  client: HeadlessClient,
  at: { x: number; y: number; z: number },
): Promise<{
  id: number;
  kind: string;
  revision: number;
  slots: readonly Messages[T.InventorySync]['slots'][number][];
}> {
  client.send({ type: T.ContainerOpenRequest, ...at });
  const opened = await client.wait(T.WindowOpen);
  const sync = await client.wait(
    T.InventorySync,
    (message) => message.windowId === opened.windowId,
  );
  return { id: opened.windowId, kind: opened.kind, revision: sync.revision, slots: sync.slots };
}

async function transact(
  client: HeadlessClient,
  windowId: number,
  revision: number,
  action: A,
  slot: number,
  slots: readonly number[] = [],
): Promise<Messages[T.InventoryResult]> {
  const id = ++requestId;
  client.send({
    type: T.InventoryTransaction,
    requestId: id,
    windowId,
    revision,
    action,
    slot,
    slots,
  });
  return client.wait(T.InventoryResult, (message) => message.requestId === id);
}

async function accepted(
  client: HeadlessClient,
  windowId: number,
  revision: number,
  action: A,
  slot: number,
  slots: readonly number[] = [],
): Promise<number> {
  const result = await transact(client, windowId, revision, action, slot, slots);
  expect(result.accepted, result.reason).toBe(true);
  return result.revision;
}

function recipeIndex(id: string): number {
  let index = 0;
  for (const recipe of crafting.recipes.values()) {
    if (recipe.id === id) return index;
    index++;
  }
  throw new Error(`Missing recipe ${id}`);
}

async function expectNoOpen(client: HeadlessClient): Promise<void> {
  await expect(client.wait(T.WindowOpen, () => true, 120)).rejects.toThrow(
    'Timed out waiting for WindowOpen',
  );
}

async function closeWindow(client: HeadlessClient, id: number): Promise<void> {
  client.send({ type: T.WindowClose, windowId: id });
  await client.wait(T.WindowClose, (message) => message.windowId === id);
}

describe('M21b-fix multiplayer containers', () => {
  it('validates open requests and revisions, and wraps window ids without using zero', async () => {
    await boot();
    const a = await connect('Ada');
    const { dimension, world } = setupWorld('chest');
    world.setBlock(6, 251, 4, 'stone');

    a.send({ type: T.ContainerOpenRequest, x: 6, y: 251, z: 4 });
    await expectNoOpen(a);
    dimension.actors[0]!.player.teleport(30.5, 250, 4.5, 0, 0);
    a.send({ type: T.ContainerOpenRequest, x: 4, y: 251, z: 4 });
    await expectNoOpen(a);
    dimension.actors[0]!.player.teleport(2.5, 250, 4.5, 0, 0);
    dimension.actors[0]!.player.dead = true;
    a.send({ type: T.ContainerOpenRequest, x: 4, y: 251, z: 4 });
    await expectNoOpen(a);
    dimension.actors[0]!.player.dead = false;

    const first = await openWindow(a, { x: 4, y: 251, z: 4 });
    expect(first.id).toBeGreaterThan(0);
    expect(first.id).toBeLessThanOrEqual(255);
    const stale = await transact(a, first.id, first.revision - 1, A.LeftClick, 0);
    expect(stale.accepted).toBe(false);
    expect(stale.reason).toContain('revision');
    await closeWindow(a, first.id);

    const seen = new Set<number>();
    for (let i = 0; i < 257; i++) {
      const opened = await openWindow(a, { x: 4, y: 251, z: 4 });
      expect(opened.id).toBeGreaterThan(0);
      seen.add(opened.id);
      await closeWindow(a, opened.id);
      await a.wait(T.InventorySync, (message) => message.windowId === 0);
    }
    expect(seen.has(1)).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  }, 30000);

  it('shares chest clicks and drags with other viewers, opens large chests, and closes all viewers before spills', async () => {
    await boot();
    const a = await connect('Ada');
    const b = await connect('Bea');
    const { dimension, world, x, y, z } = setupWorld('chest', 2);
    const firstPlayer = dimension.actors[0]!.player;
    firstPlayer.inventory.insert('dirt', 12);
    firstPlayer.inventory.insert('oak_planks', 8);
    const windowA = await openWindow(a, { x, y, z });
    const windowB = await openWindow(b, { x, y, z });
    let revisionA = await accepted(a, windowA.id, windowA.revision, A.QuickMove, 27);
    expect(
      (
        await b.wait(
          T.InventorySlot,
          (message) => message.windowId === windowB.id && message.slot === 0,
        )
      ).stack,
    ).toMatchObject({ id: 'dirt', count: 12 });
    revisionA = await accepted(a, windowA.id, revisionA, A.LeftClick, 28);
    revisionA = await accepted(a, windowA.id, revisionA, A.DragEven, 0, [1, 2]);
    expect(
      (
        await b.wait(
          T.InventorySlot,
          (message) => message.windowId === windowB.id && message.slot === 2,
        )
      ).stack,
    ).toMatchObject({ id: 'oak_planks', count: 4 });
    expect(revisionA).toBeGreaterThan(windowA.revision);

    world.setBlock(5, y, z, 'chest', { facing: 'north', pair: 'single' });
    await a.wait(T.WindowClose, (message) => message.windowId === windowA.id);
    await b.wait(T.WindowClose, (message) => message.windowId === windowB.id);
    const large = await openWindow(a, { x, y, z });
    expect(large.kind).toBe('large_chest');
    expect(large.slots).toHaveLength(95);
    const other = await openWindow(b, { x, y, z });
    world.getBlockEntity<ChestEntityState>(x, y, z)!.slots[0] = { id: 'iron_ingot', count: 3 };

    const actor = dimension.actors[0]!;
    actor.player.setGameMode('creative');
    actor.player.teleport(2.5, 250, 4.5, 0, 0);
    const closeA = a.wait(T.WindowClose, (message) => message.windowId === large.id);
    const closeB = b.wait(T.WindowClose, (message) => message.windowId === other.id);
    const broken = a.wait(
      T.BlockUpdate,
      (message) => message.x === x && message.y === y && message.stateId === 0,
    );
    a.send({
      type: T.BlockAction,
      action: B.StartBreak,
      x,
      y,
      z,
      face: 'west',
      heldSlot: 0,
      sequence: 1,
    });
    a.send({
      type: T.BlockAction,
      action: B.FinishBreak,
      x,
      y,
      z,
      face: 'west',
      heldSlot: 0,
      sequence: 2,
    });
    await Promise.all([closeA, closeB, broken]);
    expect(dimension.items.pool.some((item) => item.active && item.item.id === 'iron_ingot')).toBe(
      true,
    );
  }, 30000);

  it('applies kiln input and fuel actions, smelts, and broadcasts changed properties and output slots', async () => {
    await boot();
    const a = await connect('Ada');
    const b = await connect('Bea');
    const { dimension, world, x, y, z } = setupWorld('kiln', 2);
    const player = dimension.actors[0]!.player;
    player.inventory.insert('raw_iron', 1);
    player.inventory.insert('coal', 1);
    const kiln = world.getBlockEntity<KilnState>(x, y, z)!;
    const windowA = await openWindow(a, { x, y, z });
    const windowB = await openWindow(b, { x, y, z });
    let revision = await accepted(a, windowA.id, windowA.revision, A.LeftClick, 3);
    revision = await accepted(a, windowA.id, revision, A.LeftClick, 0);
    revision = await accepted(a, windowA.id, revision, A.LeftClick, 4);
    await accepted(a, windowA.id, revision, A.LeftClick, 1);
    kiln.cookProgress = 199;
    const output = b.wait(
      T.InventorySlot,
      (message) =>
        message.windowId === windowB.id && message.slot === 2 && message.stack?.id === 'iron_ingot',
      8000,
    );
    const burning = b.wait(
      T.WindowProperty,
      (message) =>
        message.windowId === windowB.id &&
        message.property === 'burnRemaining' &&
        message.value > 0,
      8000,
    );
    await Promise.all([output, burning]);
    expect(kiln.output).toMatchObject({ id: 'iron_ingot', count: 1 });
  }, 15000);

  it('fills and takes 2x2 and 3x3 recipes, returns grids on close and leaving reach', async () => {
    await boot();
    const a = await connect('Ada');
    const { dimension, world, x, y, z } = setupWorld('workbench');
    const player = dimension.actors[0]!.player;
    player.inventory.insert('oak_planks', 24);
    const initial = await a.wait(
      T.InventorySync,
      (message) => message.windowId === 0 && message.slots[0]?.id === 'oak_planks',
    );
    const revision = await accepted(a, 0, initial.revision, A.FillRecipe, recipeIndex('workbench'));
    await accepted(a, 0, revision, A.QuickMove, 45);
    await a.wait(
      T.InventorySync,
      (message) =>
        message.windowId === 0 && message.slots.some((stack) => stack?.id === 'workbench'),
    );
    await closeWindow(a, 0);
    const afterInventoryCraft = await a.wait(
      T.InventorySync,
      (message) =>
        message.windowId === 0 && message.slots.some((stack) => stack?.id === 'workbench'),
    );
    expect(afterInventoryCraft.slots.some((stack) => stack?.id === 'workbench')).toBe(true);

    player.inventory.insert('oak_planks', 16);
    const table = await openWindow(a, { x, y, z });
    expect(table.kind).toBe('crafting');
    const tableRevision = await accepted(
      a,
      table.id,
      table.revision,
      A.FillRecipe,
      recipeIndex('chest'),
    );
    const filledSlots = [];
    for (const slot of [0, 1, 2, 3, 5, 6, 7, 8])
      filledSlots.push(
        await a.wait(
          T.InventorySlot,
          (message) =>
            message.windowId === table.id &&
            message.slot === slot &&
            message.stack?.id === 'oak_planks',
        ),
      );
    expect(filledSlots).toHaveLength(8);
    await accepted(a, table.id, tableRevision, A.LeftClick, 9);
    expect(player.inventory.cursor).toMatchObject({ id: 'chest', count: 1 });
    await closeWindow(a, table.id);
    await a.wait(T.InventorySync, (message) => message.windowId === 0 && message.cursor === null);
    expect(player.inventory.slots.some((stack) => stack?.id === 'chest')).toBe(true);
    expect(
      player.inventory.slots.reduce(
        (sum, stack) => sum + (stack?.id === 'oak_planks' ? stack.count : 0),
        0,
      ),
    ).toBe(8);

    player.inventory.insert('oak_planks', 8);
    const away = await openWindow(a, { x, y, z });
    await accepted(a, away.id, away.revision, A.FillRecipe, recipeIndex('chest'));
    const closed = a.wait(T.WindowClose, (message) => message.windowId === away.id);
    player.teleport(40.5, 250, 4.5, 0, 0);
    await closed;
    expect(player.inventory.slots.some((stack) => stack?.id === 'oak_planks')).toBe(true);
    expect(world.getBlock(x, y, z).id).toBe('workbench');
  }, 20000);

  it('closes on death, dimension travel and disconnect, and persists container entity changes across restart', async () => {
    await boot();
    const a = await connect('Ada');
    const { dimension, x, y, z } = setupWorld('workbench');
    const player = dimension.actors[0]!.player;
    player.inventory.insert('oak_planks', 8);
    const table = await openWindow(a, { x, y, z });
    await accepted(a, table.id, table.revision, A.FillRecipe, recipeIndex('chest'));
    const died = a.wait(T.WindowClose, (message) => message.windowId === table.id);
    player.dead = true;
    await died;

    player.dead = false;
    player.setGameMode('creative');
    player.flying = true;
    player.teleport(2.5, 250, 4.5, 0, 0);
    player.inventory.insert('oak_planks', 8);
    const open = await openWindow(a, { x, y, z });
    const revision = await accepted(a, open.id, open.revision, A.FillRecipe, recipeIndex('chest'));
    await accepted(a, open.id, revision, A.LeftClick, 0);
    const close = a.wait(T.WindowClose, (message) => message.windowId === open.id);
    const dimensionChange = a.wait(
      T.ServerHello,
      (message) => message.dimension === 'hollowdeep',
      15000,
    );
    buildPortal(dimension.world, dimension.portals, { x: 8, y: 100, z: 8, axis: 'x' });
    player.teleport(8.5, 100, 8.5, 0, 0);
    await Promise.all([close, dimensionChange]);
    const arrived = server!.dimensions.get('hollowdeep')!.actors[0]!.player;
    expect(
      arrived.inventory.slots.reduce(
        (sum, stack) => sum + (stack?.id === 'oak_planks' ? stack.count : 0),
        0,
      ),
    ).toBe(8);
  }, 20000);

  it('returns crafting-grid contents on disconnect', async () => {
    await boot();
    const a = await connect('Ada');
    const { dimension, x, y, z } = setupWorld('workbench');
    const player = dimension.actors[0]!.player;
    player.inventory.insert('oak_planks', 16);
    const table = await openWindow(a, { x, y, z });
    await accepted(a, table.id, table.revision, A.FillRecipe, recipeIndex('chest'));
    a.close();
    await expect.poll(() => dimension.actors.length).toBe(0);
    await server!.stop();
    server = null;
    await boot();
    await connect('Ada');
    const restored = server!.dimensions.get('overworld')!;
    expect(
      restored.actors[0]!.player.inventory.slots.reduce(
        (sum, stack) => sum + (stack?.id === 'oak_planks' ? stack.count : 0),
        0,
      ),
    ).toBe(16);
  }, 30000);

  it('saves window changes in chest block entities across a server restart', async () => {
    await boot();
    const a = await connect('Ada');
    const { dimension, world, x, y, z } = setupWorld('chest');
    dimension.actors[0]!.player.inventory.insert('dirt', 5);
    const chest = await openWindow(a, { x, y, z });
    await accepted(a, chest.id, chest.revision, A.QuickMove, 27);
    world.setBlock(8, 251, 8, 'kiln');
    world.getBlockEntity<KilnState>(8, 251, 8)!.input = { id: 'raw_iron', count: 2, damage: null };
    world.getBlockEntity<KilnState>(8, 251, 8)!.fuel = { id: 'coal', count: 1, damage: null };
    world.getBlockEntity<KilnState>(8, 251, 8)!.output = {
      id: 'iron_ingot',
      count: 64,
      damage: null,
    };
    await server!.save();
    await server!.stop();
    server = null;
    await boot();
    await connect('Ada');
    const restored = server!.dimensions.get('overworld')!;
    expect(restored.world.getBlockEntity<ChestEntityState>(x, y, z)!.slots[0]).toEqual({
      slot: 0,
      id: 'dirt',
      count: 5,
    });
    expect(restored.world.getBlockEntity<KilnState>(8, 251, 8)!.input).toMatchObject({
      id: 'raw_iron',
      count: 2,
    });
    expect(restored.world.getBlockEntity<KilnState>(8, 251, 8)!.fuel).toMatchObject({
      id: 'coal',
      count: 1,
    });
    expect(restored.world.getBlockEntity<KilnState>(8, 251, 8)!.output).toMatchObject({
      id: 'iron_ingot',
      count: 64,
    });
  }, 30000);
});
