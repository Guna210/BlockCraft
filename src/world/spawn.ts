import { World } from './world';
import { ChunkColumn } from './column';
import { BlockRegistry } from './blocks/registry';
import { SEA_LEVEL } from '../gen/terrain';

export const SPAWN_EYE_OFFSET = 1.82;

export interface SpawnPoint {
  /** Block column the spawn stands on. */
  x: number;
  z: number;
  /** Y of the top block of that column. */
  topY: number;
  /** Camera position: (x + 0.5, topY + 1.82, z + 0.5). */
  position: [number, number, number];
  /** True when no column had dry land above sea level and the highest column was used. */
  fallback: boolean;
}

interface ColumnTop {
  y: number;
  fluid: boolean;
}

function isFluid(blockId: string): boolean {
  return blockId === 'water' || blockId === 'lava';
}

/** Highest non-air block of a column, including fluids. */
function columnTop(world: World, registry: BlockRegistry, x: number, z: number): ColumnTop | null {
  const col = world.getColumn(Math.floor(x / 16), Math.floor(z / 16), false);
  if (!col) return null;
  for (let sy = ChunkColumn.SECTION_COUNT - 1; sy >= 0; sy--) {
    const sec = col.getSection(sy);
    // Skip sections that are entirely air
    if (!sec || (sec.getBitsPerEntry() === 0 && sec.uniformStateId === 0)) continue;
    for (let y = sy * 16 + 15; y >= sy * 16; y--) {
      const stateId = world.getBlockStateId(x, y, z);
      if (stateId === 0) continue;
      const resolved = registry.getResolvedState(stateId);
      if (!resolved || resolved.blockId === 'air') continue;
      return { y, fluid: isFluid(resolved.blockId) };
    }
  }
  return null;
}

/**
 * Cells of the square ring at Chebyshev distance `r` around (0, 0), in a fixed order: the north
 * edge west to east, the east edge north to south, the south edge east to west, the west edge
 * south to north.
 */
function forEachRingCell(r: number, visit: (x: number, z: number) => void): void {
  if (r === 0) {
    visit(0, 0);
    return;
  }
  for (let x = -r; x <= r; x++) visit(x, -r);
  for (let z = -r + 1; z <= r; z++) visit(r, z);
  for (let x = r - 1; x >= -r; x--) visit(x, r);
  for (let z = r - 1; z > -r; z--) visit(-r, z);
}

/**
 * Finds the spawn point of a generated world: the nearest column to (0, 0), searching the
 * generated columns ring by ring, whose top block is above sea level and not a fluid. Within the
 * first ring that has such a column the one closest to (0, 0) wins, ties going to the earlier
 * cell in ring order. If no generated column qualifies the highest column is used.
 */
export function findSpawnPoint(world: World, radiusChunks: number): SpawnPoint | null {
  const registry = BlockRegistry.getInstance();
  const minCoord = -radiusChunks * 16;
  const maxCoord = radiusChunks * 16 + 15;
  const maxRing = Math.max(-minCoord, maxCoord);

  let highest: { x: number; z: number; y: number } | null = null;

  for (let r = 0; r <= maxRing; r++) {
    let best: { x: number; z: number; y: number; d2: number } | null = null;

    forEachRingCell(r, (x, z) => {
      if (x < minCoord || x > maxCoord || z < minCoord || z > maxCoord) return;
      if (!world.hasColumn(Math.floor(x / 16), Math.floor(z / 16))) return;
      const top = columnTop(world, registry, x, z);
      if (!top) return;
      if (!highest || top.y > highest.y) highest = { x, z, y: top.y };
      if (top.fluid || top.y <= SEA_LEVEL) return;
      const d2 = x * x + z * z;
      if (!best || d2 < best.d2) best = { x, z, y: top.y, d2 };
    });

    if (best) {
      const b = best as { x: number; z: number; y: number };
      return {
        x: b.x,
        z: b.z,
        topY: b.y,
        position: [b.x + 0.5, b.y + SPAWN_EYE_OFFSET, b.z + 0.5],
        fallback: false,
      };
    }
  }

  if (!highest) return null;
  const h = highest as { x: number; z: number; y: number };
  return {
    x: h.x,
    z: h.z,
    topY: h.y,
    position: [h.x + 0.5, h.y + SPAWN_EYE_OFFSET, h.z + 0.5],
    fallback: true,
  };
}
