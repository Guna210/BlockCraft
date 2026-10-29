import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createHollowdeepPipeline,
  HOLLOWDEEP_ENVIRONMENT,
  HOLLOWDEEP_BIOME_IDS,
} from '../../src/gen/hollowdeep';
import { createDefaultPipeline } from '../../src/gen/pipeline';
import { EMITTER_TINTS } from '../../src/render/light-curve';
import {
  hollowdeepTextureGenerators,
  HOLLOWDEEP_PALETTES,
} from '../../src/render/textures/hollowdeep';
import { textureGenerators } from '../../src/render/textures';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { ChunkColumn } from '../../src/world/column';
import { blockLoot } from '../../src/gameplay/loot';
import { items } from '../../src/gameplay/items';
import { buildIconSheet } from '../../src/ui/icons';
import ids from '../../data/block-state-ids.json';

const names = [
  'duskrock',
  'driftstone',
  'glowcap_stem',
  'glowcap',
  'glowcap_gills',
  'veilroot',
  'voidglass',
  'emberite',
];
const registry = BlockRegistry.getInstance();
const id = (name: string): number => registry.getStateId(name)!;
function generate(seed: number, cx: number, cz: number): ChunkColumn {
  const column = new ChunkColumn(cx, cz);
  createHollowdeepPipeline().generateColumn(seed, cx, cz, column);
  return column;
}
function snapshot(column: ChunkColumn): Uint16Array {
  const result = new Uint16Array(256 * 193);
  for (let y = 0; y <= 192; y++)
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) result[y * 256 + z * 16 + x] = column.getBlockStateId(x, y, z);
  return result;
}

