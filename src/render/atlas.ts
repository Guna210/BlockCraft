// src/render/atlas.ts
import { TextureData } from './textures/noise';

export const TILE_SIZE = 16;
export const PADDING = 4;
export const CELL_SIZE = TILE_SIZE + PADDING * 2; // 24
export const ATLAS_MAX_MIP = 2; // mips 0, 1, 2

export interface AtlasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class TextureAtlas {
  public mips: Uint8Array[];
  public rects: Map<string, AtlasRect>;
  public width: number;
  public height: number;

  constructor(
    tiles: Map<string, TextureData>,
    options: {
      width?: number; // Must be power of 2 and large enough
    } = {},
  ) {
    this.rects = new Map();

    // Calculate required width and height based on tile count
    const count = tiles.size;

    // Default width is typically 512 or 1024. For 24px cells, let's pick 512 (21 cells per row)
    // Needs to be a power of two for standard mipmapping although WebGL2 supports non-power-of-two.
    // Let's use 512, which can fit 21 cells per row.
    this.width = options.width || 512;
    const cellsPerRow = Math.floor(this.width / CELL_SIZE);
    const rows = Math.ceil(count / cellsPerRow);
    this.height = Math.pow(2, Math.ceil(Math.log2(rows * CELL_SIZE)));

    this.mips = [];
    for (let i = 0; i <= ATLAS_MAX_MIP; i++) {
      const w = this.width >> i;
      const h = this.height >> i;
      this.mips.push(new Uint8Array(w * h * 4));
    }

    let cellIndex = 0;
    for (const [name, tileData] of tiles.entries()) {
      const col = cellIndex % cellsPerRow;
      const row = Math.floor(cellIndex / cellsPerRow);

      const baseX = col * CELL_SIZE;
      const baseY = row * CELL_SIZE;

      // Register rect at mip level 0
      this.rects.set(name, {
        x: baseX + PADDING,
        y: baseY + PADDING,
        w: TILE_SIZE,
        h: TILE_SIZE,
      });

      // Generate mips for this tile
      for (let k = 0; k <= ATLAS_MAX_MIP; k++) {
        const mipTileSize = TILE_SIZE >> k;
        const mipPadding = PADDING >> k;
        const mipCellSize = CELL_SIZE >> k;

        const mipBaseX = col * mipCellSize;
        const mipBaseY = row * mipCellSize;
        const mipRectX = mipBaseX + mipPadding;
        const mipRectY = mipBaseY + mipPadding;

        // Downsample tile for mip level k
        const mipData = this.downsampleTile(tileData, TILE_SIZE, k);

        const mipTargetW = this.width >> k;

        // Write tile data into atlas mip
        for (let y = 0; y < mipTileSize; y++) {
          for (let x = 0; x < mipTileSize; x++) {
            const srcIdx = (y * mipTileSize + x) * 4;
            const dstIdx = ((mipRectY + y) * mipTargetW + (mipRectX + x)) * 4;
            this.mips[k]![dstIdx] = mipData[srcIdx]!;
            this.mips[k]![dstIdx + 1] = mipData[srcIdx + 1]!;
            this.mips[k]![dstIdx + 2] = mipData[srcIdx + 2]!;
            this.mips[k]![dstIdx + 3] = mipData[srcIdx + 3]!;
          }
        }

        // Fill padding by wrapping (copy pixels from the tile's opposite edge)
        // Top padding (wrap from bottom)
        for (let py = 0; py < mipPadding; py++) {
          const srcY = mipTileSize - mipPadding + py;
          for (let px = 0; px < mipTileSize; px++) {
            const dstIdx = ((mipBaseY + py) * mipTargetW + (mipRectX + px)) * 4;
            const srcIdx = ((mipRectY + srcY) * mipTargetW + (mipRectX + px)) * 4;
            this.mips[k]!.set(this.mips[k]!.subarray(srcIdx, srcIdx + 4), dstIdx);
          }
        }

        // Bottom padding (wrap from top)
        for (let py = 0; py < mipPadding; py++) {
          const srcY = py;
          for (let px = 0; px < mipTileSize; px++) {
            const dstIdx = ((mipRectY + mipTileSize + py) * mipTargetW + (mipRectX + px)) * 4;
            const srcIdx = ((mipRectY + srcY) * mipTargetW + (mipRectX + px)) * 4;
            this.mips[k]!.set(this.mips[k]!.subarray(srcIdx, srcIdx + 4), dstIdx);
          }
        }

        // Left padding (wrap from right)
        for (let px = 0; px < mipPadding; px++) {
          const srcX = mipTileSize - mipPadding + px;
          for (let py = 0; py < mipCellSize; py++) {
            const dstIdx = ((mipBaseY + py) * mipTargetW + (mipBaseX + px)) * 4;
            let srcIdx = ((mipBaseY + py) * mipTargetW + (mipRectX + srcX)) * 4;
            // Handle corners
            if (py < mipPadding) {
              srcIdx =
                ((mipRectY + mipTileSize - mipPadding + py) * mipTargetW + (mipRectX + srcX)) * 4;
            } else if (py >= mipPadding + mipTileSize) {
              srcIdx =
                ((mipRectY + py - mipPadding - mipTileSize) * mipTargetW + (mipRectX + srcX)) * 4;
            }

            this.mips[k]!.set(this.mips[k]!.subarray(srcIdx, srcIdx + 4), dstIdx);
          }
        }

        // Right padding (wrap from left)
        for (let px = 0; px < mipPadding; px++) {
          const srcX = px;
          for (let py = 0; py < mipCellSize; py++) {
            const dstIdx = ((mipBaseY + py) * mipTargetW + (mipRectX + mipTileSize + px)) * 4;
            let srcIdx = ((mipBaseY + py) * mipTargetW + (mipRectX + srcX)) * 4;
            if (py < mipPadding) {
              srcIdx =
                ((mipRectY + mipTileSize - mipPadding + py) * mipTargetW + (mipRectX + srcX)) * 4;
            } else if (py >= mipPadding + mipTileSize) {
              srcIdx =
                ((mipRectY + py - mipPadding - mipTileSize) * mipTargetW + (mipRectX + srcX)) * 4;
            }
            this.mips[k]!.set(this.mips[k]!.subarray(srcIdx, srcIdx + 4), dstIdx);
          }
        }
      }

      cellIndex++;
    }
  }

  private downsampleTile(data: TextureData, sourceSize: number, k: number): TextureData {
    if (k === 0) return data;

    const targetSize = sourceSize >> k;
    const factor = 1 << k;
    const factorSq = factor * factor;
    const result = new Uint8Array(targetSize * targetSize * 4);

    for (let y = 0; y < targetSize; y++) {
      for (let x = 0; x < targetSize; x++) {
        let r = 0,
          g = 0,
          b = 0,
          a = 0;

        // Average the pixels
        for (let dy = 0; dy < factor; dy++) {
          for (let dx = 0; dx < factor; dx++) {
            const sx = x * factor + dx;
            const sy = y * factor + dy;
            const sIdx = (sy * sourceSize + sx) * 4;
            r += data[sIdx]!;
            g += data[sIdx + 1]!;
            b += data[sIdx + 2]!;
            a += data[sIdx + 3]!;
          }
        }

        const dIdx = (y * targetSize + x) * 4;
        result[dIdx] = Math.round(r / factorSq);
        result[dIdx + 1] = Math.round(g / factorSq);
        result[dIdx + 2] = Math.round(b / factorSq);
        result[dIdx + 3] = Math.round(a / factorSq);
      }
    }

    return result;
  }
}
