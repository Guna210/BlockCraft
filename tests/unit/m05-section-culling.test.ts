import { expect, test } from 'vitest';
import { mat4, vec3 } from 'gl-matrix';
import { Camera } from '../../src/render/camera';
import { columnInFrustum, sectionInFrustum, extractFrustumPlanes } from '../../src/render/frustum';

test('section culling excludes underground/overhead geometry inside a visible column', () => {
  const camera = new Camera(16 / 9);
  vec3.set(camera.position, 0.5, 72, 8);
  camera.yaw = 0;
  camera.pitch = 0;
  camera.updateView();
  const vp = mat4.create();
  mat4.multiply(vp, camera.projectionMatrix, camera.viewMatrix);
  const planes = extractFrustumPlanes(vp);
  expect(columnInFrustum(planes, 2, 0)).toBe(true);
  expect(sectionInFrustum(planes, 2, 4, 0)).toBe(true);
  expect(sectionInFrustum(planes, 2, 0, 0)).toBe(false);
  expect(sectionInFrustum(planes, 2, 19, 0)).toBe(false);
  expect(sectionInFrustum(planes, -2, 4, 0)).toBe(false);
});
