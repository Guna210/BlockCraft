import { ChunkColumn } from '../world/column';
import { deriveSeed } from '../engine/rng';
import { withTerrainVariant, type TerrainVariant } from './world-options';

/**
 * Pure stage function operating on column data.
 * Must not keep module-level mutable state.
 */
export type TerrainStageFunction = (
  stageSeed: number,
  cx: number,
  cz: number,
  column: ChunkColumn,
) => void;

export interface TerrainStage {
  name: string;
  generate: TerrainStageFunction;
}

import { terrainShapeStage } from './terrain';
import { biomeSurfaceStage } from './surface';
import { caveStage } from './caves';
import { oreStage } from './ores';
import { featureStage } from './features';
import { createStructureStage, type StructureRegistration } from './structures/stage';

export class TerrainPipeline {
  private stages: TerrainStage[] = [];

  public addStage(stage: TerrainStage): void {
    this.stages.push(stage);
  }

  public getStages(): readonly TerrainStage[] {
    return this.stages;
  }

  /** Runs every stage on `column`; `variant` (Amplified, Single Biome) is active meanwhile. */
  public generateColumn(
    worldSeed: number,
    cx: number,
    cz: number,
    column: ChunkColumn,
    variant?: TerrainVariant,
  ): void {
    column.worldSeed = worldSeed;
    withTerrainVariant(variant, () => {
      for (const stage of this.stages) {
        const stageSeed = deriveSeed(worldSeed, stage.name);
        stage.generate(stageSeed, cx, cz, column);
      }
    });
  }
}

export function createDefaultPipeline(
  structures: readonly StructureRegistration[] = [],
): TerrainPipeline {
  const pipeline = new TerrainPipeline();
  pipeline.addStage(terrainShapeStage);
  pipeline.addStage(biomeSurfaceStage);
  pipeline.addStage(caveStage);
  pipeline.addStage(oreStage);
  pipeline.addStage(featureStage);
  pipeline.addStage(createStructureStage(structures));
  return pipeline;
}
