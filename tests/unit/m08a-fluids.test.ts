import { sampleBiome } from '../../src/gen/biomes';
import savedStateIds from '../../data/block-state-ids.json';
import { describe, it, expect, vi } from 'vitest';
import { World } from '../../src/world/world';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { hashString } from '../../src/engine/rng';
import { blockLoot } from '../../src/gameplay/loot';
import { items } from '../../src/gameplay/items';
import { canHarvest } from '../../src/gameplay/mining';
import { genBlackglass, PAL_BLACKGLASS } from '../../src/render/textures/blackglass';

const advance = (w: World, n: number) => {
  for (let i = 0; i < n; i++) w.tick();
};
function plane() {
  const w = new World(false);
  w.fill(-12, 63, -12, 12, 63, 12, 'stone');
  return w;
}
function settle(w: World, limit = 1000) {
  let n = 0;
  while (w.ticks.count && n++ < limit) w.tick();
  expect(w.ticks.count, `did not settle within ${limit} ticks`).toBe(0);
}

describe('M08a fluid simulation', () => {
  it('source on a flat plane settles to exactly the Manhattan-7 diamond', () => {
    const w = plane();
    w.setBlock(0, 64, 0, 'water');
    settle(w);
    let count = 0;
    for (let x = -9; x <= 9; x++)
      for (let z = -9; z <= 9; z++) {
        const distance = Math.abs(x) + Math.abs(z),
          b = w.getBlock(x, 64, z);
        expect(b.id, `${x},${z}`).toBe(distance <= 7 ? 'water' : 'air');
        if (distance <= 7) {
          count++;
          expect(b.state).toEqual({ level: String(distance), falling: 'false' });
        }
      }
    expect(count).toBe(113);
  });
  it('two sources make a new source in a 2×1 channel over solid or source water', () => {
    for (const floor of ['stone', 'water']) {
      const w = plane();
      w.fill(-1, 64, -1, 3, 64, 1, 'stone');
      w.fill(0, 64, 0, 2, 64, 0, 'air');
      if (floor === 'water') w.fill(0, 63, 0, 2, 63, 0, 'water');
      w.setBlock(0, 64, 0, 'water');
      w.setBlock(2, 64, 0, 'water');
      settle(w);
      expect(w.getBlock(1, 64, 0)).toEqual({
        id: 'water',
        state: { level: '0', falling: 'false' },
      });
    }
  });
  it.each([
    ['flowing lava touching water', '1', false, 'cobblestone'],
    ['lava source touched by water', '0', false, 'blackglass'],
    ['water flowing onto a lava source from above', '0', true, 'blackglass'],
  ])('%s', (_name, level, above, product) => {
    const w = plane();
    w.setBlock(0, 64, 0, 'lava', { level });
    w.setBlock(
      above ? 0 : 1,
      above ? 65 : 64,
      0,
      'water',
      above ? { level: '0', falling: 'true' } : undefined,
    );
    advance(w, 5);
    expect(w.getBlock(0, 64, 0).id).toBe(product);
  });
  it('removing the only source recedes every dependent flowing cell to air', () => {
    const w = plane();
    w.setBlock(0, 64, 0, 'water');
    settle(w);
    w.setBlock(0, 64, 0, 'air');
    settle(w);
    for (let x = -9; x <= 9; x++)
      for (let z = -9; z <= 9; z++) expect(w.getBlock(x, 64, z).id).toBe('air');
  });
  it('water waits five ticks and lava waits thirty; lava never creates infinite sources', () => {
    for (const [kind, delay] of [
      ['water', 5],
      ['lava', 30],
    ] as const) {
      const w = plane();
      w.setBlock(0, 64, 0, kind);
      advance(w, delay - 1);
      expect(w.getBlock(1, 64, 0).id).toBe('air');
      advance(w, 1);
      expect(w.getBlock(1, 64, 0)).toEqual({ id: kind, state: { level: '1', falling: 'false' } });
    }
    const w = plane();
    w.fill(-1, 64, -1, 3, 64, 1, 'stone');
    w.fill(0, 64, 0, 2, 64, 0, 'air');
    w.setBlock(0, 64, 0, 'lava');
    w.setBlock(2, 64, 0, 'lava');
    settle(w);
    expect(w.getBlock(1, 64, 0)).toEqual({ id: 'lava', state: { level: '1', falling: 'false' } });
  });
  it('prefers a drop four blocks ahead and treats unloaded terrain as a closed boundary', () => {
    const w = plane();
    w.setBlock(4, 63, 0, 'air');
    w.setBlock(0, 64, 0, 'water');
    advance(w, 5);
    expect(w.getBlock(1, 64, 0).id).toBe('water');
    for (const [x, z] of [
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      expect(w.getBlock(x!, 64, z!).id).toBe('air');
    advance(w, 25);
    expect(w.getBlock(4, 62, 0).id).toBe('water');
    const edge = new World(false);
    edge.fill(0, 63, 0, 15, 63, 15, 'stone');
    edge.setBlock(0, 64, 0, 'water');
    settle(edge);
    expect(edge.hasColumn(-1, 0)).toBe(false);
    expect(edge.hasColumn(0, -1)).toBe(false);
  });
  it('a falling column reaches ground and recedes after source removal', () => {
    const w = plane();
    w.fill(0, 64, 0, 0, 73, 0, 'stone');
    w.setBlock(0, 74, 0, 'water');
    advance(w, 60);
    for (let y = 64; y < 74; y++)
      expect(w.getBlock(1, y, 0)).toEqual({ id: 'water', state: { level: '0', falling: 'true' } });
    w.setBlock(0, 74, 0, 'air');
    settle(w, 2000);
    for (let y = 64; y <= 74; y++) expect(w.getBlock(1, y, 0).id).toBe('air');
  });
  it('terrain generation and stream-in of an ocean schedule zero fluid ticks', () => {
    const w = new World(false),
      pipeline = createDefaultPipeline(),
      seed = hashString('blockcraft-test-seed-42');
    w.worldSeed = seed;
    let ocean: { cx: number; cz: number } | undefined;
    for (let cx = -64; cx <= 64 && !ocean; cx += 4)
      for (let cz = -64; cz <= 64 && !ocean; cz += 4) {
        if (sampleBiome(seed, cx * 16, cz * 16).includes('ocean')) ocean = { cx, cz };
      }
    expect(ocean).toBeDefined();
    const { cx, cz } = ocean!;
    const load = () => pipeline.generateColumn(seed, cx, cz, w.getColumn(cx, cz, true)!);
    load();
    expect(w.getBiome(cx * 16, cz * 16)).toContain('ocean');
    expect(w.getBlock(cx * 16, 64, cz * 16)).toEqual({
      id: 'water',
      state: { level: '0', falling: 'false' },
    });
    expect(w.ticks.count).toBe(0);
    advance(w, 100);
    expect(w.ticks.count).toBe(0);
    w.removeColumn(cx, cz);
    load();
    expect(w.ticks.count).toBe(0);
    w.setBlock(cx * 16, 63, cz * 16, 'air');
    expect(w.ticks.count).toBeGreaterThan(0);
  });
  it('keeps every recorded state ID unique and resolvable, including legacy sources', () => {
    const registry = BlockRegistry.getInstance();
    expect(new Set(Object.values(savedStateIds)).size).toBe(Object.keys(savedStateIds).length);
    for (const [key, id] of Object.entries(savedStateIds)) {
      const s = registry.getResolvedState(id)!;
      const keys = Object.keys(s.properties).sort();
      expect(
        s.blockId +
          (keys.length ? '[' + keys.map((k) => k + '=' + s.properties[k]).join(',') + ']' : ''),
      ).toBe(key);
    }
    expect(registry.getDefaultStateId('foundation_stone')).toBe(28);
  });
  it('default fluids are sources, every lava state emits 15, and writes use world edit and lighting paths', () => {
    const registry = BlockRegistry.getInstance();
    for (const kind of ['water', 'lava'])
      expect(registry.getResolvedState(registry.getDefaultStateId(kind)!)!.properties).toEqual({
        level: '0',
        falling: 'false',
      });
    for (const id of registry.getAllStateIds()) {
      const s = registry.getResolvedState(id)!;
      if (s.blockId === 'lava') expect(s.definition.lightEmission).toBe(15);
    }
    const w = plane(),
      edited = vi.fn();
    w.onBlockEdited = edited;
    w.setBlock(0, 64, 0, 'water');
    edited.mockClear();
    advance(w, 5);
    expect(edited).toHaveBeenCalledWith(1, 64, 0, registry.getStateId('water', { level: '1' }));
    const lit = new World();
    lit.setBlock(0, 64, 0, 'lava', { level: '7', falling: 'true' });
    expect(lit.getLight(0, 64, 0).block).toBe(15);
  });
  it('Blackglass uses Appendix A properties, harvests only with tier 3 and drops itself; art is seeded', () => {
    const def = BlockRegistry.getInstance().getBlockDefinition('blackglass')!;
    expect(def).toMatchObject({ hardness: 50, blastResistance: 1200, tool: 'pickaxe', minTier: 3 });
    expect(canHarvest(def, items.get('wooden_pickaxe')?.tool)).toBe(false);
    expect(canHarvest(def, items.get('iron_pickaxe')?.tool)).toBe(true);
    expect(blockLoot('blackglass')).toEqual([{ id: 'blackglass', count: 1 }]);
    const art = genBlackglass(1);
    expect(art).toEqual(genBlackglass(1));
    expect(art).not.toEqual(genBlackglass(2));
    const palette = new Set(PAL_BLACKGLASS.map((c) => c.join(',')));
    for (let i = 0; i < art.length; i += 4)
      expect(palette.has([...art.slice(i, i + 4)].join(','))).toBe(true);
  });
});
