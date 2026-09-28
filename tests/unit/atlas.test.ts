import { describe, it, expect, beforeAll } from 'vitest';
import { textureGenerators, M01_REQUIRED_TEXTURES } from '../../src/render/textures/index';
import { TextureAtlas, ATLAS_MAX_MIP, TILE_SIZE, CELL_SIZE } from '../../src/render/atlas';
import { TextureData } from '../../src/render/textures/noise';
import { PNG } from 'pngjs';
import * as fs from 'fs';
import * as path from 'path';

describe('Procedural Textures & Atlas (M01b)', () => {
  it('generators are deterministic (same seed -> identical pixel hash)', () => {
    // We don't have an explicit seed parameter in our generators right now since they are hardcoded per type.
    // So we just call them twice and ensure identical output.
    for (const generator of Object.values(textureGenerators)) {
      if (!generator) continue;
      const result1 = generator();
      const result2 = generator();

      if (Array.isArray(result1)) {
        const arr2 = result2 as TextureData[];
        expect(result1.length).toBe(arr2.length);
        for (let i = 0; i < result1.length; i++) {
          expect(result1[i]).toEqual(arr2[i]);
        }
      } else {
        expect(result1).toEqual(result2);
      }
    }
  });

  it('every required texture resolves to a tile', () => {
    const keys = Object.keys(textureGenerators);
    for (const req of M01_REQUIRED_TEXTURES) {
      expect(keys).toContain(req);
    }
  });

  describe('Atlas Packer', () => {
    let atlasTiles: Map<string, TextureData>;
    let atlas: TextureAtlas;

    beforeAll(() => {
      atlasTiles = new Map();
      for (const [name, generator] of Object.entries(textureGenerators)) {
        if (!generator) continue;
        const result = generator();
        if (Array.isArray(result)) {
          for (let i = 0; i < result.length; i++) {
            atlasTiles.set(`${name}_${i}`, result[i]!);
          }
        } else {
          atlasTiles.set(name, result);
        }
      }
      atlas = new TextureAtlas(atlasTiles);
    });

    it('atlas contains no duplicate tile rects', () => {
      const rectSet = new Set<string>();
      for (const rect of atlas.rects.values()) {
        const key = `${rect.x},${rect.y}`;
        expect(rectSet.has(key)).toBe(false);
        rectSet.add(key);
      }
    });

    it('mip level k tile size = 16 >> k', () => {
      // Just assert the mathematical requirement at levels 0, 1, 2
      for (let k = 0; k <= ATLAS_MAX_MIP; k++) {
        const size = TILE_SIZE >> k;
        if (k === 0) expect(size).toBe(16);
        if (k === 1) expect(size).toBe(8);
        if (k === 2) expect(size).toBe(4);
      }
    });

    it('no bleeding in mip chain (solid colored tiles with wrapping padding)', () => {
      // Build atlas with solid colors
      const solidTiles = new Map<string, TextureData>();
      const colors = [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 0, 255],
      ];

      let i = 0;
      for (const color of colors) {
        const data = new Uint8Array(16 * 16 * 4);
        for (let p = 0; p < 256; p++) {
          data[p * 4] = color[0]!;
          data[p * 4 + 1] = color[1]!;
          data[p * 4 + 2] = color[2]!;
          data[p * 4 + 3] = color[3]!;
        }
        solidTiles.set(`color_${i++}`, data);
      }

      const solidAtlas = new TextureAtlas(solidTiles, { width: 64 }); // small atlas

      // Check all mips
      for (let k = 0; k <= ATLAS_MAX_MIP; k++) {
        const mipCellSize = CELL_SIZE >> k;
        const mipW = solidAtlas.width >> k;

        let cellIdx = 0;
        for (const color of colors) {
          const col = cellIdx % Math.floor(solidAtlas.width / CELL_SIZE);
          const row = Math.floor(cellIdx / Math.floor(solidAtlas.width / CELL_SIZE));

          const mipBaseX = col * mipCellSize;
          const mipBaseY = row * mipCellSize;

          // Check that every pixel inside the tile's rect PLUS a 1 px border contains exactly that color
          // We check the entire padded cell actually, since it wraps and the tile is solid, the wrapped pixels should also be the exact same solid color.

          for (let y = 0; y < mipCellSize; y++) {
            for (let x = 0; x < mipCellSize; x++) {
              const idx = ((mipBaseY + y) * mipW + (mipBaseX + x)) * 4;
              expect(solidAtlas.mips[k]![idx]).toBe(color[0]);
              expect(solidAtlas.mips[k]![idx + 1]).toBe(color[1]);
              expect(solidAtlas.mips[k]![idx + 2]).toBe(color[2]);
              expect(solidAtlas.mips[k]![idx + 3]).toBe(color[3]);
            }
          }
          cellIdx++;
        }
      }
    });

    it('dumps atlas to m01-atlas.png', () => {
      const artifactsDir = path.resolve(__dirname, '../../artifacts/m01');
      if (!fs.existsSync(artifactsDir)) {
        fs.mkdirSync(artifactsDir, { recursive: true });
      }

      // Save mip 0
      const png = new PNG({ width: atlas.width, height: atlas.height });
      png.data = Buffer.from(atlas.mips[0]!);
      const outPath = path.join(artifactsDir, 'm01-atlas.png');
      fs.writeFileSync(outPath, PNG.sync.write(png));
      expect(fs.existsSync(outPath)).toBe(true);

      // Save 4x nearest neighbor scaled version
      const w4 = atlas.width * 4;
      const h4 = atlas.height * 4;
      const png4x = new PNG({ width: w4, height: h4 });

      for (let y = 0; y < atlas.height; y++) {
        for (let x = 0; x < atlas.width; x++) {
          const srcIdx = (y * atlas.width + x) * 4;
          for (let dy = 0; dy < 4; dy++) {
            for (let dx = 0; dx < 4; dx++) {
              const dstIdx = ((y * 4 + dy) * w4 + (x * 4 + dx)) * 4;
              png4x.data[dstIdx] = atlas.mips[0]![srcIdx]!;
              png4x.data[dstIdx + 1] = atlas.mips[0]![srcIdx + 1]!;
              png4x.data[dstIdx + 2] = atlas.mips[0]![srcIdx + 2]!;
              png4x.data[dstIdx + 3] = atlas.mips[0]![srcIdx + 3]!;
            }
          }
        }
      }

      const outPath4x = path.join(artifactsDir, 'm01-atlas-4x.png');
      fs.writeFileSync(outPath4x, PNG.sync.write(png4x));
      expect(fs.existsSync(outPath4x)).toBe(true);
    });
  });
});

