import { describe, it, expect } from 'vitest';
import { vec3 } from 'gl-matrix';
import { mat4 } from 'gl-matrix';
import { Camera } from '../../src/render/camera';
import { extractFrustumPlanes } from '../../src/render/frustum';
import {
  ColumnPhase,
  MAX_RENDER_DISTANCE,
  MIN_RENDER_DISTANCE,
  TravelTracker,
  canFreeData,
  chebyshev,
  clampRenderDistance,
  columnKey,
  comparePriority,
  computePriority,
  makePriorityKey,
  neighboursReady,
  ringOffsets,
  streamRings,
  type PriorityView,
} from '../../src/world/streaming-plan';

function planesOf(pos: [number, number, number], yaw: number, pitch: number): Float64Array {
  const cam = new Camera(16 / 9);
  cam.position = vec3.fromValues(...pos);
  cam.yaw = yaw;
  cam.pitch = pitch;
  cam.updateView();
  const vp = mat4.create();
  mat4.multiply(vp, cam.projectionMatrix, cam.viewMatrix);
  return extractFrustumPlanes(vp);
}

function keyFor(view: PriorityView, cx: number, cz: number, pinned = false) {
  return computePriority(makePriorityKey(), view, cx, cz, pinned);
}

describe('clampRenderDistance', () => {
  it('rounds to a whole number of columns', () => {
    expect(clampRenderDistance(7.4)).toBe(7);
    expect(clampRenderDistance(7.6)).toBe(8);
  });

  it('clamps to 2..32', () => {
    expect(clampRenderDistance(0)).toBe(MIN_RENDER_DISTANCE);
    expect(clampRenderDistance(-10)).toBe(2);
    expect(clampRenderDistance(1.4)).toBe(2);
    expect(clampRenderDistance(33)).toBe(MAX_RENDER_DISTANCE);
    expect(clampRenderDistance(1e9)).toBe(32);
    expect(clampRenderDistance(Infinity)).toBe(32);
    expect(clampRenderDistance(-Infinity)).toBe(2);
  });

  it('turns NaN into the default of 8', () => {
    expect(clampRenderDistance(NaN)).toBe(8);
  });
});

describe('streamRings', () => {
  it('generates one ring beyond the mesh ring and keeps one more ring of each as hysteresis', () => {
    expect(streamRings(8)).toEqual({ mesh: 8, gen: 9, keepMesh: 9, keepData: 10 });
  });

  it('keeps meshes and data strictly beyond the rings that are loaded, so a border hover does not thrash', () => {
    for (let rd = 2; rd <= 32; rd++) {
      const r = streamRings(rd);
      expect(r.keepMesh).toBeGreaterThan(r.mesh);
      expect(r.keepData).toBeGreaterThan(r.gen);
      // Data outlives the mesh that depends on it by at least the one-column perimeter.
      expect(r.keepData).toBeGreaterThanOrEqual(r.keepMesh + 1);
    }
  });
});

describe('ring order', () => {
  it('ring k has 8k columns, all at Chebyshev distance k, without duplicates', () => {
    for (let k = 1; k <= 12; k++) {
      const ring = ringOffsets(k);
      expect(ring.length).toBe(8 * k);
      expect(new Set(ring.map(([x, z]) => `${x},${z}`)).size).toBe(8 * k);
      for (const [x, z] of ring) expect(chebyshev(x, z, 0, 0)).toBe(k);
    }
    expect(ringOffsets(0)).toEqual([[0, 0]]);
  });

  it('rings 0..r together cover the square of side 2r+1 exactly once', () => {
    const r = 6;
    const seen = new Set<string>();
    let lastRing = -1;
    for (let k = 0; k <= r; k++) {
      for (const [x, z] of ringOffsets(k)) {
        seen.add(`${x},${z}`);
        expect(chebyshev(x, z, 0, 0)).toBeGreaterThanOrEqual(lastRing);
        lastRing = chebyshev(x, z, 0, 0);
      }
    }
    expect(seen.size).toBe((2 * r + 1) ** 2);
  });

  it('column keys do not collide', () => {
    const keys = new Set<number>();
    for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) keys.add(columnKey(x, z));
    expect(keys.size).toBe(81 * 81);
  });
});

