import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { World } from '../../src/world/world';
import { ChunkColumn } from '../../src/world/column';
import { TerrainPipeline, createDefaultPipeline } from '../../src/gen/pipeline';
import {
  MOUNTAIN_BIOMES,
  ORE_SPECS,
  OVERWORLD_ORE_IDS,
  VEIN_MAX_REACH,
  buildVein,
  createVeinCells,
  getBandSeed,
  triangular,
  veinAttempts,
  veinOrigin,
  VeinOrigin,
} from '../../src/gen/ores';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { hashString, deriveSeed } from '../../src/engine/rng';
import { setWorldInstance } from '../../src/world/world-instance';
import { locate } from '../../src/debug/api/locate';
import { ORE_LOCATE_RADIUS_CHUNKS } from '../../src/debug/api/ore-locate';
import { generate } from './helpers/world-samples';

// M03e — Overworld ores. Criteria owned: ore counts per 1,000,000 underground blocks within ±25 %
// of SPEC Appendix A.4, and no ore above its maximum height. The counting rule is in
// decisions/M03e-ore-counting.md.

const SEEDS = ['blockcraft-test-seed-42', 'blockcraft-alt-seed-7'];
const STANDARD = SEEDS[0]!;

// Appendix A.4, written out independently of the stage's own table.
const TARGET: Record<string, number> = {
  coal_ore: 1200,
  copper_ore: 700,
  iron_ore: 800,
  gold_ore: 90,
  lumite_ore: 60,
};
const MAX_Y: Record<string, number> = {
  coal_ore: 192,
  copper_ore: 112,
  iron_ore: 256,
  gold_ore: 32,
  lumite_ore: 40,
};
const MIN_TIER: Record<string, number> = {
  coal_ore: 0,
  copper_ore: 1,
  iron_ore: 1,
  gold_ore: 3,
  lumite_ore: 2,
  skyshard_ore: 3,
};
const ALL_ORES = [...OVERWORLD_ORE_IDS, 'skyshard_ore'];

// Sample: GRID x GRID columns spread over the 2048 x 2048 window around the origin, one column in
// every STRIDE x STRIDE chunks. Columns are generated independently of one another, so this is a
// fair sample of the whole window (ocean, plains, mountains) rather than of one neighbourhood.
const GRID = 32;
const STRIDE = 4;
const UNDER_MIN_Y = 5;
const UNDER_MAX_Y = 100;

interface SeedStats {
  columns: number;
  underground: number;
  count: Record<string, number>; // ore blocks inside the underground set
  exposed: Record<string, number>; // ... of which touch air inside their column
  anyCount: Record<string, number>; // ore blocks anywhere (any height)
  maxY: Record<string, number>;
  aboveSurface: number; // ore blocks at or above their column's surface
  ironAbove80Outside: number; // iron above y 80 in a column of a non-mountain biome
  ironMountainWindow: number; // iron at y 80-100 in mountain columns (part of the iron count)
  mountainUnderground: number; // underground blocks at y 80-100 in mountain columns
  ironAbove80: number;
  mountainBandUnderground: number; // underground blocks at y 80-255 in mountain columns
  mountainBandIron: number; // iron among them
  groups: Array<{ under: number; count: Record<string, number> }>; // 16 sub-areas, for the error estimate
  genMs: number;
}

function emptyRecord(): Record<string, number> {
  const r: Record<string, number> = {};
  for (const id of ALL_ORES) r[id] = 0;
  return r;
}

let registry: BlockRegistry;
let oreIndex: Int8Array; // state id -> index in ALL_ORES, or -1
let openState: Uint8Array;
let airState = 0;
let stoneState = 0;
const stats = new Map<string, SeedStats>();

// 12 x 12 columns around the origin of the standard seed, with and without the ore stage
let withOres: World;
let withoutOres: World;
const AREA_C0 = -6;
const AREA_SIZE = 12;

function stagePipeline(skip: string[]): TerrainPipeline {
  const p = new TerrainPipeline();
  for (const stage of createDefaultPipeline().getStages()) {
    if (!skip.includes(stage.name)) p.addStage(stage);
  }
  return p;
}

