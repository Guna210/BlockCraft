import type { World } from './world';
import { LightStorage, SKY_15_SECTION } from './lighting';
import { columnKey } from './streaming-plan';
import { skirtIndex } from './batch-light';

interface LightSectionSnapshot {
  raw: Uint8Array | number;
  rgb?: [Uint8Array | number, Uint8Array | number, Uint8Array | number];
}
export interface LightPaddingInput {
  sy: number;
  columns: Array<{ lit: boolean; sections: LightSectionSnapshot[] }>;
  skirt?: { height: number; data: Uint16Array };
}

/** Copies section arrays; no per-cell light work runs on the main thread. */
export function collectLightPadding(
  world: World,
  cx: number,
  sy: number,
  cz: number,
): LightPaddingInput {
  const engine = world.lightEngine;
  const columns: LightPaddingInput['columns'] = [];
  const copy = (raw: Uint8Array | undefined): Uint8Array | number =>
    raw === SKY_15_SECTION ? 0xf0 : (raw?.slice() ?? 0);
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const sections: LightSectionSnapshot[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        const y = sy + dy;
        if (y < 0 || y >= 20) {
          sections.push({ raw: y < 0 ? 0 : 0xf0 });
          continue;
        }
        const key = LightStorage.getSectionKey(cx + dx, y, cz + dz);
        const rgb = engine.rgbChannels.map((c) => copy(c.storage.getRawDataByKey(key))) as [
          Uint8Array | number,
          Uint8Array | number,
          Uint8Array | number,
        ];
        sections.push({
          raw: copy(engine.storage.getRawDataByKey(key)),
          ...(rgb.length ? { rgb } : {}),
        });
      }
      columns.push({ lit: engine.isLit(cx + dx, cz + dz), sections });
    }
  const skirt = engine.skirts.get(columnKey(cx, cz));
  return {
    sy,
    columns,
    ...(skirt ? { skirt: { height: skirt.height, data: skirt.data.slice() } } : {}),
  };
}

/** Worker-side extraction, including the world floor and an unlit neighbour's exact light skirt. */
export function buildPaddedLight(input: LightPaddingInput): Uint16Array {
  const result = new Uint16Array(18 * 18 * 18);
  const value = (raw: Uint8Array | number, i: number) => (typeof raw === 'number' ? raw : raw[i]!);
  for (let pz = 0; pz < 18; pz++)
    for (let py = 0; py < 18; py++)
      for (let px = 0; px < 18; px++) {
        const index = px + 18 * (py + 18 * pz);
        const y = input.sy * 16 + py - 1;
        if (y < 0) continue;
        if (y >= 320) {
          result[index] = 0xf000;
          continue;
        }
        const dx = px === 0 ? -1 : px === 17 ? 1 : 0;
        const dz = pz === 0 ? -1 : pz === 17 ? 1 : 0;
        const column = input.columns[(dz + 1) * 3 + dx + 1]!;
        if (!column.lit && (dx !== 0 || dz !== 0) && input.skirt) {
          result[index] =
            y >= input.skirt.height ? 0xf000 : input.skirt.data[y * 68 + skirtIndex(px, pz)]!;
          continue;
        }
        const dy = py === 0 ? -1 : py === 17 ? 1 : 0;
        const section = column.sections[dy + 1]!;
        const i = ((y & 15) << 8) | (((pz + 15) & 15) << 4) | ((px + 15) & 15);
        const raw = value(section.raw, i);
        const r = section.rgb ? value(section.rgb[0], i) & 15 : raw & 15;
        const g = section.rgb ? value(section.rgb[1], i) & 15 : raw & 15;
        const b = section.rgb ? value(section.rgb[2], i) & 15 : raw & 15;
        result[index] = ((raw >>> 4) << 12) | (r << 8) | (g << 4) | b;
      }
  return result;
}
