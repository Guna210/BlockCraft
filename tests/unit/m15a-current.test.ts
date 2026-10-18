import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { items } from '../../src/gameplay/items';
import { registerChestBlockEntity, type ChestEntityState } from '../../src/gameplay/chests';
import { registerKilnBlockEntity, type KilnState } from '../../src/gameplay/kiln';
import {
  TORCH_COOLDOWN_TICKS,
  registerCurrentBlockEntities,
  type GaugeState,
  type InverterTorchState,
} from '../../src/gameplay/current';
import { crafting } from '../../src/gameplay/crafting';
import { textureGenerators, texturePalettes } from '../../src/render/textures';
import { buildIconSheet } from '../../src/ui/icons';
import { buildMeshLookupTables, greedyMesh } from '../../src/mesh/greedy';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { blockEntityRegistry } from '../../src/world/block-entities';
import { buildLightLookupTables } from '../../src/world/lighting';
import { buildPaddedSection } from '../../src/world/padded';
import { World } from '../../src/world/world';

function makeWorld(): World {
  return new World(false);
}

function setLever(
  world: World,
  x: number,
  y: number,
  z: number,
  powered: boolean,
  face = 'floor',
): void {
  world.setBlock(x, y, z, 'lever', { face, powered: String(powered) });
}

function state(world: World, x: number, y: number, z: number, key: string): string {
  return String(world.getBlock(x, y, z).state[key]);
}

