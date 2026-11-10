import { registerEntityModel, cubeFaceRects } from '../entity/ecs/model';
import { buildModel } from '../entity/mobs/kit';
import { genBlastCharge } from './textures/explosions';
const MODEL = 'primed_blast_charge';
for (const flash of [false, true]) {
  const model = buildModel({
    id: MODEL + (flash ? '_flash' : ''),
    textureSize: [64, 64],
    parts: [
      { name: 'charge', pivot: [0, 0, 0], cubes: [{ from: [-8, 0, -8], size: [16, 16, 16] }] },
    ],
  });
  registerEntityModel(model, (seed) => {
    const data = new Uint8Array(64 * 64 * 4);
    for (const [face, rect] of Object.entries(cubeFaceRects(model.parts[0]!.cubes[0]!))) {
      const tile = genBlastCharge(seed, face === 'top' || face === 'bottom');
      for (let y = 0; y < rect[3]; y++)
        for (let x = 0; x < rect[2]; x++) {
          const target = ((rect[1] + y) * 64 + rect[0] + x) * 4;
          for (let c = 0; c < 4; c++) data[target + c] = flash ? 255 : tile[(y * 16 + x) * 4 + c]!;
        }
    }
    return data;
  });
}
