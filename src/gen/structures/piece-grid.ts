import type { StructureConnector, StructurePieceTemplate } from './jigsaw';
import { TemplateBuilder } from './wayfarer-hamlet';

type CellState = Record<string, string | number>;
/** A block id, or a function of the cell's local position choosing one (with an optional state). */
export type CellPick = string | ((x: number, y: number, z: number) => string | null);

/**
 * A piece drawn by filling boxes, where a later fill replaces an earlier one at the same cell
 * (carve a room out of a solid shell, then place furniture). `build` emits each cell once.
 */
export class PieceGrid {
  private readonly cells = new Map<number, { id: string; state?: CellState }>();

  constructor(
    readonly name: string,
    readonly size: readonly [number, number, number],
  ) {}

  private index(x: number, y: number, z: number): number {
    const [sx, sy, sz] = this.size;
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz)
      throw new Error(`Cell ${x},${y},${z} is outside piece ${this.name}`);
    return (y * sz + z) * sx + x;
  }

  set(id: string, x: number, y: number, z: number, state?: CellState): void {
    this.cells.set(this.index(x, y, z), state ? { id, state } : { id });
  }

  /** Fills the inclusive box; a pick returning null leaves that cell as it was. */
  fill(
    pick: CellPick,
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    state?: CellState,
  ): void {
    for (let y = from[1]; y <= to[1]; y++)
      for (let z = from[2]; z <= to[2]; z++)
        for (let x = from[0]; x <= to[0]; x++) {
          const id = typeof pick === 'string' ? pick : pick(x, y, z);
          if (id !== null) this.set(id, x, y, z, state);
        }
  }

  get(x: number, y: number, z: number): string | undefined {
    return this.cells.get(this.index(x, y, z))?.id;
  }

  build(connectors: readonly StructureConnector[] = []): StructurePieceTemplate {
    const builder = new TemplateBuilder(this.name, this.size);
    const [sx, , sz] = this.size;
    for (const [index, cell] of [...this.cells].sort((a, b) => a[0] - b[0])) {
      const x = index % sx;
      const z = Math.floor(index / sx) % sz;
      const y = Math.floor(index / (sx * sz));
      builder.add(cell.id, x, y, z, cell.state);
    }
    return builder.build(connectors);
  }
}

/** A stable 0–1 value for a template cell, so stonework mixes look scattered but never change. */
export function cellNoise(x: number, y: number, z: number, salt: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + z * 2147483647 + salt * 974634, 1274126177);
  h ^= h >>> 13;
  h = Math.imul(h, 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
