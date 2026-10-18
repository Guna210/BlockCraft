import { describe, it, expect } from 'vitest';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { BlockShapes } from '../../src/world/block-shapes';
import { VoxelRaycaster, createRayHit } from '../../src/world/raycast';
import { buildMeshLookupTables, greedyMesh } from '../../src/mesh/greedy';
import { decodeVertex, packShapeVertex, isShapeVertex } from '../../src/mesh/vertex';
import {
  doorCells,
  removeShapeBlock,
  shapePlacement,
  toggleOpenable,
  updateFenceNeighbours,
  fenceStateFor,
  type ShapeWorld,
} from '../../src/gameplay/shape-blocks';
import { rollBlockLoot } from '../../src/gameplay/loot';
import { textureGenerators } from '../../src/render/textures';
import { collisionBoxes } from '../../src/world/shape-geometry';
import { crafting } from '../../src/gameplay/crafting';
import { smelting } from '../../src/gameplay/smelting';

const registry = BlockRegistry.getInstance();
const shapes = new BlockShapes(registry);
const resolved = (state: number) => registry.getResolvedState(state)!;
const WOODS = ['oak', 'birch', 'pine', 'acacia', 'rainwood'];

function makeWorld(): ShapeWorld & { cells: Map<string, number> } {
  const cells = new Map<string, number>();
  return {
    cells,
    getBlockStateId: (x, y, z) => cells.get(`${x},${y},${z}`) ?? 0,
    setBlockStateId: (x, y, z, s) => void cells.set(`${x},${y},${z}`, s),
  };
}
const name = (w: ShapeWorld, x: number, y: number, z: number) =>
  resolved(w.getBlockStateId(x, y, z));
const free = (w: ShapeWorld) => (x: number, y: number, z: number) =>
  w.getBlockStateId(x, y, z) === 0;
const ctx = (over: Record<string, unknown> = {}) => ({
  x: 0,
  y: 0,
  z: 0,
  face: 'top' as const,
  hitX: 0.5,
  hitY: 0.5,
  hitZ: 0.5,
  lookX: 0,
  lookZ: -1,
  ...over,
});
const size = (b: readonly number[]) => [b[3]! - b[0]!, b[4]! - b[1]!, b[5]! - b[2]!];

describe('BLOCKS-shapes registry and recipes', () => {
  it('registers stairs, fences, doors and trapdoors for every wood plus stone stairs', () => {
    for (const w of WOODS)
      for (const kind of ['stairs', 'fence', 'door', 'trapdoor'])
        expect(registry.getBlockDefinition(`${w}_${kind}`), `${w}_${kind}`).toBeDefined();
    expect(registry.getBlockDefinition('stone_stairs')).toBeDefined();
    expect(registry.getBlockDefinition('cobblestone_stairs')).toBeDefined();
  });
  it('brings the crafting recipe total to at least 120 as M10a required', () => {
    expect(crafting.recipes.size + smelting.recipes.size).toBeGreaterThanOrEqual(120);
  });
});

