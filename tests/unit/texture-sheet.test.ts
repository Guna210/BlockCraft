import { describe, it, expect } from 'vitest';
import { textureGenerators, M01_REQUIRED_TEXTURES } from '../../src/render/textures/index';
import { PNG } from 'pngjs';
import * as fs from 'fs';
import * as path from 'path';

describe('Texture Sheet', () => {
  it('produces m01-texture-sheet.png as per ART.md', () => {
    const GAP = 8;
    const TILE_SCALE = 4;
    const TILE_W = 16;
    const TILE_H = 16;
    const TILE_REPEAT = 3;
    const GRID_CELL = TILE_W * TILE_REPEAT * TILE_SCALE + GAP;

    const reqList = M01_REQUIRED_TEXTURES;

    const cols = Math.ceil(Math.sqrt(reqList.length));
    const rows = Math.ceil(reqList.length / cols);

    const sheetW = cols * GRID_CELL - GAP;
    const sheetH = rows * GRID_CELL - GAP;

    const png = new PNG({ width: sheetW, height: sheetH });

    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = 50;
      png.data[i + 1] = 50;
      png.data[i + 2] = 50;
      png.data[i + 3] = 255;
    }

    let index = 0;
    for (const name of reqList) {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const baseX = col * GRID_CELL;
      const baseY = row * GRID_CELL;

      const generator = textureGenerators[name];
      let result = generator!();
      if (Array.isArray(result)) {
        result = result[0]!;
      }

      for (let ry = 0; ry < TILE_REPEAT; ry++) {
        for (let rx = 0; rx < TILE_REPEAT; rx++) {
          for (let y = 0; y < TILE_H; y++) {
            for (let x = 0; x < TILE_W; x++) {
              const srcIdx = (y * TILE_W + x) * 4;

              for (let dy = 0; dy < TILE_SCALE; dy++) {
                for (let dx = 0; dx < TILE_SCALE; dx++) {
                  const dstX = baseX + (rx * TILE_W + x) * TILE_SCALE + dx;
                  const dstY = baseY + (ry * TILE_H + y) * TILE_SCALE + dy;

                  const dstIdx = (dstY * sheetW + dstX) * 4;

                  const a = result[srcIdx + 3]! / 255.0;
                  if (a > 0) {
                    let r = result[srcIdx]!;
                    let g = result[srcIdx + 1]!;
                    let b = result[srcIdx + 2]!;

                    // Apply Plains tinting to tinted tiles on sheet
                    if (name === 'grass_top') {
                      r = Math.round((r * 124) / 255);
                      g = Math.round((g * 189) / 255);
                      b = Math.round((b * 71) / 255);
                    } else if (name === 'grass_side') {
                      const isGrayscale = Math.abs(r - g) < 15 && Math.abs(g - b) < 15;
                      if (isGrayscale) {
                        r = Math.round((r * 124) / 255);
                        g = Math.round((g * 189) / 255);
                        b = Math.round((b * 71) / 255);
                      }
                    } else if (name === 'oak_leaves') {
                      r = Math.round((r * 119) / 255);
                      g = Math.round((g * 177) / 255);
                      b = Math.round((b * 58) / 255);
                    }

                    png.data[dstIdx] = Math.round(r * a + png.data[dstIdx]! * (1 - a));
                    png.data[dstIdx + 1] = Math.round(g * a + png.data[dstIdx + 1]! * (1 - a));
                    png.data[dstIdx + 2] = Math.round(b * a + png.data[dstIdx + 2]! * (1 - a));
                    png.data[dstIdx + 3] = 255;
                  }
                }
              }
            }
          }
        }
      }
      index++;
    }

    const artifactsDir = path.resolve(__dirname, '../../artifacts/m01');
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }
    const outPath = path.join(artifactsDir, 'm01-texture-sheet.png');
    fs.writeFileSync(outPath, PNG.sync.write(png));
    expect(fs.existsSync(outPath)).toBe(true);
  });
});
