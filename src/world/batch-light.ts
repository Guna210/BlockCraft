import { LightStorage, type LightLookupTables } from './lighting';

export type LightColumns = Record<string, (Uint16Array | number)[]>;
export interface LightRect {
  minCX: number;
  maxCX: number;
  minCZ: number;
  maxCZ: number;
}
export interface ColumnLight {
  cx: number;
  cz: number;
  sections: Array<{
    key: number;
    lightData: Uint8Array | number;
    rgb?: [Uint8Array, Uint8Array, Uint8Array];
  }>;
  skirt: Uint16Array;
  height: number;
}

/** Index around an 18 by 18 horizontal perimeter; the core is never stored in a skirt. */
export function skirtIndex(px: number, pz: number): number {
  if (pz === 0) return px;
  if (pz === 17) return 50 + px;
  return px === 0 ? 18 + (pz - 1) * 2 : 19 + (pz - 1) * 2;
}

/**
 * From-scratch light for a ready rectangle. A streamed job supplies a full column border and
 * commits just the interior. The remaining horizontal reach of any light path is below that border.
 * All unpacking, flood fill, uniform detection and skirt extraction run on the worker.
 */
export function computeBatchLight(
  bounds: LightRect,
  interior: LightRect,
  columns: LightColumns,
  tables: LightLookupTables,
): ColumnLight[] {
  const width = (bounds.maxCX - bounds.minCX + 1) * 16;
  const depth = (bounds.maxCZ - bounds.minCZ + 1) * 16;
  const area = width * depth;
  let highestSection = -1;
  for (const sections of Object.values(columns))
    for (let sy = 0; sy < 20; sy++) {
      const section = sections[sy];
      if (section instanceof Uint16Array || (typeof section === 'number' && section !== 0))
        highestSection = Math.max(highestSection, sy);
    }
  // One air section above the terrain contains every possible upward block-light path.
  const height = Math.min(320, Math.max(16, (highestSection + 2) * 16));
  const volume = area * height;
  const opacity = new Uint8Array(volume);
  const sky = new Uint8Array(volume);
  const red = new Uint8Array(volume);
  const green = new Uint8Array(volume);
  const blue = new Uint8Array(volume);
  const channels = [red, green, blue];
  const emissions = tables.rgbEmission ?? [
    tables.emissionTable,
    tables.emissionTable,
    tables.emissionTable,
  ];
  let queue = new Uint32Array(Math.max(4096, volume));
  let head = 0;
  let tail = 0;
  const push = (index: number) => {
    if (tail === queue.length) {
      const next = new Uint32Array(queue.length * 2);
      next.set(queue);
      queue = next;
    }
    queue[tail++] = index;
  };
  for (let cz = bounds.minCZ; cz <= bounds.maxCZ; cz++)
    for (let cx = bounds.minCX; cx <= bounds.maxCX; cx++) {
      const sections = columns[`${cx},${cz}`];
      if (!sections) throw new Error(`Light rectangle is missing column ${cx},${cz}`);
      const ox = (cx - bounds.minCX) * 16;
      const oz = (cz - bounds.minCZ) * 16;
      for (let sy = 0; sy * 16 < height; sy++) {
        const section = sections[sy] ?? 0;
        if (section === 0) continue;
        const uniform = typeof section === 'number';
        const uniformOp = uniform ? (tables.opacityTable[section] ?? 0) : 0;
        const uniformEmission = uniform ? (tables.emissionTable[section] ?? 0) : 0;
        for (let ly = 0; ly < 16; ly++)
          for (let lz = 0; lz < 16; lz++) {
            const row = (sy * 16 + ly) * area + (oz + lz) * width + ox;
            // Uniform opaque sections have neither sky nor artificial light.
            if (uniform && uniformOp === 15 && uniformEmission === 0) {
              opacity.fill(15, row, row + 16);
              continue;
            }
            for (let lx = 0; lx < 16; lx++) {
              const state = uniform ? section : section[(ly << 8) | (lz << 4) | lx]!;
              const index = row + lx;
              opacity[index] = tables.opacityTable[state] ?? 0;
              let emitted = false;
              for (let c = 0; c < 3; c++) {
                const level = emissions[c]![state] ?? 0;
                channels[c]![index] = level;
                emitted ||= level > 1;
              }
              if (emitted) push(index);
            }
          }
      }
    }
  const neighbours = (i: number, visit: (n: number, down: boolean) => void) => {
    const y = Math.floor(i / area);
    const rem = i - y * area;
    const x = rem % width;
    const z = Math.floor(rem / width);
    if (x > 0) visit(i - 1, false);
    if (x + 1 < width) visit(i + 1, false);
    if (z > 0) visit(i - width, false);
    if (z + 1 < depth) visit(i + width, false);
    if (y > 0) visit(i - area, true);
    if (y + 1 < height) visit(i + area, false);
  };
  // Max per channel: mixtures retain each source's strongest component independently.
  while (head < tail) {
    const i = queue[head++]!;
    neighbours(i, (n) => {
      if (opacity[n] === 15) return;
      const loss = 1 + opacity[n]!;
      let changed = false;
      for (const channel of channels) {
        const level = channel[i]! - loss;
        if (level > channel[n]!) {
          channel[n] = level;
          changed = true;
        }
      }
      if (changed) push(n);
    });
  }
  const rays = new Uint8Array(area).fill(15);
  for (let y = height - 1; y >= 0; y--)
    for (let xz = 0; xz < area; xz++) {
      const i = y * area + xz;
      const op = opacity[i]!;
      const previous = rays[xz]!;
      const level =
        previous === 15 ? (op === 0 ? 15 : Math.max(0, 15 - op)) : Math.max(0, previous - 1 - op);
      sky[i] = level;
      rays[xz] = level;
    }
  head = tail = 0;
  // Vertical rays already solved their vertical neighbours. Seed just horizontal beam boundaries.
  for (let y = 0; y < height; y++)
    for (let z = 0; z < depth; z++)
      for (let x = 0; x < width; x++) {
        const i = y * area + z * width + x;
        const level = sky[i]!;
        if (level <= 1) continue;
        if (
          (x > 0 && sky[i - 1]! < level - 1 - opacity[i - 1]!) ||
          (x + 1 < width && sky[i + 1]! < level - 1 - opacity[i + 1]!) ||
          (z > 0 && sky[i - width]! < level - 1 - opacity[i - width]!) ||
          (z + 1 < depth && sky[i + width]! < level - 1 - opacity[i + width]!)
        )
          push(i);
      }
  while (head < tail) {
    const i = queue[head++]!;
    const level = sky[i]!;
    neighbours(i, (n, down) => {
      const op = opacity[n]!;
      if (op === 15) return;
      const next = down && level === 15 && opacity[i] === 0 ? Math.max(0, 15 - op) : level - 1 - op;
      if (next > sky[n]!) {
        sky[n] = next;
        push(n);
      }
    });
  }
  const packed = (x: number, y: number, z: number) => {
    if (y >= height) return 0xf000;
    const i = y * area + z * width + x;
    return (sky[i]! << 12) | (red[i]! << 8) | (green[i]! << 4) | blue[i]!;
  };
  const result: ColumnLight[] = [];
  for (let cz = interior.minCZ; cz <= interior.maxCZ; cz++)
    for (let cx = interior.minCX; cx <= interior.maxCX; cx++) {
      const ox = (cx - bounds.minCX) * 16;
      const oz = (cz - bounds.minCZ) * 16;
      const sections: ColumnLight['sections'] = [];
      for (let sy = 0; sy < 20; sy++) {
        const key = LightStorage.getSectionKey(cx, sy, cz);
        if (sy * 16 >= height) {
          sections.push({ key, lightData: 0xf0 });
          continue;
        }
        const blocks = columns[`${cx},${cz}`]![sy];
        if (
          typeof blocks === 'number' &&
          tables.opacityTable[blocks] === 15 &&
          !tables.emissionTable[blocks]
        ) {
          sections.push({ key, lightData: 0 });
          continue;
        }
        const raw = new Uint8Array(4096);
        const rgb: [Uint8Array, Uint8Array, Uint8Array] = [
          new Uint8Array(4096),
          new Uint8Array(4096),
          new Uint8Array(4096),
        ];
        let allSky = true;
        let anyBlock = false;
        let anyLight = false;
        for (let ly = 0; ly < 16; ly++)
          for (let lz = 0; lz < 16; lz++)
            for (let lx = 0; lx < 16; lx++) {
              const i = (sy * 16 + ly) * area + (oz + lz) * width + ox + lx;
              const si = (ly << 8) | (lz << 4) | lx;
              const block = Math.max(red[i]!, green[i]!, blue[i]!);
              raw[si] = (sky[i]! << 4) | block;
              rgb[0][si] = red[i]!;
              rgb[1][si] = green[i]!;
              rgb[2][si] = blue[i]!;
              allSky &&= raw[si] === 0xf0;
              anyBlock ||= block !== 0;
              anyLight ||= raw[si] !== 0;
            }
        sections.push({
          key,
          lightData: allSky ? 0xf0 : anyLight ? raw : 0,
          ...(anyBlock ? { rgb } : {}),
        });
      }
      const skirt = new Uint16Array(68 * height);
      for (let y = 0; y < height; y++)
        for (let pz = 0; pz < 18; pz++)
          for (let px = 0; px < 18; px++) {
            if (px !== 0 && px !== 17 && pz !== 0 && pz !== 17) continue;
            const x = ox + px - 1;
            const z = oz + pz - 1;
            // Region jobs may commit the outer boundary; streamed jobs always have a real border.
            if (x < 0 || x >= width || z < 0 || z >= depth) continue;
            skirt[y * 68 + skirtIndex(px, pz)] = packed(x, y, z);
          }
      result.push({ cx, cz, sections, skirt, height });
    }
  return result;
}
