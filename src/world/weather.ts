import { World } from './world';
import { LCG } from '../render/textures/noise';
import { BlockRegistry } from './blocks/registry';

export type WeatherState = 'clear' | 'rain' | 'thunder';
export type PrecipitationType = 'none' | 'rain' | 'snow';

/** Altitude at which precipitation turns to snow in non-dry biomes (Decision 2). */
export const SNOW_ALTITUDE = 140;

/** Biomes with zero precipitation (Decision 2). */
export const DRY_BIOMES = new Set<string>(['desert', 'badlands', 'savanna']);

/** Cold biomes with snowfall at any altitude (Decision 2). */
export const COLD_BIOMES = new Set<string>(['snowy_tundra', 'frost_peaks', 'frozen_ocean']);

/**
 * Returns precipitation type ('none' | 'rain' | 'snow') for a biome and altitude.
 * - none in desert, badlands, and savanna
 * - snow in cold biomes and above SNOW_ALTITUDE (y >= 140)
 * - rain otherwise
 */
export function getPrecipitationType(biome: string, y: number): PrecipitationType {
  if (DRY_BIOMES.has(biome)) {
    return 'none';
  }
  if (COLD_BIOMES.has(biome) || y >= SNOW_ALTITUDE) {
    return 'snow';
  }
  return 'rain';
}

/**
 * Heightmap maintaining top solid block elevation per column around the player.
 * A particle below this elevation is blocked (no precipitation below solid blocks).
 */
export class WeatherHeightmap {
  private readonly columns = new Map<string, Int16Array>();

  private columnKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  public clear(): void {
    this.columns.clear();
  }

  public removeColumn(cx: number, cz: number): void {
    this.columns.delete(this.columnKey(cx, cz));
  }

  public updateColumn(world: World, cx: number, cz: number): void {
    let heights = this.columns.get(this.columnKey(cx, cz));
    if (!heights) {
      heights = new Int16Array(256);
      this.columns.set(this.columnKey(cx, cz), heights);
    }
    const baseX = cx * 16;
    const baseZ = cz * 16;
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        heights[lz * 16 + lx] = world.getHeight(baseX + lx, baseZ + lz);
      }
    }
  }

  public updateBlock(world: World, x: number, _y: number, z: number): void {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const heights = this.columns.get(this.columnKey(cx, cz));
    if (heights) {
      const lx = ((x % 16) + 16) % 16;
      const lz = ((z % 16) + 16) % 16;
      heights[lz * 16 + lx] = world.getHeight(x, z);
    }
  }

  public getTopSolidY(world: World, x: number, z: number): number {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    let heights = this.columns.get(this.columnKey(cx, cz));
    if (!heights) {
      this.updateColumn(world, cx, cz);
      heights = this.columns.get(this.columnKey(cx, cz));
    }
    if (!heights) {
      return world.getHeight(x, z);
    }
    const lx = ((x % 16) + 16) % 16;
    const lz = ((z % 16) + 16) % 16;
    return heights[lz * 16 + lx]!;
  }
}

export interface ActiveLightningStrike {
  seed: number;
  strikeTicks: number; // ticks remaining
  start: [number, number, number];
  end: [number, number, number];
}

/** Autonomous weather never changes before this many simulated ticks have elapsed (Decision 1). */
export const NATURAL_WEATHER_START = 12000;
/** Length in ticks of one natural-weather schedule slot. */
export const WEATHER_SLOT_TICKS = 6000;
/** Upper bound of simulated steps per call, so a time jump cannot stall a frame. */
const MAX_STEPS_PER_CALL = 20;

/**
 * Deterministic natural weather for the schedule slot containing the elapsed tick count `ticks`:
 * about 70 % clear, 20 % rain, 10 % thunder.
 */
export function scheduledWeather(ticks: number): WeatherState {
  const slot = Math.floor(ticks / WEATHER_SLOT_TICKS);
  const r = new LCG(slot * 7919 + 17).nextFloat();
  if (r < 0.7) return 'clear';
  return r < 0.9 ? 'rain' : 'thunder';
}

class WeatherManager {
  public weather: WeatherState = 'clear';
  public manualOverride = false;
  public flashIntensity = 0; // 0..1, for sky flash
  public activeStrike: ActiveLightningStrike | null = null;
  public readonly heightmap = new WeatherHeightmap();

  private strikeCounter = 0;
  private lastTick = -1;
  private elapsed = 0;

  public reset(): void {
    this.weather = 'clear';
    this.manualOverride = false;
    this.flashIntensity = 0;
    this.activeStrike = null;
    this.strikeCounter = 0;
    this.lastTick = -1;
    this.elapsed = 0;
    this.heightmap.clear();
  }

  public setWeather(state: WeatherState): void {
    this.weather = state;
    this.manualOverride = true;
    if (state === 'clear') {
      this.flashIntensity = 0;
      this.activeStrike = null;
    } else if (state === 'thunder') {
      this.strikeCounter = 159;
    }
  }

