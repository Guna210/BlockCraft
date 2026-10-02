import { deriveSeed } from '../engine/rng';
import { makeSimplex2D, makeFbm2D } from './noise';
import { sampleTerrainClimate, TerrainClimateSample, SEA_LEVEL } from './terrain';

export const OVERWORLD_BIOME_IDS = [
  'plains',
  'meadow',
  'oakwood_forest',
  'birch_grove',
  'pine_taiga',
  'snowy_tundra',
  'frost_peaks',
  'stony_heights',
  'desert',
  'badlands',
  'savanna',
  'swampland',
  'rainforest',
  'beach',
  'stony_shore',
  'river',
  'ocean',
  'deep_ocean',
  'frozen_ocean',
] as const;

export type OverworldBiomeId = (typeof OVERWORLD_BIOME_IDS)[number];

export interface SurfaceRules {
  topBlock: string;
  fillerBlock: string;
  depth: number;
  hasClayrockStrata?: boolean;
  hasMirePatches?: boolean;
  hasSnowTop?: boolean;
  snowlineY?: number;
  hasGravelPatches?: boolean;
  hasClayPatches?: boolean;
}

export interface BiomeDefinition {
  id: OverworldBiomeId;
  temperature: number;
  humidity: number;
  grassTint: [number, number, number];
  foliageTint: [number, number, number];
  surfaceRules: SurfaceRules;
}

export const BIOME_DEFINITIONS: Record<OverworldBiomeId, BiomeDefinition> = {
  plains: {
    id: 'plains',
    temperature: 0.55,
    humidity: 0.4,
    grassTint: [124, 189, 71],
    foliageTint: [119, 177, 58],
    surfaceRules: { topBlock: 'grass_block', fillerBlock: 'dirt', depth: 4 },
  },
  meadow: {
    id: 'meadow',
    temperature: 0.5,
    humidity: 0.5,
    grassTint: [100, 200, 90],
    foliageTint: [90, 190, 80],
    surfaceRules: { topBlock: 'grass_block', fillerBlock: 'dirt', depth: 4 },
  },
  oakwood_forest: {
    id: 'oakwood_forest',
    temperature: 0.6,
    humidity: 0.65,
    grassTint: [95, 175, 65],
    foliageTint: [85, 165, 55],
    surfaceRules: { topBlock: 'grass_block', fillerBlock: 'dirt', depth: 4 },
  },
  birch_grove: {
    id: 'birch_grove',
    temperature: 0.4,
    humidity: 0.5,
    grassTint: [130, 195, 95],
    foliageTint: [112, 182, 82],
    surfaceRules: { topBlock: 'grass_block', fillerBlock: 'dirt', depth: 4 },
  },
  pine_taiga: {
    id: 'pine_taiga',
    temperature: 0.25,
    humidity: 0.6,
    grassTint: [80, 140, 90],
    foliageTint: [60, 120, 75],
    surfaceRules: { topBlock: 'grass_block', fillerBlock: 'dirt', depth: 4 },
  },
  snowy_tundra: {
    id: 'snowy_tundra',
    temperature: 0.1,
    humidity: 0.3,
    grassTint: [140, 170, 150],
    foliageTint: [120, 150, 130],
    surfaceRules: {
      topBlock: 'grass_block',
      fillerBlock: 'dirt',
      depth: 4,
      hasSnowTop: true,
      snowlineY: 64,
    },
  },
  frost_peaks: {
    id: 'frost_peaks',
    temperature: 0.05,
    humidity: 0.4,
    grassTint: [130, 160, 150],
    foliageTint: [110, 140, 130],
    surfaceRules: {
      topBlock: 'stone',
      fillerBlock: 'stone',
      depth: 4,
      hasSnowTop: true,
      snowlineY: 90,
    },
  },
  stony_heights: {
    id: 'stony_heights',
    temperature: 0.3,
    humidity: 0.3,
    grassTint: [110, 145, 95],
    foliageTint: [95, 130, 80],
    surfaceRules: {
      topBlock: 'stone',
      fillerBlock: 'stone',
      depth: 4,
      hasGravelPatches: true,
    },
  },
  desert: {
    id: 'desert',
    temperature: 0.95,
    humidity: 0.05,
    grassTint: [190, 180, 80],
    foliageTint: [170, 160, 70],
    surfaceRules: { topBlock: 'sand', fillerBlock: 'sand', depth: 5 },
  },
  badlands: {
    id: 'badlands',
    temperature: 0.9,
    humidity: 0.2,
    grassTint: [160, 130, 60],
    foliageTint: [140, 110, 50],
    surfaceRules: {
      topBlock: 'red_sand',
      fillerBlock: 'red_sand',
      depth: 5,
      hasClayrockStrata: true,
    },
  },
  savanna: {
    id: 'savanna',
    temperature: 0.8,
    humidity: 0.35,
    grassTint: [180, 170, 70],
    foliageTint: [160, 150, 60],
    surfaceRules: { topBlock: 'grass_block', fillerBlock: 'dirt', depth: 4 },
  },
  swampland: {
    id: 'swampland',
    temperature: 0.7,
    humidity: 0.85,
    grassTint: [60, 100, 50],
    foliageTint: [50, 85, 40],
    surfaceRules: {
      topBlock: 'grass_block',
      fillerBlock: 'dirt',
      depth: 4,
      hasMirePatches: true,
    },
  },
  rainforest: {
    id: 'rainforest',
    temperature: 0.85,
    humidity: 0.9,
    grassTint: [40, 190, 50],
    foliageTint: [30, 175, 40],
    surfaceRules: { topBlock: 'grass_block', fillerBlock: 'dirt', depth: 4 },
  },
  beach: {
    id: 'beach',
    temperature: 0.6,
    humidity: 0.4,
    grassTint: [160, 185, 80],
    foliageTint: [140, 165, 70],
    surfaceRules: { topBlock: 'sand', fillerBlock: 'sand', depth: 5 },
  },
  stony_shore: {
    id: 'stony_shore',
    temperature: 0.4,
    humidity: 0.4,
    grassTint: [120, 150, 100],
    foliageTint: [100, 130, 85],
    surfaceRules: {
      topBlock: 'stone',
      fillerBlock: 'gravel',
      depth: 4,
      hasGravelPatches: true,
    },
  },
  river: {
    id: 'river',
    temperature: 0.5,
    humidity: 0.5,
    grassTint: [100, 180, 70],
    foliageTint: [90, 165, 60],
    surfaceRules: {
      topBlock: 'sand',
      fillerBlock: 'gravel',
      depth: 3,
      hasClayPatches: true,
      hasGravelPatches: true,
    },
  },
  ocean: {
    id: 'ocean',
    temperature: 0.5,
    humidity: 0.5,
    grassTint: [90, 170, 80],
    foliageTint: [80, 155, 70],
    surfaceRules: { topBlock: 'sand', fillerBlock: 'sand', depth: 3 },
  },
  deep_ocean: {
    id: 'deep_ocean',
    temperature: 0.4,
    humidity: 0.5,
    grassTint: [80, 160, 80],
    foliageTint: [70, 145, 70],
    surfaceRules: { topBlock: 'gravel', fillerBlock: 'gravel', depth: 3 },
  },
  frozen_ocean: {
    id: 'frozen_ocean',
    temperature: 0.05,
    humidity: 0.5,
    grassTint: [120, 160, 150],
    foliageTint: [100, 140, 130],
    surfaceRules: {
      topBlock: 'gravel',
      fillerBlock: 'gravel',
      depth: 3,
      hasSnowTop: true,
      snowlineY: 64,
    },
  },
};

