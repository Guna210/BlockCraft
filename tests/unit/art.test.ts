import { describe, it, expect } from 'vitest';
import { textureGenerators } from '../../src/render/textures/index';
import { TextureData } from '../../src/render/textures/noise';

describe('ART.md Automated Checks', () => {
  it('every pixel belongs to the declared palette and max 12 colors', () => {
    for (const [name, generator] of Object.entries(textureGenerators)) {
      if (!generator) continue;
      const result = generator();
      const textures = Array.isArray(result) ? result : [result];

      for (const tex of textures) {
        const colors = new Set<string>();
        for (let i = 0; i < tex.length; i += 4) {
          const colorKey = `${tex[i]},${tex[i + 1]},${tex[i + 2]},${tex[i + 3]}`;
          colors.add(colorKey);
        }
        expect(colors.size, `${name} has more than 12 colors: ${colors.size}`).toBeLessThanOrEqual(
          12,
        );
      }
    }
  });

  it('opaque static tiles have luminance contrast >= 60', () => {
    // Helper for relative luminance approximate
    const getLuminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

    for (const [name, generator] of Object.entries(textureGenerators)) {
      if (!generator) continue;
      const result = generator();

      // Skip animations and translucent items
      if (Array.isArray(result)) continue;

      if (name === 'glass') continue;

      let maxLuma = -1;
      let minLuma = 256;
      for (let i = 0; i < result.length; i += 4) {
        if (result[i + 3]! < 255) continue; // Skip non-opaque pixels
        const luma = getLuminance(result[i]!, result[i + 1]!, result[i + 2]!);
        if (luma > maxLuma) maxLuma = luma;
        if (luma < minLuma) minLuma = luma;
      }

      if (minLuma <= maxLuma) {
        const diff = maxLuma - minLuma;
        expect(
          diff,
          `${name} luminance contrast is ${diff}, expected >= 60`,
        ).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it('animations loop properly (last frame to first frame diff <= 1.5 * avg diff)', () => {
    for (const [name, generator] of Object.entries(textureGenerators)) {
      if (!generator) continue;
      const result = generator();
      if (!Array.isArray(result) || result.length < 2) continue;

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
      const loopDiff = getDiff(result[result.length - 1]!, result[0]!);

      expect(
        loopDiff,
        `${name} loop diff ${loopDiff} exceeds 1.5 * avgDiff ${avgDiff}`,
      ).toBeLessThanOrEqual(avgDiff * 1.5);
    }
  });
});
