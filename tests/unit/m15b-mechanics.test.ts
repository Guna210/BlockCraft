import { beforeEach, describe, expect, it } from 'vitest';
import { registerChestBlockEntity } from '../../src/gameplay/chests';
import { registerKilnBlockEntity } from '../../src/gameplay/kiln';
import { registerCurrentBlockEntities } from '../../src/gameplay/current';
import {
  PISTON_MOVE_TICKS,
  PISTON_PUSH_LIMIT,
  type DispenserState,
  type ToneEvent,
} from '../../src/gameplay/mechanics';
import { toggleOpenable } from '../../src/gameplay/shape-blocks';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { breakSeconds } from '../../src/gameplay/mining';
import { collisionBoxes } from '../../src/world/shape-geometry';
import { World } from '../../src/world/world';

const Y = 65;

function makeWorld(): World {
  return new World(false);
}

function lever(world: World, x: number, y: number, z: number, powered: boolean): void {
  world.setBlock(x, y, z, 'lever', { face: 'floor', powered: String(powered) });
}

function setLever(world: World, x: number, y: number, z: number, powered: boolean): void {
  const block = world.getBlock(x, y, z);
  const id = BlockRegistry.getInstance().getStateId('lever', {
    ...block.state,
    powered: String(powered),
  });
  world.setBlockStateId(x, y, z, id!);
}

function tick(world: World, count: number): void {
  for (let i = 0; i < count; i++) world.tick();
}

/** A piston at x = 0 facing east with `count` stone blocks in front, power lever on top. */
function pistonLine(world: World, id: string, count: number): void {
  world.setBlock(0, Y, 0, id, { facing: 'east', extended: 'false' });
  for (let i = 1; i <= count; i++) world.setBlock(i, Y, 0, 'stone');
}

function blockId(world: World, x: number, y = Y, z = 0): string {
  return world.getBlock(x, y, z).id;
}

