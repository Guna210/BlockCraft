import { describe, expect, it } from 'vitest';
import { World } from '../../src/world/world';
import { BlockCollision } from '../../src/entity/physics';
import { Player } from '../../src/entity/player';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { buildLightLookupTables } from '../../src/world/lighting';
import { buildMeshLookupTables, greedyMesh } from '../../src/mesh/greedy';
import { decodeVertex } from '../../src/mesh/vertex';
import { genLadder, genVine, PAL_LADDER, PAL_VINE } from '../../src/render/textures/climbing';

function scene() {
  const world = new World(false);
  world.fill(-5, 64, -5, 35, 64, 5, 'stone');
  const collision = new BlockCollision(world);
  const player = new Player(collision, () => true);
  player.teleport(0.5, 65, 0.5, 0, 0);
  return { world, collision, player };
}
function ticks(player: Player, count: number) {
  for (let i = 0; i < count; i++) player.tick();
}

describe('M06b water movement', () => {
  it('swims upward in a few ticks, limits sinking to 2 and horizontal swim to 2/3', () => {
    const { world, player } = scene();
    world.fill(-5, 65, -5, 35, 85, 5, 'water');
    player.teleport(0.5, 70, 0.5);
    player.input('jump', true);
    ticks(player, 4);
    expect(player.inFluid).toBe('water');
    expect(player.pos[1]).toBeGreaterThan(70.3);
    ticks(player, 10);
    expect(player.vel[1]).toBeCloseTo(3);
    player.input('jump', false);
    player.input('forward', true);
    ticks(player, 40);
    expect(player.vel[1]).toBeCloseTo(-2);
    expect(player.vel[0]).toBeCloseTo(2);
    player.input('sprint', true);
    ticks(player, 5);
    expect(player.vel[0]).toBeCloseTo(3);
    player.input('forward', false);
    ticks(player, 2);
    expect(player.vel[0]).toBe(0);
  });
  it('bobs at the surface with jump held and climbs out onto a one-block bank', () => {
    const { world, player } = scene();
    world.fill(-4, 65, -4, 5, 69, 4, 'water');
    player.teleport(0.5, 68, 0.5);
    player.input('jump', true);
    ticks(player, 40);
    expect(player.pos[1]).toBeCloseTo(69.5);
    expect(player.inFluid).toBe('water');
    const bobSamples = [];
    for (let i = 0; i < 20; i++) {
      player.tick();
      bobSamples.push(player.pos[1]);
    }
    expect(Math.max(...bobSamples)).toBeLessThan(69.55);
    expect(Math.min(...bobSamples)).toBeGreaterThan(69.45);
    expect(Math.max(...bobSamples) - Math.min(...bobSamples)).toBeGreaterThan(0.07);
    world.fill(2, 65, -4, 35, 70, 4, 'stone');
    player.input('forward', true);
    ticks(player, 35);
    player.input('jump', false);
    ticks(player, 10);
    expect(player.pos[0]).toBeGreaterThan(2.3);
    expect(player.pos[1]).toBe(71);
    expect(player.inFluid).toBeNull();
    expect(player.health).toBe(20);
  });
});