const colBuf = new Uint16Array(320 * 256); // index y * 256 + z * 16 + x
function fillBuffer(col: ChunkColumn): void {
  const sec = new Uint16Array(4096);
  colBuf.fill(0);
  for (let sy = 0; sy < ChunkColumn.SECTION_COUNT; sy++) {
    const s = col.getSection(sy);
    if (!s) continue;
    s.copyBlockStatesTo(sec);
    colBuf.set(sec, sy * 4096);
  }
}

function analyse(col: ChunkColumn, acc: SeedStats, group: number): void {
  fillBuffer(col);
  const g = acc.groups[group]!;
  for (let i = 0; i < 256; i++) {
    let top = -1;
    for (let y = 319; y >= 0; y--) {
      if (openState[colBuf[y * 256 + i]!] === 0) {
        top = y;
        break;
      }
    }
    const mountain = MOUNTAIN_BIOMES.includes(col.biomes[i]!);
    const x = i & 15;
    const z = i >> 4;
    for (let y = 0; y < 320; y++) {
      const st = colBuf[y * 256 + i]!;
      const oi = oreIndex[st]!;
      const underground = y >= UNDER_MIN_Y && y <= UNDER_MAX_Y && y < top && openState[st] === 0;
      if (underground) {
        acc.underground++;
        g.under++;
        if (mountain && y >= 80) acc.mountainUnderground++;
      }
      if (mountain && y >= 80 && y < top && openState[st] === 0) {
        acc.mountainBandUnderground++;
        if (oi >= 0 && ALL_ORES[oi] === 'iron_ore') acc.mountainBandIron++;
      }
      if (oi < 0) continue;
      const id = ALL_ORES[oi]!;
      acc.anyCount[id]!++;
      if (y > acc.maxY[id]!) acc.maxY[id] = y;
      if (y >= top) acc.aboveSurface++;
      if (id === 'iron_ore' && y > 80) {
        acc.ironAbove80++;
        if (!mountain) acc.ironAbove80Outside++;
      }
      if (!underground) continue;
      acc.count[id]!++;
      g.count[id] = (g.count[id] ?? 0) + 1;
      if (id === 'iron_ore' && mountain && y >= 80) acc.ironMountainWindow++;
      const air = (nx: number, ny: number, nz: number): boolean =>
        nx >= 0 && nx < 16 && nz >= 0 && nz < 16 && colBuf[ny * 256 + nz * 16 + nx] === airState;
      if (
        air(x + 1, y, z) ||
        air(x - 1, y, z) ||
        air(x, y + 1, z) ||
        air(x, y - 1, z) ||
        air(x, y, z + 1) ||
        air(x, y, z - 1)
      ) {
        acc.exposed[id]!++;
      }
    }
  }
}

beforeAll(() => {
  registry = BlockRegistry.getInstance();
  oreIndex = new Int8Array(registry.getMaxStateId() + 1).fill(-1);
  openState = new Uint8Array(registry.getMaxStateId() + 1);
  for (const st of registry.getAllStateIds()) {
    const id = registry.getResolvedState(st)!.blockId;
    const oi = ALL_ORES.indexOf(id);
    if (oi >= 0) oreIndex[st] = oi;
    if (id === 'air' || id === 'water' || id === 'lava') openState[st] = 1;
  }
  airState = registry.getStateId('air')!;
  stoneState = registry.getStateId('stone')!;

  // Every default stage except the features: ore positions are the same with or without them
  // (they only replace air), and cave mushrooms then cannot enter the block counts.
  const pipeline = stagePipeline(['features']);
  for (const seedStr of SEEDS) {
    const seed = hashString(seedStr);
    const acc: SeedStats = {
      columns: GRID * GRID,
      underground: 0,
      count: emptyRecord(),
      exposed: emptyRecord(),
      anyCount: emptyRecord(),
      maxY: emptyRecord(),
      aboveSurface: 0,
      ironAbove80Outside: 0,
      ironMountainWindow: 0,
      mountainUnderground: 0,
      ironAbove80: 0,
      mountainBandUnderground: 0,
      mountainBandIron: 0,
      groups: Array.from({ length: 16 }, () => ({ under: 0, count: {} })),
      genMs: 0,
    };
    const t0 = performance.now();
    const off = -Math.floor((GRID * STRIDE) / 2);
    for (let i = 0; i < GRID; i++) {
      for (let k = 0; k < GRID; k++) {
        const cx = off + i * STRIDE;
        const cz = off + k * STRIDE;
        const col = new ChunkColumn(cx, cz, 0);
        pipeline.generateColumn(seed, cx, cz, col);
        analyse(col, acc, (i >> 3) * 4 + (k >> 3));
      }
    }
    acc.genMs = performance.now() - t0;
    stats.set(seedStr, acc);
  }

  const seed = hashString(STANDARD);
  withOres = new World(false);
  generate(stagePipeline(['features']), seed, withOres, AREA_C0, AREA_C0, AREA_SIZE);
  withoutOres = new World(false);
  generate(stagePipeline(['features', 'ores']), seed, withoutOres, AREA_C0, AREA_C0, AREA_SIZE);

  const lines = SEEDS.map((s) => {
    const a = stats.get(s)!;
    return `${s}: ${a.columns} columns, ${a.underground} underground blocks, ${a.genMs.toFixed(0)} ms`;
  });
  console.log(`[ores sample] ${lines.join(' | ')}`);
}, 900000);