describe('M15a — Current logic', () => {
  beforeEach(() => {
    BlockRegistry.getInstance();
    registerChestBlockEntity();
    registerKilnBlockEntity();
    registerCurrentBlockEntities();
  });

  it('attenuates a 20-block trace by one per block', () => {
    const world = makeWorld();
    setLever(world, -1, 65, 0, true);
    for (let x = 0; x < 20; x++) world.setBlock(x, 65, 0, 'copper_trace');

    expect(world.getBlock(0, 65, 0).state.power).toBe('15');
    expect(world.getBlock(14, 65, 0).state.power).toBe('1');
    expect(world.getBlock(15, 65, 0).state.power).toBe('0');
    expect(world.getBlock(19, 65, 0).state.power).toBe('0');
  });

  it('meshes both arms of ascending and descending trace steps', () => {
    const world = makeWorld();
    world.setBlock(5, 65, 5, 'copper_trace');
    world.setBlock(6, 66, 5, 'copper_trace');
    world.setBlock(10, 65, 5, 'copper_trace');
    world.setBlock(9, 66, 5, 'copper_trace');

    const tables = buildMeshLookupTables(BlockRegistry.getInstance(), () => 0);
    const mesh = greedyMesh(buildPaddedSection(world, 0, 4, 0), tables);

    // Each trace contributes its center and one connecting arm at either height.
    expect(mesh.models.quadCount).toBe(8);
  });

  it('appends current states after the master state range', () => {
    const stateIds = JSON.parse(
      readFileSync(path.join(process.cwd(), 'data/block-state-ids.json'), 'utf8'),
    ) as Record<string, number>;
    const currentStates = Object.entries(stateIds).filter(([key]) =>
      [
        'copper_trace',
        'gauge',
        'inverter_torch',
        'lamp',
        'lever',
        'pressure_plate',
        'relay',
        'stone_button',
        'tripwire',
        'tripwire_hook',
        'wooden_button',
      ].some((blockId) => key === blockId || key.startsWith(`${blockId}[`)),
    );

    expect(stateIds['kiln[facing=west,lit=true]']).toBe(541);
    expect(currentStates).toHaveLength(157);
    expect(Math.min(...currentStates.map(([, stateId]) => stateId))).toBe(542);
    expect(currentStates.every(([, stateId]) => stateId >= 542)).toBe(true);
  });

  it('builds NOT, AND, OR and XOR truth tables from blocks set in the world', () => {
    const truthTable = [
      { a: false, b: false },
      { a: false, b: true },
      { a: true, b: false },
      { a: true, b: true },
    ];
    for (const { a, b } of truthTable) {
      const notWorld = makeWorld();
      notWorld.setBlock(0, 65, 0, 'stone');
      setLever(notWorld, 1, 65, 0, a, 'wall_west');
      notWorld.setBlock(0, 66, 0, 'inverter_torch', { attachment: 'floor', lit: 'true' });
      notWorld.setBlock(0, 66, 1, 'lamp');
      expect(state(notWorld, 0, 66, 0, 'lit')).toBe(String(!a));
      expect(state(notWorld, 0, 66, 1, 'lit')).toBe(String(!a));

      const orWorld = makeWorld();
      setLever(orWorld, -1, 65, 0, a);
      setLever(orWorld, -1, 65, 2, b);
      for (let x = 0; x <= 2; x++) {
        orWorld.setBlock(x, 65, 0, 'copper_trace');
        orWorld.setBlock(x, 65, 2, 'copper_trace');
      }
      orWorld.setBlock(2, 65, 1, 'copper_trace');
      orWorld.setBlock(3, 65, 1, 'lamp');
      expect(state(orWorld, 3, 65, 1, 'lit')).toBe(String(a || b));

      const andWorld = makeWorld();
      andWorld.setBlock(20, 65, 0, 'stone');
      andWorld.setBlock(24, 65, 0, 'stone');
      andWorld.setBlock(22, 65, 2, 'stone');
      setLever(andWorld, 20, 65, -1, a, 'wall_south');
      setLever(andWorld, 24, 65, -1, b, 'wall_south');
      for (const [x, y, z] of [
        [20, 66, 1],
        [21, 66, 1],
        [23, 66, 1],
        [24, 66, 1],
        [21, 65, 1],
        [22, 65, 1],
        [23, 65, 1],
      ] as const)
        andWorld.setBlock(x, y, z, 'copper_trace');
      andWorld.setBlock(20, 66, 0, 'inverter_torch', { attachment: 'floor', lit: 'true' });
      andWorld.setBlock(24, 66, 0, 'inverter_torch', { attachment: 'floor', lit: 'true' });
      andWorld.setBlock(22, 66, 2, 'inverter_torch', { attachment: 'floor', lit: 'true' });
      andWorld.setBlock(22, 66, 3, 'lamp');
      expect(state(andWorld, 22, 66, 2, 'lit')).toBe(String(a && b));
      expect(state(andWorld, 22, 66, 3, 'lit')).toBe(String(a && b));

      const xorWorld = makeWorld();
      setLever(xorWorld, 39, 65, 0, a); // A at gauge A's rear
      setLever(xorWorld, 40, 65, -1, b); // B at gauge A's side
      setLever(xorWorld, 40, 65, 1, b); // B at gauge B's rear
      setLever(xorWorld, 39, 65, 2, a); // A at gauge B's side
      xorWorld.setBlock(40, 65, 0, 'gauge', {
        facing: 'east',
        mode: 'subtract',
        powered: 'false',
      });
      xorWorld.setBlock(40, 65, 2, 'gauge', {
        facing: 'south',
        mode: 'subtract',
        powered: 'false',
      });
      const xor =
        xorWorld.blockEntities.get<GaugeState>(40, 65, 0)!.state.outputLevel > 0 ||
        xorWorld.blockEntities.get<GaugeState>(40, 65, 2)!.state.outputLevel > 0;
      expect(xor).toBe(a !== b);
    }
  });

  it('holds an RS latch state after set and reset pulses', () => {
    const world = makeWorld();
    world.setBlock(0, 65, 0, 'stone');
    world.setBlock(0, 66, 0, 'inverter_torch', { attachment: 'floor', lit: 'true' });
    world.setBlock(4, 65, 0, 'stone');
    world.setBlock(4, 66, 0, 'inverter_torch', { attachment: 'floor', lit: 'true' });
    setLever(world, -1, 65, 0, false, 'wall_east'); // reset Q
    setLever(world, 5, 65, 0, false, 'wall_west'); // set Q
    for (let x = 0; x <= 3; x++) {
      world.setBlock(x, 66, 1, 'copper_trace');
    }
    for (let x = 1; x <= 4; x++) world.setBlock(x, 66, -1, 'copper_trace');
    world.setBlock(3, 65, 1, 'copper_trace');
    world.setBlock(4, 65, 1, 'copper_trace');
    world.setBlock(1, 65, -1, 'copper_trace');
    world.setBlock(0, 65, -1, 'copper_trace');

    setLever(world, 5, 65, 0, true, 'wall_west');
    setLever(world, 5, 65, 0, false, 'wall_west');
    expect(state(world, 0, 66, 0, 'lit')).toBe('true');
    expect(state(world, 4, 66, 0, 'lit')).toBe('false');

    setLever(world, -1, 65, 0, true, 'wall_east');
    setLever(world, -1, 65, 0, false, 'wall_east');
    expect(state(world, 0, 66, 0, 'lit')).toBe('false');
    expect(state(world, 4, 66, 0, 'lit')).toBe('true');
  });

  it('runs a stable five-tick torch and relay clock for 1000 ticks', () => {
    const world = makeWorld();
    world.setBlock(0, 65, 0, 'stone');
    world.setBlock(0, 66, 0, 'inverter_torch', { attachment: 'floor', lit: 'true' });
    world.setBlock(1, 66, 0, 'relay', {
      facing: 'east',
      delay: '2',
      locked: 'false',
      powered: 'false',
    });
    world.setBlock(3, 66, 0, 'relay', {
      facing: 'east',
      delay: '3',
      locked: 'false',
      powered: 'false',
    });
    world.setBlock(5, 66, 2, 'relay', {
      facing: 'south',
      delay: '2',
      locked: 'false',
      powered: 'false',
    });
    world.setBlock(4, 66, 3, 'relay', {
      facing: 'west',
      delay: '3',
      locked: 'false',
      powered: 'false',
    });
    world.setBlock(2, 66, 0, 'copper_trace');
    world.setBlock(4, 66, 0, 'copper_trace');
    world.setBlock(5, 66, 0, 'copper_trace');
    world.setBlock(5, 66, 1, 'copper_trace');
    world.setBlock(3, 66, 3, 'copper_trace');
    world.setBlock(3, 65, 3, 'copper_trace');
    world.setBlock(2, 65, 3, 'copper_trace');
    world.setBlock(1, 65, 3, 'copper_trace');
    world.setBlock(0, 65, 3, 'copper_trace');
    world.setBlock(0, 65, 2, 'copper_trace');
    world.setBlock(0, 65, 1, 'copper_trace');

    const edges: number[] = [];
    let previous = state(world, 0, 66, 0, 'lit');
    for (let tick = 1; tick <= 1000; tick++) {
      world.tick();
      const next = state(world, 0, 66, 0, 'lit');
      if (next !== previous) edges.push(tick);
      previous = next;
    }
    expect(edges.length).toBeGreaterThan(90);
    expect(edges.slice(1).every((tick, index) => tick - edges[index]! === 10)).toBe(true);
  });

  it('burns out after the ninth toggle in 60 ticks and relights after cooling', () => {
    const world = makeWorld();
    world.setBlock(0, 65, 0, 'stone');
    world.setBlock(0, 66, 0, 'inverter_torch', { attachment: 'floor', lit: 'true' });
    setLever(world, 1, 65, 0, false, 'wall_west');
    const torch = world.blockEntities.get<InverterTorchState>(0, 66, 0)!;

    for (let toggle = 0; toggle < 9; toggle++) {
      setLever(world, 1, 65, 0, true, 'wall_west');
      setLever(world, 1, 65, 0, false, 'wall_west');
    }
    expect(torch.state.toggleTicks.length).toBeGreaterThan(8);
    expect(torch.state.coolingUntil).toBe(TORCH_COOLDOWN_TICKS);
    expect(state(world, 0, 66, 0, 'lit')).toBe('false');

    for (let tick = 0; tick < TORCH_COOLDOWN_TICKS - 1; tick++) world.tick();
    expect(state(world, 0, 66, 0, 'lit')).toBe('false');
    world.tick();
    expect(state(world, 0, 66, 0, 'lit')).toBe('true');
  });

  it('delays relay output and freezes it while locked', () => {
    const world = makeWorld();
    setLever(world, 0, 65, 0, true);
    setLever(world, 1, 65, -1, false);
    world.setBlock(1, 65, 0, 'relay', {
      facing: 'east',
      delay: '2',
      locked: 'false',
      powered: 'false',
    });
    world.tick();
    expect(state(world, 1, 65, 0, 'powered')).toBe('false');
    world.tick();
    expect(state(world, 1, 65, 0, 'powered')).toBe('true');

    setLever(world, 1, 65, -1, true);
    expect(state(world, 1, 65, 0, 'locked')).toBe('true');
    setLever(world, 0, 65, 0, false);
    for (let tick = 0; tick < 4; tick++) world.tick();
    expect(state(world, 1, 65, 0, 'powered')).toBe('true');

    setLever(world, 1, 65, -1, false);
    world.tick();
    world.tick();
    expect(state(world, 1, 65, 0, 'powered')).toBe('false');
  });

  it('reads generic chest and kiln fullness for gauge compare and subtract modes', () => {
    const world = makeWorld();
    world.setBlock(0, 65, 0, 'chest', { facing: 'north', pair: 'single' });
    world.setBlock(1, 65, 0, 'gauge', { facing: 'east', mode: 'compare', powered: 'false' });
    setLever(world, 1, 65, -1, true);
    const chest = world.blockEntities.get<ChestEntityState>(0, 65, 0)!;
    chest.state.slots[0] = { id: 'stone', count: 64 };
    world.tick();
    const gauge = world.blockEntities.get<GaugeState>(1, 65, 0)!;
    expect(gauge.state.outputLevel).toBe(0);
    setLever(world, 1, 65, -1, false);
    expect(gauge.state.outputLevel).toBe(1);

    const kilnWorld = makeWorld();
    kilnWorld.setBlock(0, 65, 0, 'kiln');
    kilnWorld.setBlock(1, 65, 0, 'gauge', { facing: 'east', mode: 'subtract', powered: 'false' });
    setLever(kilnWorld, 1, 65, -1, false);
    const kiln = kilnWorld.blockEntities.get<KilnState>(0, 65, 0)!;
    kiln.state.input = { id: 'stone', count: 64, damage: null };
    kilnWorld.tick();
    const subtract = kilnWorld.blockEntities.get<GaugeState>(1, 65, 0)!;
    expect(subtract.state.outputLevel).toBe(5);
    setLever(kilnWorld, 1, 65, -1, true);
    expect(subtract.state.outputLevel).toBe(0);
  });

  it('uses the shared entity query for player and item pressure-plate detection', () => {
    const world = makeWorld();
    world.setBlock(0, 65, 0, 'pressure_plate');
    let nearby: Array<{
      id: number | string;
      type: string;
      minX: number;
      minY: number;
      minZ: number;
      maxX: number;
      maxY: number;
      maxZ: number;
    }> = [];
    world.entityQuery.addProvider('player', () =>
      nearby.filter((entity) => entity.type === 'player'),
    );
    world.entityQuery.addProvider('items', () => nearby.filter((entity) => entity.type === 'item'));
    const box = {
      minX: 0.4,
      minY: 65,
      minZ: 0.4,
      maxX: 0.6,
      maxY: 65.4,
      maxZ: 0.6,
    };
    nearby = [{ ...box, id: 'player', type: 'player' }];
    world.tick();
    expect(state(world, 0, 65, 0, 'powered')).toBe('true');
    nearby = [{ ...box, id: 1, type: 'item' }];
    world.tick();
    expect(state(world, 0, 65, 0, 'powered')).toBe('true');
    nearby = [];
    world.tick();
    expect(state(world, 0, 65, 0, 'powered')).toBe('false');
  });

  it('trips paired hooks for player and item entities through the same query', () => {
    const world = makeWorld();
    world.setBlock(0, 65, 0, 'pressure_plate');
    world.setBlock(0, 65, 2, 'tripwire_hook', { facing: 'east', powered: 'false' });
    for (let x = 1; x <= 3; x++) world.setBlock(x, 65, 2, 'tripwire');
    world.setBlock(4, 65, 2, 'tripwire_hook', { facing: 'west', powered: 'false' });
    let nearby: Array<{
      id: number | string;
      type: string;
      minX: number;
      minY: number;
      minZ: number;
      maxX: number;
      maxY: number;
      maxZ: number;
    }> = [];
    world.entityQuery.addProvider('player', () =>
      nearby.filter((entity) => entity.type === 'player'),
    );
    world.entityQuery.addProvider('items', () => nearby.filter((entity) => entity.type === 'item'));

    for (const entity of [
      { id: 'player', type: 'player' },
      { id: 1, type: 'item' },
    ]) {
      nearby = [
        {
          ...entity,
          minX: 2.4,
          minY: 65.3,
          minZ: 2.4,
          maxX: 2.6,
          maxY: 65.7,
          maxZ: 2.6,
        },
      ];
      world.tick();
      expect(state(world, 0, 65, 2, 'powered')).toBe('true');
      expect(state(world, 4, 65, 2, 'powered')).toBe('true');
    }

    nearby = [];
    world.tick();
    expect(state(world, 0, 65, 2, 'powered')).toBe('false');
    expect(state(world, 4, 65, 2, 'powered')).toBe('false');
  });

  it('releases stone and wooden buttons after 20 and 30 scheduled ticks', () => {
    const world = makeWorld();
    world.setBlock(0, 65, 0, 'stone_button');
    world.setBlock(2, 65, 0, 'wooden_button');

    expect(world.current.useBlock(0, 65, 0)).toBe(true);
    expect(world.current.useBlock(2, 65, 0)).toBe(true);
    for (let tick = 0; tick < 19; tick++) world.tick();
    expect(state(world, 0, 65, 0, 'powered')).toBe('true');
    expect(state(world, 2, 65, 0, 'powered')).toBe('true');
    world.tick();
    expect(state(world, 0, 65, 0, 'powered')).toBe('false');
    expect(state(world, 2, 65, 0, 'powered')).toBe('true');
    for (let tick = 0; tick < 10; tick++) world.tick();
    expect(state(world, 2, 65, 0, 'powered')).toBe('false');
  });

  it('registers a generated texture and icon for every current block item', () => {
    const registry = BlockRegistry.getInstance();
    const lookup = (name: string) => {
      const generated = textureGenerators[name]?.(42);
      return Array.isArray(generated) ? generated[0] : generated;
    };
    const sheet = buildIconSheet(lookup, new Uint8Array(16 * 16 * 4));
    for (const blockId of [
      'copper_trace',
      'gauge',
      'inverter_torch',
      'lamp',
      'lever',
      'pressure_plate',
      'relay',
      'stone_button',
      'tripwire',
      'tripwire_hook',
      'wooden_button',
    ]) {
      expect(items.get(blockId).block).toBe(blockId);
      const icon = sheet.rects.get(blockId);
      expect(icon).toBeDefined();
      let visiblePixels = 0;
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++)
          visiblePixels += Number(
            sheet.data[((icon!.y + y) * sheet.width + icon!.x + x) * 4 + 3]! > 0,
          );
      expect(visiblePixels, `${blockId} icon should contain generated pixels`).toBeGreaterThan(0);
      expect(registry.getBlockDefinition(blockId)).toBeDefined();
      const recipe = crafting.recipes.get(blockId);
      expect(recipe?.result.id).toBe(blockId);
      const block = registry.getBlockDefinition(blockId)!;
      for (const texture of Object.values(block.textures ?? {})) {
        if (!texture) continue;
        expect(textureGenerators[texture], `${blockId} texture ${texture}`).toBeDefined();
        expect(texturePalettes[texture], `${blockId} palette ${texture}`).toBeDefined();
      }
    }
    for (let power = 0; power <= 15; power++) {
      const texture = `copper_trace_${power}`;
      expect(textureGenerators[texture]).toBeDefined();
      expect(texturePalettes[texture]).toBeDefined();
    }
    expect(blockEntityRegistry.has('inverter_torch')).toBe(true);
    expect(blockEntityRegistry.has('gauge')).toBe(true);
  });

  it('emits Lamp light through its generic lightEmissionWhen data rule', () => {
    const registry = BlockRegistry.getInstance();
    const tables = buildLightLookupTables(registry);
    const lit = registry.getStateId('lamp', { lit: 'true' })!;
    const unlit = registry.getStateId('lamp', { lit: 'false' })!;
    expect(tables.emissionTable[lit]).toBe(15);
    expect(tables.emissionTable[unlit]).toBe(0);
    expect(registry.getFaceTexture(lit, 'north')).toBe('lamp_side_lit');
    expect(registry.getFaceTexture(unlit, 'north')).toBe('lamp_side');
  });
});
