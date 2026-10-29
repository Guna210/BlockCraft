import { TerrainPipeline, createDefaultPipeline } from '../gen/pipeline';
import type { StructureRegistration } from '../gen/structures/stage';

/** The worlds a save holds. Each one has its own columns, streaming, lighting and block entities. */
export type DimensionId = 'overworld' | 'hollowdeep';

export const DIMENSION_IDS: readonly DimensionId[] = ['overworld', 'hollowdeep'];

/** One block in the Hollowdeep spans this many Overworld blocks horizontally (SPEC M20). */
export const DIMENSION_SCALE = 4;

export function isDimensionId(value: unknown): value is DimensionId {
  return value === 'overworld' || value === 'hollowdeep';
}

/** The other end of a portal from `dimension`. */
export function otherDimension(dimension: DimensionId): DimensionId {
  return dimension === 'overworld' ? 'hollowdeep' : 'overworld';
}

/** A horizontal coordinate carried from one dimension to another: ÷4 into the Hollowdeep, ×4 back. */
export function scaleCoordinate(value: number, from: DimensionId, to: DimensionId): number {
  if (from === to) return value;
  return to === 'hollowdeep' ? value / DIMENSION_SCALE : value * DIMENSION_SCALE;
}

export interface DimensionDefinition {
  id: DimensionId;
  /** Lowest and highest y a portal frame's bottom row may stand on. */
  portalMinY: number;
  portalMaxY: number;
  /** The block a fallback portal platform is made of. */
  platformBlock: string;
  /** The terrain generator of this dimension; `structures` only applies where it has any. */
  createPipeline(structures: readonly StructureRegistration[]): TerrainPipeline;
}

export const DIMENSIONS: Readonly<Record<DimensionId, DimensionDefinition>> = {
  overworld: {
    id: 'overworld',
    portalMinY: 4,
    portalMaxY: 300,
    platformBlock: 'stone',
    createPipeline: (structures) => createDefaultPipeline(structures),
  },
  hollowdeep: {
    id: 'hollowdeep',
    portalMinY: 8,
    portalMaxY: 180,
    platformBlock: 'stone',
    // The Hollowdeep generator (M20b) is not part of this build: its columns are empty air, and a
    // portal arriving there stands on its own safe platform.
    createPipeline: () => new TerrainPipeline(),
  },
};
