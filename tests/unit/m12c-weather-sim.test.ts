import { describe, it, expect, beforeEach } from 'vitest';
import {
  weatherManager,
  getWeather,
  setWeather,
  resetWeather,
  scheduledWeather,
  NATURAL_WEATHER_START,
  WEATHER_SLOT_TICKS,
} from '../../src/world/weather';
import { World } from '../../src/world/world';
import { BlockRegistry } from '../../src/world/blocks/registry';

/** Builds a 7x7 chunk world with a stone floor (top at y=63) in the given biome. */
function buildWorld(biome: string): World {
  const world = new World();
  for (let cz = -3; cz <= 3; cz++) {
    for (let cx = -3; cx <= 3; cx++) {
      const col = world.getColumn(cx, cz, true)!;
      col.setBiomeIndices(new Uint8Array(256).fill(0), [biome]);
      for (let sy = 0; sy < 4; sy++)
        col.getOrCreateSection(sy)?.fill(BlockRegistry.getInstance().getDefaultStateId('stone')!);
    }
  }
  fullSky(world);
  return world;
}

/** Full sky light in section y=4 (blocks y 64..79) of every loaded column. */
function fullSky(world: World): void {
  for (let cz = -3; cz <= 3; cz++)
    for (let cx = -3; cx <= 3; cx++)
      for (let lx = 0; lx < 16; lx++)
        for (let ly = 0; ly < 16; ly++)
          for (let lz = 0; lz < 16; lz++)
            world.lightEngine.storage.setSkyLight(cx, 4, cz, lx, ly, lz, 15);
}

function count(world: World, id: string, y: number, r: number): number {
  let n = 0;
  for (let x = -r; x <= r; x++)
    for (let z = -r; z <= r; z++) if (world.getBlock(x, y, z).id === id) n++;
  return n;
}