// Scratch structures for sampling
const CLIMATE_SCRATCH: TerrainClimateSample = {
  continentalness: 0,
  erosion: 0,
  peaks: 0,
  river: 0,
  surfaceHeight: 0,
};

const COAST_SCRATCH: TerrainClimateSample = {
  continentalness: 0,
  erosion: 0,
  peaks: 0,
  river: 0,
  surfaceHeight: 0,
};

interface ClimateSamplers {
  fbmTemp: (x: number, y: number) => number;
  fbmHumid: (x: number, y: number) => number;
  offTempX: number;
  offTempZ: number;
  offHumidX: number;
  offHumidZ: number;
  terrainStageSeed: number;
}

let cachedWorldSeed: number | null = null;
let cachedSamplers: ClimateSamplers | null = null;

function getClimateSamplers(worldSeed: number): ClimateSamplers {
  if (cachedWorldSeed === worldSeed && cachedSamplers) {
    return cachedSamplers;
  }

  const terrainStageSeed = deriveSeed(worldSeed, 'terrain_shape');
  const seedTemp = deriveSeed(worldSeed, 'temperature');
  const seedHumid = deriveSeed(worldSeed, 'humidity');

  const s2Temp = makeSimplex2D(seedTemp);
  const fbmTemp = makeFbm2D(s2Temp, 3, 0.5, 2.0);

  const s2Humid = makeSimplex2D(seedHumid);
  const fbmHumid = makeFbm2D(s2Humid, 3, 0.5, 2.0);

  // Modulo wrap to avoid giant offsets
  const offTempX = (deriveSeed(worldSeed, 'temp_off_x') % 20000) - 10000;
  const offTempZ = (deriveSeed(worldSeed, 'temp_off_z') % 20000) - 10000;
  const offHumidX = (deriveSeed(worldSeed, 'humid_off_x') % 20000) - 10000;
  const offHumidZ = (deriveSeed(worldSeed, 'humid_off_z') % 20000) - 10000;

  cachedWorldSeed = worldSeed;
  cachedSamplers = {
    fbmTemp,
    fbmHumid,
    offTempX,
    offTempZ,
    offHumidX,
    offHumidZ,
    terrainStageSeed,
  };
  return cachedSamplers;
}