  public tick(world: World, ticks: number, playerPos?: ArrayLike<number>): void {
    // Advance by the game ticks elapsed since the last call (this runs from the render loop, so
    // a paused world must not advance and a debug tick(n) must advance exactly n steps).
    const delta = this.lastTick < 0 ? 0 : ticks - this.lastTick;
    this.lastTick = ticks;
    const steps = Math.min(Math.max(delta, 0), MAX_STEPS_PER_CALL);

    // 1. Natural weather: clear until NATURAL_WEATHER_START simulated ticks have elapsed, then a
    // seeded schedule. Only simulated steps count, so setTimeOfDay jumps never start weather.
    this.elapsed += steps;
    if (!this.manualOverride) {
      this.weather =
        this.elapsed < NATURAL_WEATHER_START ? 'clear' : scheduledWeather(this.elapsed);
      if (this.weather === 'clear') this.strikeCounter = 0;
    }

    for (let i = 0; i < steps; i++) {
      const stepTick = ticks - steps + i + 1;

      // 2. Fade lightning flash
      if (this.flashIntensity > 0) {
        this.flashIntensity = Math.max(0, this.flashIntensity - 0.15);
      }

      // 3. Update active lightning strike
      if (this.activeStrike) {
        this.activeStrike.strikeTicks--;
        if (this.activeStrike.strikeTicks <= 0) {
          this.activeStrike = null;
        }
      }

      // 4. Thunder strikes roughly every 160 ticks
      if (this.weather === 'thunder') {
        this.strikeCounter++;
        if (this.strikeCounter >= 160) {
          this.strikeCounter = 0;
          this.triggerLightningStrike(world, stepTick, playerPos);
        }
      }

      // 5. Budgeted weather accumulation & water freezing over loaded columns (Decision 5)
      if (this.weather !== 'clear') {
        this.tickAccumulation(world, stepTick, playerPos);
      }
    }
  }

  public triggerLightningStrike(world: World, seed: number, playerPos?: ArrayLike<number>): void {
    const rng = new LCG(seed);
    const px = playerPos ? (playerPos[0] ?? 0) : 0;
    const pz = playerPos ? (playerPos[2] ?? 0) : 0;

    // Strike position near player within 12..36 blocks
    const angle = rng.nextFloat() * Math.PI * 2;
    const dist = 14 + rng.nextFloat() * 24;
    const targetX = Math.floor(px + Math.cos(angle) * dist);
    const targetZ = Math.floor(pz + Math.sin(angle) * dist);
    const targetY = world.getHeight(targetX, targetZ);

    const startX = targetX + (rng.nextFloat() - 0.5) * 16;
    const startZ = targetZ + (rng.nextFloat() - 0.5) * 16;
    const startY = 192; // Cloud altitude

    this.flashIntensity = 1.0;
    this.activeStrike = {
      seed,
      strikeTicks: 8,
      start: [startX, startY, startZ],
      end: [targetX, targetY, targetZ],
    };

    // Seeded fire-ignition chance at strike point (Decision 4)
    // If strike point is exposed and air above, ignite fire with 60% chance
    if (rng.nextFloat() < 0.6) {
      const above = world.getBlock(targetX, targetY + 1, targetZ);
      if (above.id === 'air') {
        const below = world.getBlock(targetX, targetY, targetZ);
        if (below.id !== 'air' && below.id !== 'water') {
          world.setBlock(targetX, targetY + 1, targetZ, 'fire');
        }
      }
    }
  }

  /**
   * Minimal, deterministic, budgeted weather tick (Decision 5):
   * Inspects 2 random columns near the player per tick:
   * - Snow layers build up on exposed solid top faces in cold biomes during snowfall
   * - Still water exposed to the sky freezes to ice in cold biomes
   */
  private tickAccumulation(world: World, ticks: number, playerPos?: ArrayLike<number>): void {
    const rng = new LCG(ticks * 31337);
    const px = playerPos ? Math.floor(playerPos[0] ?? 0) : 0;
    const pz = playerPos ? Math.floor(playerPos[2] ?? 0) : 0;

    const BUDGET = 2; // 2 column tests per simulation tick
    for (let b = 0; b < BUDGET; b++) {
      const offsetX = rng.nextInt(-48, 48);
      const offsetZ = rng.nextInt(-48, 48);
      const x = px + offsetX;
      const z = pz + offsetZ;
      const cx = Math.floor(x / 16);
      const cz = Math.floor(z / 16);

      if (!world.hasColumn(cx, cz)) continue;

      const topY = surfaceY(world, x, z);
      if (topY < 0) continue;
      const biome = world.getBiome(x, z);
      const precip = getPrecipitationType(biome, topY);
      if (precip !== 'snow') continue;
      if (world.getLight(x, topY + 1, z).sky < 14) continue;

      const topBlock = world.getBlock(x, topY, z);
      if (topBlock.id === 'water') {
        // Exposed water freezes to ice
        world.setBlock(x, topY, z, 'ice');
      } else if (
        topBlock.id !== 'ice' &&
        topBlock.id !== 'snow_layer' &&
        topBlock.id !== 'lava' &&
        topBlock.id !== 'fire' &&
        BlockRegistry.getInstance().getBlockDefinition(topBlock.id)?.model !== 'cross' &&
        world.getBlock(x, topY + 1, z).id === 'air'
      ) {
        // Accumulate snow layer
        world.setBlock(x, topY + 1, z, 'snow_layer');
      }
    }
  }
}

/** Highest non-air block in the column, water included (unlike World.getHeight), or -1. */
function surfaceY(world: World, x: number, z: number): number {
  for (let y = 319; y >= 0; y--) {
    if (world.getBlockStateId(x, y, z) !== 0) return y;
  }
  return -1;
}

export const weatherManager = new WeatherManager();

export function getWeather(): WeatherState {
  return weatherManager.weather;
}

export function setWeather(state: WeatherState): void {
  weatherManager.setWeather(state);
}

export function resetWeather(): void {
  weatherManager.reset();
}
