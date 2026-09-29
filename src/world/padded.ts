import { World } from './world';

export const PADDED_SECTION_SIZE = 18;
export const PADDED_SECTION_VOLUME =
  PADDED_SECTION_SIZE * PADDED_SECTION_SIZE * PADDED_SECTION_SIZE; // 5832

/**
 * Builds an 18x18x18 Uint16Array of block-state IDs from the World,
 * centering on the section at section coordinates (sx, sy, sz) with 1 block
 * padding along all 6 faces for boundary culling.
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

  const baseX = sx * 16;
  const baseY = sy * 16;
  const baseZ = sz * 16;

  for (let pz = 0; pz < PADDED_SECTION_SIZE; pz++) {
    const wz = baseZ + pz - 1;
    const zOffset = pz * 18 * 18;

    for (let py = 0; py < PADDED_SECTION_SIZE; py++) {
      const wy = baseY + py - 1;
      const yzOffset = py * 18 + zOffset;

      if (wy < 0 || wy > 319) {
        for (let px = 0; px < PADDED_SECTION_SIZE; px++) {
          result[px + yzOffset] = 0; // Air
        }
        continue;
      }

      for (let px = 0; px < PADDED_SECTION_SIZE; px++) {
        const wx = baseX + px - 1;
        result[px + yzOffset] = world.getBlockStateId(wx, wy, wz);
      }
    }
  }

  return result;
}
