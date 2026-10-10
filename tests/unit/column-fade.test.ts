import { describe, it, expect } from 'vitest';
import {
  ColumnFades,
  FADE_IN_MS,
  UniformValueCache,
  fadeAmount,
  fadeStartFor,
} from '../../src/render/column-fade';

describe('column fade: the clock', () => {
  it('lasts a named constant between 300 and 500 ms of wall-clock time', () => {
    expect(FADE_IN_MS).toBeGreaterThanOrEqual(300);
    expect(FADE_IN_MS).toBeLessThanOrEqual(500);
  });

  it('is 0 at the start, rises linearly and is 1 from FADE_IN_MS on', () => {
    expect(fadeAmount(-10)).toBe(0);
    expect(fadeAmount(0)).toBe(0);
    expect(fadeAmount(FADE_IN_MS / 4)).toBeCloseTo(0.25, 10);
    expect(fadeAmount(FADE_IN_MS / 2)).toBeCloseTo(0.5, 10);
    expect(fadeAmount(FADE_IN_MS)).toBe(1);
    expect(fadeAmount(FADE_IN_MS * 3)).toBe(1);
  });
});

describe('column fade: which uploads start a fade', () => {
  it('a column whose first section is uploaded fades in from that moment', () => {
    const fades = new ColumnFades();
    fades.onUpload(3, -2, false, 1000);
    expect(fades.amount(3, -2, 1000)).toBe(0);
    expect(fades.amount(3, -2, 1000 + FADE_IN_MS / 2)).toBeCloseTo(0.5, 10);
    expect(fades.amount(3, -2, 1000 + FADE_IN_MS)).toBe(1);
  });

  it('an upload to a column that already has section meshes does not fade it again', () => {
    const fades = new ColumnFades();
    fades.onUpload(0, 0, false, 1000);
    // A re-mesh uploads another section while the column is visible.
    fades.onUpload(0, 0, true, 1000 + FADE_IN_MS / 2);
    expect(fades.amount(0, 0, 1000 + FADE_IN_MS / 2)).toBeCloseTo(0.5, 10);
    expect(fades.amount(0, 0, 1000 + FADE_IN_MS)).toBe(1);
  });

  it('a column whose upload has no fade start is shown at once', () => {
    const fades = new ColumnFades();
    fades.onUpload(1, 1, false, null);
    expect(fades.amount(1, 1, 0)).toBe(1);
    expect(fades.size).toBe(0);
  });

  it('a column that is uploaded without a fade and then re-meshed is not faded either', () => {
    const fades = new ColumnFades();
    fades.onUpload(1, 1, false, null);
    fades.onUpload(1, 1, true, 500);
    expect(fades.amount(1, 1, 500)).toBe(1);
  });

  it('a column whose section meshes were all freed fades again when it comes back', () => {
    const fades = new ColumnFades();
    fades.onUpload(2, 2, false, 0);
    expect(fades.amount(2, 2, FADE_IN_MS)).toBe(1);
    fades.onEmptied(2, 2);
    fades.onUpload(2, 2, false, 5000);
    expect(fades.amount(2, 2, 5000)).toBe(0);
    expect(fades.amount(2, 2, 5000 + FADE_IN_MS)).toBe(1);
  });

  it('a column that is emptied during a fade stops fading at once', () => {
    const fades = new ColumnFades();
    fades.onUpload(4, 4, false, 0);
    fades.onEmptied(4, 4);
    expect(fades.amount(4, 4, 10)).toBe(1);
    expect(fades.size).toBe(0);
  });

  it('a column without a fade on record is drawn in full', () => {
    expect(new ColumnFades().amount(9, 9, 0)).toBe(1);
  });

  it('keeps columns apart, including negative and far coordinates', () => {
    const fades = new ColumnFades();
    fades.onUpload(-1, 0, false, 0);
    fades.onUpload(0, -1, false, 100);
    fades.onUpload(-30000, 30000, false, 200);
    expect(fades.size).toBe(3);
    expect(fades.amount(-1, 0, 0)).toBe(0);
    expect(fades.amount(0, -1, 0)).toBe(0);
    expect(fades.amount(0, 0, 0)).toBe(1);
    expect(fades.amount(-30000, 30000, 200)).toBe(0);
  });
});

describe('column fade: the count of columns still fading', () => {
  it('counts the fades that have not finished, not the ones that have', () => {
    const fades = new ColumnFades();
    fades.onUpload(0, 0, false, 0);
    fades.onUpload(1, 0, false, 300);
    expect(fades.fadingColumns(100)).toBe(2);
    expect(fades.fadingColumns(FADE_IN_MS + 10)).toBe(1); // column 0 has finished
    expect(fades.fadingColumns(300 + FADE_IN_MS)).toBe(0);
  });

  it('a column that is emptied is no longer counted', () => {
    const fades = new ColumnFades();
    fades.onUpload(0, 0, false, 0);
    fades.onEmptied(0, 0);
    expect(fades.fadingColumns(0)).toBe(0);
  });

  it('clear forgets every fade', () => {
    const fades = new ColumnFades();
    fades.onUpload(0, 0, false, 0);
    fades.onUpload(5, 5, false, 0);
    fades.clear();
    expect(fades.size).toBe(0);
    expect(fades.fadingColumns(0)).toBe(0);
  });
});

describe('column fade: full opacity while a load is pending', () => {
  it('a section uploaded while createWorld or a region request is pending starts no fade', () => {
    expect(fadeStartFor(true, 1234)).toBeNull();
    const fades = new ColumnFades();
    fades.onUpload(0, 0, false, fadeStartFor(true, 1234));
    expect(fades.amount(0, 0, 1234)).toBe(1);
    expect(fades.size).toBe(0);
  });

  it('a section uploaded with no load pending starts its fade at the upload time', () => {
    expect(fadeStartFor(false, 1234)).toBe(1234);
    const fades = new ColumnFades();
    fades.onUpload(0, 0, false, fadeStartFor(false, 1234));
    expect(fades.amount(0, 0, 1234)).toBe(0);
    expect(fades.amount(0, 0, 1234 + FADE_IN_MS)).toBe(1);
  });
});

describe('column fade: the uniform is written only when its value changes', () => {
  it('writes the first value, skips repeats and writes each change', () => {
    const written: number[] = [];
    const cache = new UniformValueCache((v) => written.push(v));
    for (const v of [1, 1, 1, 0.5, 0.5, 1, 1]) cache.set(v);
    expect(written).toEqual([1, 0.5, 1]);
  });

  it('writes a value again after forget, even when it is the same', () => {
    const written: number[] = [];
    const cache = new UniformValueCache((v) => written.push(v));
    cache.set(1);
    cache.set(1);
    cache.forget();
    cache.set(1);
    expect(written).toEqual([1, 1]);
  });

  it('writes nothing for a finished column in each of several passes', () => {
    // Three passes over the same visible columns, all finished: one write in all.
    const written: number[] = [];
    const cache = new UniformValueCache((v) => written.push(v));
    for (let pass = 0; pass < 3; pass++) {
      for (const amount of [1, 1, 1]) cache.set(amount);
    }
    expect(written).toEqual([1]);
  });
});
