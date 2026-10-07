import { test, expect } from '../harness/fixture';

// M03g item B: a section must never be meshed while one of its neighbour columns is missing, or
// the mesher sees air there and emits faces (for water, translucent walls) toward a column that
// does not exist. After createWorld, and after waitForTerrain at another place, no meshed face
// may face a column that has not been generated.

interface RendererHandle {
  glWrapper: { gl: WebGL2RenderingContext };
  world: { hasColumn(cx: number, cz: number): boolean };
  camera: { position: Float32Array; updateView(): void };
  chunkRenderer: {
    sectionMeshes: Map<
      string,
      {
        sx: number;
        sy: number;
        sz: number;
        opaque: GPUBucket | null;
        cutout: GPUBucket | null;
        translucent: GPUBucket | null;
      }
    >;
  };
}
interface GPUBucket {
  vbo: WebGLBuffer;
  ebo: WebGLBuffer;
  indexCount: number;
}
type WorldManagerHost = { WorldManager: { getInstance(): RendererHandle } };

/** Counts side faces (±X, ±Z) of every uploaded bucket whose neighbouring column is not generated. */
async function facesTowardMissingColumns(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const wm = (window as unknown as WorldManagerHost).WorldManager.getInstance();
    const gl = wm.glWrapper.gl;
    const result = {
      sections: 0,
      sideQuads: 0,
      towardMissing: 0,
      byBucket: { opaque: 0, cutout: 0, translucent: 0 },
      examples: [] as string[],
    };
    for (const mesh of wm.chunkRenderer.sectionMeshes.values()) {
      result.sections++;
      for (const name of ['opaque', 'cutout', 'translucent'] as const) {
        const bucket = mesh[name];
        if (!bucket) continue;
        const idx = new Uint32Array(bucket.indexCount);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bucket.ebo);
        gl.getBufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, idx);
        let maxIndex = 0;
        for (const i of idx) if (i > maxIndex) maxIndex = i;
        const vb = new Uint32Array((maxIndex + 1) * 2);
        gl.bindBuffer(gl.ARRAY_BUFFER, bucket.vbo);
        gl.getBufferSubData(gl.ARRAY_BUFFER, 0, vb);
        for (let q = 0; q < idx.length / 6; q++) {
          const w0 = vb[idx[q * 6]! * 2]!;
          const n = (w0 >> 15) & 7;
          if (n === 2 || n === 3) continue; // up and down faces stay in their own column
          result.sideQuads++;
          // a +X / +Z face lies on the section's far plane, a -X / -Z face on its near plane
          const dcx = n === 0 ? 1 : n === 1 ? -1 : 0;
          const dcz = n === 4 ? 1 : n === 5 ? -1 : 0;
          const lx = w0 & 31;
          const lz = (w0 >> 10) & 31;
          // local coordinate 0 or 16 on the facing axis means the face is on the section border
          const onBorder = n < 2 ? lx === (n === 0 ? 16 : 0) : lz === (n === 4 ? 16 : 0);
          if (!onBorder) continue;
          if (!wm.world.hasColumn(mesh.sx + dcx, mesh.sz + dcz)) {
            result.towardMissing++;
            result.byBucket[name]++;
            if (result.examples.length < 5) {
              result.examples.push(
                `${name} section (${mesh.sx},${mesh.sy},${mesh.sz}) normal ${n}`,
              );
            }
          }
        }
      }
    }
    return result;
  });
}

test('M03g: after createWorld no meshed face faces a column that has not been generated', async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.__blockcraft!.createWorld!({
      name: 'm03g-perimeter',
      seed: 'blockcraft-test-seed-42',
      mode: 'survival',
      type: 'default',
    });
  });
  const result = await facesTowardMissingColumns(page);
  expect(result.sideQuads, 'side quads checked').toBeGreaterThan(1000);
  expect(result.examples).toEqual([]);
  expect(result.towardMissing).toBe(0);
});

test('M03g: waitForTerrain at another place meshes its radius and leaves no face toward a missing column', async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.__blockcraft!.createWorld!({
      name: 'm03g-perimeter-2',
      seed: 'blockcraft-test-seed-42',
      mode: 'survival',
      type: 'default',
    });
    const camera = (window as unknown as WorldManagerHost).WorldManager.getInstance().camera;
    camera.position[0] = 400;
    camera.position[2] = -300;
    camera.updateView();
    await window.__blockcraft!.waitForTerrain!(2);
  });

  // The contract of waitForTerrain: every column within the radius is generated, meshed, uploaded.
  const covered = await page.evaluate(() => {
    const wm = (window as unknown as WorldManagerHost).WorldManager.getInstance();
    const centerCX = Math.floor(400 / 16);
    const centerCZ = Math.floor(-300 / 16);
    const missing: string[] = [];
    for (let cx = centerCX - 2; cx <= centerCX + 2; cx++) {
      for (let cz = centerCZ - 2; cz <= centerCZ + 2; cz++) {
        let meshed = 0;
        for (const mesh of wm.chunkRenderer.sectionMeshes.values()) {
          if (mesh.sx === cx && mesh.sz === cz) meshed++;
        }
        if (!wm.world.hasColumn(cx, cz) || meshed === 0) missing.push(`${cx},${cz}`);
      }
    }
    return missing;
  });
  expect(covered, 'columns within radius 2 that are not generated or have no mesh').toEqual([]);

  const result = await facesTowardMissingColumns(page);
  expect(result.sideQuads).toBeGreaterThan(1000);
  expect(result.examples).toEqual([]);
  expect(result.towardMissing).toBe(0);
});
