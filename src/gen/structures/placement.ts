import placementData from '../../../data/structures/placement.json';
import { deriveSeed, hash3 } from '../../engine/rng';
import { sampleBiome, type OverworldBiomeId } from '../biomes';

export interface StructurePlacementConfig {
  readonly id: string;
  /** Region width in chunks. */
  readonly spacing: number;
  /** Minimum empty distance between candidates, in chunks. */
  readonly separation: number;
  readonly salt: string;
  readonly biomes: readonly OverworldBiomeId[];
}

export interface StructureStart {
  readonly id: string;
  readonly regionX: number;
  readonly regionZ: number;
  readonly chunkX: number;
  readonly chunkZ: number;
  /** Block coordinates at the candidate chunk center. */
  readonly x: number;
  readonly z: number;
}

export interface StructureBounds {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

export type StructureNear =
  readonly [x: number, z: number] | readonly [x: number, y: number, z: number];

export type BiomeSampler = (worldSeed: number, x: number, z: number) => string;

const rawPlacementData = placementData as StructurePlacementConfig[];

function validateConfigs(configs: readonly StructurePlacementConfig[]): void {
  const ids = new Set<string>();
  for (const config of configs) {
    if (
      !config.id ||
      ids.has(config.id) ||
      !Number.isSafeInteger(config.spacing) ||
      config.spacing <= 0 ||
      !Number.isSafeInteger(config.separation) ||
      config.separation < 0 ||
      config.separation >= config.spacing ||
      !config.salt ||
      !Array.isArray(config.biomes) ||
      config.biomes.length === 0
    ) {
      throw new Error('Invalid structure placement configuration');
    }
    ids.add(config.id);
  }
}

validateConfigs(rawPlacementData);

/** Frozen source data; callers can pass their own configs to createPlacementGrid for testing. */
export const STRUCTURE_PLACEMENT_CONFIGS: readonly StructurePlacementConfig[] = Object.freeze(
  rawPlacementData.map((config) =>
    Object.freeze({ ...config, biomes: Object.freeze([...config.biomes]) }),
  ),
);

export interface PlacementGrid {
  candidateAtRegion(id: string, regionX: number, regionZ: number): StructureStart | null;
  within(id: string, bounds: StructureBounds): StructureStart[];
  locateNearest(id: string, near: StructureNear, maxDistance: number): StructureStart | null;
}

function integerChunkFromBlock(block: number): number {
  return Math.floor(block / 16);
}

function regionForChunk(chunk: number, spacing: number): number {
  return Math.floor(chunk / spacing);
}

/**
 * Creates a deterministic view of the placement grid for one world. The returned functions have
 * no mutable state and always sample the real biome function unless a sampler is injected.
 */
export function createPlacementGrid(
  worldSeed: number,
  configs: readonly StructurePlacementConfig[] = STRUCTURE_PLACEMENT_CONFIGS,
  biomeSampler: BiomeSampler = sampleBiome,
): PlacementGrid {
  validateConfigs(configs);

  function configFor(id: string): StructurePlacementConfig | undefined {
    return configs.find((candidate) => candidate.id === id);
  }

  function candidateAtRegion(id: string, regionX: number, regionZ: number): StructureStart | null {
    const config = configFor(id);
    if (!config) return null;
    const seed = deriveSeed(worldSeed, config.salt);
    const offsetRange = config.spacing - config.separation;
    const offsetX = Math.floor(hash3(seed, regionX, 0, regionZ) * offsetRange);
    const offsetZ = Math.floor(hash3(seed, regionX, 1, regionZ) * offsetRange);
    const chunkX = regionX * config.spacing + offsetX;
    const chunkZ = regionZ * config.spacing + offsetZ;
    const x = chunkX * 16 + 8;
    const z = chunkZ * 16 + 8;
    if (!config.biomes.includes(biomeSampler(worldSeed, x, z) as OverworldBiomeId)) return null;
    return { id, regionX, regionZ, chunkX, chunkZ, x, z };
  }

  function within(id: string, bounds: StructureBounds): StructureStart[] {
    const config = configFor(id);
    if (!config) return [];
    if (
      !Number.isFinite(bounds.minX) ||
      !Number.isFinite(bounds.minZ) ||
      !Number.isFinite(bounds.maxX) ||
      !Number.isFinite(bounds.maxZ) ||
      bounds.maxX < bounds.minX ||
      bounds.maxZ < bounds.minZ
    ) {
      throw new Error('Invalid structure placement bounds');
    }
    const minChunkX = integerChunkFromBlock(bounds.minX);
    const minChunkZ = integerChunkFromBlock(bounds.minZ);
    const maxChunkX = integerChunkFromBlock(bounds.maxX);
    const maxChunkZ = integerChunkFromBlock(bounds.maxZ);
    const maxOffset = config.spacing - config.separation - 1;
    const minRegionX = regionForChunk(minChunkX - maxOffset, config.spacing);
    const minRegionZ = regionForChunk(minChunkZ - maxOffset, config.spacing);
    const maxRegionX = regionForChunk(maxChunkX, config.spacing);
    const maxRegionZ = regionForChunk(maxChunkZ, config.spacing);
    const starts: StructureStart[] = [];
    for (let regionZ = minRegionZ; regionZ <= maxRegionZ; regionZ++) {
      for (let regionX = minRegionX; regionX <= maxRegionX; regionX++) {
        const start = candidateAtRegion(id, regionX, regionZ);
        if (
          start &&
          start.x >= bounds.minX &&
          start.x <= bounds.maxX &&
          start.z >= bounds.minZ &&
          start.z <= bounds.maxZ
        ) {
          starts.push(start);
        }
      }
    }
    return starts;
  }

  function locateNearest(
    id: string,
    near: StructureNear,
    maxDistance: number,
  ): StructureStart | null {
    if (!Number.isFinite(maxDistance) || maxDistance < 0) {
      throw new Error('maxDistance must be a non-negative finite number');
    }
    const nearX = near[0];
    const nearZ = near.length === 3 ? near[2] : near[1];
    if (!Number.isFinite(nearX) || !Number.isFinite(nearZ)) {
      throw new Error('Structure search position must be finite');
    }
    const candidates = within(id, {
      minX: nearX - maxDistance,
      minZ: nearZ - maxDistance,
      maxX: nearX + maxDistance,
      maxZ: nearZ + maxDistance,
    });
    let nearest: StructureStart | null = null;
    let nearestDistance = Infinity;
    for (const candidate of candidates) {
      const distance = Math.hypot(candidate.x - nearX, candidate.z - nearZ);
      if (
        distance <= maxDistance &&
        (distance < nearestDistance ||
          (distance === nearestDistance &&
            (candidate.chunkX < nearest!.chunkX ||
              (candidate.chunkX === nearest!.chunkX && candidate.chunkZ < nearest!.chunkZ))))
      ) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  return Object.freeze({ candidateAtRegion, within, locateNearest });
}

export function locateNearest(
  worldSeed: number,
  id: string,
  near: StructureNear,
  maxDistance: number,
): StructureStart | null {
  return createPlacementGrid(worldSeed).locateNearest(id, near, maxDistance);
}
