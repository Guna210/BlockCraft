import { GLWrapper } from './gl';
import { columnKey } from '../world/streaming-plan';
import { renderPhaseStats } from '../engine/render-phase-stats';

export const TINT_DEFAULT_SLOT = 0;
export const TINT_INITIAL_SLOTS = 512; // 512 slots = 1024 cells (grass + foliage), 1024 x 256 px; RD8 (289 columns) never grows it
export const TINT_ATLAS_CELLS_PER_ROW = 64; // 64 * 16 = 1024 px width

export interface ColumnTintPair {
  grassTexture: WebGLTexture;
  foliageTexture: WebGLTexture;
  slot: number;
}

interface ColumnTintEntry {
  slot: number;
  grassTexture: WebGLTexture | null;
  foliageTexture: WebGLTexture | null;
  pair: ColumnTintPair;
  grassTintsRef: Uint8Array;
  foliageTintsRef: Uint8Array;
}

/**
 * Computes the top-left (x, y) pixel offset in the 1024px-wide 2D tint atlas for a given
 * `slot` and `isFoliage` flag (`false` = grass cell `slot * 2`, `true` = foliage cell `slot * 2 + 1`).
 */
export function tintAtlasCellOrigin(slot: number, isFoliage: boolean): [number, number] {
  const cell = slot * 2 + (isFoliage ? 1 : 0);
  const col = cell & (TINT_ATLAS_CELLS_PER_ROW - 1);
  const row = cell >> 6;
  return [col * 16, row * 16];
}

export class ColumnTintCache {
  private glWrapper: GLWrapper;
  private readonly useSharedAtlas: boolean;
  private sharedTexture: WebGLTexture | null = null;
  private slotCapacity = TINT_INITIAL_SLOTS;
  private initialCapacity = TINT_INITIAL_SLOTS;
  /** Largest slot count whose atlas height fits `MAX_TEXTURE_SIZE`. */
  private maxSlots = Number.POSITIVE_INFINITY;
  private nextSlot = 1; // Slot 0 is reserved for plains default
  private readonly freeSlots: number[] = [];
  private readonly slotDataGrass: Array<Uint8Array | null> = [];
  private readonly slotDataFoliage: Array<Uint8Array | null> = [];

  private plainsGrassTexture: WebGLTexture | null = null;
  private plainsFoliageTexture: WebGLTexture | null = null;
  private plainsPair: ColumnTintPair;
  private readonly plainsGrassData: Uint8Array;
  private readonly plainsFoliageData: Uint8Array;

  private columnTextures: Map<number, ColumnTintEntry> = new Map();
  private columnSections: Map<number, Set<number>> = new Map();

  constructor(glWrapper: GLWrapper, initialSlots = TINT_INITIAL_SLOTS) {
    this.glWrapper = glWrapper;
    this.slotCapacity = Math.max(32, initialSlots);
    this.initialCapacity = this.slotCapacity;
    const gl = glWrapper.gl as Partial<WebGL2RenderingContext>;
    this.useSharedAtlas =
      typeof gl.texStorage2D === 'function' && typeof gl.texSubImage2D === 'function';

    this.plainsGrassData = new Uint8Array(256 * 3);
    this.plainsFoliageData = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      this.plainsGrassData[i * 3] = 124;
      this.plainsGrassData[i * 3 + 1] = 189;
      this.plainsGrassData[i * 3 + 2] = 71;

      this.plainsFoliageData[i * 3] = 119;
      this.plainsFoliageData[i * 3 + 1] = 177;
      this.plainsFoliageData[i * 3 + 2] = 58;
    }

    this.slotDataGrass[TINT_DEFAULT_SLOT] = this.plainsGrassData;
    this.slotDataFoliage[TINT_DEFAULT_SLOT] = this.plainsFoliageData;

