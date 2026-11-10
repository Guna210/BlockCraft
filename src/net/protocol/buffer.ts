import { MAX_CHUNK_BYTES, MAX_STRING_BYTES } from './messages';

export type DecodeErrorCode = 'truncated' | 'length' | 'value' | 'type' | 'utf8' | 'trailing';
export interface DecodeError {
  code: DecodeErrorCode;
  offset: number;
  message: string;
}
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** One growable allocation reused across frames. finish() borrows storage until reset/next encode. */
export class BinaryWriter {
  private bytes: Uint8Array<ArrayBuffer>;
  private view: DataView<ArrayBuffer>;
  private offset = 0;
  constructor(capacity = 256) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > MAX_CHUNK_BYTES + 64)
      throw new RangeError('Invalid writer capacity');
    this.bytes = new Uint8Array(capacity);
    this.view = new DataView(this.bytes.buffer);
  }
  reset(): void {
    this.offset = 0;
  }
  private reserve(count: number): void {
    const needed = this.offset + count;
    if (needed <= this.bytes.length) return;
    const grown = new Uint8Array(Math.max(needed, this.bytes.length * 2));
    grown.set(this.bytes);
    this.bytes = grown;
    this.view = new DataView(grown.buffer);
  }
  integer(value: number, min: number, max: number): void {
    if (!Number.isInteger(value) || value < min || value > max)
      throw new RangeError('Integer outside wire range');
  }
  u8(value: number): void {
    this.integer(value, 0, 255);
    this.reserve(1);
    this.view.setUint8(this.offset++, value);
  }
  u16(value: number): void {
    this.integer(value, 0, 65535);
    this.reserve(2);
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
  }
  i16(value: number): void {
    this.integer(value, -32768, 32767);
    this.reserve(2);
    this.view.setInt16(this.offset, value, true);
    this.offset += 2;
  }
  u32(value: number): void {
    this.integer(value, 0, 0xffffffff);
    this.reserve(4);
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
  }
  i32(value: number): void {
    this.integer(value, -0x80000000, 0x7fffffff);
    this.reserve(4);
    this.view.setInt32(this.offset, value, true);
    this.offset += 4;
  }
  f64(value: number): void {
    if (!Number.isFinite(value)) throw new RangeError('Non-finite number');
    this.reserve(8);
    this.view.setFloat64(this.offset, value, true);
    this.offset += 8;
  }
  bool(value: boolean): void {
    this.u8(value ? 1 : 0);
  }
  /** UTF-8 directly into the reusable buffer, without per-string byte arrays or views. */
  string(value: string): void {
    if (value.length > MAX_STRING_BYTES) throw new RangeError('String exceeds 256 UTF-8 bytes');
    let length = 0;
    for (let i = 0; i < value.length; i++) {
      const cp = value.codePointAt(i)!;
      if (cp >= 0xd800 && cp <= 0xdfff) throw new RangeError('Unpaired UTF-16 surrogate');
      length += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
      if (cp > 0xffff) i++;
    }
    if (length > MAX_STRING_BYTES) throw new RangeError('String exceeds 256 UTF-8 bytes');
    this.u16(length);
    this.reserve(length);
    for (let i = 0; i < value.length; i++) {
      const cp = value.codePointAt(i)!;
      if (cp < 0x80) this.bytes[this.offset++] = cp;
      else if (cp < 0x800) {
        this.bytes[this.offset++] = 0xc0 | (cp >> 6);
        this.bytes[this.offset++] = 0x80 | (cp & 63);
      } else if (cp < 0x10000) {
        this.bytes[this.offset++] = 0xe0 | (cp >> 12);
        this.bytes[this.offset++] = 0x80 | ((cp >> 6) & 63);
        this.bytes[this.offset++] = 0x80 | (cp & 63);
      } else {
        i++;
        this.bytes[this.offset++] = 0xf0 | (cp >> 18);
        this.bytes[this.offset++] = 0x80 | ((cp >> 12) & 63);
        this.bytes[this.offset++] = 0x80 | ((cp >> 6) & 63);
        this.bytes[this.offset++] = 0x80 | (cp & 63);
      }
    }
  }
  payload(value: Uint8Array): void {
    if (value.length > MAX_CHUNK_BYTES) throw new RangeError('Chunk exceeds 1 MiB');
    this.u32(value.length);
    this.reserve(value.length);
    this.bytes.set(value, this.offset);
    this.offset += value.length;
  }
  finish(): Uint8Array {
    return this.bytes.subarray(0, this.offset);
  }
}

export class BinaryReader {
  offset = 0;
  error: DecodeError | null = null;
  private readonly view: DataView;
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  fail(code: DecodeErrorCode, message: string): void {
    this.error ??= { code, offset: this.offset, message };
  }
  has(count: number): boolean {
    if (this.error) return false;
    if (count > this.bytes.length - this.offset) {
      this.fail('truncated', 'Incomplete frame');
      return false;
    }
    return true;
  }
  u8(): number {
    if (!this.has(1)) return 0;
    return this.view.getUint8(this.offset++);
  }
  u16(): number {
    if (!this.has(2)) return 0;
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }
  i16(): number {
    if (!this.has(2)) return 0;
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }
  u32(): number {
    if (!this.has(4)) return 0;
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }
  i32(): number {
    if (!this.has(4)) return 0;
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }
  f64(): number {
    if (!this.has(8)) return 0;
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    if (!Number.isFinite(v)) this.fail('value', 'Non-finite number');
    return v;
  }
  bounded(value: number, max: number): number {
    if (value > max) {
      this.fail('length', 'Length or enum exceeds limit');
      return 0;
    }
    return value;
  }
  bool(): boolean {
    return this.bounded(this.u8(), 1) === 1;
  }
  string(): string {
    const length = this.bounded(this.u16(), MAX_STRING_BYTES);
    if (!this.has(length)) return '';
    const start = this.offset;
    this.offset += length;
    try {
      return utf8.decode(this.bytes.subarray(start, this.offset));
    } catch {
      this.fail('utf8', 'Invalid UTF-8');
      return '';
    }
  }
  payload(): Uint8Array {
    const length = this.bounded(this.u32(), MAX_CHUNK_BYTES);
    if (!this.has(length)) return new Uint8Array(0);
    const start = this.offset;
    this.offset += length;
    // Borrow the bounded frame; no attacker-sized copy. Retain/copy at the transport boundary.
    return this.bytes.subarray(start, this.offset);
  }
  end(): void {
    if (this.offset !== this.bytes.length) this.fail('trailing', 'Unexpected trailing bytes');
  }
}
