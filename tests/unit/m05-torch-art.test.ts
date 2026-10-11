import { expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { genTorch } from '../../src/render/textures/light-sources';

it('renders the standing torch as a readable repeated sprite for art review', () => {
  const tile = genTorch();
  expect(genTorch()).toEqual(tile);
  const sheet = new PNG({ width: 192, height: 192 });
  for (let y = 0; y < sheet.height; y++)
    for (let x = 0; x < sheet.width; x++) {
      const source = (((y >> 2) % 16) * 16 + ((x >> 2) % 16)) * 4;
      const target = (y * sheet.width + x) * 4;
      for (let c = 0; c < 3; c++)
        sheet.data[target + c] = tile[source + 3] ? tile[source + c]! : 50;
      sheet.data[target + 3] = 255;
    }
  mkdirSync('artifacts/M05b', { recursive: true });
  writeFileSync('artifacts/M05b/m05-torch-sheet.png', PNG.sync.write(sheet));
});