describe('BLOCKS-shapes boxes', () => {
  it('stairs are a slab plus a half-block step on the facing side, mirrored when on top', () => {
    const east = registry.getStateId('oak_stairs', { facing: 'east', half: 'bottom' })!;
    expect(shapes.parts[east]).toEqual([
      [0, 0, 0, 1, 0.5, 1],
      [0.5, 0.5, 0, 1, 1, 1],
    ]);
    const top = registry.getStateId('oak_stairs', { facing: 'north', half: 'top' })!;
    expect(shapes.parts[top]).toEqual([
      [0, 0.5, 0, 1, 1, 1],
      [0, 0, 0, 1, 0.5, 0.5],
    ]);
  });
  it('fence arms appear per connection and collide 1.5 blocks high', () => {
    const lone = registry.getStateId('oak_fence', {})!;
    expect(shapes.parts[lone]).toHaveLength(1);
    const east = registry.getStateId('oak_fence', { east: 'true' })!;
    expect(shapes.parts[east]).toHaveLength(3);
    const all = registry.getStateId('oak_fence', {
      north: 'true',
      south: 'true',
      east: 'true',
      west: 'true',
    })!;
    expect(shapes.parts[all]).toHaveLength(9);
    const collide = collisionBoxes('oak_fence', 'fence', {
      north: 'false',
      south: 'false',
      east: 'false',
      west: 'false',
    });
    expect(collide[0]![4]).toBe(1.5);
  });
  it('a door leaf is 3/16 thick, sits on its facing side closed and on the hinge side open', () => {
    const closed = registry.getStateId('oak_door', {
      facing: 'north',
      half: 'lower',
      hinge: 'left',
      open: 'false',
    })!;
    expect(shapes.parts[closed]![0]).toEqual([0, 0, 0, 1, 1, 3 / 16]);
    const open = registry.getStateId('oak_door', {
      facing: 'north',
      half: 'lower',
      hinge: 'left',
      open: 'true',
    })!;
    const leaf = shapes.parts[open]![0]!;
    expect(size(leaf)[0]).toBeCloseTo(3 / 16);
    expect(leaf[2]).toBe(0);
    expect(leaf[5]).toBe(1);
  });
  it('a trapdoor is a 3/16 slab closed and a 3/16 wall leaf open', () => {
    const closed = registry.getStateId('oak_trapdoor', {
      facing: 'north',
      half: 'top',
      open: 'false',
    })!;
    expect(shapes.parts[closed]![0]).toEqual([0, 1 - 3 / 16, 0, 1, 1, 1]);
    const open = registry.getStateId('oak_trapdoor', {
      facing: 'east',
      half: 'bottom',
      open: 'true',
    })!;
    expect(shapes.parts[open]![0]).toEqual([1 - 3 / 16, 0, 0, 1, 1, 1]);
  });
});

describe('BLOCKS-shapes placement rules', () => {
  it('stairs rise towards the look direction and flip on an underside or upper half click', () => {
    const w = makeWorld();
    const [a] = shapePlacement(registry, w, 'oak_stairs', ctx({ lookX: 1, lookZ: 0 }), free(w))!;
    expect(resolved(a!.state).properties).toMatchObject({
      facing: 'east',
      half: 'bottom',
    });
    const [b] = shapePlacement(registry, w, 'oak_stairs', ctx({ face: 'bottom' }), free(w))!;
    expect(resolved(b!.state).properties.half).toBe('top');
    const [c] = shapePlacement(
      registry,
      w,
      'oak_stairs',
      ctx({ face: 'north', hitY: 0.8 }),
      free(w),
    )!;
    expect(resolved(c!.state).properties.half).toBe('top');
  });
  it('fences connect to fences and full cubes but not to air or slabs', () => {
    const w = makeWorld();
    w.cells.set('1,0,0', registry.getStateId('stone')!);
    w.cells.set('0,0,1', registry.getStateId('oak_fence', {})!);
    w.cells.set('-1,0,0', registry.getStateId('stone_slab', { half: 'bottom' })!);
    const s = resolved(fenceStateFor(registry, w, 'oak_fence', 0, 0, 0));
    expect(s.properties).toMatchObject({
      east: 'true',
      south: 'true',
      west: 'false',
      north: 'false',
    });
  });
  it('placing and breaking a block next to a fence updates the fence', () => {
    const w = makeWorld();
    w.cells.set('0,0,0', registry.getStateId('oak_fence', {})!);
    w.cells.set('1,0,0', registry.getStateId('stone')!);
    expect(updateFenceNeighbours(registry, w, 1, 0, 0)).toHaveLength(1);
    expect(name(w, 0, 0, 0).properties.east).toBe('true');
    removeShapeBlock(registry, w, 1, 0, 0);
    expect(name(w, 0, 0, 0).properties.east).toBe('false');
  });
  it('a door fills two cells, faces the player, picks its hinge from the click and needs headroom', () => {
    const w = makeWorld();
    const cells = shapePlacement(registry, w, 'oak_door', ctx({ lookZ: -1, hitX: 0.9 }), free(w))!;
    expect(cells).toHaveLength(2);
    expect(cells.map((c) => c.y)).toEqual([0, 1]);
    const lower = resolved(cells[0]!.state).properties;
    expect(lower).toMatchObject({ facing: 'south', half: 'lower', hinge: 'right', open: 'false' });
    expect(resolved(cells[1]!.state).properties.half).toBe('upper');
    const left = shapePlacement(registry, w, 'oak_door', ctx({ lookZ: -1, hitX: 0.1 }), free(w))!;
    expect(resolved(left[0]!.state).properties.hinge).toBe('left');
    w.cells.set('0,1,0', registry.getStateId('stone')!);
    expect(shapePlacement(registry, w, 'oak_door', ctx(), free(w))).toBeNull();
  });
  it('a trapdoor takes the wall side clicked and the click height', () => {
    const w = makeWorld();
    const [t] = shapePlacement(
      registry,
      w,
      'oak_trapdoor',
      ctx({ face: 'east', hitY: 0.2 }),
      free(w),
    )!;
    expect(resolved(t!.state).properties).toMatchObject({
      facing: 'west',
      half: 'bottom',
      open: 'false',
    });
  });
});

