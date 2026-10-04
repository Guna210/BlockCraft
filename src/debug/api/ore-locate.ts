import { getWorldInstance } from '../../world/world-instance';
import { ChunkColumn } from '../../world/column';
import { BlockRegistry } from '../../world/blocks/registry';
import { createDefaultPipeline, TerrainPipeline } from '../../gen/pipeline';
import { OVERWORLD_ORE_IDS } from '../../gen/ores';
import { registerLocator } from './locate';

/**
 * `locate('ore', id, near)` (M03e).
 *
 * Returns the block `[x, y, z]` nearest to `near` that holds ore `id`, or null. "Nearest" is the
 * smallest squared Euclidean distance between `floor(near)` and the block position; ties go to the
 * lower y, then the lower x, then the lower z, so the answer does not depend on the order columns
 * are visited in.
 *
 * Search radius: the columns within `ORE_LOCATE_RADIUS_CHUNKS` (8) chunks of the column containing
 * `near` in Chebyshev distance, a square of 17 x 17 = 289 columns (every block whose column lies in
 * it, at any height). Nothing beyond it is searched, so a result may be null although ore exists
 * farther away. Columns are visited in rings outward, and the search stops as soon as no later ring
 * can hold a block closer than the best one found.
 *
 * Ore only exists once a column is generated, so the search looks at the real blocks: a column that
 * is loaded in the world instance is read as it is (edits included, so mined ore is not reported);
 * any other column is generated off to the side with the default pipeline (about 14 ms each) and
 * its ore positions are cached by world seed. A flat world has no ore, so it returns null, as do
 * unknown ids and 'skyshard_ore', which only generates in the Hollowdeep (M20b).
 */
export const ORE_LOCATE_RADIUS_CHUNKS = 8;

const CACHE_LIMIT = 4096;
const oreCache = new Map<string, Int32Array[]>();
let scratchPipeline: TerrainPipeline | null = null;
const sectionBuf = new Uint16Array(4096);

/** Positions of every ore block of the column, per ore in OVERWORLD_ORE_IDS order, as x, y, z triples. */
function scanColumn(column: ChunkColumn, oreStates: number[]): Int32Array[] {
  const found: number[][] = oreStates.map(() => []);
  const x0 = column.cx * 16;
  const z0 = column.cz * 16;
  for (let sy = 0; sy < ChunkColumn.SECTION_COUNT; sy++) {
    const section = column.getSection(sy);
    if (!section || section.getBitsPerEntry() === 0) continue; // empty or one block type: no ore
    section.copyBlockStatesTo(sectionBuf);
    for (let i = 0; i < 4096; i++) {
      const st = sectionBuf[i]!;
      const oi = oreStates.indexOf(st);
      if (oi < 0) continue;
      found[oi]!.push(x0 + (i & 15), sy * 16 + (i >> 8), z0 + ((i >> 4) & 15));
    }
  }
  return found.map((f) => Int32Array.from(f));
}

function columnOres(
  worldSeed: number,
  cx: number,
  cz: number,
  oreStates: number[],
  loaded: ChunkColumn | null,
): Int32Array[] {
  if (loaded) return scanColumn(loaded, oreStates);
  const key = `${worldSeed}:${cx},${cz}`;
  const hit = oreCache.get(key);
  if (hit) return hit;
  scratchPipeline ??= createDefaultPipeline();
  const column = new ChunkColumn(cx, cz, 0);
  scratchPipeline.generateColumn(worldSeed, cx, cz, column);
  const result = scanColumn(column, oreStates);
  if (oreCache.size >= CACHE_LIMIT) oreCache.clear();
  oreCache.set(key, result);
  return result;
}

export function locateOre(
  id: string,
  near: [number, number, number],
): [number, number, number] | null {
  const oi = OVERWORLD_ORE_IDS.indexOf(id);
  if (oi < 0) return null;
  const nx = Math.floor(near[0]);
  const ny = Math.floor(near[1]);
  const nz = Math.floor(near[2]);
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) return null;

  const world = getWorldInstance();
  if (world.worldType === 'flat') return null;
  const registry = BlockRegistry.getInstance();
  const oreStates = OVERWORLD_ORE_IDS.map((o) => registry.getStateId(o)!);
  const worldSeed = world.worldSeed;

  const ccx = Math.floor(nx / 16);
  const ccz = Math.floor(nz / 16);
  let best: [number, number, number] | null = null;
  let bestD2 = Infinity;

  for (let r = 0; r <= ORE_LOCATE_RADIUS_CHUNKS; r++) {
    // Every block of a ring-r column is at least (r - 1) * 16 + 1 blocks away horizontally.
    if (r > 0 && best !== null) {
      const lower = (r - 1) * 16 + 1;
      if (lower * lower > bestD2) break;
    }
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = ccx + dx;
        const cz = ccz + dz;
        const list = columnOres(worldSeed, cx, cz, oreStates, world.getColumn(cx, cz, false))[oi]!;
        for (let i = 0; i < list.length; i += 3) {
          const x = list[i]!;
          const y = list[i + 1]!;
          const z = list[i + 2]!;
          const d2 = (x - nx) * (x - nx) + (y - ny) * (y - ny) + (z - nz) * (z - nz);
          if (
            best === null ||
            d2 < bestD2 ||
            (d2 === bestD2 &&
              (y < best[1] || (y === best[1] && (x < best[0] || (x === best[0] && z < best[2])))))
          ) {
            best = [x, y, z];
            bestD2 = d2;
          }
        }
      }
    }
  }
  return best;
}

registerLocator('ore', locateOre);
