import { expect, it } from 'vitest';
import { sortedQuadIndices, TranslucentSorter } from '../../src/render/translucent-sort';

it('reuses scratch while preserving the established back-to-front order', () => {
  const centers = new Float32Array([1, 0, 0, 8, 0, 0, 3, 0, 0, 3, 0, 0]);
  const sorter = new TranslucentSorter(centers);
  for (const camera of [
    [0, 0, 0],
    [10, 1, 0],
  ]) {
    const expected = sortedQuadIndices(centers, camera).map((index) => index + 64);
    expect(sorter.sort(camera, 64)).toEqual(expected);
  }
  const many = new Float32Array(300);
  for (let i = 0; i < many.length; i++) many[i] = (i * 37) % 19;
  const manySorter = new TranslucentSorter(many);
  expect(manySorter.sort([4, 9, 2], 3)).toEqual(
    sortedQuadIndices(many, [4, 9, 2]).map((index) => index + 3),
  );
});
