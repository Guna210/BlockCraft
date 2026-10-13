import { describe, it, expect } from 'vitest';
import { VoxelRaycaster, createRayHit, FACES } from '../../src/world/raycast';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { LCG } from '../../src/render/textures/noise';
import type { Box } from '../../src/world/block-shapes';
// Independent exact plane/slab reference, reached by fine marching rather than DDA.
function exact(o: number[], d: number[], x: number, y: number, z: number, b: Box) {
  const ranges = [0, 1, 2].map((a) => {
    const low = ([x, y, z][a]! + b[a]! - o[a]!) / d[a]!;
    const high = ([x, y, z][a]! + b[a + 3]! - o[a]!) / d[a]!;
    return {
      near: Math.min(low, high),
      far: Math.max(low, high),
      face: a + (d[a]! > 0 ? 0 : 3),
      exit: a + (d[a]! > 0 ? 3 : 0),
    };
  });
  const enter = ranges.reduce((a, b) => (a.near >= b.near ? a : b)),
    leave = ranges.reduce((a, b) => (a.far <= b.far ? a : b));
  if (enter.near > leave.far || leave.far < 0) return null;
  return {
    entry: enter.near,
    distance: enter.near >= 0 ? enter.near : leave.far,
    face: FACES[enter.near >= 0 ? enter.face : leave.exit],
  };
}
describe('M07a voxel DDA', () => {
  it('matches fine-step marching plus independent exact box intersections over 10,000 seeded random rays including non-cubes', () => {
    const registry = BlockRegistry.getInstance(),
      rng = new LCG(707);
    const states = [
      'stone',
      'stone_slab',
      'torch',
      'bluebell',
      'water',
      'lava',
      'ladder',
      'vine',
      'wall_torch',
    ].flatMap((id) =>
      registry.getAllStateIds().filter((s) => registry.getResolvedState(s)!.blockId === id),
    );
    const blocks = new Map<string, number>();
    for (let x = -6; x <= 6; x++)
      for (let y = -6; y <= 6; y++)
        for (let z = -6; z <= 6; z++)
          if (rng.nextFloat() < 0.2)
            blocks.set(`${x},${y},${z}`, states[rng.nextInt(0, states.length - 1)]!);
    const world = {
      getBlockStateId: (x: number, y: number, z: number) => blocks.get(`${x},${y},${z}`) ?? 0,
    };
    const ray = new VoxelRaycaster(world),
      out = createRayHit();
    let hits = 0;
    for (let n = 0; n < 10000; n++) {
      const o = [rng.nextFloat() * 10 - 5, rng.nextFloat() * 10 - 5, rng.nextFloat() * 10 - 5];
      const d = [rng.nextFloat() * 2 - 1, rng.nextFloat() * 2 - 1, rng.nextFloat() * 2 - 1],
        length = Math.hypot(...d);
      for (let a = 0; a < 3; a++) d[a]! /= length;
      const reach = n % 2 ? 4.5 : 5;
      let best: {
        x: number;
        y: number;
        z: number;
        distance: number;
        entry: number;
        face: (typeof FACES)[number] | undefined;
      } | null = null;
      const visited = new Set<string>();
      const centres = new Set<string>();
      for (let t = 0; t <= reach + 0.001; t += 0.005) {
        const x = Math.floor(o[0]! + d[0]! * Math.min(t, reach)),
          y = Math.floor(o[1]! + d[1]! * Math.min(t, reach)),
          z = Math.floor(o[2]! + d[2]! * Math.min(t, reach));
        const centre = `${x},${y},${z}`;
        if (centres.has(centre)) continue;
        centres.add(centre);
        // Include neighbours so even a grazing cell shorter than the fine step is exact-tested.
        for (let a = -1; a <= 1; a++)
          for (let b = -1; b <= 1; b++)
            for (let c = -1; c <= 1; c++) {
              const bx = x + a,
                by = y + b,
                bz = z + c,
                key = `${bx},${by},${bz}`;
              if (visited.has(key)) continue;
              visited.add(key);
              const box = ray.shapes.boxes[world.getBlockStateId(bx, by, bz)];
              if (!box) continue;
              const h = exact(o, d, bx, by, bz, box);
              if (
                h &&
                h.distance <= reach &&
                (!best ||
                  h.distance < best.distance ||
                  (h.distance === best.distance && h.entry < best.entry))
              )
                best = { x: bx, y: by, z: bz, ...h };
            }
      }
      ray.cast(o[0]!, o[1]!, o[2]!, d[0]!, d[1]!, d[2]!, reach, out);
      expect(out.hit, `ray ${n}`).toBe(best !== null);
      if (best) {
        hits++;
        expect(
          [out.x, out.y, out.z],
          JSON.stringify({
            n,
            o,
            d,
            out,
            best,
            actual: registry.getResolvedState(out.stateId),
            expected: registry.getResolvedState(world.getBlockStateId(best.x, best.y, best.z)),
          }),
        ).toEqual([best.x, best.y, best.z]);
        expect(out.face).toBe(best.face);
        expect(out.distance).toBeCloseTo(best.distance, 9);
      }
    }
    expect(hits).toBeGreaterThan(1000);
  }, 120000);
  it('handles zero directions, axis faces, exact reach, and empty slab halves', () => {
    const registry = BlockRegistry.getInstance();
    const ray = new VoxelRaycaster({
        getBlockStateId: (x, y, z) =>
          x === 2 && y === 0 && z === 0
            ? registry.getStateId('stone_slab', { half: 'bottom' })!
            : 0,
      }),
      out = createRayHit();
    expect(ray.cast(0, 0.25, 0.5, 1, 0, 0, 2, out).hit).toBe(true);
    expect(out.face).toBe('west');
    expect(out.distance).toBe(2);
    expect(ray.cast(0, 0.75, 0.5, 1, 0, 0, 5, out).hit).toBe(false);
    expect(ray.cast(0, 0.25, 0.5, 0, 0, 0, 5, out).hit).toBe(false);
  });
});
