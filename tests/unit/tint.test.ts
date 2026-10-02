import { describe, expect, it } from 'vitest';
import { tintTexelForFace } from '../../src/render/tint-utils';
import { ColumnTintCache } from '../../src/render/tint-cache';
import { GLWrapper } from '../../src/render/gl';

describe('Tint Utilities & Cache (M02b-fix)', () => {
  describe('tintTexelForFace', () => {
    it('calculates correct texel coordinates [0..15] for all 6 faces at local x/z = 0 and 15 in positive world coords', () => {
      // Local x/z = 0 (block at bx = 0, bz = 0 in column 0,0)
      // East (+X): pos on face x = 1, y = 0.5, z = 0.5; normal = [1, 0, 0]
      expect(tintTexelForFace([1, 0.5, 0.5], [1, 0, 0])).toEqual([0, 0]);
      // West (-X): pos on face x = 0, y = 0.5, z = 0.5; normal = [-1, 0, 0]
      expect(tintTexelForFace([0, 0.5, 0.5], [-1, 0, 0])).toEqual([0, 0]);
      // Top (+Y): pos on face x = 0.5, y = 1, z = 0.5; normal = [0, 1, 0]
      expect(tintTexelForFace([0.5, 1, 0.5], [0, 1, 0])).toEqual([0, 0]);
      // Bottom (-Y): pos on face x = 0.5, y = 0, z = 0.5; normal = [0, -1, 0]
      expect(tintTexelForFace([0.5, 0, 0.5], [0, -1, 0])).toEqual([0, 0]);
      // South (+Z): pos on face x = 0.5, y = 0.5, z = 1; normal = [0, 0, 1]
      expect(tintTexelForFace([0.5, 0.5, 1], [0, 0, 1])).toEqual([0, 0]);
      // North (-Z): pos on face x = 0.5, y = 0.5, z = 0; normal = [0, 0, -1]
      expect(tintTexelForFace([0.5, 0.5, 0], [0, 0, -1])).toEqual([0, 0]);

      // Local x/z = 15 (block at bx = 15, bz = 15 in column 0,0)
      // East (+X): pos on face x = 16, y = 0.5, z = 15.5; normal = [1, 0, 0] -> bx = 15, bz = 15 -> texel [15, 15]
      expect(tintTexelForFace([16, 0.5, 15.5], [1, 0, 0])).toEqual([15, 15]);
      // West (-X): pos on face x = 15, y = 0.5, z = 15.5; normal = [-1, 0, 0]
      expect(tintTexelForFace([15, 0.5, 15.5], [-1, 0, 0])).toEqual([15, 15]);
      // Top (+Y): pos on face x = 15.5, y = 1, z = 15.5; normal = [0, 1, 0]
      expect(tintTexelForFace([15.5, 1, 15.5], [0, 1, 0])).toEqual([15, 15]);
      // Bottom (-Y): pos on face x = 15.5, y = 0, z = 15.5; normal = [0, -1, 0]
      expect(tintTexelForFace([15.5, 0, 15.5], [0, -1, 0])).toEqual([15, 15]);
      // South (+Z): pos on face x = 15.5, y = 0.5, z = 16; normal = [0, 0, 1]
      expect(tintTexelForFace([15.5, 0.5, 16], [0, 0, 1])).toEqual([15, 15]);
      // North (-Z): pos on face x = 15.5, y = 0.5, z = 15; normal = [0, 0, -1]
      expect(tintTexelForFace([15.5, 0.5, 15], [0, 0, -1])).toEqual([15, 15]);
    });

    it('calculates correct texel coordinates [0..15] for all 6 faces in negative world coords', () => {
      // Column (-1, -1): local x/z = 0 corresponds to bx = -16, bz = -16 -> texel [0, 0]
      expect(tintTexelForFace([-15, -15.5, -15.5], [1, 0, 0])).toEqual([0, 0]);
      expect(tintTexelForFace([-16, -15.5, -15.5], [-1, 0, 0])).toEqual([0, 0]);

      // Column (-1, -1): local x/z = 15 corresponds to bx = -1, bz = -1 -> texel [15, 15]
      // East (+X) face of bx = -1: x = 0, y = 0.5, z = -0.5; normal = [1, 0, 0]
      expect(tintTexelForFace([0, 0.5, -0.5], [1, 0, 0])).toEqual([15, 15]);
      // West (-X) face of bx = -1: x = -1, y = 0.5, z = -0.5; normal = [-1, 0, 0]
      expect(tintTexelForFace([-1, 0.5, -0.5], [-1, 0, 0])).toEqual([15, 15]);
      // South (+Z) face of bz = -1: x = -0.5, y = 0.5, z = 0; normal = [0, 0, 1]
      expect(tintTexelForFace([-0.5, 0.5, 0], [0, 0, 1])).toEqual([15, 15]);
      // North (-Z) face of bz = -1: x = -0.5, y = 0.5, z = -1; normal = [0, 0, -1]
      expect(tintTexelForFace([-0.5, 0.5, -1], [0, 0, -1])).toEqual([15, 15]);
    });
  });

  describe('ColumnTintCache Lifecycle & Mock GL', () => {
    it('asserts exactly 4 uploads for 2 columns x 3 sections x 100 frames, and 2 frees when one column is removed', () => {
      let textureIdCounter = 1;
      let columnUploadCount = 0;
      let createTextureCount = 0;
      let deleteTextureCount = 0;

      // Mock WebGL2 context
      const mockGL = {
        TEXTURE_2D: 0x0de1,
        TEXTURE_MIN_FILTER: 0x2801,
        TEXTURE_MAG_FILTER: 0x2800,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        NEAREST: 0x2600,
        CLAMP_TO_EDGE: 0x812f,
        RGB: 0x1907,
        UNSIGNED_BYTE: 0x1401,
        NO_ERROR: 0,
        getError: () => 0,
        createTexture: () => {
          createTextureCount++;
          return { id: textureIdCounter++ } as unknown as WebGLTexture;
        },
        deleteTexture: (_tex: WebGLTexture) => {
          deleteTextureCount++;
        },
        bindTexture: (_target: number, _tex: WebGLTexture | null) => {},
        texParameteri: (_target: number, _pname: number, _param: number) => {},
        texImage2D: (
          _target: number,
          _level: number,
          _internalformat: number,
          _width: number,
          _height: number,
          _border: number,
          _format: number,
          _type: number,
          _pixels: Uint8Array | null,
        ) => {
          columnUploadCount++;
        },
      } as unknown as WebGL2RenderingContext;

      const mockGLWrapper = new GLWrapper(mockGL, false);

      const cache = new ColumnTintCache(mockGLWrapper);

      // Startup created 2 shared plains textures (2 createTexture, 2 texImage2D)
      expect(mockGLWrapper.getCounts().textures).toBe(2);
      const initialUploadCount = columnUploadCount; // 2
      const initialCreateCount = createTextureCount; // 2

      // Create 2 columns (0,0) and (1,0), each with 3 sections
      const col1Sections = [
        [0, 0, 0],
        [0, 1, 0],
        [0, 2, 0],
      ];
      const col2Sections = [
        [1, 0, 0],
        [1, 1, 0],
        [1, 2, 0],
      ];

      for (const [sx, sy, sz] of col1Sections) {
        cache.onSectionAdded(sx!, sy!, sz!);
      }
      for (const [sx, sy, sz] of col2Sections) {
        cache.onSectionAdded(sx!, sy!, sz!);
      }

      const col1Tints = {
        grassTints: new Uint8Array(256 * 3).fill(100),
        foliageTints: new Uint8Array(256 * 3).fill(110),
      };
      const col2Tints = {
        grassTints: new Uint8Array(256 * 3).fill(120),
        foliageTints: new Uint8Array(256 * 3).fill(130),
      };

      const mockWorld = {
        worldType: 'default',
        getColumn: (cx: number, cz: number) => {
          if (cx === 0 && cz === 0) return col1Tints;
          if (cx === 1 && cz === 0) return col2Tints;
          return null;
        },
      };

      // Simulate drawing 2 columns x 3 sections for 100 frames
      for (let frame = 0; frame < 100; frame++) {
        for (const [sx, sy, sz] of [...col1Sections, ...col2Sections]) {
          void sy;
          cache.getColumnTints(sx!, sz!, mockWorld);
        }
      }

      // Assert exactly 4 column texture uploads occurred across all 100 frames (2 per column x 2 columns)
      const columnOnlyUploads = columnUploadCount - initialUploadCount;
      const columnOnlyCreates = createTextureCount - initialCreateCount;

      expect(columnOnlyCreates).toBe(4);
      expect(columnOnlyUploads).toBe(4);
      expect(mockGLWrapper.getCounts().textures).toBe(6); // 2 plains + 4 column textures

      // Remove column 1's 3 sections
      const initialDeletes = deleteTextureCount;
      for (const [sx, sy, sz] of col1Sections) {
        cache.onSectionRemoved(sx!, sy!, sz!);
      }

      // Assert exactly 2 column textures freed
      const columnFrees = deleteTextureCount - initialDeletes;
      expect(columnFrees).toBe(2);
      expect(mockGLWrapper.getCounts().textures).toBe(4); // 2 plains + 2 remaining column textures
    });
  });
});
