import { ChunkColumn } from '../world/column';
import { deriveSeed } from '../engine/rng';

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

export class TerrainPipeline {
  private stages: TerrainStage[] = [];

  public addStage(stage: TerrainStage): void {
    this.stages.push(stage);
  }

  public getStages(): readonly TerrainStage[] {
    return this.stages;
  }

  public generateColumn(worldSeed: number, cx: number, cz: number, column: ChunkColumn): void {
    column.worldSeed = worldSeed;
    for (const stage of this.stages) {
      const stageSeed = deriveSeed(worldSeed, stage.name);
      stage.generate(stageSeed, cx, cz, column);
    }
  }
}

export function createDefaultPipeline(): TerrainPipeline {
  const pipeline = new TerrainPipeline();
  pipeline.addStage(terrainShapeStage);
  pipeline.addStage(biomeSurfaceStage);
  pipeline.addStage(caveStage);
  return pipeline;
}