describe('M20b Hollowdeep', () => {
  it('is deterministic across seed interleaving, pipeline instances and column order', () => {
    const a = generate(927, -1, 0);
    const b = generate(927, 0, 0);
    generate(128, 9, -7);
    expect(snapshot(generate(927, 0, 0))).toEqual(snapshot(b));
    const again = generate(927, -1, 0);
    expect(snapshot(again)).toEqual(snapshot(a));
    expect(again.biomes).toEqual(a.biomes);
    expect(again.biomeIndices).toEqual(a.biomeIndices);
    for (let i = 0; i < 256; i++)
      expect(HOLLOWDEEP_BIOME_IDS[again.biomeIndices[i]!]).toBe(again.biomes[i]);
    expect(snapshot(generate(928, -1, 0))).not.toEqual(snapshot(a));
  });

  it('seals the floor and ceiling, keeps foundation at y 0–4, and leaves large open caverns', () => {
    let air = 0;
    for (const [cx, cz] of [
      [0, 0],
      [-2, 3],
      [17, -19],
    ]) {
      const column = generate(42, cx!, cz!);
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          for (let y = 0; y <= 4; y++)
            expect(column.getBlockStateId(x, y, z)).toBe(id('foundation_stone'));
          expect(column.getBlockStateId(x, 5, z)).not.toBe(0);
          expect(column.getBlockStateId(x, 192, z)).toBe(id('duskrock'));
          expect(column.getBlockStateId(x, 193, z)).toBe(0);
          for (let y = 50; y < 150; y++) if (column.getBlockStateId(x, y, z) === 0) air++;
        }
    }
    expect(air).toBeGreaterThan(256 * 3 * 80);
  });

  it('has sea surfaces exactly at y 40 and ceiling falls, islands, forests, vines and hollow geodes', () => {
    const counts = new Map<number, number>();
    let sea = 0;
    let falls = 0;
    let floating = 0;
    let geodeCore = 0;
    for (let cz = -8; cz < 8; cz++)
      for (let cx = -8; cx < 8; cx++) {
        const column = generate(42, cx, cz);
        for (let z = 0; z < 16; z++)
          for (let x = 0; x < 16; x++) {
            if (
              column.getBlockStateId(x, 40, z) === id('lava') &&
              column.getBlockStateId(x, 41, z) === 0
            )
              sea++;
            if (column.getBlockStateId(x, 150, z) === id('lava')) falls++;
            for (let y = 5; y < 192; y++) {
              const state = column.getBlockStateId(x, y, z);
              counts.set(state, (counts.get(state) ?? 0) + 1);
              if (state === id('driftstone') && column.getBlockStateId(x, y - 1, z) === 0)
                floating++;
              if (state === id('voidglass') && column.getBlockStateId(x, y + 1, z) === 0)
                geodeCore++;
            }
          }
      }
    expect(sea).toBeGreaterThan(1000);
    expect(falls).toBeGreaterThan(0);
    expect(floating).toBeGreaterThan(100);
    expect(geodeCore).toBeGreaterThan(0);
    for (const name of names) expect(counts.get(id(name)), name).toBeGreaterThan(0);
  });

  it('Skyshard never generates in the Overworld; appears at the Appendix A rate in the Hollowdeep', () => {
    const overworld = createDefaultPipeline();
    const hollowdeep = createHollowdeepPipeline();
    const hosts = new Set(
      ['duskrock', 'driftstone', 'emberite', 'voidglass', 'skyshard_ore'].map(id),
    );
    let ore = 0;
    let solid = 0;
    let highOre = 0;
    for (let i = 0; i < 1024; i++) {
      const cx = (i % 32) * 7 - 112;
      const cz = Math.floor(i / 32) * 7 - 112;
      const column = new ChunkColumn(cx, cz);
      hollowdeep.generateColumn(1301 + (i % 4), cx, cz, column);
      for (let y = 5; y < 192; y++)
        for (let z = 0; z < 16; z++)
          for (let x = 0; x < 16; x++) {
            const state = column.getBlockStateId(x, y, z);
            if (hosts.has(state)) solid++;
            if (state === id('skyshard_ore')) {
              ore++;
              if (y > 60) highOre++;
            }
          }
      if (i < 16) {
        const over = new ChunkColumn(cx, cz);
        overworld.generateColumn(1301 + (i % 4), cx, cz, over);
        for (let sy = 0; sy < ChunkColumn.SECTION_COUNT; sy++)
          expect(over.getSection(sy)?.getPalette() ?? []).not.toContain(id('skyshard_ore'));
      }
    }
    const rate = (ore * 1_000_000) / solid;
    mkdirSync('artifacts/M20b', { recursive: true });
    writeFileSync(
      'artifacts/M20b/ore-rate.json',
      JSON.stringify({ columns: 1024, solid, ore, highOre, perMillion: rate }),
    );
    process.stdout.write(
      'M20b Skyshard ' +
        JSON.stringify({ columns: 1024, solid, ore, highOre, perMillion: rate }) +
        '\n',
    );
    expect(solid).toBeGreaterThan(10_000_000);
    expect(rate).toBeGreaterThanOrEqual(20);
    expect(rate).toBeLessThanOrEqual(30);
    expect(highOre).toBeGreaterThan(0);
  }, 60_000);

  it('registers append-only blocks with textures, palettes, icons, light and loot', () => {
    const sheet = buildIconSheet((name) => {
      const t = textureGenerators[name]?.(42);
      return Array.isArray(t) ? t[0] : t;
    }, new Uint8Array(1024));
    for (const [i, name] of names.entries()) {
      expect((ids as Record<string, number>)[name]).toBe(825 + i);
      expect(id(name)).toBe(825 + i);
      expect(items.get(name).block).toBe(name);
      expect(sheet.rects.has(name)).toBe(true);
      expect(blockLoot(name)).toEqual([{ id: name, count: 1 }]);
      const tile = hollowdeepTextureGenerators[name]!(42);
      expect(tile).toEqual(hollowdeepTextureGenerators[name]!(42));
      const palette = HOLLOWDEEP_PALETTES[name]!;
      expect(palette.length).toBeLessThanOrEqual(12);
      const colors = new Set(palette.map((c) => c.join(',')));
      for (let p = 0; p < tile.length; p += 4)
        expect(colors.has(Array.from(tile.subarray(p, p + 4)).join(','))).toBe(true);
      if (registry.getBlockDefinition(name)!.fullOpaqueCube) {
        const luminances = [];
        for (let p = 0; p < tile.length; p += 4)
          luminances.push(tile[p]! * 0.2126 + tile[p + 1]! * 0.7152 + tile[p + 2]! * 0.0722);
        expect(Math.max(...luminances) - Math.min(...luminances), name).toBeGreaterThanOrEqual(60);
      }
    }
    expect(registry.getBlockDefinition('voidglass')?.renderLayer).toBe('translucent');
    for (const name of ['glowcap', 'glowcap_gills']) {
      expect(registry.getBlockDefinition(name)?.lightEmission).toBe(9);
      expect(EMITTER_TINTS[name]).toEqual([0.55, 1, 0.8]);
    }
    expect(HOLLOWDEEP_ENVIRONMENT.skyLight).toBe(0);
    expect(HOLLOWDEEP_ENVIRONMENT.lavaFlowTickRate).toBe(10);
    expect(HOLLOWDEEP_ENVIRONMENT.spores.particlesPerSecond).toBeGreaterThan(0);
  });

  it('measures generation cost alongside the unchanged Overworld pipeline', () => {
    const run = (pipeline: ReturnType<typeof createHollowdeepPipeline>): number => {
      for (let i = 0; i < 4; i++) pipeline.generateColumn(42, i, 1, new ChunkColumn(i, 1));
      const start = performance.now();
      for (let i = 0; i < 48; i++)
        pipeline.generateColumn(42, i - 24, 3, new ChunkColumn(i - 24, 3));
      return (performance.now() - start) / 48;
    };
    const hollowdeepMs = run(createHollowdeepPipeline());
    const overworldMs = run(createDefaultPipeline());
    mkdirSync('artifacts/M20b', { recursive: true });
    writeFileSync(
      'artifacts/M20b/generation-cost.json',
      JSON.stringify({ hollowdeepMs, overworldMs, ratio: hollowdeepMs / overworldMs, columns: 48 }),
    );
    process.stdout.write(
      'M20b generation ms/column ' +
        JSON.stringify({
          hollowdeepMs,
          overworldMs,
          ratio: hollowdeepMs / overworldMs,
          columns: 48,
        }) +
        '\n',
    );
    expect(Number.isFinite(hollowdeepMs)).toBe(true);
  });
});