export function sampleBiome(worldSeed: number, wx: number, wz: number): OverworldBiomeId {
  const samplers = getClimateSamplers(worldSeed);
  sampleTerrainClimate(samplers.terrainStageSeed, wx, wz, CLIMATE_SCRATCH);

  const { erosion, peaks, river, surfaceHeight } = CLIMATE_SCRATCH;

  // Temperature and Humidity calculation with normalized contrast
  const rawTemp = samplers.fbmTemp(
    (wx + samplers.offTempX) * 0.0012,
    (wz + samplers.offTempZ) * 0.0012,
  );
  const rawHumid = samplers.fbmHumid(
    (wx + samplers.offHumidX) * 0.0012,
    (wz + samplers.offHumidZ) * 0.0012,
  );

  const normTemp = Math.max(-1, Math.min(1, rawTemp * 1.8));
  const normHumid = Math.max(-1, Math.min(1, rawHumid * 1.8));

  // Temperature decreases with surface height above sea level
  const heightLapse = Math.max(0, surfaceHeight - SEA_LEVEL) * 0.003;
  const temp = Math.max(0, Math.min(1, 0.5 + 0.5 * normTemp - heightLapse));
  const humid = Math.max(0, Math.min(1, 0.5 + 0.5 * normHumid));

  // 1. Water columns (surfaceHeight < SEA_LEVEL and not river)
  if (surfaceHeight < SEA_LEVEL && river === 0) {
    if (temp < 0.2) {
      return 'frozen_ocean';
    }
    if (surfaceHeight < SEA_LEVEL - 8) {
      return 'deep_ocean';
    }
    return 'ocean';
  }

  // 2. River channels
  if (river > 0) {
    return 'river';
  }

  // 3. High mountain biomes (frost_peaks & stony_heights)
  if (surfaceHeight >= 115 || (surfaceHeight >= 95 && peaks > 0.65)) {
    if (temp < 0.25 || surfaceHeight >= 125) {
      return 'frost_peaks';
    }
    return 'stony_heights';
  }

  // 4. Beach and Stony Shore (land columns adjacent to ocean)
  if (surfaceHeight >= SEA_LEVEL && surfaceHeight <= SEA_LEVEL + 4) {
    // Check 4-block offset to see if ocean is nearby
    sampleTerrainClimate(samplers.terrainStageSeed, wx + 4, wz, COAST_SCRATCH);
    const isWaterEast = COAST_SCRATCH.surfaceHeight < SEA_LEVEL && COAST_SCRATCH.river === 0;

    sampleTerrainClimate(samplers.terrainStageSeed, wx - 4, wz, COAST_SCRATCH);
    const isWaterWest = COAST_SCRATCH.surfaceHeight < SEA_LEVEL && COAST_SCRATCH.river === 0;

    sampleTerrainClimate(samplers.terrainStageSeed, wx, wz + 4, COAST_SCRATCH);
    const isWaterSouth = COAST_SCRATCH.surfaceHeight < SEA_LEVEL && COAST_SCRATCH.river === 0;

    sampleTerrainClimate(samplers.terrainStageSeed, wx, wz - 4, COAST_SCRATCH);
    const isWaterNorth = COAST_SCRATCH.surfaceHeight < SEA_LEVEL && COAST_SCRATCH.river === 0;

    if (isWaterEast || isWaterWest || isWaterSouth || isWaterNorth) {
      if (temp < 0.2) {
        return 'snowy_tundra';
      }
      if (erosion < -0.2 || peaks > 0.5) {
        return 'stony_shore';
      }
      return 'beach';
    }
  }

  // 5. Inland Biomes based on Temperature, Humidity, and terrain features
  if (temp < 0.25) {
    if (humid < 0.5) return 'snowy_tundra';
    return 'pine_taiga';
  }

  if (temp < 0.45) {
    if (humid < 0.25) return 'plains';
    if (humid < 0.55) return 'birch_grove';
    return 'pine_taiga';
  }

  if (temp < 0.65) {
    if (humid < 0.3) return 'plains';
    if (humid < 0.5) return 'meadow';
    if (humid > 0.75 || (humid > 0.65 && erosion > 0.0)) return 'swampland';
    return 'oakwood_forest';
  }

  // Warm / Hot biomes (temp >= 0.65)
  if (humid < 0.22) return 'desert';
  if (humid < 0.38) return 'badlands';
  if (humid < 0.68) return 'savanna';
  if (humid > 0.8 || (humid > 0.7 && erosion > 0.0)) return 'swampland';
  return 'rainforest';
}