describe('M12c — weather simulation', () => {
  beforeEach(() => {
    resetWeather();
  });

  describe('natural weather schedule', () => {
    it('is deterministic and covers clear, rain and thunder', () => {
      const seen = new Set<string>();
      for (let slot = 2; slot < 200; slot++) {
        const w = scheduledWeather(slot * WEATHER_SLOT_TICKS);
        expect(scheduledWeather(slot * WEATHER_SLOT_TICKS)).toBe(w);
        seen.add(w);
      }
      expect([...seen].sort()).toEqual(['clear', 'rain', 'thunder']);
    });

    it('stays clear for 12000 simulated ticks and then may change', () => {
      const world = new World();
      let first = -1;
      for (let t = 1; t <= 200_000; t++) {
        weatherManager.tick(world, t);
        if (getWeather() !== 'clear') {
          first = t;
          break;
        }
        if (t < NATURAL_WEATHER_START) expect(getWeather()).toBe('clear');
      }
      expect(first).toBeGreaterThanOrEqual(NATURAL_WEATHER_START);
    });

    it('does not start weather when world time is jumped (setTimeOfDay)', () => {
      const world = new World();
      weatherManager.tick(world, 6000);
      for (const t of [13000, 18000, 30000, 100000, 6000]) {
        weatherManager.tick(world, t);
        expect(getWeather()).toBe('clear');
      }
    });

    it('a manual setWeather is not overridden by the schedule', () => {
      const world = new World();
      setWeather('rain');
      for (let t = 0; t < 40; t++) weatherManager.tick(world, t);
      expect(getWeather()).toBe('rain');
    });
  });

  describe('thunder ticking', () => {
    it('does not advance while the world time is paused', () => {
      const world = buildWorld('plains');
      setWeather('thunder');
      weatherManager.tick(world, 100, [0, 64, 0]);
      for (let i = 0; i < 500; i++) weatherManager.tick(world, 100, [0, 64, 0]);
      expect(weatherManager.activeStrike).toBeNull();
      expect(weatherManager.flashIntensity).toBe(0);
    });

    it('strikes on the first game tick after setWeather(thunder), flashes and fades', () => {
      const world = buildWorld('plains');
      setWeather('thunder');
      weatherManager.tick(world, 100, [0, 64, 0]);
      weatherManager.tick(world, 101, [0, 64, 0]);
      expect(weatherManager.activeStrike).not.toBeNull();
      expect(weatherManager.flashIntensity).toBe(1);
      for (let t = 102; t < 112; t++) weatherManager.tick(world, t, [0, 64, 0]);
      expect(weatherManager.flashIntensity).toBe(0);
      expect(weatherManager.activeStrike).toBeNull();
    });

    it('ignites fire above solid ground for some strike seeds, never otherwise', () => {
      const world = buildWorld('plains');
      let fires = 0;
      const N = 60;
      for (let seed = 1; seed <= N; seed++) {
        weatherManager.triggerLightningStrike(world, seed * 977, [0, 64, 0]);
        const s = weatherManager.activeStrike!;
        const [ex, ey, ez] = s.end;
        expect(world.getBlock(ex, ey, ez).id).toBe('stone');
        if (world.getBlock(ex, ey + 1, ez).id === 'fire') fires++;
      }
      expect(fires).toBeGreaterThan(N * 0.3);
      expect(fires).toBeLessThan(N);
    });
  });

  describe('snow accumulation and freezing', () => {
    it('builds snow layers on exposed ground in a cold biome during snowfall', () => {
      const world = buildWorld('snowy_tundra');
      setWeather('rain');
      weatherManager.tick(world, 0, [0, 64, 0]);
      for (let t = 1; t <= 3000; t++) weatherManager.tick(world, t, [0, 64, 0]);
      expect(count(world, 'snow_layer', 64, 48)).toBeGreaterThan(20);
    });

    it('freezes exposed water to ice in a cold biome', () => {
      const world = buildWorld('frozen_ocean');
      for (let x = -48; x <= 48; x++)
        for (let z = -48; z <= 48; z++) world.setBlock(x, 64, z, 'water');
      setWeather('rain');
      weatherManager.tick(world, 0, [0, 64, 0]);
      for (let t = 1; t <= 3000; t++) weatherManager.tick(world, t, [0, 64, 0]);
      expect(count(world, 'ice', 64, 48)).toBeGreaterThan(20);
      expect(count(world, 'snow_layer', 65, 48)).toBe(0);
    });

    it('freezes only still water sources, not flowing water', () => {
      const world = buildWorld('frozen_ocean');
      for (let x = -48; x <= 48; x++)
        for (let z = -48; z <= 48; z++) {
          world.setBlock(x, 64, z, 'water');
        }
      const registry = BlockRegistry.getInstance();
      const flowing = registry.getStateId('water', { level: '3', falling: 'false' })!;
      for (let x = -48; x <= 48; x++)
        for (let z = -48; z <= 48; z++) world.setBlockStateId(x, 64, z, flowing);
      fullSky(world);
      setWeather('rain');
      weatherManager.tick(world, 0, [0, 64, 0]);
      for (let t = 1; t <= 2000; t++) weatherManager.tick(world, t, [0, 64, 0]);
      expect(count(world, 'ice', 64, 48)).toBe(0);
      expect(count(world, 'snow_layer', 65, 48)).toBe(0);
    });

    it('does nothing in temperate or dry biomes, or when the weather is clear', () => {
      for (const [biome, state] of [
        ['plains', 'rain'],
        ['desert', 'rain'],
        ['snowy_tundra', 'clear'],
      ] as const) {
        resetWeather();
        const world = buildWorld(biome);
        for (let x = -48; x <= 48; x++)
          for (let z = -48; z <= 48; z++) world.setBlock(x, 64, z, 'water');
        setWeather(state);
        weatherManager.tick(world, 0, [0, 64, 0]);
        for (let t = 1; t <= 1000; t++) weatherManager.tick(world, t, [0, 64, 0]);
        expect(count(world, 'ice', 64, 48)).toBe(0);
        expect(count(world, 'snow_layer', 65, 48)).toBe(0);
      }
    });

    it('goes through World.setBlock so edits notify the mesher', () => {
      const world = buildWorld('snowy_tundra');
      const edits: number[][] = [];
      world.onBlockEdited = (x, y, z) => edits.push([x, y, z]);
      setWeather('rain');
      weatherManager.tick(world, 0, [0, 64, 0]);
      for (let t = 1; t <= 500; t++) weatherManager.tick(world, t, [0, 64, 0]);
      expect(edits.length).toBeGreaterThan(0);
      for (const [, y] of edits) expect(y).toBe(64);
    });
  });
});
