import { World } from '../../../src/world/world';
import { TerrainPipeline, createDefaultPipeline } from '../../../src/gen/pipeline';
import { terrainShapeStage } from '../../../src/gen/terrain';
import { biomeSurfaceStage } from '../../../src/gen/surface';
import { caveStage } from '../../../src/gen/caves';
import { generate } from './world-samples';

// Sample areas generated once per test file (in a beforeAll) and shared by the tests that read them.
//
// A test asks for an area exactly as it did before: a square of `size` x `size` columns whose
// south-west column is (cx0, cz0). Columns are generated independently of one another and of the
// order they are generated in (tests 8b and the isolated-blocks tests assert it), so a test that
// reads only inside its square sees identical blocks whether the world holds just that square or
// a larger one that contains it. `build` therefore generates each requested square once, and a
// square that lies inside another requested square of the same kind and seed is served from that
// one.

/** 'full' is the default pipeline; 'noFeatures' stops after the cave stage. */
export type AreaKind = 'full' | 'noFeatures';

interface Rect {
  kind: AreaKind;
  seed: number;
  cx0: number;
  cz0: number;
  size: number;
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    outer.kind === inner.kind &&
    outer.seed === inner.seed &&
    inner.cx0 >= outer.cx0 &&
    inner.cz0 >= outer.cz0 &&
    inner.cx0 + inner.size <= outer.cx0 + outer.size &&
    inner.cz0 + inner.size <= outer.cz0 + outer.size
  );
}

export class SharedAreas {
  private requests: Rect[] = [];
  private built: Array<{ rect: Rect; world: World }> = [];

  request(kind: AreaKind, seed: number, cx0: number, cz0: number, size: number): void {
    this.requests.push({ kind, seed, cx0, cz0, size });
  }

  /** Generates every requested area once; returns the columns generated and requested. */
  build(): { generated: number; requested: number } {
    const full = createDefaultPipeline();
    const noFeatures = new TerrainPipeline();
    noFeatures.addStage(terrainShapeStage);
    noFeatures.addStage(biomeSurfaceStage);
    noFeatures.addStage(caveStage);

    let generated = 0;
    let requested = 0;
    for (const rect of [...this.requests].sort((a, b) => b.size - a.size)) {
      requested += rect.size * rect.size;
      if (this.built.some((b) => contains(b.rect, rect))) continue;
      const world = new World(false);
      generate(
        rect.kind === 'full' ? full : noFeatures,
        rect.seed,
        world,
        rect.cx0,
        rect.cz0,
        rect.size,
      );
      generated += rect.size * rect.size;
      this.built.push({ rect, world });
    }
    return { generated, requested };
  }

  /** The world that holds the requested square (it may hold more columns around it). */
  get(kind: AreaKind, seed: number, cx0: number, cz0: number, size: number): World {
    const want: Rect = { kind, seed, cx0, cz0, size };
    const hit = this.built.find((b) => contains(b.rect, want));
    if (!hit) throw new Error(`area ${JSON.stringify(want)} was not requested before build()`);
    return hit.world;
  }
}
