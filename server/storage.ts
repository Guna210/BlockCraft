import { inflate } from 'node:zlib';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setImmediate as yieldTick } from 'node:timers/promises';
import type { DimensionId } from '../src/world/dimension';
import { deserializeColumnBinary, serializeColumn } from '../src/persist/column-format';
import { FORMAT_VERSION } from '../src/persist/version';
import type { ChunkColumn } from '../src/world/column';

export async function readOptional(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
let writeId = 0;
const pendingWrites = new Map<string, Promise<void>>();
export function atomicWrite(path: string, bytes: Uint8Array | string): Promise<void> {
  const previous = pendingWrites.get(path) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(() => writeAtomically(path, bytes));
  pendingWrites.set(path, operation);
  void operation
    .finally(() => {
      if (pendingWrites.get(path) === operation) pendingWrites.delete(path);
    })
    .catch(() => {});
  return operation;
}
async function writeAtomically(path: string, bytes: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${writeId++}`;
  await writeFile(temp, bytes);
  await rename(temp, path);
}
/** Region table: BCRG, u16 format, u16 count, repeated u16 local index/u32 length/payload. */
export function encodeRegion(entries: ReadonlyMap<number, Uint8Array>): Uint8Array {
  let length = 8;
  for (const data of entries.values()) length += 6 + data.length;
  const out = new Uint8Array(length);
  out.set([66, 67, 82, 71]);
  const view = new DataView(out.buffer);
  view.setUint16(4, FORMAT_VERSION, true);
  view.setUint16(6, entries.size, true);
  let offset = 8;
  for (const [index, data] of entries) {
    view.setUint16(offset, index, true);
    view.setUint32(offset + 2, data.length, true);
    out.set(data, offset + 6);
    offset += 6 + data.length;
  }
  return out;
}
export function decodeRegion(bytes: Uint8Array): Map<number, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length < 8 ||
    view.getUint32(0) !== 0x42435247 ||
    view.getUint16(4, true) !== FORMAT_VERSION
  )
    throw new Error('Invalid region format');
  const count = view.getUint16(6, true);
  if (count > 1024) throw new Error('Region exceeds 32×32 columns');
  const entries = new Map<number, Uint8Array>();
  let offset = 8;
  for (let i = 0; i < count; i++) {
    if (offset + 6 > bytes.length) throw new Error('Truncated region');
    const index = view.getUint16(offset, true),
      length = view.getUint32(offset + 2, true);
    offset += 6;
    if (
      index > 1023 ||
      entries.has(index) ||
      length > 1024 * 1024 ||
      offset + length > bytes.length
    )
      throw new Error('Invalid region entry');
    entries.set(index, bytes.slice(offset, offset + length));
    offset += length;
  }
  if (offset !== bytes.length) throw new Error('Trailing region bytes');
  return entries;
}
export class DiskStorage {
  private writing: Promise<void> = Promise.resolve();
  constructor(readonly root: string) {}
  private path(dimension: DimensionId, cx: number, cz: number): string {
    return join(this.root, dimension, `r.${Math.floor(cx / 32)}.${Math.floor(cz / 32)}.bin`);
  }
  async loadColumn(dimension: DimensionId, cx: number, cz: number): Promise<ChunkColumn | null> {
    const bytes = await readOptional(this.path(dimension, cx, cz));
    if (!bytes) return null;
    const entry = decodeRegion(bytes).get((cz & 31) * 32 + (cx & 31));
    if (!entry) return null;
    const inflated = await new Promise<Uint8Array>((resolve, reject) =>
      inflate(entry, { maxOutputLength: 512 * 1024 }, (error, output) =>
        error ? reject(error) : resolve(output),
      ),
    );
    return deserializeColumnBinary(inflated);
  }
  saveColumns(dimension: DimensionId, columns: readonly ChunkColumn[]): Promise<void> {
    const operation = this.writing.then(() => this.writeColumns(dimension, columns));
    this.writing = operation.catch(() => {});
    return operation;
  }
  private async writeColumns(
    dimension: DimensionId,
    columns: readonly ChunkColumn[],
  ): Promise<void> {
    const regions = new Map<string, Map<number, Uint8Array>>();
    for (const column of columns) {
      const path = this.path(dimension, column.cx, column.cz);
      let region = regions.get(path);
      if (!region) {
        const existing = await readOptional(path);
        region = existing ? decodeRegion(existing) : new Map();
        regions.set(path, region);
      }
      region.set((column.cz & 31) * 32 + (column.cx & 31), await serializeColumn(column));
      await yieldTick();
    }
    for (const [path, region] of regions) {
      await atomicWrite(path, encodeRegion(region));
      await yieldTick();
    }
  }
}
