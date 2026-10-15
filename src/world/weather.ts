import { World } from './world';
import { LCG } from '../render/textures/noise';

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

class WeatherManager {
  public weather: WeatherState = 'clear';
  public manualOverride = false;
  public flashIntensity = 0; // 0..1, for sky flash
  public activeStrike: ActiveLightningStrike | null = null;
  public readonly heightmap = new WeatherHeightmap();

  private strikeCounter = 0;

  public reset(): void {
    this.weather = 'clear';
    this.manualOverride = false;
    this.flashIntensity = 0;
    this.activeStrike = null;
    this.strikeCounter = 0;
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
    // 1. Natural weather changes only after 12000 ticks if not manually overridden
    if (!this.manualOverride) {
      if (ticks < 12000) {
        this.weather = 'clear';
      }
    }

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

    // 4. Thunder strikes
    if (this.weather === 'thunder') {
      this.strikeCounter++;
      // Strike every ~160 ticks or trigger when counter reaches interval
      if (this.strikeCounter >= 160) {
        this.strikeCounter = 0;
        this.triggerLightningStrike(world, ticks, playerPos);
      }
    }

    // 5. Budgeted weather accumulation & water freezing over loaded columns (Decision 5)
    if (this.weather !== 'clear') {
      this.tickAccumulation(world, ticks, playerPos);
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

      const topY = world.getHeight(x, z);
      const biome = world.getBiome(x, z);
      const precip = getPrecipitationType(biome, topY);

      if (precip === 'snow') {
        const topBlock = world.getBlock(x, topY, z);
        const skyLight = world.getLight(x, topY + 1, z).sky;

        if (skyLight >= 14) {
          if (topBlock.id === 'water') {
            // Still water freezes to ice
            world.setBlock(x, topY, z, 'ice');
          } else if (
            topBlock.id !== 'air' &&
            topBlock.id !== 'ice' &&
            topBlock.id !== 'snow_layer' &&
            topBlock.id !== 'water' &&
            topBlock.id !== 'lava'
          ) {
            const above = world.getBlock(x, topY + 1, z);
            if (above.id === 'air') {
              // Accumulate snow layer
              world.setBlock(x, topY + 1, z, 'snow_layer');
            }
          }
        }
      }
    }
  }
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
