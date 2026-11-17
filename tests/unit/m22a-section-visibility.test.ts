import { expect, it } from 'vitest';
import { SectionVisibility } from '../../src/render/section-visibility';

it('invalidates cached visibility when a column is awaiting new meshes', () => {
  const visibility = new SectionVisibility();
  const camera = [8, 168, 8];
  const planes = new Float64Array(24);
  for (let z = -2; z <= 2; z++) for (let y = 0; y < 20; y++) visibility.set(1, y, z, 0);
  visibility.prepare(camera, planes, 0, false);
  expect(visibility.visible(2, 10, 0)).toBe(false);
  visibility.invalidateColumn(1, 0);
  visibility.prepare(camera, planes, 0, false);
  expect(visibility.visible(2, 10, 0)).toBe(true);
  visibility.removeColumn(1, 0);
  visibility.prepare(camera, planes, 0, false);
  expect(visibility.visible(2, 10, 0)).toBe(true);
});

it('retains monotonic paths between the camera and the vertical range of geometry', () => {
  const visibility = new SectionVisibility();
  visibility.prepare([8, 168, 8], new Float64Array(24), 0, false, 7, 12);
  expect(visibility.visible(1, 7, 0)).toBe(true);
  expect(visibility.visible(1, 12, 0)).toBe(true);
});
