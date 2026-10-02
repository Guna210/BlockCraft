import { ChunkSection } from './chunk';

export class ChunkColumn {
  public static readonly SECTION_COUNT = 20; // 320 / 16
  public static readonly MIN_Y = 0;
  public static readonly MAX_Y = 319;

  public readonly cx: number;
  public readonly cz: number;
  private readonly defaultStateId: number;

  private sections: (ChunkSection | null)[];
  public biomes: string[];
  public biomeIndices: Uint8Array;
  public grassTints: Uint8Array;
  public foliageTints: Uint8Array;
  public worldSeed?: number;

  constructor(cx: number, cz: number, defaultStateId: number = 0) {
    this.cx = cx;
    this.cz = cz;
    this.defaultStateId = defaultStateId;
    this.sections = new Array(ChunkColumn.SECTION_COUNT).fill(null);
    this.biomes = new Array<string>(256).fill('plains');
    this.biomeIndices = new Uint8Array(256);
    // Plains grass tint default: [124, 189, 71]
    this.grassTints = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      this.grassTints[i * 3] = 124;
      this.grassTints[i * 3 + 1] = 189;
      this.grassTints[i * 3 + 2] = 71;
    }
    // Plains foliage tint default: [119, 177, 58]
    this.foliageTints = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      this.foliageTints[i * 3] = 119;
      this.foliageTints[i * 3 + 1] = 177;
      this.foliageTints[i * 3 + 2] = 58;
    }
  }

  public setBiomeIndices(indices: Uint8Array, biomeList: readonly string[]): void {
    this.biomeIndices.set(indices);
    for (let i = 0; i < 256; i++) {
      const idx = indices[i] ?? 0;
      this.biomes[i] = biomeList[idx] || 'plains';
    }
  }

  public getSection(sectionY: number): ChunkSection | null {
    if (sectionY < 0 || sectionY >= ChunkColumn.SECTION_COUNT) {
      return null;
    }
    return this.sections[sectionY] ?? null;
  }

  public getOrCreateSection(sectionY: number, initialStateId: number = 0): ChunkSection | null {
    if (sectionY < 0 || sectionY >= ChunkColumn.SECTION_COUNT) {
      return null;
    }
    if (!this.sections[sectionY]) {
      this.sections[sectionY] = new ChunkSection(initialStateId);
    }
    return this.sections[sectionY]!;
  }

  public getBlockStateId(x: number, y: number, z: number): number {
    if (y < ChunkColumn.MIN_Y || y > ChunkColumn.MAX_Y) {
      return 0; // Air for out of bounds y
    }

    const sectionY = y >> 4;
    const localY = y & 15;
    const section = this.sections[sectionY];

    if (!section) return this.defaultStateId;
    return section.getBlockStateId(x, localY, z);
  }

  public setBlockStateId(x: number, y: number, z: number, stateId: number): void {
    if (y < ChunkColumn.MIN_Y || y > ChunkColumn.MAX_Y) {
      return;
    }

    const sectionY = y >> 4;
    const localY = y & 15;

    let section = this.sections[sectionY];
    if (!section) {
      if (stateId === this.defaultStateId) {
        return; // Still uniform section matching defaultStateId, no need to allocate
      }
      section = new ChunkSection(this.defaultStateId);
      this.sections[sectionY] = section;
    }

    section.setBlockStateId(x, localY, z, stateId);
  }
}