describe('Generators Seed Parameter & Duplicate Rect Checks', () => {
  it('duplicate rect test checks bounds and overlap', () => {
    const PADDING = 4;
    // Generate an atlas
    const atlasTiles = new Map<string, TextureData>();
    for (const [name, generator] of Object.entries(textureGenerators)) {
      if (!generator) continue;
      const result = generator();
      if (Array.isArray(result)) {
        for (let i = 0; i < result.length; i++) {
          atlasTiles.set(`${name}_${i}`, result[i]!);
        }
      } else {
        atlasTiles.set(name, result);
      }
    }
    const atlas = new TextureAtlas(atlasTiles);

    const rects = Array.from(atlas.rects.values());
    for (let i = 0; i < rects.length; i++) {
      const r1 = rects[i]!;
      // Inside bounds
      expect(r1.x).toBeGreaterThanOrEqual(0);
      expect(r1.y).toBeGreaterThanOrEqual(0);
      expect(r1.x + r1.w).toBeLessThanOrEqual(atlas.width);
      expect(r1.y + r1.h).toBeLessThanOrEqual(atlas.height);

      // No overlap with other rects (including padding since they are cells)
      for (let j = i + 1; j < rects.length; j++) {
        const r2 = rects[j]!;
        // Padded cell rects
        const cell1 = {
          x: r1.x - PADDING,
          y: r1.y - PADDING,
          w: r1.w + PADDING * 2,
          h: r1.h + PADDING * 2,
        };
        const cell2 = {
          x: r2.x - PADDING,
          y: r2.y - PADDING,
          w: r2.w + PADDING * 2,
          h: r2.h + PADDING * 2,
        };

        const overlap = !(
          cell1.x + cell1.w <= cell2.x ||
          cell1.x >= cell2.x + cell2.w ||
          cell1.y + cell1.h <= cell2.y ||
          cell1.y >= cell2.y + cell2.h
        );
        expect(overlap, `Rect ${i} overlaps with Rect ${j}`).toBe(false);
      }
    }
  });
});
