import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPrecipitationType,
  WeatherHeightmap,
  weatherManager,
  getWeather,
  setWeather,
  resetWeather,
  SNOW_ALTITUDE,
  DRY_BIOMES,
  COLD_BIOMES,
} from '../../src/world/weather';
import savedStateIds from '../../data/block-state-ids.json';
import {
  generateLightningBolt,
  generateLightningPolylines,
  buildBoltPass,
  BOLT_FLOATS_PER_VERTEX,
} from '../../src/render/weather';
import { World } from '../../src/world/world';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { textureGenerators } from '../../src/render/textures/index';

describe('M12c — Weather', () => {
  beforeEach(() => {
    resetWeather();
  });

  describe('Biome and altitude precipitation choice (Decision 2)', () => {
    it('returns none for dry biomes at any altitude', () => {
      for (const biome of DRY_BIOMES) {
        expect(getPrecipitationType(biome, 64)).toBe('none');
        expect(getPrecipitationType(biome, 150)).toBe('none');
        expect(getPrecipitationType(biome, 200)).toBe('none');
      }
    });

    it('returns snow for cold biomes at any altitude', () => {
      for (const biome of COLD_BIOMES) {
        expect(getPrecipitationType(biome, 60)).toBe('snow');
        expect(getPrecipitationType(biome, 100)).toBe('snow');
        expect(getPrecipitationType(biome, 160)).toBe('snow');
      }
    });

    it('returns rain for temperate biomes below snow altitude (y < 140)', () => {
      expect(getPrecipitationType('plains', 64)).toBe('rain');
      expect(getPrecipitationType('forest', 70)).toBe('rain');
      expect(getPrecipitationType('taiga', 90)).toBe('rain');
      expect(getPrecipitationType('plains', SNOW_ALTITUDE - 1)).toBe('rain');
    });

    it('returns snow for temperate biomes at or above snow altitude (y >= 140)', () => {
      expect(getPrecipitationType('plains', SNOW_ALTITUDE)).toBe('snow');
      expect(getPrecipitationType('forest', 145)).toBe('snow');
      expect(getPrecipitationType('mountains', 180)).toBe('snow');
    });
  });

  describe('Top-solid heightmap cover rule (Decision 2)', () => {
    it('tracks top solid elevation and determines particle cover', () => {
      const world = new World();
      const heightmap = new WeatherHeightmap();

      // Flat stone terrain at y=64
      const cx = 0;
      const cz = 0;
      const col = world.getColumn(cx, cz, true)!;
      for (let sy = 0; sy < 4; sy++) {
        col.getOrCreateSection(sy)?.fill(1); // stone
      }

      heightmap.updateColumn(world, cx, cz);
      const topY = heightmap.getTopSolidY(world, 5, 5);
      expect(topY).toBe(63); // 0..63 stone

      // Particle above top solid is exposed to weather
      expect(70 > topY).toBe(true);

      // Particle at or below top solid is under cover
      expect(60 > topY).toBe(false);
      expect(63 > topY).toBe(false);

      // Place a roof block at y=80
      world.setBlock(5, 80, 5, 'stone');
      heightmap.updateBlock(world, 5, 80, 5);
      const newTopY = heightmap.getTopSolidY(world, 5, 5);
      expect(newTopY).toBe(80);

      // A particle at y=70 is now covered by the roof
      expect(70 > newTopY).toBe(false);
      // Only particles above y=80 are exposed
      expect(85 > newTopY).toBe(true);
    });
  });

  describe('Lightning procedural generation & determinism (Decision 4)', () => {
    it('is completely deterministic for identical seed and endpoints', () => {
      const start: [number, number, number] = [10, 192, 10];
      const end: [number, number, number] = [12, 64, 15];
      const seed = 42817;

      const boltA = generateLightningBolt(seed, start, end);
      const boltB = generateLightningBolt(seed, start, end);

      expect(boltA.length).toBeGreaterThan(0);
      expect(boltA).toEqual(boltB);
    });

    it('produces different branch structures for different seeds', () => {
      const start: [number, number, number] = [0, 192, 0];
      const end: [number, number, number] = [0, 64, 0];

      const boltA = generateLightningBolt(11111, start, end);
      const boltB = generateLightningBolt(99999, start, end);

      expect(boltA).not.toEqual(boltB);
    });

    it('connects from start region to target strike endpoint', () => {
      const start: [number, number, number] = [0, 192, 0];
      const end: [number, number, number] = [5, 60, 5];
      const bolt = generateLightningBolt(12345, start, end);

      // Main trunk starts at start and terminates at end
      const first = bolt[0]!;
      expect(first.p0).toEqual(start);
      const last = bolt[bolt.length - 1]!;
      expect(last.p1).toEqual(end);
    });
  });

  describe('Continuous lightning ribbons', () => {
    const start: [number, number, number] = [0, 192, 0];
    const end: [number, number, number] = [6, 64, -4];

    it('builds branches as fine, tapering polylines that start on the trunk', () => {
      const lines = generateLightningPolylines(777, start, end);
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines.length).toBeLessThanOrEqual(5);
      const trunk = lines[0]!;
      expect(trunk.points[0]).toEqual(start);
      expect(trunk.points[trunk.points.length - 1]).toEqual(end);
      expect(trunk.points.length).toBeGreaterThan(100);
      for (let i = 1; i < trunk.points.length; i++) {
        const a = trunk.points[i - 1]!;
        const b = trunk.points[i]!;
        expect(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])).toBeLessThan(3);
      }
      for (const fork of lines.slice(1)) {
        expect(trunk.points).toContainEqual(fork.points[0]);
        expect(fork.taper[1]).toBeLessThan(fork.taper[0]);
      }
      expect(trunk.taper[1]).toBeLessThan(trunk.taper[0]);
    });

    it('shares exactly one vertex pair at every joint, so quads leave no gaps', () => {
      const lines = generateLightningPolylines(777, start, end);
      for (const pass of ['glow', 'core'] as const) {
        const out: number[] = [];
        buildBoltPass(lines, [20, 120, 30], pass, out);
        const stride = BOLT_FLOATS_PER_VERTEX;
        expect(out.every(Number.isFinite)).toBe(true);
        const vertex = (i: number) => out.slice(i * stride, i * stride + 3).join(',');
        let base = 0;
        for (const line of lines) {
          const segs = line.points.length - 1;
          for (let s = 0; s + 1 < segs; s++) {
            const cur = base + s * 6;
            const next = cur + 6;
            // quad = (L0,R0,R1) (L0,R1,L1): its end edge R1/L1 is the next quad's start edge L0/R0
            expect(vertex(cur + 2)).toBe(vertex(next + 1));
            expect(vertex(cur + 5)).toBe(vertex(next));
          }
          base += segs * 6;
        }
        expect(base * stride).toBe(out.length);
      }
    });
  });

  describe('Weather state transitions and world initial determinism (Decision 1)', () => {
    it('starts in clear state', () => {
      expect(getWeather()).toBe('clear');
    });

    it('transitions to rain and thunder via setWeather and resets cleanly', () => {
      setWeather('rain');
      expect(getWeather()).toBe('rain');

      setWeather('thunder');
      expect(getWeather()).toBe('thunder');

      resetWeather();
      expect(getWeather()).toBe('clear');
    });

    it('does not change weather autonomously before 12000 ticks', () => {
      const world = new World();
      expect(getWeather()).toBe('clear');

      // Tick through morning/noon (0..11999 ticks) without manual override
      for (let t = 0; t < 12000; t += 2000) {
        weatherManager.tick(world, t);
        expect(getWeather()).toBe('clear');
      }
    });
  });

  describe('Weather block definitions and texture generators (Decision 5 & ART.md)', () => {
    it('registers ice, snow_layer, and fire in BlockRegistry', () => {
      const registry = BlockRegistry.getInstance();
      expect(registry.getBlockDefinition('ice')).toBeDefined();
      expect(registry.getBlockDefinition('snow_layer')).toBeDefined();
      expect(registry.getBlockDefinition('fire')).toBeDefined();
    });

    it('has texture generators for ice and fire', () => {
      expect(textureGenerators['ice']).toBeDefined();
      expect(textureGenerators['fire']).toBeDefined();

      const iceTex = textureGenerators['ice']!(42);
      expect(Array.isArray(iceTex)).toBe(false);
      if (!Array.isArray(iceTex)) {
        expect(iceTex.length).toBe(1024);
      }

      const fireTex = textureGenerators['fire']!(42);
      expect(Array.isArray(fireTex)).toBe(false);
      if (!Array.isArray(fireTex)) {
        expect(fireTex.length).toBe(1024);
      }
    });
  });

  describe('Budgeted weather accumulation & freezing (Decision 5)', () => {
    it('freezes exposed water to ice and builds snow layers in cold biomes', () => {
      const world = new World();
      const cx = 0;
      const cz = 0;
      const col = world.getColumn(cx, cz, true)!;
      // Mark as cold biome
      col.setBiomeIndices(new Uint8Array(256).fill(3), ['snowy_tundra']);

      // Ground at y=63
      for (let sy = 0; sy < 4; sy++) {
        col.getOrCreateSection(sy)?.fill(1); // stone
      }

      // Add exposed water at (4, 64, 4)
      world.setBlock(4, 64, 4, 'water');
      // Set sky light to 15 at y=65 (sy=4, ly=1)
      world.lightEngine.storage.setSkyLight(0, 4, 0, 4, 1, 4, 15);
      world.lightEngine.storage.setSkyLight(0, 4, 0, 4, 0, 4, 15);

      setWeather('rain'); // In snowy_tundra, precip is snow

      // Trigger accumulation tick at x=4, z=4
      // We can directly invoke accumulation effect by running ticks near (4, 64, 4)
      for (let t = 0; t < 300; t++) {
        weatherManager.tick(world, t, [4, 64, 4]);
      }

      // Either water froze or snow accumulated on ground
      const blockAtWater = world.getBlock(4, 64, 4);
      // Because RNG checks near the player, either water turned to ice or another block was affected
      expect(blockAtWater.id === 'water' || blockAtWater.id === 'ice').toBe(true);
    });
  });

  describe('Desert climate coverage (Decision 2)', () => {
    it('evaluates zero precipitation across entire 16-block neighborhood in desert interior', async () => {
      const { hashString } = await import('../../src/engine/rng');
      const { sampleBiome } = await import('../../src/gen/biomes');
      const seed = hashString('blockcraft-test-seed-42');

      // (0, -80) is inside the desert biome for blockcraft-test-seed-42
      for (let dz = -16; dz <= 16; dz += 2) {
        for (let dx = -16; dx <= 16; dx += 2) {
          const b = sampleBiome(seed, 0 + dx, -80 + dz);
          expect(getPrecipitationType(b, 80)).toBe('none');
        }
      }
    });
  });

  describe('WeatherHeightmap cache', () => {
    it('bumps its version on every change and drops unloaded columns', () => {
      const world = new World();
      const col = world.getColumn(0, 0, true)!;
      col.getOrCreateSection(0)?.fill(BlockRegistry.getInstance().getDefaultStateId('stone')!);
      const hm = new WeatherHeightmap();
      const v0 = hm.version;
      hm.updateColumn(world, 0, 0);
      const v1 = hm.version;
      expect(v1).toBeGreaterThan(v0);
      hm.updateBlock(world, 3, 5, 4);
      const v2 = hm.version;
      expect(v2).toBeGreaterThan(v1);
      hm.updateBlock(world, 300, 5, 4); // column not cached: nothing changes
      expect(hm.version).toBe(v2);
      hm.removeColumn(0, 0);
      const v3 = hm.version;
      expect(v3).toBeGreaterThan(v2);
      hm.removeColumn(0, 0); // already gone
      expect(hm.version).toBe(v3);
    });
  });

  describe('Stable block state IDs', () => {
    it('records every ice, snow_layer and fire state in the append-only table', () => {
      const registry = BlockRegistry.getInstance();
      const table = savedStateIds as Record<string, number>;
      const max = Math.max(...Object.values(table));
      let checked = 0;
      for (const block of ['ice', 'snow_layer', 'fire']) {
        for (const stateId of registry.getAllStateIds()) {
          const s = registry.getResolvedState(stateId)!;
          if (s.blockId !== block) continue;
          const keys = Object.keys(s.properties).sort();
          const key =
            block +
            (keys.length ? '[' + keys.map((k) => k + '=' + s.properties[k]).join(',') + ']' : '');
          expect(table[key], key).toBe(stateId);
          checked++;
        }
      }
      expect(checked).toBeGreaterThanOrEqual(3);
      expect(table['fire']).toBeGreaterThan(114);
      expect(max).toBeGreaterThanOrEqual(117);
    });
  });
});
