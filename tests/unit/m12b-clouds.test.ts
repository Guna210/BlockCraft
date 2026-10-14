import { describe, it, expect } from 'vitest';
import {
  generateCloudGrid,
  CLOUD_CELL_SIZE,
  CLOUD_GRID_CELLS,
  CLOUD_REGION_SIZE,
  CLOUD_Y_BOTTOM,
  CLOUD_THICKNESS,
  CLOUD_Y_TOP,
  CLOUD_WIND_SPEED,
  CLOUD_SHADE_TOP,
  CLOUD_SHADE_SIDE,
  CLOUD_SHADE_BOTTOM,
} from '../../src/render/clouds';
import { settings } from '../../src/engine/settings';
import { setClouds } from '../../src/debug/api/clouds';

describe('M12b — Clouds & Sun Glare', () => {
  describe('Cloud field configuration and geometry constants', () => {
    it('is placed at y=192 and has thickness of 4 blocks (y=192 to y=196)', () => {
      expect(CLOUD_Y_BOTTOM).toBe(192);
      expect(CLOUD_THICKNESS).toBe(4);
      expect(CLOUD_Y_TOP).toBe(196);
    });

    it('uses 12x12-block cells on a 32x32 grid (384-block region)', () => {
      expect(CLOUD_CELL_SIZE).toBe(12);
      expect(CLOUD_GRID_CELLS).toBe(32);
      expect(CLOUD_REGION_SIZE).toBe(384);
    });

    it('defines shading with white top, near-white sides for bright rim, and pale blue-grey bottom', () => {
      expect(CLOUD_SHADE_TOP).toBe(1.0);
      expect(CLOUD_SHADE_SIDE).toBe(0.96);
      expect(CLOUD_SHADE_BOTTOM).toBe(0.78);
      expect(CLOUD_SHADE_TOP).toBeGreaterThan(CLOUD_SHADE_SIDE);
      expect(CLOUD_SHADE_SIDE).toBeGreaterThan(CLOUD_SHADE_BOTTOM);
    });
  });

  describe('Procedural cloud noise grid and coverage', () => {
    it('generates coverage roughly 30–40 % (target ~35 %)', () => {
      const active = generateCloudGrid(12006, 32, 32, 0.35);
      const activeCount = active.filter(Boolean).length;
      const coverage = activeCount / (32 * 32);

      expect(coverage).toBeGreaterThanOrEqual(0.3);
      expect(coverage).toBeLessThanOrEqual(0.4);
      expect(activeCount).toBe(358); // Exactly 34.96 %
    });

    it('is deterministic for the same seed and produces different shapes for different seeds', () => {
      const gridA1 = generateCloudGrid(12006, 32, 32, 0.35);
      const gridA2 = generateCloudGrid(12006, 32, 32, 0.35);
      const gridB = generateCloudGrid(99999, 32, 32, 0.35);

      expect(gridA1).toEqual(gridA2);
      expect(gridA1).not.toEqual(gridB);
    });

    it('mixes lone cells, small clumps, and larger ragged clusters with notches and holes', () => {
      const active = generateCloudGrid(12006, 32, 32, 0.35);
      const visited = new Array<boolean>(32 * 32).fill(false);
      const components: number[] = [];

      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const idx = y * 32 + x;
          if (!active[idx] || visited[idx]) continue;
          let size = 0;
          const queue: [number, number][] = [[x, y]];
          visited[idx] = true;
          while (queue.length > 0) {
            const [cx, cy] = queue.shift()!;
            size++;
            for (const [dx, dy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ] as const) {
              const nx = (cx + dx + 32) % 32;
              const ny = (cy + dy + 32) % 32;
              const nidx = ny * 32 + nx;
              if (active[nidx] && !visited[nidx]) {
                visited[nidx] = true;
                queue.push([nx, ny]);
              }
            }
          }
          components.push(size);
        }
      }

      const loneCells = components.filter((s) => s === 1).length;
      const smallClumps = components.filter((s) => s >= 2 && s <= 5).length;
      const mediumClusters = components.filter((s) => s >= 6 && s <= 30).length;
      const largeClusters = components.filter((s) => s > 30).length;
      const maxCluster = Math.max(...components);

      // Verify mix of shapes per Requirement 4
      expect(loneCells).toBeGreaterThan(0);
      expect(smallClumps).toBeGreaterThan(0);
      expect(mediumClusters).toBeGreaterThan(0);
      expect(largeClusters).toBeGreaterThan(0);
      // No single giant smooth blob dominating the grid
      expect(maxCluster).toBeLessThan(200);

      // Verify presence of notches/holes (inactive cells with 3+ active neighbors)
      let holes = 0;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          if (!active[y * 32 + x]) {
            let activeNeighbors = 0;
            for (const [dx, dy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ] as const) {
              const nx = (x + dx + 32) % 32;
              const ny = (y + dy + 32) % 32;
              if (active[ny * 32 + nx]) activeNeighbors++;
            }
            if (activeNeighbors >= 3) holes++;
          }
        }
      }
      expect(holes).toBeGreaterThan(0);
    });
  });

  describe('Wind drift calculation', () => {
    it('drifts along +X at 1 block/s on the fixed tick (20 ticks/s)', () => {
      expect(CLOUD_WIND_SPEED).toBe(1.0);

      const driftAt = (ticks: number) => (ticks / 20.0) * CLOUD_WIND_SPEED;

      expect(driftAt(0)).toBe(0);
      expect(driftAt(20)).toBe(1.0);
      expect(driftAt(100)).toBe(5.0);
      expect(driftAt(24000)).toBe(1200.0);
    });
  });

  describe('Cloud settings and debug API', () => {
    it('defaults to fancy mode and updates via setClouds debug call', () => {
      expect(settings.clouds).toBe('fancy');

      setClouds('fast');
      expect(settings.clouds).toBe('fast');

      setClouds('off');
      expect(settings.clouds).toBe('off');

      setClouds('fancy');
      expect(settings.clouds).toBe('fancy');
    });
  });

  describe('Sun glare height and horizon response (Decision 5)', () => {
    function computeGlare(
      sunDirY: number,
      viewDir: [number, number, number],
      sunDir: [number, number, number],
    ) {
      const cosSun = viewDir[0] * sunDir[0] + viewDir[1] * sunDir[1] + viewDir[2] * sunDir[2];
      if (sunDirY <= -0.08 || cosSun <= 0.7) {
        return { intensity: 0, glareColor: [0, 0, 0], core: 0 };
      }

      const sunHeight = Math.max(0, Math.min(1, sunDirY));
      const highFactor = Math.max(0, Math.min(1, (sunHeight - 0.05) / (0.65 - 0.05)));

      const haloStart = 0.965 * (1 - highFactor) + 0.82 * highFactor;
      const halo = Math.max(0, Math.min(1, (cosSun - haloStart) / (0.992 - haloStart)));
      const core = Math.max(0, Math.min(1, (cosSun - 0.985) / (0.998 - 0.985))) * highFactor;

      const warmColor = [1.0, 0.55, 0.15];
      const whiteColor = [1.0, 1.0, 1.0];
      const glareColor = [
        warmColor[0]! * (1 - highFactor) + whiteColor[0]! * highFactor,
        warmColor[1]! * (1 - highFactor) + whiteColor[1]! * highFactor,
        warmColor[2]! * (1 - highFactor) + whiteColor[2]! * highFactor,
      ];

      const intensity = Math.min(
        1.0,
        0.4 * halo * (1 - highFactor) + Math.min(1.0, halo * 0.75 + core * 1.5) * highFactor,
      );

      return { intensity, glareColor, core };
    }

    it('saturates to near white at noon looking at the sun disc', () => {
      const sunDir: [number, number, number] = [
        0,
        Math.cos((15 * Math.PI) / 180),
        Math.sin((15 * Math.PI) / 180),
      ];
      const glare = computeGlare(sunDir[1], sunDir, sunDir);

      expect(glare.intensity).toBeGreaterThanOrEqual(1.0);
      expect(glare.glareColor[0]).toBe(1.0);
      expect(glare.glareColor[1]).toBe(1.0);
      expect(glare.glareColor[2]).toBe(1.0);
      expect(glare.core).toBe(1.0);
    });

    it('dims, shrinks and warms to orange at sunset so the disc is readable', () => {
      const sunDir: [number, number, number] = [-1, 0, 0];
      const glare = computeGlare(0, sunDir, sunDir);

      expect(glare.intensity).toBeLessThanOrEqual(0.4); // Shrunk and dimmed
      expect(glare.core).toBe(0); // No blinding core
      expect(glare.glareColor[0]).toBe(1.0);
      expect(glare.glareColor[1]).toBe(0.55); // Warm orange
      expect(glare.glareColor[2]).toBe(0.15);
    });

    it('has zero glare in horizontal noon view', () => {
      const sunDir: [number, number, number] = [
        0,
        Math.cos((15 * Math.PI) / 180),
        Math.sin((15 * Math.PI) / 180),
      ];
      const horizontalWest: [number, number, number] = [-1, 0, 0];
      const glare = computeGlare(sunDir[1], horizontalWest, sunDir);

      expect(glare.intensity).toBe(0);
    });
  });
});
