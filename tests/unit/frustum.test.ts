import { describe, it, expect } from 'vitest';
import { mat4, vec3, vec4 } from 'gl-matrix';
import {
  aabbIntersectsFrustum,
  columnInFrustum,
  extractFrustumPlanes,
  COLUMN_MAX_Y,
} from '../../src/render/frustum';
import { Camera } from '../../src/render/camera';

function viewProjOf(
  pos: [number, number, number],
  yaw: number,
  pitch: number,
  aspect = 16 / 9,
): mat4 {
  const cam = new Camera(aspect);
  cam.position = vec3.fromValues(...pos);
  cam.yaw = yaw;
  cam.pitch = pitch;
  cam.updateView();
  const vp = mat4.create();
  mat4.multiply(vp, cam.projectionMatrix, cam.viewMatrix);
  return vp;
}

/** Reference: does any sampled point of the column box lie inside the clip volume? */
function anySampleVisible(vp: mat4, cx: number, cz: number): boolean {
  const p = vec4.create();
  for (let ix = 0; ix <= 2; ix++) {
    for (let iz = 0; iz <= 2; iz++) {
      for (let iy = 0; iy <= 8; iy++) {
        vec4.set(p, cx * 16 + ix * 8, (iy * COLUMN_MAX_Y) / 8, cz * 16 + iz * 8, 1);
        vec4.transformMat4(p, p, vp);
        if (
          Math.abs(p[0]) <= p[3] &&
          Math.abs(p[1]) <= p[3] &&
          Math.abs(p[2]) <= p[3] &&
          p[3] > 0
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

describe('column frustum test', () => {
  it('keeps a column straight ahead of the camera', () => {
    const planes = extractFrustumPlanes(viewProjOf([0.5, 100, 0.5], 0, 0));
    expect(columnInFrustum(planes, 5, 0)).toBe(true);
    expect(columnInFrustum(planes, 20, 0)).toBe(true);
  });

  it('keeps the column the camera is standing in, in any direction', () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [Math.PI, 0],
      [1.2, -1.5],
      [-2, 1.5],
    ]) {
      const planes = extractFrustumPlanes(viewProjOf([8.5, 70, 8.5], yaw!, pitch!));
      expect(columnInFrustum(planes, 0, 0), `yaw ${yaw} pitch ${pitch}`).toBe(true);
    }
  });

  it('culls columns behind the camera (near plane)', () => {
    const planes = extractFrustumPlanes(viewProjOf([0.5, 100, 0.5], 0, 0));
    expect(columnInFrustum(planes, -5, 0)).toBe(false);
    expect(columnInFrustum(planes, -30, 3)).toBe(false);
  });

  it('culls columns beyond the far plane', () => {
    const planes = extractFrustumPlanes(viewProjOf([0.5, 100, 0.5], 0, 0));
    expect(columnInFrustum(planes, 70, 0)).toBe(false); // x = 1120 > far 1000
    expect(columnInFrustum(planes, 55, 0)).toBe(true); // x = 880
  });

  it('culls columns outside the left and right planes', () => {
    const planes = extractFrustumPlanes(viewProjOf([0.5, 100, 0.5], 0, 0));
    // Yaw 0 looks along +x; +z is to the right. Horizontal half angle is about 51 degrees.
    expect(columnInFrustum(planes, 4, 20)).toBe(false);
    expect(columnInFrustum(planes, 4, -20)).toBe(false);
    expect(columnInFrustum(planes, 20, 20)).toBe(true); // 45 degrees, inside
    expect(columnInFrustum(planes, 20, -20)).toBe(true);
  });

  it('culls columns outside the top and bottom planes when the camera looks up or down', () => {
    const up = extractFrustumPlanes(viewProjOf([0.5, 100, 0.5], 0, Math.PI / 2 - 0.02));
    expect(columnInFrustum(up, 0, 0)).toBe(true);
    expect(columnInFrustum(up, 30, 0)).toBe(false);
    expect(columnInFrustum(up, 0, 30)).toBe(false);

    const down = extractFrustumPlanes(viewProjOf([0.5, 100, 0.5], 0, -(Math.PI / 2 - 0.02)));
    expect(columnInFrustum(down, 0, 0)).toBe(true);
    expect(columnInFrustum(down, 30, 0)).toBe(false);
    expect(columnInFrustum(down, 0, -30)).toBe(false);
  });

  it('keeps a column that straddles a plane', () => {
    const planes = extractFrustumPlanes(viewProjOf([0.5, 100, 0.5], 0, 0));
    // Column x 16..32, z 16..32 touches the right plane (45 degrees line x = z) from both sides.
    expect(columnInFrustum(planes, 1, 1)).toBe(true);
    // Column straddling the near plane: camera inside it.
    expect(columnInFrustum(planes, 0, 0)).toBe(true);
    // A box straddling the far plane.
    expect(aabbIntersectsFrustum(planes, 990, 90, 0, 1010, 110, 16)).toBe(true);
  });

  it('never culls a column that has a visible point (random cameras and columns)', () => {
    let seed = 12345;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let visible = 0;
    let culled = 0;
    const wronglyCulled: string[] = [];
    for (let i = 0; i < 300; i++) {
      const pos: [number, number, number] = [rnd() * 400 - 200, rnd() * 300, rnd() * 400 - 200];
      const yaw = rnd() * Math.PI * 2;
      const pitch = (rnd() - 0.5) * Math.PI * 0.98;
      const vp = viewProjOf(pos, yaw, pitch);
      const planes = extractFrustumPlanes(vp);
      const ccx = Math.floor(pos[0] / 16);
      const ccz = Math.floor(pos[2] / 16);
      for (let dz = -12; dz <= 12; dz += 1) {
        for (let dx = -12; dx <= 12; dx += 1) {
          const inside = anySampleVisible(vp, ccx + dx, ccz + dz);
          const kept = columnInFrustum(planes, ccx + dx, ccz + dz);
          if (inside) {
            visible++;
            if (!kept) wronglyCulled.push(`camera ${i} column ${ccx + dx},${ccz + dz}`);
          } else if (!kept) {
            culled++;
          }
        }
      }
    }
    expect(wronglyCulled).toEqual([]);
    // The test is only meaningful if both outcomes occur.
    expect(visible).toBeGreaterThan(1000);
    expect(culled).toBeGreaterThan(1000);
  });
});