describe('M06b climb and Mire', () => {
  for (const block of ['ladder', 'vine'])
    for (const facing of ['north', 'south', 'east', 'west']) {
      it(`${block} ${facing} climbs into its wall, caps descent, sneaks and resets fall damage`, () => {
        const { world, player, collision } = scene();
        for (let y = 65; y <= 85; y++) world.setBlock(0, y, 0, block, { facing });
        const yaw =
          facing === 'north'
            ? Math.PI / 2
            : facing === 'south'
              ? -Math.PI / 2
              : facing === 'east'
                ? Math.PI
                : 0;
        const wx = facing === 'east' ? -1 : facing === 'west' ? 1 : 0;
        const wz = facing === 'north' ? 1 : facing === 'south' ? -1 : 0;
        world.fill(wx, 65, wz, wx, 85, wz, 'stone');
        expect(collision.free(0.5, 65, 0.5, 1.8)).toBe(true);
        player.teleport(0.5, 72, 0.5, yaw);
        player.input('forward', true);
        ticks(player, 20);
        expect(player.pos[1]).toBeCloseTo(74.35);
        player.input('forward', false);
        ticks(player, 10);
        const start = player.pos[1];
        ticks(player, 20);
        expect(start - player.pos[1]).toBeCloseTo(2.35);
        expect(player.vel[1]).toBeCloseTo(-2.35);
        player.input('sneak', true);
        const hold = player.pos[1];
        ticks(player, 20);
        expect(player.pos[1]).toBe(hold);
        player.input('jump', true);
        ticks(player, 5);
        expect(player.pos[1]).toBe(hold);
        player.input('sneak', false);
        ticks(player, 10);
        expect(player.pos[1]).toBeCloseTo(hold + 1.175);
        player.input('jump', false);
        ticks(player, 140);
        expect(player.health).toBe(20);
      });
    }
  it('Mire keeps solid collision and multiplies ground distance by 0.4', () => {
    const normal = scene(),
      mire = scene();
    mire.world.fill(-5, 64, -5, 35, 64, 5, 'mire');
    normal.player.input('forward', true);
    mire.player.input('forward', true);
    ticks(normal.player, 100);
    ticks(mire.player, 100);
    const ratio = (mire.player.pos[0] - 0.5) / (normal.player.pos[0] - 0.5);
    expect(ratio).toBeGreaterThan(0.39);
    expect(ratio).toBeLessThan(0.41);
    expect(mire.player.pos[1]).toBe(65);
    expect(mire.player.onGround).toBe(true);
  });
});

describe('M06b block models and art', () => {
  it('four facing states emit one thin two-sided face, foliage tint and zero light opacity', () => {
    const registry = BlockRegistry.getInstance();
    const light = buildLightLookupTables(registry);
    const tables = buildMeshLookupTables(registry, () => 0);
    const { world, collision } = scene();
    for (const block of ['ladder', 'vine'])
      for (const facing of ['north', 'south', 'east', 'west']) {
        world.setBlock(0, 65, 0, block, { facing });
        const state = world.getBlockStateId(0, 65, 0);
        expect(light.opacityTable[state]).toBe(0);
        expect(collision.free(0.5, 65, 0.5, 1.8)).toBe(true);
        const padded = new Uint16Array(18 ** 3);
        padded[1 + 18 + 18 * 18] = state;
        const mesh = greedyMesh(padded, tables);
        expect(mesh.opaque.quadCount).toBe(0);
        expect(mesh.cutout.quadCount).toBe(0);
        expect(mesh.models.quadCount).toBe(2);
        const axis = facing === 'north' || facing === 'south' ? 'z' : 'x';
        const plane = facing === 'north' || facing === 'west' ? 31 / 32 : 1 / 32;
        for (let i = 0; i < mesh.models.vertices.length; i += 2) {
          const vertex = decodeVertex(mesh.models.vertices[i]!, mesh.models.vertices[i + 1]!);
          expect(vertex[axis]).toBe(plane);
          expect(vertex.tintIndex).toBe(block === 'vine' ? 2 : 0);
        }
      }
    expect(light.opacityTable[registry.getDefaultStateId('water')!]).toBe(1);
  });
  it('uses declared palettes, deterministic clusters and visible contrast for ladder/vine', () => {
    for (const [gen, palette] of [
      [genLadder, PAL_LADDER],
      [genVine, PAL_VINE],
    ] as const) {
      const tile = gen(42);
      expect(tile).toEqual(gen(42));
      expect(palette.length).toBeLessThanOrEqual(12);
      const colors = palette.map((c) => c.join(','));
      const lumas: number[] = [];
      for (let i = 0; i < tile.length; i += 4) {
        expect(colors).toContain(Array.from(tile.slice(i, i + 4)).join(','));
        if (tile[i + 3])
          lumas.push(tile[i]! * 0.2126 + tile[i + 1]! * 0.7152 + tile[i + 2]! * 0.0722);
      }
      expect(Math.max(...lumas) - Math.min(...lumas)).toBeGreaterThanOrEqual(60);
      expect(lumas.length).toBeGreaterThan(50);
      expect(lumas.length).toBeLessThan(230);
    }
  });
});
