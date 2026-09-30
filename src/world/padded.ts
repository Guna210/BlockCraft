import { World } from './world';

export const PADDED_SECTION_SIZE = 18;
export const PADDED_SECTION_VOLUME =
  PADDED_SECTION_SIZE * PADDED_SECTION_SIZE * PADDED_SECTION_SIZE; // 5832

/**
 * Fast direct section-level padded section extraction from World.
 * Directly queries columns and sections instead of calling world.getBlockStateId 5,832 times per section.
 */
export function buildPaddedSection(
  world: World,
  sx: number,
  sy: number,
  sz: number,
  target?: Uint16Array,
): Uint16Array {
  const result =
    target && target.length === PADDED_SECTION_VOLUME
      ? target
      : new Uint16Array(PADDED_SECTION_VOLUME);

  // Pre-fetch 3x3 neighbor columns around (sx, sz)
  // Indices: dx (0..2 -> -1..1), dz (0..2 -> -1..1)
  const cols: (ReturnType<typeof world.getColumn> | null)[] = new Array(9);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const idx = (dz + 1) * 3 + (dx + 1);
      cols[idx] = world.getColumn(sx + dx, sz + dz, false);
    }
  }

  const baseY = sy * 16;

  for (let pz = 0; pz < 18; pz++) {
    const lz = pz - 1;
    let czOffset = 0;
    let localZ = lz;
    if (lz < 0) {
      czOffset = -1;
      localZ = 15;
    } else if (lz >= 16) {
      czOffset = 1;
      localZ = 0;
    }
    const zIndexOffset = pz * 324; // 18 * 18

    for (let py = 0; py < 18; py++) {
      const wy = baseY + py - 1;
      const yzIndexOffset = zIndexOffset + py * 18;

      if (wy < 0 || wy > 319) {
        for (let px = 0; px < 18; px++) {
          result[yzIndexOffset + px] = 0;
        }
        continue;
      }

      for (let px = 0; px < 18; px++) {
        const lx = px - 1;
        let cxOffset = 0;
        let localX = lx;
        if (lx < 0) {
          cxOffset = -1;
          localX = 15;
        } else if (lx >= 16) {
          cxOffset = 1;
          localX = 0;
        }

        const colIdx = (czOffset + 1) * 3 + (cxOffset + 1);
        const col = cols[colIdx];
        if (!col) {
          result[yzIndexOffset + px] = 0;
        } else {
          result[yzIndexOffset + px] = col.getBlockStateId(localX, wy, localZ);
        }
      }
    }
  }

  return result;
}
