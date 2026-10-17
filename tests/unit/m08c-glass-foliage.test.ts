import { describe, expect, it } from 'vitest';
import savedStateIds from '../../data/block-state-ids.json';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { items } from '../../src/gameplay/items';
import { blockLoot } from '../../src/gameplay/loot';
import { match } from '../../src/gameplay/crafting';
import { buildMeshLookupTables, greedyMesh } from '../../src/mesh/greedy';
import { decodeVertex } from '../../src/mesh/vertex';
import { PADDED_SECTION_VOLUME } from '../../src/world/padded';
import { buildLightLookupTables } from '../../src/world/lighting';
import { textureGenerators, texturePalettes } from '../../src/render/textures';
import { STAINED_GLASS_COLORS } from '../../src/render/textures/stained-glass';
import { FluidAnimationClock } from '../../src/render/fluid-animation';
import { TextureAtlas } from '../../src/render/atlas';
import { atlasTileIndex, buildSwayMasks, packedMaskHas } from '../../src/render/foliage';
import type { MeshBucketData } from '../../src/mesh/greedy';
import type { TextureData } from '../../src/render/textures/noise';

const registry = BlockRegistry.getInstance();
const tileOf = new Map<string, number>();
const resolver = (name: string) => {
  if (!tileOf.has(name)) tileOf.set(name, tileOf.size);
  return tileOf.get(name)!;
};
const tables = buildMeshLookupTables(registry, resolver);
const fastTables = buildMeshLookupTables(registry, resolver, { fastLeaves: true });
const STAINED = STAINED_GLASS_COLORS.map((c) => `${c}_stained_glass`);

const at = (x: number, y: number, z: number) => x + 18 * (y + 18 * z);
function cube(id: string, size: number, origin = 4): Uint16Array {
  const padded = new Uint16Array(PADDED_SECTION_VOLUME);
  const state = registry.getDefaultStateId(id)!;
  for (let x = 0; x < size; x++)
    for (let y = 0; y < size; y++)
      for (let z = 0; z < size; z++) padded[at(origin + x, origin + y, origin + z)] = state;
  return padded;
}
function decodeAll(bucket: MeshBucketData) {
  return Array.from({ length: bucket.vertices.length / 2 }, (_, v) =>
    decodeVertex(bucket.vertices[v * 2]!, bucket.vertices[v * 2 + 1]!),
  );
}
/** Every quad vertex lies on the cube's boundary along the quad's own normal axis. */
function onlyBoundaryFaces(bucket: MeshBucketData, lo: number, hi: number): boolean {
  return decodeAll(bucket).every((v) => {
    const coordinate = [v.x, v.x, v.y, v.y, v.z, v.z][v.normalIndex]!;
    return coordinate === lo || coordinate === hi;
  });
}
const meanAlpha = (tex: TextureData) => {
  let sum = 0;
  for (let i = 3; i < tex.length; i += 4) sum += tex[i]!;
  return sum / (tex.length / 4) / 255;
};

describe('M08c registry, items, loot and recipes', () => {
  it('registers eight stained glass colours as translucent non-opaque blocks with item, empty loot and a recipe', () => {
    expect(STAINED).toHaveLength(8);
    expect(new Set(STAINED).size).toBe(8);
    for (const id of STAINED) {
      const def = registry.getBlockDefinition(id)!;
      expect(def.renderLayer).toBe('translucent');
      expect(def.fullOpaqueCube).toBe(false);
      expect(def.textures).toMatchObject({ top: id, side: id, bottom: id });
      expect(items.get(id)).toMatchObject({ kind: 'block', block: id, maxStack: 64 });
      expect(blockLoot(id)).toEqual([]);
      const recipe = match([
        ['glass', 'glass', 'glass'],
        ['glass', 'wild_rose', 'glass'],
        ['glass', 'glass', 'glass'],
      ]);
      expect(recipe).not.toBeNull();
    }
  });

  it('crafts eight stained glass from eight glass and one colourant, each colour from a distinct colourant', () => {
    const colourants = [
      'wild_rose',
      'marigold',
      'buttercup',
      'cactus',
      'lumite_shard',
      'bluebell',
      'violet',
      'heather',
    ];
    const results = colourants.map((c) => {
      const recipe = match([
        ['glass', 'glass', 'glass'],
        ['glass', c, 'glass'],
        ['glass', 'glass', 'glass'],
      ]);
      expect(recipe).toMatchObject({ result: { count: 8 } });
      return recipe!.result.id;
    });
    expect(new Set(results)).toEqual(new Set(STAINED));
  });

  it('appends the stained glass states to the end of the saved state IDs without reordering', () => {
    const entries = Object.entries(savedStateIds as Record<string, number>);
    const newest = entries.sort((a, b) => b[1] - a[1]).slice(0, 8);
    expect(newest.map(([id]) => id).sort()).toEqual([...STAINED].sort());
    expect((savedStateIds as Record<string, number>)['air']).toBe(0);
    expect((savedStateIds as Record<string, number>)['glass']).toBe(29);
    expect((savedStateIds as Record<string, number>)['packed_ice']).toBe(51);
    for (const id of STAINED)
      expect(registry.getStateId(id)).toBe((savedStateIds as Record<string, number>)[id]);
  });

  it('keeps glass, ice and packed ice translucent and lets light through all but packed ice', () => {
    for (const id of ['glass', 'ice', 'packed_ice']) {
      const def = registry.getBlockDefinition(id)!;
      expect(def.renderLayer, id).toBe('translucent');
      expect(def.fullOpaqueCube, id).toBe(false);
    }
    const light = buildLightLookupTables(registry);
    for (const id of ['glass', 'ice', ...STAINED])
      expect(light.opacityTable[registry.getDefaultStateId(id)!], id).toBe(0);
    expect(light.opacityTable[registry.getDefaultStateId('packed_ice')!]).toBeGreaterThan(0);
    expect(light.opacityTable[registry.getDefaultStateId('packed_ice')!]).toBeLessThan(15);
  });
});