describe('priority order', () => {
  const baseView = (over: Partial<PriorityView> = {}): PriorityView => ({
    x: 8,
    z: 8,
    cx: 0,
    cz: 0,
    travelX: 0,
    travelZ: 0,
    planes: null,
    ...over,
  });

  it('a nearer Chebyshev ring comes first, whatever the frustum or the travel direction say', () => {
    // Camera looks along +x and travels +x: the column behind it in ring 1 still beats a column
    // straight ahead in ring 2.
    const view = baseView({ planes: planesOf([8, 100, 8], 0, 0), travelX: 1 });
    const behindRing1 = keyFor(view, -1, 0);
    const aheadRing2 = keyFor(view, 2, 0);
    expect(comparePriority(behindRing1, aheadRing2)).toBeLessThan(0);
  });

  it('within a ring, columns in the camera frustum come before columns outside it', () => {
    const view = baseView({ planes: planesOf([8, 100, 8], 0, 0) });
    const inFront = keyFor(view, 3, 0);
    const behind = keyFor(view, -3, 0);
    expect(inFront.outside).toBe(0);
    expect(behind.outside).toBe(1);
    expect(comparePriority(inFront, behind)).toBeLessThan(0);
  });

  it('within ring and frustum class, the column more in the direction of travel comes first', () => {
    // No frustum (everything counts as inside); travelling +x.
    const view = baseView({ travelX: 1 });
    const ahead = keyFor(view, 3, 0);
    const diagonal = keyFor(view, 3, 3);
    const side = keyFor(view, 0, 3);
    const behind = keyFor(view, -3, 0);
    const sorted = [behind, side, diagonal, ahead].sort(comparePriority);
    expect(sorted).toEqual([ahead, diagonal, side, behind]);
    expect(ahead.negDot).toBeCloseTo(-1, 5);
    expect(behind.negDot).toBeGreaterThan(0);
  });

  it('with no travel direction, the exact distance decides within a ring', () => {
    const view = baseView({ x: 1, z: 1 });
    const near = keyFor(view, 2, 0); // centre (40, 8): 39 from the camera
    const far = keyFor(view, -2, 0); // centre (-24, 8): 25 from the camera
    expect(far.negDot).toBeCloseTo(0, 9);
    expect(near.negDot).toBeCloseTo(0, 9);
    expect(comparePriority(far, near)).toBeLessThan(0);
  });

  it('pinned columns come before everything unpinned, even a far ring', () => {
    const view = baseView({ travelX: 1 });
    const unpinnedNear = keyFor(view, 1, 0);
    const pinnedFar = keyFor(view, -9, 4, true);
    expect(comparePriority(pinnedFar, unpinnedNear)).toBeLessThan(0);
  });

  it('is a consistent total order: sorting any permutation gives the same sequence', () => {
    const view = baseView({
      x: 5,
      z: 11,
      travelX: 0.6,
      travelZ: 0.8,
      planes: planesOf([5, 90, 11], 0.9, -0.2),
    });
    const keys = [];
    for (let x = -6; x <= 6; x++)
      for (let z = -6; z <= 6; z++) keys.push({ x, z, k: keyFor(view, x, z) });
    const a = [...keys].sort((p, q) => comparePriority(p.k, q.k)).map((e) => `${e.x},${e.z}`);
    const b = [...keys]
      .reverse()
      .sort((p, q) => comparePriority(p.k, q.k))
      .map((e) => `${e.x},${e.z}`);
    expect(a).toEqual(b);
  });
});

describe('TravelTracker', () => {
  it('is zero while the camera stands still', () => {
    const t = new TravelTracker();
    for (let i = 0; i < 50; i++) t.update(10, 10, 0.016);
    expect(t.dirX).toBe(0);
    expect(t.dirZ).toBe(0);
  });

  it('points along the motion once the camera moves, smoothed', () => {
    const t = new TravelTracker();
    for (let i = 0; i < 60; i++) t.update(10 + i * 0.5, 10, 0.016); // ~31 blocks per second along +x
    expect(t.dirX).toBeGreaterThan(0.99);
    expect(Math.abs(t.dirZ)).toBeLessThan(0.05);
  });

  it('a single jump does not flip the direction at once (smoothing)', () => {
    const t = new TravelTracker();
    for (let i = 0; i < 100; i++) t.update(10 + i * 0.5, 10, 0.016);
    t.update(60, 10, 0.016); // one frame of slight backwards motion
    t.update(59.9, 10, 0.016);
    expect(t.dirX).toBeGreaterThan(0.9);
  });

  it('returns to zero after the camera stops', () => {
    const t = new TravelTracker();
    for (let i = 0; i < 60; i++) t.update(i * 0.5, 0, 0.016);
    for (let i = 0; i < 400; i++) t.update(30, 0, 0.016);
    expect(t.dirX).toBe(0);
    expect(t.dirZ).toBe(0);
  });

  it('ignores a first sample and zero or negative time steps', () => {
    const t = new TravelTracker();
    t.update(0, 0, 0.016);
    t.update(100, 0, 0);
    t.update(200, 0, -1);
    expect(t.dirX).toBe(0);
  });
});

describe('perimeter rules', () => {
  const phases = (entries: Record<string, ColumnPhase>) => (cx: number, cz: number) =>
    entries[`${cx},${cz}`];

  const ring = (cx: number, cz: number, phase: ColumnPhase, skip: string[] = []) => {
    const out: Record<string, ColumnPhase> = {};
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const k = `${cx + dx},${cz + dz}`;
        if (!skip.includes(k)) out[k] = phase;
      }
    }
    return out;
  };

  it('meshing needs all eight neighbour columns to hold data', () => {
    expect(neighboursReady(0, 0, phases(ring(0, 0, 'generated')))).toBe(true);
    expect(neighboursReady(0, 0, phases(ring(0, 0, 'meshed')))).toBe(true);
    for (const missing of ['-1,-1', '0,-1', '1,-1', '-1,0', '1,0', '-1,1', '0,1', '1,1']) {
      expect(neighboursReady(0, 0, phases(ring(0, 0, 'generated', [missing])))).toBe(false);
    }
  });

  it('a neighbour that is only queued or still generating does not count as loaded', () => {
    expect(neighboursReady(0, 0, phases({ ...ring(0, 0, 'generated'), '1,0': 'queuedGen' }))).toBe(
      false,
    );
    expect(neighboursReady(0, 0, phases({ ...ring(0, 0, 'generated'), '1,0': 'generating' }))).toBe(
      false,
    );
  });

  it('data cannot be freed while the column or any neighbour holds a mesh', () => {
    const none = () => false;
    expect(canFreeData(0, 0, none)).toBe(true);
    expect(canFreeData(0, 0, (x, z) => x === 0 && z === 0)).toBe(false);
    for (const [dx, dz] of [
      [-1, -1],
      [0, 1],
      [1, 0],
      [1, 1],
    ]) {
      expect(canFreeData(0, 0, (x, z) => x === dx && z === dz)).toBe(false);
    }
    expect(canFreeData(0, 0, (x, z) => x === 2 && z === 0)).toBe(true); // two columns away
  });
});