    if (this.useSharedAtlas) {
      const maxTexture = (gl.getParameter?.(gl.MAX_TEXTURE_SIZE as number) ?? 0) as number;
      if (typeof maxTexture === 'number' && maxTexture >= TINT_ATLAS_CELLS_PER_ROW * 16) {
        // height = rows * 16 <= maxTexture, 32 slots (64 cells) per row
        this.maxSlots = Math.floor(maxTexture / 16) * (TINT_ATLAS_CELLS_PER_ROW / 2);
        this.slotCapacity = Math.min(this.slotCapacity, this.maxSlots);
        this.initialCapacity = this.slotCapacity;
      }
      this.sharedTexture = this.createSharedAtlasTexture(this.slotCapacity);
      this.uploadSlotCells(TINT_DEFAULT_SLOT, this.plainsGrassData, this.plainsFoliageData);
      this.plainsPair = {
        grassTexture: this.sharedTexture,
        foliageTexture: this.sharedTexture,
        slot: TINT_DEFAULT_SLOT,
      };
    } else {
      this.plainsGrassTexture = this.createTintTexture2D(this.plainsGrassData);
      this.plainsFoliageTexture = this.createTintTexture2D(this.plainsFoliageData);
      this.plainsPair = {
        grassTexture: this.plainsGrassTexture,
        foliageTexture: this.plainsFoliageTexture,
        slot: TINT_DEFAULT_SLOT,
      };
    }
  }

  public get texture(): WebGLTexture | null {
    return this.sharedTexture;
  }

  public get activeSlotCount(): number {
    return this.columnTextures.size;
  }

  public get freeSlotCount(): number {
    return this.freeSlots.length;
  }

  public get capacitySlots(): number {
    return this.slotCapacity;
  }

  private createSharedAtlasTexture(slots: number): WebGLTexture {
    const bindingStart = renderPhaseStats.start();
    const tex = this.glWrapper.gl ? this.glWrapper.createTexture() : ({} as WebGLTexture);
    const gl = this.glWrapper.gl;
    const totalCells = slots * 2;
    const rows = Math.max(1, Math.ceil(totalCells / TINT_ATLAS_CELLS_PER_ROW));
    const width = TINT_ATLAS_CELLS_PER_ROW * 16;
    const height = rows * 16;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGB8, width, height);
    renderPhaseStats.end('tintTextureBindingMs', bindingStart);
    return tex;
  }

  private uploadSlotCells(slot: number, grassData: Uint8Array, foliageData: Uint8Array): void {
    this.slotDataGrass[slot] = grassData;
    this.slotDataFoliage[slot] = foliageData;
    if (!this.useSharedAtlas || !this.sharedTexture) return;
    const gl = this.glWrapper.gl;
    const bindingStart = renderPhaseStats.start();
    gl.bindTexture(gl.TEXTURE_2D, this.sharedTexture);
    renderPhaseStats.end('tintTextureBindingMs', bindingStart);
    const uploadStart = renderPhaseStats.start();
    const [gx, gy] = tintAtlasCellOrigin(slot, false);
    const [fx, fy] = tintAtlasCellOrigin(slot, true);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, gx, gy, 16, 16, gl.RGB, gl.UNSIGNED_BYTE, grassData);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, fx, fy, 16, 16, gl.RGB, gl.UNSIGNED_BYTE, foliageData);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    renderPhaseStats.end('tintTextureUploadMs', uploadStart);
  }

  private allocateSlot(): number {
    if (this.freeSlots.length > 0) {
      return this.freeSlots.pop()!;
    }
    if (this.nextSlot >= this.slotCapacity) {
      if (this.slotCapacity >= this.maxSlots) return TINT_DEFAULT_SLOT; // atlas is at MAX_TEXTURE_SIZE
      this.growCapacity(Math.min(this.slotCapacity * 2, this.maxSlots));
    }
    return this.nextSlot++;
  }

  private growCapacity(newCapacity: number): void {
    const oldTex = this.sharedTexture;
    this.slotCapacity = newCapacity;
    if (!this.useSharedAtlas) return;
    this.sharedTexture = this.createSharedAtlasTexture(newCapacity);
    this.plainsPair.grassTexture = this.sharedTexture;
    this.plainsPair.foliageTexture = this.sharedTexture;
    for (let s = 0; s < this.nextSlot; s++) {
      const g = this.slotDataGrass[s];
      const f = this.slotDataFoliage[s];
      if (g && f) {
        this.uploadSlotCells(s, g, f);
      }
    }
    for (const entry of this.columnTextures.values()) {
      entry.pair.grassTexture = this.sharedTexture;
      entry.pair.foliageTexture = this.sharedTexture;
    }
    if (oldTex) {
      this.glWrapper.deleteTexture(oldTex);
    }
  }

  private createTintTexture2D(data: Uint8Array): WebGLTexture {
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

  private uploadTextureData2D(tex: WebGLTexture, data: Uint8Array): void {
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

  public getColumnTintSlot(
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
  ): number {
    return this.getColumnTints(sx, sz, world).slot;
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
        if (this.useSharedAtlas) {
          this.uploadSlotCells(cached.slot, col.grassTints, col.foliageTints);
        } else {
          this.uploadTextureData2D(cached.grassTexture!, col.grassTints);
          this.uploadTextureData2D(cached.foliageTexture!, col.foliageTints);
        }
        cached.grassTintsRef = col.grassTints;
        cached.foliageTintsRef = col.foliageTints;
      }
      return cached.pair;
    }

    const slot = this.allocateSlot();
    if (this.useSharedAtlas) {
      this.uploadSlotCells(slot, col.grassTints, col.foliageTints);
      const tex = this.sharedTexture!;
      cached = {
        slot,
        grassTexture: null,
        foliageTexture: null,
        pair: { grassTexture: tex, foliageTexture: tex, slot },
        grassTintsRef: col.grassTints,
        foliageTintsRef: col.foliageTints,
      };
    } else {
      const grassTexture = this.createTintTexture2D(col.grassTints);
      const foliageTexture = this.createTintTexture2D(col.foliageTints);
      cached = {
        slot,
        grassTexture,
        foliageTexture,
        pair: { grassTexture, foliageTexture, slot },
        grassTintsRef: col.grassTints,
        foliageTintsRef: col.foliageTints,
      };
    }
    this.columnTextures.set(colKey, cached);

    return cached.pair;
  }

  private freeColumnTextures(colKey: number): void {
    const cached = this.columnTextures.get(colKey);
    if (cached) {
      if (!this.useSharedAtlas) {
        if (cached.grassTexture) this.glWrapper.deleteTexture(cached.grassTexture);
        if (cached.foliageTexture) this.glWrapper.deleteTexture(cached.foliageTexture);
      }
      if (cached.slot !== TINT_DEFAULT_SLOT) {
        this.slotDataGrass[cached.slot] = null;
        this.slotDataFoliage[cached.slot] = null;
        this.freeSlots.push(cached.slot);
      }
      this.columnTextures.delete(colKey);
    }
  }

  public clearAll(): void {
    for (const colKey of Array.from(this.columnTextures.keys())) {
      this.freeColumnTextures(colKey);
    }
    this.columnSections.clear();
    this.freeSlots.length = 0;
    this.nextSlot = 1;
    if (this.useSharedAtlas && this.slotCapacity > this.initialCapacity) {
      if (this.sharedTexture) this.glWrapper.deleteTexture(this.sharedTexture);
      this.slotCapacity = this.initialCapacity;
      this.sharedTexture = this.createSharedAtlasTexture(this.slotCapacity);
      this.uploadSlotCells(TINT_DEFAULT_SLOT, this.plainsGrassData, this.plainsFoliageData);
      this.plainsPair.grassTexture = this.sharedTexture;
      this.plainsPair.foliageTexture = this.sharedTexture;
    }
  }

  public destroy(): void {
    this.clearAll();
    if (this.sharedTexture) {
      this.glWrapper.deleteTexture(this.sharedTexture);
      this.sharedTexture = null;
    }
    if (this.plainsGrassTexture) {
      this.glWrapper.deleteTexture(this.plainsGrassTexture);
      this.plainsGrassTexture = null;
    }
    if (this.plainsFoliageTexture) {
      this.glWrapper.deleteTexture(this.plainsFoliageTexture);
      this.plainsFoliageTexture = null;
    }
  }
}
