import { computeBatchLight } from '../src/world/batch-light';
import { expandBlockColumns } from '../src/world/block-snapshot';
import type { LightingJob } from './generation';
import { parentPort } from 'node:worker_threads';
import { DIMENSIONS, type DimensionId } from '../src/world/dimension';
import { STRUCTURE_REGISTRATIONS } from '../src/gen/structures/registrations';
import { ChunkColumn } from '../src/world/column';
import { World } from '../src/world/world';
import { deserializeColumnBinary, serializeColumnBinary } from '../src/persist/column-format';

const pipelines = {
  overworld: DIMENSIONS.overworld.createPipeline(STRUCTURE_REGISTRATIONS),
  hollowdeep: DIMENSIONS.hollowdeep.createPipeline([]),
};
const world = new World();
world.lightEngine.onlyLitColumns = true;
let previousColumn: [number, number] | null = null;
parentPort!.on(
  'message',
  (job: {
    id: number;
    seed: number;
    dimension: DimensionId;
    cx: number;
    cz: number;
    bytes?: Uint8Array;
    light?: LightingJob;
  }) => {
    try {
      if (job.light) {
        const relit = computeBatchLight(
          job.light.bounds,
          job.light.interior,
          expandBlockColumns(job.light.columns),
          world.lightEngine.tables,
        );
        parentPort!.postMessage({
          id: job.id,
          bytes: new Uint8Array(),
          markers: [],
          lights: [],
          relit,
        });
        return;
      }
      const column = job.bytes
        ? deserializeColumnBinary(job.bytes)
        : new ChunkColumn(job.cx, job.cz);
      const pipeline = pipelines[job.dimension];
      if (!job.bytes) {
        pipeline.generateColumn(job.seed, job.cx, job.cz, column);
        const biomes = DIMENSIONS[job.dimension].biomeIds;
        for (let i = 0; i < 256; i++)
          column.biomeIndices[i] = Math.max(0, biomes.indexOf(column.biomes[i]!));
      }
      if (previousColumn) world.removeColumn(...previousColumn);
      world.setColumn(column);
      previousColumn = [job.cx, job.cz];
      world.lightEngine.initializeColumnLight(world, job.cx, job.cz);
      const lights = [];
      for (let sy = 0; sy < 20; sy++) {
        const data = world.lightEngine.storage.getRawData(job.cx, sy, job.cz);
        if (data)
          lights.push({
            sy,
            data,
            rgb: world.lightEngine.rgbChannels.map(
              (channel) => channel.storage.getRawData(job.cx, sy, job.cz) ?? new Uint8Array(4096),
            ),
          });
      }
      const bytes = serializeColumnBinary(column);
      parentPort!.postMessage({
        id: job.id,
        bytes,
        lights,
        markers: job.bytes ? [] : pipeline.takeStructureMarkers(job.cx, job.cz),
      });
    } catch (error) {
      parentPort!.postMessage({ id: job.id, error: String(error) });
    }
  },
);
