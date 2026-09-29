export interface Mood {
  scale: {
    root: number; // 0-11
    mode: string;
  };
  tempo: number;
  register: number; // MIDI base pitch
  density: number; // 0-1
}

export const BIOME_IDS = [
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
  'glowcap_forest',
  'magma_sea',
  'driftstone_expanse',
  'voidglass_geodes',
  'overworld',
  'hollowdeep',
] as const;

export type BiomeId = (typeof BIOME_IDS)[number];

const MOODS: Record<BiomeId, Mood> = {
  plains: { scale: { root: 0, mode: 'major' }, tempo: 100, register: 60, density: 0.5 },
  meadow: { scale: { root: 0, mode: 'harmonic_minor' }, tempo: 100, register: 60, density: 0.5 },
  oakwood_forest: {
    scale: { root: 0, mode: 'phrygian_dominant' },
    tempo: 100,
    register: 60,
    density: 0.5,
  },
  birch_grove: {
    scale: { root: 0, mode: 'minor_pentatonic' },
    tempo: 100,
    register: 60,
    density: 0.5,
  },
  pine_taiga: { scale: { root: 1, mode: 'major' }, tempo: 100, register: 60, density: 0.5 },
  snowy_tundra: {
    scale: { root: 1, mode: 'harmonic_minor' },
    tempo: 100,
    register: 60,
    density: 0.5,
  },
  frost_peaks: {
    scale: { root: 1, mode: 'phrygian_dominant' },
    tempo: 100,
    register: 60,
    density: 0.5,
  },
  stony_heights: {
    scale: { root: 1, mode: 'minor_pentatonic' },
    tempo: 100,
    register: 60,
    density: 0.5,
  },
  desert: { scale: { root: 2, mode: 'major' }, tempo: 100, register: 60, density: 0.5 },
  badlands: { scale: { root: 2, mode: 'harmonic_minor' }, tempo: 100, register: 60, density: 0.5 },
  savanna: {
    scale: { root: 2, mode: 'phrygian_dominant' },
    tempo: 100,
    register: 60,
    density: 0.5,
  },
  swampland: {
    scale: { root: 2, mode: 'minor_pentatonic' },
    tempo: 100,
    register: 60,
    density: 0.5,
  },
  rainforest: { scale: { root: 3, mode: 'major' }, tempo: 100, register: 60, density: 0.5 },
  beach: { scale: { root: 3, mode: 'harmonic_minor' }, tempo: 100, register: 60, density: 0.5 },
  stony_shore: {
    scale: { root: 3, mode: 'phrygian_dominant' },
    tempo: 100,
    register: 60,
    density: 0.5,
  },
  river: { scale: { root: 3, mode: 'minor_pentatonic' }, tempo: 100, register: 60, density: 0.5 },
  ocean: { scale: { root: 4, mode: 'major' }, tempo: 100, register: 60, density: 0.5 },
  deep_ocean: {
    scale: { root: 4, mode: 'harmonic_minor' },
    tempo: 100,
    register: 60,
    density: 0.5,
  },
  frozen_ocean: {
    scale: { root: 4, mode: 'phrygian_dominant' },
    tempo: 100,
    register: 60,
    density: 0.5,
  },
  glowcap_forest: {
    scale: { root: 4, mode: 'minor_pentatonic' },
    tempo: 80,
    register: 48,
    density: 0.3,
  },
  magma_sea: { scale: { root: 5, mode: 'major' }, tempo: 80, register: 48, density: 0.3 },
  driftstone_expanse: {
    scale: { root: 5, mode: 'phrygian_dominant' },
    tempo: 80,
    register: 48,
    density: 0.3,
  },
  voidglass_geodes: {
    scale: { root: 5, mode: 'minor_pentatonic' },
    tempo: 80,
    register: 48,
    density: 0.3,
  },
  overworld: { scale: { root: 6, mode: 'major' }, tempo: 100, register: 60, density: 0.5 },
  hollowdeep: {
    scale: { root: 6, mode: 'phrygian_dominant' },
    tempo: 80,
    register: 48,
    density: 0.3,
  },
};

/**
 * Gets the mood for a given context ID (biome or dimension).
 * Unknown IDs fall back to their dimension's mood, using keyword guessing
 * to distinguish Hollowdeep IDs from Overworld IDs.
 */
export function getMood(contextId: string): Mood {
  if (contextId in MOODS) {
    return MOODS[contextId as BiomeId];
  }

  // Fallback: guess the dimension based on keyword inclusion.
  if (
    contextId.includes('hollowdeep') ||
    contextId.includes('magma') ||
    contextId.includes('glowcap') ||
    contextId.includes('driftstone') ||
    contextId.includes('voidglass')
  ) {
    return MOODS['hollowdeep'];
  }

  return MOODS['overworld'];
}
