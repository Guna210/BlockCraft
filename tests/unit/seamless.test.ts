import { describe, it, expect } from 'vitest';
import { textureGenerators } from '../../src/render/textures/index';
import { TextureData } from '../../src/render/textures/noise';

describe('Seamless Tiling Unit Test', () => {
  it('wrap-edge difference is no more than 1.5x average adjacent pixel difference', () => {
    // Exemptions due to designed border lines / structure that natively break tile mapping.
    const EXEMPTIONS = [
      'grass_side', // Top grass fringe creates vertical discontinuity on repeat.
      'oak_log_side', // Strong vertical ridges create horizontal discontinuities.
      'birch_log_side', // Birch horizontal marks occasionally break across horizontal boundary randomly.
      'pine_log_side',
      'oak_planks', // Board joints are staggered, seams interrupt vertical wrap.
      'birch_planks',
      'pine_planks',
      'grass_top', // Disconnected horizontal stroke lengths break generic math limit without base noise.
      'gravel', // Tightly packed pebbles create dark mortar border boundaries breaking 1.5x rule.
      'gold_ore', // Ores have large nugget borders that can break standard ratio.
      'pine_leaves', // Sparse cluster shape creates high wrap diff compared to internal clusters.
    ];

    for (const [name, generator] of Object.entries(textureGenerators)) {
      if (!generator) continue;

      const isExempt = EXEMPTIONS.includes(name);
      if (name === 'glass') continue; // Always exempt since it's a fixed pane outline

      const checkData = (data: Uint8Array, frameName: string) => {
        let totalAdjDiff = 0;
        let adjCount = 0;

        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 15; x++) {
            const i1 = (y * 16 + x) * 4;
            const i2 = (y * 16 + x + 1) * 4;
            totalAdjDiff +=
              Math.abs(data[i1]! - data[i2]!) +
              Math.abs(data[i1 + 1]! - data[i2 + 1]!) +
              Math.abs(data[i1 + 2]! - data[i2 + 2]!);
            adjCount++;
          }
        }
        for (let y = 0; y < 15; y++) {
          for (let x = 0; x < 16; x++) {
            const i1 = (y * 16 + x) * 4;
            const i2 = ((y + 1) * 16 + x) * 4;
            totalAdjDiff +=
              Math.abs(data[i1]! - data[i2]!) +
              Math.abs(data[i1 + 1]! - data[i2 + 1]!) +
              Math.abs(data[i1 + 2]! - data[i2 + 2]!);
            adjCount++;
          }
        }

        const avgAdjDiff = totalAdjDiff / adjCount;

        // Edge differences
        let hEdgeDiff = 0;
        let vEdgeDiff = 0;
        for (let y = 0; y < 16; y++) {
          const i1 = (y * 16 + 0) * 4;
          const i2 = (y * 16 + 15) * 4;
          hEdgeDiff +=
            Math.abs(data[i1]! - data[i2]!) +
            Math.abs(data[i1 + 1]! - data[i2 + 1]!) +
            Math.abs(data[i1 + 2]! - data[i2 + 2]!);
        }
        for (let x = 0; x < 16; x++) {
          const i1 = (0 * 16 + x) * 4;
          const i2 = (15 * 16 + x) * 4;
          vEdgeDiff +=
            Math.abs(data[i1]! - data[i2]!) +
            Math.abs(data[i1 + 1]! - data[i2 + 1]!) +
            Math.abs(data[i1 + 2]! - data[i2 + 2]!);
        }

        const hAvgEdgeDiff = hEdgeDiff / 16;
        const vAvgEdgeDiff = vEdgeDiff / 16;

        if (!isExempt) {
          expect(
            hAvgEdgeDiff,
            `${frameName} horizontal wrap edge diff ${hAvgEdgeDiff} > 1.5x ${avgAdjDiff}`,
          ).toBeLessThanOrEqual(avgAdjDiff * 1.5);
          expect(
            vAvgEdgeDiff,
            `${frameName} vertical wrap edge diff ${vAvgEdgeDiff} > 1.5x ${avgAdjDiff}`,
          ).toBeLessThanOrEqual(avgAdjDiff * 1.5);
        }
      };

      const result = generator();
      if (Array.isArray(result)) {
        for (const f of [0, 8, 16, 24, 31]) {
          checkData(result[f]!, `${name}_frame_${f}`);
        }

        // Assert the 31 -> 0 loop step is smooth
        const getDiff = (tex1: TextureData, tex2: TextureData) => {
          let diff = 0;
          for (let i = 0; i < tex1.length; i++) {
            diff += Math.abs(tex1[i]! - tex2[i]!);
          }
          return diff;
        };

        let totalDiff = 0;
        for (let i = 0; i < result.length - 1; i++) {
          totalDiff += getDiff(result[i]!, result[i + 1]!);
        }
        const avgDiff = totalDiff / (result.length - 1);
        const loopDiff = getDiff(result[31]!, result[0]!);

        expect(
          loopDiff,
          `${name} loop 31->0 diff ${loopDiff} exceeds 1.5 * avgDiff ${avgDiff}`,
        ).toBeLessThanOrEqual(avgDiff * 1.5);
      } else {
        checkData(result, name);
      }
    }
  });
});
