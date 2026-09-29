# Decision Record: M02b Vertex Format & Merge Key Rules

**Date:** 2025-03-30
**Task:** M02b — Greedy mesher

## Overview

This decision record defines the packed vertex layout, Uint32 index format, and merge key rules used by the BlockCraft greedy mesher (`src/mesh/greedy.ts`) as specified in SPEC §3.2.

---

## 1. Packed Vertex Format (2 × uint32 per vertex)

Each vertex is packed into two 32-bit unsigned integers (64 bits total) to optimize memory bandwidth and worker-to-main thread buffer transfers.

### Word 0: Position, Normal, Lighting & Tint (32 bits)

| Field | Bits | Bit Range | Value Range | Description |
| --- | --- | --- | --- | --- |
| `x` | 5 | 0–4 | 0–16 | Local X coordinate within the 16³ section (vertices at section block corners) |
| `y` | 5 | 5–9 | 0–16 | Local Y coordinate within the 16³ section |
| `z` | 5 | 10–14 | 0–16 | Local Z coordinate within the 16³ section |
| `normalIndex` | 3 | 15–17 | 0–5 | Face direction index: `0=+X`, `1=-X`, `2=+Y`, `3=-Y`, `4=+Z`, `5=-Z` |
| `ao` | 2 | 18–19 | 0–3 | Per-vertex Ambient Occlusion value (default constant `0`) |
| `skyLight` | 4 | 20–23 | 0–15 | Per-vertex Sky Light level (default constant `15`) |
| `blockLight` | 4 | 24–27 | 0–15 | Per-vertex Block Light level (default constant `0`) |
| `tintIndex` | 4 | 28–31 | 0–15 | Tint color lookup index (default constant `0`) |

### Word 1: Tile & Quad-Local UV Coordinates (32 bits)

| Field | Bits | Bit Range | Value Range | Description |
| --- | --- | --- | --- | --- |
| `tileIndex` | 16 | 0–15 | 0–65535 | Texture atlas tile index |
| `u` | 8 | 16–23 | 0–16 | Quad-local U coordinate in block units |
| `v` | 8 | 24–31 | 0–16 | Quad-local V coordinate in block units |

---

## 2. Uint32 Element Indexing (`Uint32Array`)

Bucket indices are packed into a `Uint32Array` (uint32) rather than `Uint16Array` because worst-case cutout/translucent sections (such as a 16³ leaf-leaf checkerboard) produce up to 24,576 quads ($24,576 \times 4 = 98,304$ vertices and $24,576 \times 6 = 147,456$ indices). Since 98,304 exceeds the 65,535 limit of uint16 indices, uint32 indices and `gl.UNSIGNED_INT` draw calls are required.

---

## 3. Quad-Local UV Mapping in Block Units

Quad-local UVs carry the width and height of the merged quad in integer block units (e.g. a 5×3 merged quad has corners with U = 0..5 and V = 0..3).

The M02c shader uses these quad-local block coordinates combined with the tile index to sample the corresponding tile rect from the texture atlas and wrap texture coordinates (`fract(u)`, `fract(v)`) seamlessly per block.

---

## 4. Merge Key Rules

For task M02b, two coplanar faces on the same slice plane merge into a single quad if and only if:
1. They share the same face direction (normal index 0–5).
2. They have the same texture atlas `tileIndex`.

### Future Extensions (M05b)
In M05b (Smooth Lighting & Ambient Occlusion), per-vertex sky light, block light, and AO values will be calculated. At that milestone:
- `skyLight`, `blockLight`, and `ao` will be populated into Word 0.
- `skyLight`, `blockLight`, and `ao` will be added to the merge key so that faces with differing lighting or ambient occlusion values are not merged across light boundaries.

---

## 5. Default Constants in M02b

Since lighting and AO calculation systems do not exist prior to M05, the following named constants are used during meshing:
- `DEFAULT_SKY_LIGHT = 15` (fully lit sky)
- `DEFAULT_BLOCK_LIGHT = 0` (no artificial light)
- `DEFAULT_AO = 0` (no ambient occlusion shadow)
- `DEFAULT_TINT_INDEX = 0` (no custom tinting)