describe('BLOCKS-shapes opening and breaking', () => {
  it('toggling either half of a door flips both halves', () => {
    const w = makeWorld();
    for (const c of shapePlacement(registry, w, 'pine_door', ctx(), free(w))!)
      w.setBlockStateId(c.x, c.y, c.z, c.state);
    expect(toggleOpenable(registry, w, 0, 1, 0)).toHaveLength(2);
    expect(name(w, 0, 0, 0).properties.open).toBe('true');
    expect(name(w, 0, 1, 0).properties.open).toBe('true');
    toggleOpenable(registry, w, 0, 0, 0);
    expect(name(w, 0, 0, 0).properties.open).toBe('false');
    expect(name(w, 0, 1, 0).properties.open).toBe('false');
  });
  it('a trapdoor toggles alone and breaking a door removes both halves', () => {
    const w = makeWorld();
    w.cells.set(
      '3,0,0',
      registry.getStateId('oak_trapdoor', { facing: 'north', half: 'bottom', open: 'false' })!,
    );
    expect(toggleOpenable(registry, w, 3, 0, 0)).toHaveLength(1);
    expect(name(w, 3, 0, 0).properties.open).toBe('true');
    for (const c of shapePlacement(registry, w, 'oak_door', ctx(), free(w))!)
      w.setBlockStateId(c.x, c.y, c.z, c.state);
    expect(doorCells(registry, w, 0, 1, 0)).toHaveLength(2);
    removeShapeBlock(registry, w, 0, 0, 0);
    expect(w.getBlockStateId(0, 0, 0)).toBe(0);
    expect(w.getBlockStateId(0, 1, 0)).toBe(0);
  });
  it('toggling a plain block changes nothing', () => {
    const w = makeWorld();
    w.cells.set('0,0,0', registry.getStateId('stone')!);
    expect(toggleOpenable(registry, w, 0, 0, 0)).toEqual([]);
  });
});

describe('BLOCKS-shapes targeting', () => {
  it('a ray passes through the empty part of a stair and hits the step behind it', () => {
    const w = makeWorld();
    // Bottom stair rising to the east: the east half is a full block, the west half is a slab.
    w.cells.set('0,0,0', registry.getStateId('oak_stairs', { facing: 'east', half: 'bottom' })!);
    const ray = new VoxelRaycaster(w);
    const out = createRayHit();
    // Looking straight down at the west quarter hits the slab top at y 0.5.
    ray.cast(0.2, 3, 0.5, 0, -1, 0, 5, out);
    expect(out.hit).toBe(true);
    expect(out.distance).toBeCloseTo(2.5);
    // Looking straight down at the step hits its top at y 1.
    ray.cast(0.8, 3, 0.5, 0, -1, 0, 5, out);
    expect(out.hit).toBe(true);
    expect(out.distance).toBeCloseTo(2);
    // A horizontal ray at height 0.75 from the west passes over the slab and hits the step's side.
    ray.cast(-2, 0.75, 0.5, 1, 0, 0, 5, out);
    expect(out.hit).toBe(true);
    expect(out.distance).toBeCloseTo(2.5);
    expect(out.face).toBe('west');
  });
});