function per1M(acc: SeedStats, id: string): number {
  return (acc.count[id]! / acc.underground) * 1e6;
}

/** Relative standard error of the pooled ratio, from the spread of the 16 sub-areas. */
function relativeSE(acc: SeedStats, id: string): number {
  const ratios = acc.groups.map((g) => (g.count[id] ?? 0) / g.under);
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const variance = ratios.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (ratios.length - 1);
  return Math.sqrt(variance / ratios.length) / mean;
}

describe('M03e — ores', () => {
  it('a: ore counts per 1,000,000 underground blocks are within ±25 % of Appendix A.4 (both seeds)', () => {
    const rows: string[] = [];
    for (const seedStr of SEEDS) {
      const acc = stats.get(seedStr)!;
      for (const id of OVERWORLD_ORE_IDS) {
        const value = per1M(acc, id);
        const ratio = value / TARGET[id]!;
        const se = relativeSE(acc, id);
        rows.push(
          `${seedStr} ${id}: ${value.toFixed(1)} per 1M (target ${TARGET[id]}, ${((ratio - 1) * 100).toFixed(1)} %, ${acc.count[id]} blocks, SE ${(se * 100).toFixed(1)} %)`,
        );
        expect(ratio, `${seedStr} ${id}`).toBeGreaterThanOrEqual(0.75);
        expect(ratio, `${seedStr} ${id}`).toBeLessThanOrEqual(1.25);
      }
      // The rarest ore must have enough blocks for the estimate to be well inside the tolerance
      expect(acc.count['gold_ore']!).toBeGreaterThan(800);
      expect(relativeSE(acc, 'gold_ore')).toBeLessThan(0.1);
    }
    console.log(`[ores a]\n${rows.join('\n')}`);
  });

  it('a (iron): the mountain band is part of the count; its share is reported', () => {
    const rows: string[] = [];
    for (const seedStr of SEEDS) {
      const acc = stats.get(seedStr)!;
      const share = acc.ironMountainWindow / acc.count['iron_ore']!;
      const density = (acc.ironMountainWindow / acc.mountainUnderground) * 1e6;
      rows.push(
        `${seedStr}: iron in y 80-100 of mountain columns ${acc.ironMountainWindow} of ${acc.count['iron_ore']} (${(share * 100).toFixed(2)} %); ${density.toFixed(0)} per 1M of the ${acc.mountainUnderground} underground blocks there`,
      );
      const bandDensity = (acc.mountainBandIron / acc.mountainBandUnderground) * 1e6;
      rows.push(
        `${seedStr}: iron in y 80-255 of mountain columns ${acc.mountainBandIron} of ${acc.mountainBandUnderground} underground blocks (${bandDensity.toFixed(0)} per 1M)`,
      );
      expect(bandDensity).toBeGreaterThan(400);
      expect(bandDensity).toBeLessThan(1600);
      expect(share).toBeLessThan(0.05);
      expect(acc.ironAbove80).toBeGreaterThan(0);
    }
    console.log(`[ores iron band]\n${rows.join('\n')}`);
  });

  it('b: no ore above its maximum height; iron above y 80 only in mountain biomes; no Skyshard anywhere', () => {
    for (const seedStr of SEEDS) {
      const acc = stats.get(seedStr)!;
      for (const id of OVERWORLD_ORE_IDS) {
        expect(acc.anyCount[id]!, `${seedStr} ${id} exists`).toBeGreaterThan(0);
        expect(acc.maxY[id]!, `${seedStr} ${id} max y`).toBeLessThanOrEqual(MAX_Y[id]!);
      }
      expect(acc.ironAbove80Outside).toBe(0);
      expect(acc.anyCount['skyshard_ore']).toBe(0);
    }
    // the stage's own table agrees with Appendix A.4
    for (const spec of ORE_SPECS) {
      expect(spec.maxY).toBe(MAX_Y[spec.id]);
      for (const band of spec.bands) expect(band.maxY).toBeLessThanOrEqual(MAX_Y[spec.id]!);
    }
    expect(OVERWORLD_ORE_IDS).not.toContain('skyshard_ore');
  });

  it('c: ores replace only stone, never at or above the surface, never in the top block of a column', () => {
    // 12 x 12 columns generated with and without the ore stage: every difference must be stone
    // turned into ore, below the column's top block.
    let changed = 0;
    const problems: string[] = [];
    const byOre: Record<string, number> = {};
    const x0 = AREA_C0 * 16;
    const x1 = (AREA_C0 + AREA_SIZE) * 16;
    for (let x = x0; x < x1; x++) {
      for (let z = x0; z < x1; z++) {
        const top = withoutOres.getHeight(x, z);
        for (let y = 0; y < 320; y++) {
          const before = withoutOres.getBlockStateId(x, y, z);
          const after = withOres.getBlockStateId(x, y, z);
          if (before === after) continue;
          changed++;
          const oi = oreIndex[after]!;
          if (before !== stoneState)
            problems.push(`non-stone ${before} replaced at (${x},${y},${z})`);
          if (oi < 0) problems.push(`non-ore ${after} written at (${x},${y},${z})`);
          else byOre[ALL_ORES[oi]!] = (byOre[ALL_ORES[oi]!] ?? 0) + 1;
          if (y >= top) problems.push(`ore at or above the surface (${x},${y},${z}), top ${top}`);
        }
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
    expect(changed).toBeGreaterThan(2000);
    for (const id of ['coal_ore', 'copper_ore', 'iron_ore']) {
      expect(byOre[id] ?? 0, id).toBeGreaterThan(0);
    }
    // the full sample: no ore at or above a surface
    for (const seedStr of SEEDS) expect(stats.get(seedStr)!.aboveSurface).toBe(0);
    console.log(`[ores c] ${changed} blocks changed in 144 columns: ${JSON.stringify(byOre)}`);
  });

  it('c (lumite): lumite touching cave air is a clearly higher share of lumite than for the other ores', () => {
    const rows: string[] = [];
    for (const seedStr of SEEDS) {
      const acc = stats.get(seedStr)!;
      const share = (id: string): number => acc.exposed[id]! / acc.count[id]!;
      const lumite = share('lumite_ore');
      const others = OVERWORLD_ORE_IDS.filter((id) => id !== 'lumite_ore');
      rows.push(
        `${seedStr}: lumite ${(lumite * 100).toFixed(1)} % exposed; ` +
          others
            .map(
              (id) =>
                `${id} ${(share(id) * 100).toFixed(1)} % (lumite/${id} = ${(lumite / share(id)).toFixed(2)})`,
            )
            .join(', '),
      );
      for (const id of others) expect(lumite, `${seedStr} vs ${id}`).toBeGreaterThan(2 * share(id));
    }
    console.log(`[ores lumite exposure]\n${rows.join('\n')}`);
  });

  it('d: a 3x3 block of columns generated in two orders has an identical worldHash, and veins cross chunk borders', () => {
    const seed = hashString(STANDARD);
    const pipeline = createDefaultPipeline();
    const build = (order: Array<[number, number]>): string => {
      const world = new World(false);
      for (const [cx, cz] of order)
        pipeline.generateColumn(seed, cx, cz, world.getColumn(cx, cz, true)!);
      return world.worldHash(0, 0, 47, 47);
    };
    const forward: Array<[number, number]> = [];
    for (let cz = 0; cz < 3; cz++) for (let cx = 0; cx < 3; cx++) forward.push([cx, cz]);
    const shuffled: Array<[number, number]> = [4, 8, 0, 2, 6, 1, 7, 3, 5].map((i) => forward[i]!);
    expect(build(shuffled)).toBe(build(forward));

    // Ore of one kind on both sides of a border, face to face, in the 12 x 12 area
    let acrossX = 0;
    let acrossZ = 0;
    for (let c = AREA_C0 + 1; c < AREA_C0 + AREA_SIZE; c++) {
      for (let a = AREA_C0 * 16; a < (AREA_C0 + AREA_SIZE) * 16; a++) {
        for (let y = 5; y < 120; y++) {
          const bx = c * 16;
          const ex = withOres.getBlockStateId(bx - 1, y, a);
          if (oreIndex[ex]! >= 0 && ex === withOres.getBlockStateId(bx, y, a)) acrossX++;
          const ez = withOres.getBlockStateId(a, y, bx - 1);
          if (oreIndex[ez]! >= 0 && ez === withOres.getBlockStateId(a, y, bx)) acrossZ++;
        }
      }
    }
    expect(acrossX).toBeGreaterThan(0);
    expect(acrossZ).toBeGreaterThan(0);

    // Veins whose cells reach into the next column exist, for every ore (by construction)
    const origin: VeinOrigin = { x: 0, y: 0, z: 0, shapeSeed: 0 };
    const cells = createVeinCells();
    const stageSeed = deriveSeed(seed, 'ores');
    const crossing: Record<string, number> = {};
    for (let oi = 0; oi < ORE_SPECS.length; oi++) {
      const spec = ORE_SPECS[oi]!;
      crossing[spec.id] = 0;
      for (let bi = 0; bi < spec.bands.length; bi++) {
        const band = spec.bands[bi]!;
        const bandSeed = getBandSeed(stageSeed, oi, bi);
        for (let ocx = -40; ocx < 40; ocx++) {
          for (let ocz = -40; ocz < 40; ocz++) {
            for (let j = 0; j < veinAttempts(bandSeed, band, ocx, ocz); j++) {
              veinOrigin(bandSeed, band, ocx, ocz, j, origin);
              buildVein(spec.shape, origin.shapeSeed, cells);
              let minX = 99;
              let maxX = -99;
              for (let c = 0; c < cells.count; c++) {
                minX = Math.min(minX, Math.floor((origin.x + cells.dx[c]!) / 16));
                maxX = Math.max(maxX, Math.floor((origin.x + cells.dx[c]!) / 16));
              }
              if (minX !== maxX) crossing[spec.id]!++;
            }
          }
        }
      }
    }
    for (const spec of ORE_SPECS) expect(crossing[spec.id]!, spec.id).toBeGreaterThan(0);
    console.log(
      `[ores d] ore pairs across a border: ${acrossX} (x) ${acrossZ} (z); veins crossing a chunk border in 6400 origin columns: ${JSON.stringify(crossing)}`,
    );
  });

  describe('e: locate("ore", ...)', () => {
    const NEAR: Array<[number, number, number]> = [
      [0, 64, 0],
      [300, 40, -250],
    ];

    function worldFor(seedStr: string): World {
      const world = new World(false);
      world.worldSeed = hashString(seedStr);
      world.worldType = 'default';
      setWorldInstance(world);
      return world;
    }

    /** Independent search: fresh columns from the default pipeline, nearest by the documented rule. */
    function bruteForce(
      seed: number,
      stateId: number,
      near: [number, number, number],
      radiusChunks: number,
    ): [number, number, number] | null {
      const pipeline = createDefaultPipeline();
      const nx = Math.floor(near[0]);
      const ny = Math.floor(near[1]);
      const nz = Math.floor(near[2]);
      const ccx = Math.floor(nx / 16);
      const ccz = Math.floor(nz / 16);
      let best: [number, number, number] | null = null;
      let bestD = Infinity;
      for (let cz = ccz - radiusChunks; cz <= ccz + radiusChunks; cz++) {
        for (let cx = ccx - radiusChunks; cx <= ccx + radiusChunks; cx++) {
          const col = new ChunkColumn(cx, cz, 0);
          pipeline.generateColumn(seed, cx, cz, col);
          for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
              for (let y = 0; y < 320; y++) {
                if (col.getBlockStateId(x, y, z) !== stateId) continue;
                const wx = cx * 16 + x;
                const wz = cz * 16 + z;
                const d = (wx - nx) ** 2 + (y - ny) ** 2 + (wz - nz) ** 2;
                if (
                  d < bestD ||
                  (d === bestD &&
                    (y < best![1] ||
                      (y === best![1] && (wx < best![0] || (wx === best![0] && wz < best![2])))))
                ) {
                  best = [wx, y, wz];
                  bestD = d;
                }
              }
            }
          }
        }
      }
      return best;
    }

    for (const seedStr of SEEDS) {
      it(`returns, for every ore, a block that a freshly generated column holds as that ore (${seedStr})`, () => {
        worldFor(seedStr);
        const seed = hashString(seedStr);
        const pipeline = createDefaultPipeline();
        for (const near of NEAR) {
          for (const id of OVERWORLD_ORE_IDS) {
            const pos = locate('ore', id, near);
            expect(pos, `${id} near ${near}`).not.toBeNull();
            const [x, y, z] = pos!;
            const cx = Math.floor(x / 16);
            const cz = Math.floor(z / 16);
            const col = new ChunkColumn(cx, cz, 0);
            pipeline.generateColumn(seed, cx, cz, col);
            const st = col.getBlockStateId(x - cx * 16, y, z - cz * 16);
            expect(registry.getResolvedState(st)!.blockId, `${id} at ${pos}`).toBe(id);
            // deterministic: the same call gives the same block
            expect(locate('ore', id, near)).toEqual(pos);
          }
        }
      });
    }

    it('returns the nearest ore block, equal to an independent search (standard seed)', () => {
      worldFor(STANDARD);
      const seed = hashString(STANDARD);
      for (const id of ['coal_ore', 'gold_ore', 'lumite_ore']) {
        const near: [number, number, number] = [-40.5, 30.2, 75.9];
        const pos = locate('ore', id, near);
        expect(pos).not.toBeNull();
        const d = Math.sqrt(
          (pos![0] - Math.floor(near[0])) ** 2 +
            (pos![1] - Math.floor(near[1])) ** 2 +
            (pos![2] - Math.floor(near[2])) ** 2,
        );
        const expected = bruteForce(
          seed,
          registry.getStateId(id)!,
          near,
          Math.min(ORE_LOCATE_RADIUS_CHUNKS, Math.ceil(d / 16) + 1),
        );
        expect(pos, id).toEqual(expected);
      }
    });

    it('returns null for unknown ids, skyshard_ore and flat worlds; searches outward only to the documented radius', () => {
      const world = worldFor(STANDARD);
      expect(locate('ore', 'unobtainium_ore', [0, 64, 0])).toBeNull();
      expect(locate('ore', 'skyshard_ore', [0, 64, 0])).toBeNull();
      expect(locate('ore', 'stone', [0, 64, 0])).toBeNull();
      expect(locate('ore', 'coal_ore', [NaN, 64, 0])).toBeNull();
      expect(ORE_LOCATE_RADIUS_CHUNKS).toBe(8);
      world.worldType = 'flat';
      expect(locate('ore', 'coal_ore', [0, 64, 0])).toBeNull();
    });

    it('reads a loaded column as it is: mined ore is not reported again', () => {
      const world = worldFor(STANDARD);
      const seed = hashString(STANDARD);
      const pipeline = createDefaultPipeline();
      // Load the 3 x 3 columns around the origin
      for (let cz = -1; cz <= 1; cz++) {
        for (let cx = -1; cx <= 1; cx++) {
          pipeline.generateColumn(seed, cx, cz, world.getColumn(cx, cz, true)!);
        }
      }
      const first = locate('ore', 'coal_ore', [0, 60, 0])!;
      expect(first).not.toBeNull();
      expect(Math.abs(first[0]) <= 24 && Math.abs(first[2]) <= 24).toBe(true);
      world.setBlockStateId(first[0], first[1], first[2], registry.getStateId('air')!);
      const second = locate('ore', 'coal_ore', [0, 60, 0])!;
      expect(second).not.toBeNull();
      expect(second).not.toEqual(first);
      expect(
        registry.getResolvedState(world.getBlockStateId(second[0], second[1], second[2]))!.blockId,
      ).toBe('coal_ore');
    });

    it('is registered by the debug API index and implemented in its own module', () => {
      const index = fs.readFileSync(path.join(__dirname, '../../src/debug/api/index.ts'), 'utf8');
      expect(index).toContain("import './ore-locate';");
      const mod = fs.readFileSync(
        path.join(__dirname, '../../src/debug/api/ore-locate.ts'),
        'utf8',
      );
      expect(mod).toContain("registerLocator('ore', locateOre)");
    });
  });

  // -------------------------------------------------------------------------------------------
  // Guards for the pieces the stage relies on
  // -------------------------------------------------------------------------------------------

  it('veins have distinct shapes, stay within VEIN_MAX_REACH, and are a pure function of their seed', () => {
    const cells = createVeinCells();
    const again = createVeinCells();
    const rows: string[] = [];
    const sizes: Record<string, number> = {};
    for (const spec of ORE_SPECS) {
      let total = 0;
      let reach = 0;
      let minSize = 1e9;
      let maxSize = 0;
      let horizontal = 0;
      let vertical = 0;
      const N = 3000;
      for (let s = 0; s < N; s++) {
        const shapeSeed = hashString(`${spec.id}-${s}`);
        buildVein(spec.shape, shapeSeed, cells);
        let core = 0;
        let minX = 99;
        let maxX = -99;
        let minY = 99;
        let maxY = -99;
        for (let c = 0; c < cells.count; c++) {
          reach = Math.max(
            reach,
            Math.abs(cells.dx[c]!),
            Math.abs(cells.dy[c]!),
            Math.abs(cells.dz[c]!),
          );
          if (cells.kind[c] === 0) {
            core++;
            minX = Math.min(minX, cells.dx[c]!);
            maxX = Math.max(maxX, cells.dx[c]!);
            minY = Math.min(minY, cells.dy[c]!);
            maxY = Math.max(maxY, cells.dy[c]!);
          }
        }
        total += core;
        minSize = Math.min(minSize, core);
        maxSize = Math.max(maxSize, core);
        horizontal += maxX - minX + 1;
        vertical += maxY - minY + 1;
        if (s < 200) {
          buildVein(spec.shape, shapeSeed, again);
          // rebuilt after another vein: identical cells
          buildVein(spec.shape, hashString('other'), cells);
          buildVein(spec.shape, shapeSeed, cells);
          expect(Array.from(cells.dx.subarray(0, cells.count))).toEqual(
            Array.from(again.dx.subarray(0, again.count)),
          );
          expect(Array.from(cells.dy.subarray(0, cells.count))).toEqual(
            Array.from(again.dy.subarray(0, again.count)),
          );
          expect(Array.from(cells.dz.subarray(0, cells.count))).toEqual(
            Array.from(again.dz.subarray(0, again.count)),
          );
          expect(Array.from(cells.kind.subarray(0, cells.count))).toEqual(
            Array.from(again.kind.subarray(0, again.count)),
          );
        }
        if (spec.shape !== 'crystal') {
          for (let c = 0; c < cells.count; c++) expect(cells.kind[c]).toBe(0);
        }
      }
      expect(reach, spec.id).toBeLessThanOrEqual(VEIN_MAX_REACH);
      sizes[spec.id] = total / N;
      rows.push(
        `${spec.id} (${spec.shape}): core cells mean ${(total / N).toFixed(1)} (${minSize}-${maxSize}), extent x ${(horizontal / N).toFixed(1)} y ${(vertical / N).toFixed(1)}, max reach ${reach}`,
      );
    }
    // copper streaks are longer than they are tall; coal blobs are compact; gold is small
    expect(sizes['gold_ore']!).toBeLessThan(sizes['coal_ore']! / 2);
    expect(VEIN_MAX_REACH).toBeLessThanOrEqual(16);
    console.log(`[ores shapes]\n${rows.join('\n')}`);
  });

  it('origin heights follow the triangular distribution of each band and stay inside it', () => {
    const origin: VeinOrigin = { x: 0, y: 0, z: 0, shapeSeed: 0 };
    const seed = deriveSeed(hashString(STANDARD), 'ores');
    for (let oi = 0; oi < ORE_SPECS.length; oi++) {
      const spec = ORE_SPECS[oi]!;
      for (let bi = 0; bi < spec.bands.length; bi++) {
        const band = spec.bands[bi]!;
        const bandSeed = getBandSeed(seed, oi, bi);
        const bins = new Array<number>(10).fill(0);
        let n = 0;
        for (let ocx = -60; ocx < 60 && n < 20000; ocx++) {
          for (let ocz = -60; ocz < 60; ocz++) {
            const attempts = veinAttempts(bandSeed, { ...band, perColumn: 3 }, ocx, ocz);
            for (let j = 0; j < attempts; j++) {
              veinOrigin(bandSeed, { ...band, perColumn: 3 }, ocx, ocz, j, origin);
              expect(origin.y).toBeGreaterThanOrEqual(band.minY);
              expect(origin.y).toBeLessThanOrEqual(band.maxY);
              expect(Math.floor(origin.x / 16)).toBe(ocx);
              expect(Math.floor(origin.z / 16)).toBe(ocz);
              bins[
                Math.min(9, Math.floor(((origin.y - band.minY) / (band.maxY - band.minY)) * 10))
              ]!++;
              n++;
            }
          }
        }
        const peakBin = Math.min(
          9,
          Math.floor(((band.peakY - band.minY) / (band.maxY - band.minY)) * 10),
        );
        expect(bins.indexOf(Math.max(...bins)), `${spec.id} band ${bi}`).toBe(peakBin);
        expect(bins[0]!, `${spec.id} band ${bi} low edge`).toBeLessThan(Math.max(...bins) / 2);
      }
    }
    // inverse CDF sanity: the median of the peak-at-middle triangle is the middle
    expect(triangular(0, 50, 100, 0.5)).toBeCloseTo(50, 6);
    expect(triangular(0, 50, 100, 0)).toBe(0);
    expect(triangular(0, 20, 100, 1)).toBeCloseTo(100, 6);
  });

  it('the stage runs after the caves and before the features, and ores.json carries tool and minTier', () => {
    const names = createDefaultPipeline()
      .getStages()
      .map((s) => s.name);
    expect(names.indexOf('ores')).toBe(names.indexOf('caves') + 1);
    expect(names.indexOf('features')).toBe(names.indexOf('ores') + 1);

    const json = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../data/blocks/ores.json'), 'utf8'),
    ) as Record<string, { tool?: string; minTier?: number }>;
    for (const id of ALL_ORES) {
      expect(json[id]!.tool, id).toBe('pickaxe');
      expect(json[id]!.minTier, id).toBe(MIN_TIER[id]);
      expect(registry.getResolvedState(registry.getStateId(id)!)!.definition.minTier, id).toBe(
        MIN_TIER[id],
      );
    }
  });

  it('the ore code uses no implementation-approximated math and no Math.random', () => {
    for (const file of ['src/gen/ores.ts', 'src/debug/api/ore-locate.ts']) {
      const src = fs
        .readFileSync(path.join(__dirname, '../..', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const fn of [
        'sin',
        'cos',
        'tan',
        'atan',
        'atan2',
        'pow',
        'exp',
        'log',
        'random',
        'hypot',
        'cbrt',
      ]) {
        expect(src, `${file} uses Math.${fn}`).not.toMatch(new RegExp(`Math\\.${fn}\\b`));
      }
    }
  });
});
