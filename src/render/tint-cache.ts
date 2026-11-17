import { GLWrapper } from './gl';
import { columnKey } from '../world/streaming-plan';
import { renderPhaseStats } from '../engine/render-phase-stats';

export interface ColumnTintPair {
  grassTexture: WebGLTexture;
  foliageTexture: WebGLTexture;
}

interface ColumnTintEntry {
  grassTexture: WebGLTexture;
  foliageTexture: WebGLTexture;
  pair: ColumnTintPair;
  grassTintsRef: Uint8Array;
  foliageTintsRef: Uint8Array;
}

export class ColumnTintCache {
  private glWrapper: GLWrapper;
  private plainsGrassTexture: WebGLTexture;
  private plainsFoliageTexture: WebGLTexture;
  private plainsPair: ColumnTintPair;

  private columnTextures: Map<number, ColumnTintEntry> = new Map();
  private columnSections: Map<number, Set<number>> = new Map();

  constructor(glWrapper: GLWrapper) {
    this.glWrapper = glWrapper;

    const plainsGrassData = new Uint8Array(256 * 3);
    const plainsFoliageData = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      plainsGrassData[i * 3] = 124;
      plainsGrassData[i * 3 + 1] = 189;
      plainsGrassData[i * 3 + 2] = 71;

      plainsFoliageData[i * 3] = 119;
      plainsFoliageData[i * 3 + 1] = 177;
      plainsFoliageData[i * 3 + 2] = 58;
    }

    this.plainsGrassTexture = this.createTintTexture(plainsGrassData);
    this.plainsFoliageTexture = this.createTintTexture(plainsFoliageData);
    this.plainsPair = {
      grassTexture: this.plainsGrassTexture,
      foliageTexture: this.plainsFoliageTexture,
    };
  }

  private createTintTexture(data: Uint8Array): WebGLTexture {
    const bindingStart = renderPhaseStats.start();
    const tex = this.glWrapper.createTexture();
    const gl = this.glWrapper.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    renderPhaseStats.end('tintTextureBindingMs', bindingStart);
    const uploadStart = renderPhaseStats.start();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 16, 16, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
    renderPhaseStats.end('tintTextureUploadMs', uploadStart);
    return tex;
  }

  private uploadTextureData(tex: WebGLTexture, data: Uint8Array): void {
    const gl = this.glWrapper.gl;
    const bindingStart = renderPhaseStats.start();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    renderPhaseStats.end('tintTextureBindingMs', bindingStart);
    const uploadStart = renderPhaseStats.start();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 16, 16, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
    renderPhaseStats.end('tintTextureUploadMs', uploadStart);
  }

  public onSectionAdded(sx: number, sy: number, sz: number): void {
    const colKey = columnKey(sx, sz);
    const sectionKey = colKey * 32 + sy;
    let set = this.columnSections.get(colKey);
    if (!set) {
      set = new Set();
      this.columnSections.set(colKey, set);
    }
    set.add(sectionKey);
  }

  public onSectionRemoved(sx: number, sy: number, sz: number): void {
    const colKey = columnKey(sx, sz);
    const sectionKey = colKey * 32 + sy;
    const set = this.columnSections.get(colKey);
    if (set) {
      set.delete(sectionKey);
      if (set.size === 0) {
        this.columnSections.delete(colKey);
        this.freeColumnTextures(colKey);
      }
    }
  }

  public getColumnTints(
    sx: number,
    sz: number,
    world?: {
      worldType?: string;
      getColumn?: (
        cx: number,
        cz: number,
        createIfMissing?: boolean,
      ) => { grassTints?: Uint8Array; foliageTints?: Uint8Array } | null;
    } | null,
  ): ColumnTintPair {
    if (!world || world.worldType === 'flat') {
      return this.plainsPair;
    }

    const col = world.getColumn ? world.getColumn(sx, sz, false) : null;
    if (!col || !col.grassTints || !col.foliageTints) {
      return this.plainsPair;
    }

    const colKey = columnKey(sx, sz);
    let cached = this.columnTextures.get(colKey);

    if (cached) {
      if (cached.grassTintsRef !== col.grassTints || cached.foliageTintsRef !== col.foliageTints) {
        this.uploadTextureData(cached.grassTexture, col.grassTints);
        this.uploadTextureData(cached.foliageTexture, col.foliageTints);
        cached.grassTintsRef = col.grassTints;
        cached.foliageTintsRef = col.foliageTints;
      }
      return cached.pair;
    }

    const grassTexture = this.createTintTexture(col.grassTints);
    const foliageTexture = this.createTintTexture(col.foliageTints);

    cached = {
      grassTexture,
      foliageTexture,
      pair: { grassTexture, foliageTexture },
      grassTintsRef: col.grassTints,
      foliageTintsRef: col.foliageTints,
    };
    this.columnTextures.set(colKey, cached);

    return cached.pair;
  }

  private freeColumnTextures(colKey: number): void {
    const cached = this.columnTextures.get(colKey);
    if (cached) {
      this.glWrapper.deleteTexture(cached.grassTexture);
      this.glWrapper.deleteTexture(cached.foliageTexture);
      this.columnTextures.delete(colKey);
    }
  }

  public clearAll(): void {
    for (const colKey of Array.from(this.columnTextures.keys())) {
      this.freeColumnTextures(colKey);
    }
    this.columnSections.clear();
  }

  public destroy(): void {
    this.clearAll();
    this.glWrapper.deleteTexture(this.plainsGrassTexture);
    this.glWrapper.deleteTexture(this.plainsFoliageTexture);
  }
}