describe('BLOCKS-shapes meshing', () => {
  const tables = buildMeshLookupTables(registry, (t) => t.length);
  const at = (x: number, y: number, z: number) => x + 1 + (y + 1) * 18 + (z + 1) * 324;
  it('shape vertices round-trip through the packed format and never read as fluid', () => {
    const v = new Uint32Array(2);
    packShapeVertex(v, 0, 3, 4, 5, 13, 8, 16, 2, 1, 9, 4, 5, 6, 777);
    expect(isShapeVertex(v[0]!, v[1]!)).toBe(true);
    const d = decodeVertex(v[0]!, v[1]!);
    expect([d.x, d.y, d.z]).toEqual([3 + 13 / 16, 4.5, 6]);
    expect(d).toMatchObject({
      normalIndex: 2,
      ao: 1,
      skyLight: 9,
      blockR: 4,
      blockG: 5,
      blockB: 6,
      tileIndex: 777,
    });
    for (let x = 0; x <= 16; x++) {
      packShapeVertex(v, 0, 0, 0, 0, x, 0, 0, 0, 0, 0, 0, 0, 0, 1);
      expect(v[0]! >>> 28).toBeGreaterThanOrEqual(8);
    }
  });
  it('a lone stair emits boxes into the model bucket; a stair on stone hides its bottom', () => {
    const stair = registry.getStateId('stone_stairs', { facing: 'north', half: 'bottom' })!;
    const blocks = new Uint16Array(18 ** 3);
    blocks[at(5, 5, 5)] = stair;
    const alone = greedyMesh(blocks, tables).models.quadCount;
    expect(alone).toBeGreaterThan(6);
    blocks[at(5, 4, 5)] = registry.getStateId('stone')!;
    expect(greedyMesh(blocks, tables).models.quadCount).toBeLessThan(alone);
  });
  it('a fence with four arms stays within the per-block quad budget', () => {
    const fence = registry.getStateId('oak_fence', {
      north: 'true',
      south: 'true',
      east: 'true',
      west: 'true',
    })!;
    const blocks = new Uint16Array(18 ** 3);
    blocks[at(5, 5, 5)] = fence;
    expect(greedyMesh(blocks, tables).models.quadCount).toBeLessThanOrEqual(54);
  });
  it('a section full of shapes meshes completely', () => {
    const fence = registry.getStateId('oak_fence', {
      north: 'true',
      south: 'true',
      east: 'true',
      west: 'true',
    })!;
    const blocks = new Uint16Array(18 ** 3);
    for (let z = 0; z < 16; z += 2)
      for (let y = 0; y < 16; y += 2) for (let x = 0; x < 16; x += 2) blocks[at(x, y, z)] = fence;
    const mesh = greedyMesh(blocks, tables).models;
    expect(mesh.quadCount).toBeGreaterThan(24576 / 8);
    expect(mesh.indices.length).toBe(mesh.quadCount * 6);
  });
});

describe('BLOCKS-shapes limits and drops', () => {
  it('keeps every atlas tile index inside the 10 bits of a shape vertex', () => {
    let tiles = 0;
    for (const generate of Object.values(textureGenerators)) {
      const result = generate();
      tiles += Array.isArray(result) ? result.length : 1;
    }
    expect(tiles).toBeLessThanOrEqual(1024);
  });
  it('breaking a door drops exactly one door, whichever half was broken', () => {
    for (const wood of WOODS) {
      expect(rollBlockLoot(`${wood}_door`, 1, 0, 65, 0)).toEqual([
        { id: `${wood}_door`, count: 1 },
      ]);
    }
    const w = makeWorld();
    for (const c of shapePlacement(registry, w, 'oak_door', ctx(), free(w))!)
      w.setBlockStateId(c.x, c.y, c.z, c.state);
    // BlockInteraction calls onBreak once per break, and removeShapeBlock clears both halves.
    expect(removeShapeBlock(registry, w, 0, 1, 0).filter((c) => c.state === 0)).toHaveLength(2);
  });
});
