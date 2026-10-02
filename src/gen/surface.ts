import { ChunkColumn } from '../world/column';
import { TerrainStage } from './pipeline';
import { sampleBiome, BIOME_DEFINITIONS, OverworldBiomeId } from './biomes';
import { BlockRegistry } from '../world/blocks/registry';
import { deriveSeed } from '../engine/rng';
import { makeSimplex2D } from './noise';

const CLAYROCK_PALETTE = [
  'clayrock_white',
  'clayrock_orange',
  'clayrock_magenta',
  'clayrock_light_blue',
  'clayrock_yellow',
  'clayrock_lime',
  'clayrock_pink',
  'clayrock_gray',
];

export function generateSurfaceRules(
  stageSeed: number,
  cx: number,
  cz: number,
  column: ChunkColumn,
): void {
  const worldSeed = column.worldSeed;
  if (worldSeed === undefined) {
    throw new Error('generateSurfaceRules requires column.worldSeed to be set');
  }
  const registry = BlockRegistry.getInstance();

  const airState = 0;
  const stoneState = registry.getDefaultStateId('stone') ?? 1;
  const waterState = registry.getDefaultStateId('water') ?? 1;
  const sandState = registry.getDefaultStateId('sand') ?? 1;
  const gravelState = registry.getDefaultStateId('gravel') ?? 1;
  const clayState = registry.getDefaultStateId('clay') ?? 1;
  const snowState = registry.getDefaultStateId('snow') ?? 1;

  const patchNoise = makeSimplex2D(deriveSeed(stageSeed, 'surface_patches'));

  const baseWorldX = cx * 16;
  const baseWorldZ = cz * 16;

  // Initialize or fetch column biomes (16x16) and tint map (16x16x3 grass, 16x16x3 foliage)
  const biomes = column.biomes;
  const grassTints = column.grassTints;
  const foliageTints = column.foliageTints;

  // Pre-sample biomes & tints for 28x28 grid around column (-6..+21 relative to base)
  const pad = 6;
  const gridDim = 16 + pad * 2; // 28
  const gridG = new Float32Array(gridDim * gridDim * 3);
  const gridF = new Float32Array(gridDim * gridDim * 3);

  for (let gz = 0; gz < gridDim; gz++) {
    const wz = baseWorldZ - pad + gz;
    for (let gx = 0; gx < gridDim; gx++) {
      const wx = baseWorldX - pad + gx;
      const b = sampleBiome(worldSeed, wx, wz);
      const def = BIOME_DEFINITIONS[b];
      const gIdx = (gz * gridDim + gx) * 3;
      gridG[gIdx] = def.grassTint[0];
      gridG[gIdx + 1] = def.grassTint[1];
      gridG[gIdx + 2] = def.grassTint[2];

      gridF[gIdx] = def.foliageTint[0];
      gridF[gIdx + 1] = def.foliageTint[1];
      gridF[gIdx + 2] = def.foliageTint[2];
    }
  }

  // 1. Biome determination and 13x13 pre-sampled tint blending
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const idx = z * 16 + x;
      biomes[idx] = sampleBiome(worldSeed, baseWorldX + x, baseWorldZ + z);

      let rG = 0,
        gG = 0,
        bG = 0;
      let rF = 0,
        gF = 0,
        bF = 0;

      for (let dz = 0; dz < 13; dz++) {
        const gz = z + dz;
        for (let dx = 0; dx < 13; dx++) {
          const gx = x + dx;
          const gIdx = (gz * gridDim + gx) * 3;
          rG += gridG[gIdx]!;
          gG += gridG[gIdx + 1]!;
          bG += gridG[gIdx + 2]!;

          rF += gridF[gIdx]!;
          gF += gridF[gIdx + 1]!;
          bF += gridF[gIdx + 2]!;
        }
      }

      grassTints[idx * 3] = Math.round(rG / 169);
      grassTints[idx * 3 + 1] = Math.round(gG / 169);
      grassTints[idx * 3 + 2] = Math.round(bG / 169);

      foliageTints[idx * 3] = Math.round(rF / 169);
      foliageTints[idx * 3 + 1] = Math.round(gF / 169);
      foliageTints[idx * 3 + 2] = Math.round(bF / 169);
    }
  }

  // 2. Apply Surface Rules column by column
  for (let z = 0; z < 16; z++) {
    const wz = baseWorldZ + z;
    for (let x = 0; x < 16; x++) {
      const wx = baseWorldX + x;
      const colIdx = z * 16 + x;
      const biomeId = biomes[colIdx]! as OverworldBiomeId;
      const biomeDef = BIOME_DEFINITIONS[biomeId];
      const rules = biomeDef.surfaceRules;

      // Find highest solid stone/terrain block
      let topY = -1;
      for (let y = 319; y >= 0; y--) {
        const state = column.getBlockStateId(x, y, z);
        if (state !== airState && state !== waterState) {
          topY = y;
          break;
        }
      }

      if (topY < 0) continue; // Pure air or water column

      const topState = column.getBlockStateId(x, topY, z);
      const isWaterAbove = column.getBlockStateId(x, topY + 1, z) === waterState;

      // Steep slope / cliff check: count height diffs with 4 orthogonal neighbors
      let maxSlope = 0;
      const offsets: [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const offset of offsets) {
        const dx = offset[0];
        const dz = offset[1];
        // Sample height offset
        let neighborTopY = topY;
        for (let ny = Math.min(319, topY + 10); ny >= Math.max(0, topY - 10); ny--) {
          const s = column.getBlockStateId((x + dx + 16) % 16, ny, (z + dz + 16) % 16);
          if (s !== airState && s !== waterState) {
            neighborTopY = ny;
            break;
          }
        }
        const slope = Math.abs(topY - neighborTopY);
        if (slope > maxSlope) maxSlope = slope;
      }

      const isCliff = maxSlope >= 4;

      // Rule: Steep slopes expose stone in every biome
      if (isCliff && topState === stoneState) {
        // Leave stone exposed, optional gravel patch
        continue;
      }

      // Water bed rules
      if (isWaterAbove) {
        const waterDepth = 64 - topY; // distance below sea level
        if (biomeId === 'river') {
          // River beds: sand and gravel with clay patches
          const n = patchNoise(wx * 0.08, wz * 0.08);
          if (n > 0.3) {
            column.setBlockStateId(x, topY, z, clayState);
          } else if (n < -0.2) {
            column.setBlockStateId(x, topY, z, gravelState);
          } else {
            column.setBlockStateId(x, topY, z, sandState);
          }
        } else if (waterDepth > 8 || biomeId === 'deep_ocean') {
          // Deep ocean floors: gravel
          column.setBlockStateId(x, topY, z, gravelState);
        } else {
          // Shallow ocean floors: sand
          column.setBlockStateId(x, topY, z, sandState);
        }

        // Filler layers under water
        for (let dy = 1; dy < rules.depth; dy++) {
          if (topY - dy > 4) {
            const currentState = column.getBlockStateId(x, topY - dy, z);
            if (currentState === stoneState) {
              column.setBlockStateId(x, topY - dy, z, gravelState);
            }
          }
        }
        continue;
      }

      // Dry surface rules per biome
      const topBlockState = registry.getDefaultStateId(rules.topBlock) ?? stoneState;
      const fillerBlockState = registry.getDefaultStateId(rules.fillerBlock) ?? stoneState;

      // Badlands Clayrock strata check
      if (rules.hasClayrockStrata) {
        column.setBlockStateId(x, topY, z, topBlockState);
        for (let dy = 1; dy < rules.depth; dy++) {
          if (topY - dy > 4) {
            const clayrockColor = CLAYROCK_PALETTE[(topY - dy) % 8]!;
            const clayrockState = registry.getDefaultStateId(clayrockColor) ?? stoneState;
            column.setBlockStateId(x, topY - dy, z, clayrockState);
          }
        }
        continue;
      }

      // Swampland Mire patches
      if (rules.hasMirePatches) {
        const n = patchNoise(wx * 0.1, wz * 0.1);
        if (n > 0.25) {
          const mireState = registry.getDefaultStateId('mire') ?? topBlockState;
          column.setBlockStateId(x, topY, z, mireState);
        } else {
          column.setBlockStateId(x, topY, z, topBlockState);
        }
        for (let dy = 1; dy < rules.depth; dy++) {
          if (topY - dy > 4) {
            column.setBlockStateId(x, topY - dy, z, fillerBlockState);
          }
        }
        continue;
      }

      // Stony heights gravel patches
      if (rules.hasGravelPatches && biomeId === 'stony_heights') {
        const n = patchNoise(wx * 0.08, wz * 0.08);
        if (n > 0.2) {
          column.setBlockStateId(x, topY, z, gravelState);
        } else {
          column.setBlockStateId(x, topY, z, stoneState);
        }
        continue;
      }

      // Default top + filler replacement
      column.setBlockStateId(x, topY, z, topBlockState);
      for (let dy = 1; dy < rules.depth; dy++) {
        if (topY - dy > 4) {
          const curr = column.getBlockStateId(x, topY - dy, z);
          if (curr === stoneState) {
            column.setBlockStateId(x, topY - dy, z, fillerBlockState);
          }
        }
      }

      // Snow top layer for snowy biomes above snowline
      if (rules.hasSnowTop && topY >= (rules.snowlineY ?? 64)) {
        column.setBlockStateId(x, topY + 1, z, snowState);
      }
    }
  }
}

export const biomeSurfaceStage: TerrainStage = {
  name: 'biome_surface',
  generate: generateSurfaceRules,
};
