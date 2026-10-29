import { TerrainPipeline } from '../pipeline';
import { hollowdeepShapeStage } from './shape';
import { hollowdeepFeatureStage } from './features';
import { hollowdeepOreStage } from './ores';

export { HOLLOWDEEP_BIOME_IDS } from './shape';
export { HOLLOWDEEP_ENVIRONMENT } from './environment';

/** Worker-compatible generation only. Dimension selection belongs to M20a. */
export function createHollowdeepPipeline(): TerrainPipeline {
  const pipeline = new TerrainPipeline();
  pipeline.addStage(hollowdeepShapeStage);
  pipeline.addStage(hollowdeepFeatureStage);
  pipeline.addStage(hollowdeepOreStage);
  return pipeline;
}
