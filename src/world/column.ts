import { ChunkSection } from './chunk';

export class ChunkColumn {
  public static readonly SECTION_COUNT = 20; // 320 / 16
  public static readonly MIN_Y = 0;
  public static readonly MAX_Y = 319;

  public readonly cx: number;
  public readonly cz: number;
  private readonly defaultStateId: number;

  private sections: (ChunkSection | null)[];

  constructor(cx: number, cz: number, defaultStateId: number = 0) {
    this.cx = cx;
    this.cz = cz;
    this.defaultStateId = defaultStateId;
    this.sections = new Array(ChunkColumn.SECTION_COUNT).fill(null);
  }

  public getSection(sectionY: number): ChunkSection | null {
    if (sectionY < 0 || sectionY >= ChunkColumn.SECTION_COUNT) {
      return null;
    }
    return this.sections[sectionY] ?? null;
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
