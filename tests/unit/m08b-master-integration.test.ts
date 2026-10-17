import { expect, it } from 'vitest';
import slabs from '../../data/blocks/slabs.json';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { buildMeshLookupTables, greedyMesh } from '../../src/mesh/greedy';
import { decodeVertex } from '../../src/mesh/vertex';
import { textureGenerators } from '../../src/render/textures';

const registry = BlockRegistry.getInstance();
const tiles = new Map<string, number>();
const tables = buildMeshLookupTables(registry, (name) => {
  if (!tiles.has(name)) tiles.set(name, tiles.size);
  return tiles.get(name)!;
});
const cubes = ['rainwood_planks', 'acacia_planks', 'coarse_dirt', 'mud', 'lumite_block'];
const cases: Array<[string, 'bottom' | 'top' | undefined]> = [
  ...cubes.map((id): [string, undefined] => [id, undefined]),
  ...Object.keys(slabs).flatMap((id): Array<[string, 'bottom' | 'top']> => [
    [id, 'bottom'],
    [id, 'top'],
  ]),
];

it.each(cases)(
  'keeps master block %s (%s) geometry and texture payload intact beside water',
  (id, half) => {
    const state = half ? registry.getStateId(id, { half }) : registry.getDefaultStateId(id);
    expect(state).toBeDefined();
    const definition = registry.getBlockDefinition(id)!;
    const texture = definition.textures!.top!;
    expect(textureGenerators[texture]).toBeTypeOf('function');
    const blocks = new Uint16Array(18 ** 3);
    blocks[4 + 4 * 18 + 4 * 324] = state!;
    for (const water of [false, true]) {
      if (water) blocks[5 + 4 * 18 + 4 * 324] = registry.getDefaultStateId('water')!;
      const mesh = greedyMesh(blocks, tables);
      const solid = half ? mesh.models : mesh.opaque;
      expect(solid.quadCount).toBe(6);
      const vertices = Array.from({ length: solid.vertices.length / 2 }, (_, v) =>
        decodeVertex(solid.vertices[v * 2]!, solid.vertices[v * 2 + 1]!),
      );
      expect(Math.min(...vertices.map((p) => p.x))).toBe(3);
      expect(Math.max(...vertices.map((p) => p.x))).toBe(4);
      expect(Math.min(...vertices.map((p) => p.y))).toBe(half === 'top' ? 3.5 : 3);
      expect(Math.max(...vertices.map((p) => p.y))).toBe(half === 'bottom' ? 3.5 : 4);
      expect(new Set(vertices.map((p) => p.normalIndex)).size).toBe(6);
      expect(vertices.every((p) => p.tintIndex < 4 && p.tileIndex === tiles.get(texture))).toBe(
        true,
      );
      expect(mesh.translucent.quadCount > 0).toBe(water);
    }
  },
);
