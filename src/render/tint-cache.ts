import { GLWrapper } from './gl';

export interface ColumnTintPair {
  grassTexture: WebGLTexture;
  foliageTexture: WebGLTexture;
}

interface ColumnTintEntry {
  grassTexture: WebGLTexture;
  foliageTexture: WebGLTexture;
  grassTintsRef: Uint8Array;
  foliageTintsRef: Uint8Array;
}

export class ColumnTintCache {
  private glWrapper: GLWrapper;
  private plainsGrassTexture: WebGLTexture;
  private plainsFoliageTexture: WebGLTexture;

  private columnTextures: Map<string, ColumnTintEntry> = new Map();
  private columnSections: Map<string, Set<string>> = new Map();

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
  }

  private createTintTexture(data: Uint8Array): WebGLTexture {
    const tex = this.glWrapper.createTexture();
    const gl = this.glWrapper.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 16, 16, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
    return tex;
  }

  private uploadTextureData(tex: WebGLTexture, data: Uint8Array): void {
    const gl = this.glWrapper.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 16, 16, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
  }

  public onSectionAdded(sx: number, sy: number, sz: number): void {
    const colKey = `${sx},${sz}`;
    const sectionKey = `${sx},${sy},${sz}`;
    let set = this.columnSections.get(colKey);
    if (!set) {
      set = new Set();
      this.columnSections.set(colKey, set);
    }
    set.add(sectionKey);
  }

  public onSectionRemoved(sx: number, sy: number, sz: number): void {
    const colKey = `${sx},${sz}`;
    const sectionKey = `${sx},${sy},${sz}`;
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
      return {
        grassTexture: this.plainsGrassTexture,
        foliageTexture: this.plainsFoliageTexture,
      };
    }

    const col = world.getColumn ? world.getColumn(sx, sz, false) : null;
    if (!col || !col.grassTints || !col.foliageTints) {
      return {
        grassTexture: this.plainsGrassTexture,
        foliageTexture: this.plainsFoliageTexture,
      };
    }

    const colKey = `${sx},${sz}`;
    let cached = this.columnTextures.get(colKey);

    if (cached) {
      if (cached.grassTintsRef !== col.grassTints || cached.foliageTintsRef !== col.foliageTints) {
        this.uploadTextureData(cached.grassTexture, col.grassTints);
        this.uploadTextureData(cached.foliageTexture, col.foliageTints);
        cached.grassTintsRef = col.grassTints;
        cached.foliageTintsRef = col.foliageTints;
      }
      return {
        grassTexture: cached.grassTexture,
        foliageTexture: cached.foliageTexture,
      };
    }

    const grassTexture = this.createTintTexture(col.grassTints);
    const foliageTexture = this.createTintTexture(col.foliageTints);

    cached = {
      grassTexture,
      foliageTexture,
      grassTintsRef: col.grassTints,
      foliageTintsRef: col.foliageTints,
    };
    this.columnTextures.set(colKey, cached);

    return { grassTexture, foliageTexture };
  }

  private freeColumnTextures(colKey: string): void {
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