describe('M08c translucent textures', () => {
  it('glass is mostly clear, ice about 60 percent and packed ice about 90 percent opaque', () => {
    const glassTex = textureGenerators.glass!() as TextureData;
    let interior = 0;
    for (let y = 1; y < 15; y++)
      for (let x = 1; x < 15; x++) interior += glassTex[(y * 16 + x) * 4 + 3]! / 255;
    const glass = interior / (14 * 14);
    const ice = meanAlpha(textureGenerators.ice!() as TextureData);
    const packed = meanAlpha(textureGenerators.packed_ice!() as TextureData);
    expect(glass).toBeLessThan(0.15);
    expect(ice).toBeGreaterThan(0.5);
    expect(ice).toBeLessThan(0.7);
    expect(packed).toBeGreaterThan(0.85);
    expect(packed).toBeLessThan(0.95);
  });

  it('glass has a frame and only sparse streak pixels', () => {
    const tex = textureGenerators.glass!() as TextureData;
    let opaque = 0;
    for (let i = 3; i < tex.length; i += 4) if (tex[i]! > 100) opaque++;
    expect(opaque).toBeGreaterThanOrEqual(60 + 4);
    expect(opaque).toBeLessThan(60 + 12);
  });

  it('stained glass tiles are deterministic, seeded, within a four-colour palette and readable', () => {
    const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    for (const id of STAINED) {
      const generate = textureGenerators[id]!;
      expect(generate(5)).toEqual(generate(5));
      expect(generate(5)).not.toEqual(generate(6));
      const palette = texturePalettes[id]!;
      expect(palette.length).toBeLessThanOrEqual(12);
      const tex = generate() as TextureData;
      const allowed = new Set(palette.map((c) => c.join(',')));
      let min = 255;
      let max = 0;
      for (let i = 0; i < tex.length; i += 4) {
        expect(allowed.has([...tex.slice(i, i + 4)].join(','))).toBe(true);
        const l = lum(tex[i]!, tex[i + 1]!, tex[i + 2]!);
        min = Math.min(min, l);
        max = Math.max(max, l);
      }
      expect(max - min, id).toBeGreaterThanOrEqual(60);
      expect(meanAlpha(tex)).toBeGreaterThan(0.3);
      expect(meanAlpha(tex)).toBeLessThan(0.7);
    }
    const means = STAINED.map((id) => {
      const palette = texturePalettes[id]!;
      return palette[1]!.slice(0, 3).join(',');
    });
    expect(new Set(means).size).toBe(8);
  });

  it('packed ice keeps luminance contrast of at least 60 regardless of alpha', () => {
    const tex = textureGenerators.packed_ice!() as TextureData;
    let min = 255;
    let max = 0;
    for (let i = 0; i < tex.length; i += 4) {
      const l = 0.2126 * tex[i]! + 0.7152 * tex[i + 1]! + 0.0722 * tex[i + 2]!;
      min = Math.min(min, l);
      max = Math.max(max, l);
    }
    expect(max - min).toBeGreaterThanOrEqual(60);
  });
});

