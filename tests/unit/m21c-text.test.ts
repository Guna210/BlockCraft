import { it, expect } from 'vitest';
import { networkText } from '../../src/game/net/text';
it('shows separators, zero-width and bidi controls visibly while retaining ordinary Unicode', () => {
  expect(networkText('<b>🌱 café\u2028\u2029\u200b\u202eX\u2069')).toBe(
    '<b>🌱 café\\u2028\\u2029\\u200b\\u202eX\\u2069',
  );
});
