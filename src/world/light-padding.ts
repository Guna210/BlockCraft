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
  for (let pz = 0; pz < 18; pz++) {
    const dz = pz === 0 ? -1 : pz === 17 ? 1 : 0;
    for (let py = 0; py < 18; py++) {
      const y = input.sy * 16 + py - 1;
      const out = 18 * (py + 18 * pz);
      if (y < 0) continue;
      if (y >= 320) {
        result.fill(0xf000, out, out + 18);
        continue;
      }
      const dy = py === 0 ? -1 : py === 17 ? 1 : 0;
      const row = ((y & 15) << 8) | (((pz + 15) & 15) << 4);
      for (let dx = -1; dx <= 1; dx++) {
        const start = dx === -1 ? 0 : dx === 0 ? 1 : 17;
        const end = dx === 0 ? 17 : start + 1;
        const column = input.columns[(dz + 1) * 3 + dx + 1]!;
        if (!column.lit && (dx !== 0 || dz !== 0) && input.skirt) {
          if (y >= input.skirt.height) result.fill(0xf000, out + start, out + end);
          else
            for (let px = start; px < end; px++)
              result[out + px] = input.skirt.data[y * 68 + skirtIndex(px, pz)]!;
          continue;
        }
        const section = column.sections[dy + 1]!;
        const raw = section.raw;
        const r = section.rgb ? section.rgb[0] : raw;
        const g = section.rgb ? section.rgb[1] : raw;
        const b = section.rgb ? section.rgb[2] : raw;
        if (
          typeof raw === 'number' &&
          typeof r === 'number' &&
          typeof g === 'number' &&
          typeof b === 'number'
        ) {
          const packed = ((raw >>> 4) << 12) | ((r & 15) << 8) | ((g & 15) << 4) | (b & 15);
          result.fill(packed, out + start, out + end);
        } else {
          for (let px = start; px < end; px++) {
            const i = row | ((px + 15) & 15);
            const sky = typeof raw === 'number' ? raw : raw[i]!;
            const red = typeof r === 'number' ? r : r[i]!;
            const green = typeof g === 'number' ? g : g[i]!;
            const blue = typeof b === 'number' ? b : b[i]!;
            result[out + px] =
              ((sky >>> 4) << 12) | ((red & 15) << 8) | ((green & 15) << 4) | (blue & 15);
          }
        }
      }
    }
  }
  return result;
}