describe('M08c meshing', () => {
  it('hides faces between blocks of the same translucent type, so a glass block shows only its outer shell', () => {
    for (const id of ['glass', 'ice', 'packed_ice', 'red_stained_glass']) {
      const mesh = greedyMesh(cube(id, 3), tables);
      expect(mesh.translucent.quadCount, id).toBeGreaterThan(0);
      expect(mesh.opaque.quadCount, id).toBe(0);
      expect(onlyBoundaryFaces(mesh.translucent, 3, 6), id).toBe(true);
    }
  });

  it('keeps the shared face between two different translucent blocks', () => {
    const padded = new Uint16Array(PADDED_SECTION_VOLUME);
    padded[at(4, 4, 4)] = registry.getDefaultStateId('red_stained_glass')!;
    padded[at(5, 4, 4)] = registry.getDefaultStateId('blue_stained_glass')!;
    expect(greedyMesh(padded, tables).translucent.quadCount).toBe(12);
    padded[at(5, 4, 4)] = registry.getDefaultStateId('red_stained_glass')!;
    expect(greedyMesh(padded, tables).translucent.quadCount).toBe(6);
  });

  it('draws opaque neighbours of packed ice and glass against the translucent face', () => {
    const padded = new Uint16Array(PADDED_SECTION_VOLUME);
    padded[at(4, 4, 4)] = registry.getDefaultStateId('stone')!;
    padded[at(5, 4, 4)] = registry.getDefaultStateId('packed_ice')!;
    const mesh = greedyMesh(padded, tables);
    expect(mesh.opaque.quadCount).toBe(6);
    expect(mesh.translucent.quadCount).toBe(5);
  });

  it('fancy leaves draw every face; fast leaves are opaque cubes whose inner faces are hidden', () => {
    const fancy = greedyMesh(cube('oak_leaves', 3), tables);
    const fast = greedyMesh(cube('oak_leaves', 3), fastTables);
    // Fancy keeps the faces between leaves: three merged layers in each of the six directions.
    expect(fancy.cutout.quadCount).toBe(3 * 6);
    expect(onlyBoundaryFaces(fancy.cutout, 3, 6)).toBe(false);
    expect(fast.cutout.quadCount).toBe(6);
    expect(onlyBoundaryFaces(fast.cutout, 3, 6)).toBe(true);
  });

  it('fast leaves hide the face of a solid neighbour that touches them', () => {
    const padded = new Uint16Array(PADDED_SECTION_VOLUME);
    padded[at(4, 4, 4)] = registry.getDefaultStateId('stone')!;
    padded[at(5, 4, 4)] = registry.getDefaultStateId('oak_leaves')!;
    expect(greedyMesh(padded, tables).opaque.quadCount).toBe(6);
    expect(greedyMesh(padded, fastTables).opaque.quadCount).toBe(5);
  });

  it('leaves the other tables unchanged in fast mode', () => {
    const oak = registry.getDefaultStateId('oak_leaves')!;
    const stone = registry.getDefaultStateId('stone')!;
    expect(tables.isOpaqueCube[oak]).toBe(0);
    expect(fastTables.isOpaqueCube[oak]).toBe(1);
    expect(fastTables.isOpaqueCube[stone]).toBe(1);
    expect(fastTables.renderLayer[oak]).toBe(tables.renderLayer[oak]);
    expect(fastTables.tileIndices[oak * 6]).toBe(tables.tileIndices[oak * 6]);
  });
});

describe('M08c wind clock', () => {
  it('advances with time and holds when asked', () => {
    const clock = new FluidAnimationClock();
    expect(clock.sample(1000)).toBe(0);
    expect(clock.sample(1500)).toBeCloseTo(0.5);
    expect(clock.sample(2500, true)).toBeCloseTo(0.5);
    expect(clock.sample(3000)).toBeCloseTo(1);
    clock.setPaused(true, 3000);
    expect(clock.sample(4000)).toBeCloseTo(1);
  });
});

describe('M08c foliage uniforms', () => {
  const tiles = new Map<string, TextureData>();
  for (const [name, generate] of Object.entries(textureGenerators)) {
    if (!generate) continue;
    const result = generate();
    if (Array.isArray(result)) result.forEach((t, i) => tiles.set(`${name}_${i}`, t));
    else tiles.set(name, result);
  }
  const atlas = new TextureAtlas(tiles);

  it('packed uvec4 sway lookup answers like the flat uint[128] lookup for every atlas tile', () => {
    const { leaf, plant } = buildSwayMasks(registry, atlas);
    const flat = (mask: Uint32Array, tile: number) =>
      ((mask[tile >> 5]! >>> (tile & 31)) & 1) === 1;
    let leafTiles = 0;
    let plantTiles = 0;
    for (let tile = 0; tile < 4096; tile++) {
      expect(packedMaskHas(leaf, tile)).toBe(flat(leaf, tile));
      expect(packedMaskHas(plant, tile)).toBe(flat(plant, tile));
      if (packedMaskHas(leaf, tile)) leafTiles++;
      if (packedMaskHas(plant, tile)) plantTiles++;
    }
    expect(leafTiles).toBeGreaterThanOrEqual(5);
    expect(plantTiles).toBeGreaterThan(5);
    for (const id of ['oak_leaves', 'birch_leaves']) {
      const tile = atlasTileIndex(atlas, registry.getBlockDefinition(id)!.textures!.side!);
      expect(packedMaskHas(leaf, tile)).toBe(true);
      expect(packedMaskHas(plant, tile)).toBe(false);
    }
    const grass = atlasTileIndex(atlas, registry.getBlockDefinition('tall_grass')!.textures!.side!);
    expect(packedMaskHas(plant, grass)).toBe(true);
    expect(packedMaskHas(leaf, grass)).toBe(false);
  });

  it('keeps the sway masks within 64 vertex uniform vectors', () => {
    const { leaf, plant } = buildSwayMasks(registry, atlas);
    expect((leaf.length + plant.length) / 4).toBe(64);
  });
});