describe('M15b — Pistons and mechanical outputs', () => {
  beforeEach(() => {
    BlockRegistry.getInstance();
    registerChestBlockEntity();
    registerKilnBlockEntity();
    registerCurrentBlockEntities();
  });

  it('a piston pushes a line of 12 blocks', () => {
    const world = makeWorld();
    pistonLine(world, 'piston', PISTON_PUSH_LIMIT);
    lever(world, 0, Y + 1, 0, true);

    expect(world.getBlock(0, Y, 0).state.extended).toBe('true');
    tick(world, PISTON_MOVE_TICKS);

    expect(blockId(world, 1)).toBe('piston_head');
    for (let x = 2; x <= 13; x++) expect(blockId(world, x)).toBe('stone');
    expect(blockId(world, 14)).toBe('air');
    expect(world.current.mechanics.movingBlocks()).toEqual([]);
  });

  it('a line of 13 blocks does not extend', () => {
    const world = makeWorld();
    pistonLine(world, 'piston', PISTON_PUSH_LIMIT + 1);
    lever(world, 0, Y + 1, 0, true);
    tick(world, 5);

    expect(world.getBlock(0, Y, 0).state.extended).toBe('false');
    for (let x = 1; x <= 13; x++) expect(blockId(world, x)).toBe('stone');
    expect(blockId(world, 14)).toBe('air');
  });

  it('slides blocks as moving block entities and lands them after a fixed number of ticks', () => {
    const world = makeWorld();
    pistonLine(world, 'piston', 2);
    lever(world, 0, Y + 1, 0, true);

    const moving = world.current.mechanics.movingBlocks();
    expect(moving.map((m) => m.x)).toEqual([1, 2, 3]);
    expect(moving.every((m) => m.duration === PISTON_MOVE_TICKS)).toBe(true);
    expect(blockId(world, 2)).toBe('piston_moving');
    tick(world, PISTON_MOVE_TICKS - 1);
    expect(blockId(world, 3)).toBe('piston_moving');
    tick(world, 1);
    expect(blockId(world, 3)).toBe('stone');
    expect(blockId(world, 1)).toBe('piston_head');
  });

  it('a normal piston leaves the block behind; a sticky piston retracts the attached block', () => {
    for (const id of ['piston', 'sticky_piston']) {
      const world = makeWorld();
      pistonLine(world, id, 1);
      lever(world, 0, Y + 1, 0, true);
      tick(world, PISTON_MOVE_TICKS);
      expect(blockId(world, 1)).toBe(id === 'piston' ? 'piston_head' : 'sticky_piston_head');
      expect(blockId(world, 2)).toBe('stone');

      setLever(world, 0, Y + 1, 0, false);
      expect(world.getBlock(0, Y, 0).state.extended).toBe('false');
      tick(world, PISTON_MOVE_TICKS);
      expect(blockId(world, 1)).toBe(id === 'piston' ? 'air' : 'stone');
      expect(blockId(world, 2)).toBe(id === 'piston' ? 'stone' : 'air');
    }
  });

  it('releases the piston when a moving cell is removed mid-move, and it keeps working', () => {
    const world = makeWorld();
    world.setBlock(0, Y, 0, 'sticky_piston', { facing: 'east', extended: 'false' });
    world.setBlock(1, Y, 0, 'stone');
    lever(world, 0, Y + 1, 0, true);
    expect(blockId(world, 1)).toBe('piston_moving');
    expect(world.current.mechanics.isBusy(0, Y, 0)).toBe(true);

    world.setBlock(1, Y, 0, 'air');
    world.setBlock(2, Y, 0, 'air');
    tick(world, 5);

    expect(world.current.mechanics.isBusy(0, Y, 0)).toBe(false);
    expect(world.current.mechanics.movingBlocks()).toEqual([]);
    // the carried block is lost, never duplicated
    expect(blockId(world, 2)).not.toBe('stone');

    setLever(world, 0, Y + 1, 0, false);
    tick(world, 5);
    expect(world.getBlock(0, Y, 0).state.extended).toBe('false');
    expect(blockId(world, 1)).toBe('air');

    world.setBlock(1, Y, 0, 'stone');
    setLever(world, 0, Y + 1, 0, true);
    tick(world, 5);
    expect(world.getBlock(0, Y, 0).state.extended).toBe('true');
    expect(blockId(world, 1)).toBe('sticky_piston_head');
    expect(blockId(world, 2)).toBe('stone');
    setLever(world, 0, Y + 1, 0, false);
    tick(world, 5);
    expect(blockId(world, 1)).toBe('stone');
    expect(blockId(world, 2)).toBe('air');
  });

  it('finishes in-flight moves when their column unloads and leaves nothing stale', () => {
    const world = makeWorld();
    world.setBlock(0, Y, 0, 'sticky_piston', { facing: 'east', extended: 'false' });
    world.setBlock(1, Y, 0, 'stone');
    lever(world, 0, Y + 1, 0, true);
    expect(world.current.mechanics.isBusy(0, Y, 0)).toBe(true);
    expect(world.current.mechanics.movingBlocks().length).toBeGreaterThan(0);

    world.removeColumn(0, 0);
    expect(world.current.mechanics.isBusy(0, Y, 0)).toBe(false);
    expect(world.current.mechanics.movingBlocks()).toEqual([]);

    // the column comes back and the piston works as new
    world.setBlock(0, Y, 0, 'sticky_piston', { facing: 'east', extended: 'false' });
    world.setBlock(1, Y, 0, 'stone');
    lever(world, 0, Y + 1, 0, true);
    tick(world, 5);
    expect(world.getBlock(0, Y, 0).state.extended).toBe('true');
    expect(blockId(world, 1)).toBe('sticky_piston_head');
    expect(blockId(world, 2)).toBe('stone');
    setLever(world, 0, Y + 1, 0, false);
    tick(world, 5);
    expect(blockId(world, 1)).toBe('stone');
    expect(world.current.mechanics.isBusy(0, Y, 0)).toBe(false);
  });

  it('a piston head collides with its plate and shaft, a moving block has no collision, and neither can be mined', () => {
    const registry = BlockRegistry.getInstance();
    const head = registry.getBlockDefinition('piston_head')!;
    const moving = registry.getBlockDefinition('piston_moving')!;
    expect(collisionBoxes('piston_head', head.model, { facing: 'east' }).length).toBe(2);
    expect(collisionBoxes('piston_moving', moving.model, { facing: 'east' })).toEqual([]);
    expect(breakSeconds(moving)).toBe(Infinity);
  });

  it('does not push immovable blocks', () => {
    const immovable: Array<[string, Record<string, string>?]> = [
      ['foundation_stone'],
      ['blackglass'],
      ['chest', { facing: 'north', pair: 'single' }],
      ['kiln'],
    ];
    for (const [id, props] of immovable) {
      const world = makeWorld();
      world.setBlock(0, Y, 0, 'piston', { facing: 'east', extended: 'false' });
      world.setBlock(1, Y, 0, id, props);
      lever(world, 0, Y + 1, 0, true);
      tick(world, 5);
      expect(world.getBlock(0, Y, 0).state.extended, id).toBe('false');
      expect(blockId(world, 1), id).toBe(id);
      expect(blockId(world, 2), id).toBe('air');
    }
  });

  it('an extended piston is immovable', () => {
    const world = makeWorld();
    world.setBlock(0, Y, 0, 'piston', { facing: 'east', extended: 'false' });
    world.setBlock(1, Y, 0, 'piston', { facing: 'south', extended: 'false' });
    // Beside the piston, not on it, so the lever does not also power the first piston through it.
    lever(world, 1, Y, -1, true);
    tick(world, PISTON_MOVE_TICKS);
    expect(world.getBlock(1, Y, 0).state.extended).toBe('true');
    expect(blockId(world, 1, Y, 1)).toBe('piston_head');

    lever(world, 0, Y + 1, 0, true);
    tick(world, 5);
    expect(world.getBlock(0, Y, 0).state.extended).toBe('false');
    expect(blockId(world, 1)).toBe('piston');
    expect(blockId(world, 2)).toBe('air');
  });

  it('a block pushed behind an immovable one blocks the whole line', () => {
    const world = makeWorld();
    pistonLine(world, 'piston', 3);
    world.setBlock(4, Y, 0, 'blackglass');
    lever(world, 0, Y + 1, 0, true);
    tick(world, 5);
    expect(world.getBlock(0, Y, 0).state.extended).toBe('false');
    expect(blockId(world, 1)).toBe('stone');
  });

  it('pushes vertically', () => {
    const world = makeWorld();
    world.setBlock(0, Y, 0, 'piston', { facing: 'up', extended: 'false' });
    world.setBlock(0, Y + 1, 0, 'stone');
    world.setBlock(1, Y, 0, 'lever', { face: 'wall_west', powered: 'false' });
    world.setBlock(1, Y, 0, 'copper_trace');
    world.setBlock(2, Y, 0, 'lever', { face: 'floor', powered: 'true' });
    tick(world, PISTON_MOVE_TICKS);
    expect(blockId(world, 0, Y + 1)).toBe('piston_head');
    expect(blockId(world, 0, Y + 2)).toBe('stone');
  });

  it('powered doors and trapdoors follow power, and hand toggling still works', () => {
    const world = makeWorld();
    const registry = BlockRegistry.getInstance();
    world.setBlock(0, Y, 0, 'oak_door', { half: 'lower', facing: 'north' });
    world.setBlock(0, Y + 1, 0, 'oak_door', { half: 'upper', facing: 'north' });
    world.setBlock(0, Y, 3, 'oak_trapdoor', { facing: 'north', half: 'bottom' });
    world.setBlock(1, Y, 0, 'copper_trace');
    world.setBlock(1, Y, 3, 'copper_trace');
    world.setBlock(2, Y, 0, 'copper_trace');
    world.setBlock(2, Y, 3, 'copper_trace');
    const open = () => [
      String(world.getBlock(0, Y, 0).state.open),
      String(world.getBlock(0, Y + 1, 0).state.open),
      String(world.getBlock(0, Y, 3).state.open),
    ];
    expect(open()).toEqual(['false', 'false', 'false']);

    lever(world, 3, Y, 0, true);
    lever(world, 3, Y, 3, true);
    expect(open()).toEqual(['true', 'true', 'true']);

    setLever(world, 3, Y, 0, false);
    setLever(world, 3, Y, 3, false);
    expect(open()).toEqual(['false', 'false', 'false']);

    // A hand toggle sticks until the power changes again.
    toggleOpenable(registry, world, 0, Y, 0);
    expect(open()[0]).toBe('true');
    setLever(world, 3, Y, 0, true);
    expect(open()[0]).toBe('true');
    setLever(world, 3, Y, 0, false);
    expect(open()[0]).toBe('false');
  });

  it('a dispenser ejects one item on a rising edge', () => {
    const world = makeWorld();
    const spawned: Array<{
      id: string;
      count: number;
      x: number;
      y: number;
      z: number;
      v: number[];
    }> = [];
    world.itemSpawner = (id, count, x, y, z, v) => spawned.push({ id, count, x, y, z, v });
    world.setBlock(0, Y, 0, 'dispenser', { facing: 'east', triggered: 'false' });
    const slots = world.blockEntities.getContainer(0, Y, 0)!.slots;
    expect(slots.length).toBe(9);
    expect(world.current.mechanics.insertItem(0, Y, 0, 'stick', 2)).toBe(true);
    expect(world.current.mechanics.insertItem(0, Y, 0, 'coal', 1)).toBe(true);

    lever(world, 0, Y + 1, 0, true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ id: 'stick', count: 1 });
    expect(spawned[0]!.x).toBeGreaterThan(1);
    expect(spawned[0]!.v[0]).toBeGreaterThan(0);
    expect(spawned[0]!.v[2]).toBe(0);
    tick(world, 5);
    expect(spawned).toHaveLength(1);
    expect(world.getBlock(0, Y, 0).state.triggered).toBe('true');

    setLever(world, 0, Y + 1, 0, false);
    expect(world.getBlock(0, Y, 0).state.triggered).toBe('false');
    expect(spawned).toHaveLength(1);
    setLever(world, 0, Y + 1, 0, true);
    setLever(world, 0, Y + 1, 0, false);
    setLever(world, 0, Y + 1, 0, true);
    expect(spawned.map((s) => s.id)).toEqual(['stick', 'stick', 'coal']);

    const state = world.blockEntities.get<DispenserState>(0, Y, 0)!.state;
    expect(state.slots.every((slot) => slot === null)).toBe(true);
    setLever(world, 0, Y + 1, 0, false);
    setLever(world, 0, Y + 1, 0, true);
    expect(spawned).toHaveLength(3);
  });

  it('a dispenser ejects in its facing direction, including up', () => {
    const world = makeWorld();
    const velocities: number[][] = [];
    world.itemSpawner = (_id, _count, _x, _y, _z, v) => velocities.push(v);
    world.setBlock(0, Y, 0, 'dispenser', { facing: 'up', triggered: 'false' });
    world.current.mechanics.insertItem(0, Y, 0, 'stick', 1);
    lever(world, 1, Y, 0, true);
    world.setBlock(1, Y, 0, 'copper_trace');
    lever(world, 2, Y, 0, true);
    expect(velocities).toHaveLength(1);
    expect(velocities[0]![1]).toBeGreaterThan(0);
    expect(velocities[0]![0]).toBe(0);
  });

  it('a note block emits a tone on a rising edge and cycles with use', () => {
    const world = makeWorld();
    const tones: ToneEvent[] = [];
    world.current.mechanics.onTone((event) => tones.push(event));
    world.setBlock(0, Y, 0, 'note_block', { note: '3', powered: 'false' });

    lever(world, 0, Y + 1, 0, true);
    expect(tones).toHaveLength(1);
    expect(tones[0]).toMatchObject({ x: 0, y: Y, z: 0, note: 3 });
    expect(tones[0]!.pitch).toBeCloseTo(2 ** ((3 - 12) / 12));
    tick(world, 5);
    expect(tones).toHaveLength(1);

    setLever(world, 0, Y + 1, 0, false);
    setLever(world, 0, Y + 1, 0, true);
    expect(tones).toHaveLength(2);

    setLever(world, 0, Y + 1, 0, false);
    expect(world.current.useBlock(0, Y, 0)).toBe(true);
    expect(world.getBlock(0, Y, 0).state.note).toBe('4');
    expect(tones[2]).toMatchObject({ note: 4 });
    for (let i = 0; i < 21; i++) world.current.useBlock(0, Y, 0);
    expect(world.getBlock(0, Y, 0).state.note).toBe('0');
  });
});
