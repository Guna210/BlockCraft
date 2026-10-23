import { RenderableC, TransformC } from '../ecs/components';
import type { EntityModel } from '../ecs/model';
import type { MobHandle } from '../ai/runtime';
import { TargetPlayerGoal } from '../ai/goals/target-player';
import { SwellGoal } from '../ai/goals/swell';
import { ApproachGoal } from '../ai/goals/approach';
import { WanderGoal } from '../ai/goals/wander';
import {
  SkinPainter,
  buildModel,
  clumps,
  cubesOf,
  featureSeed,
  spots,
  strands,
  type Ramp,
} from './kit';
import { PRIORITY, registerCreature, rollCount, type CreatureDefinition } from './creature';
import { spawnSporeCloud } from './spore-cloud';

export const SPOREBURST = 'sporeburst';
/** Drawn while it flashes during the swell: the same model in a pale skin. */
export const SPOREBURST_FLASH = 'sporeburst_flash';
/** Blast power of the burst (Appendix B). */
export const SPOREBURST_POWER = 3;
export const SWELL_TICKS = 30;
/** The model grows to this multiple of its size by the end of the swell. */
export const SWELL_GROWTH = 0.35;

// A mauve cap with cream warts over a pale, fibrous stem; root legs in dark earth tones.
const CAP: Ramp = ['#3a2238', '#5a3456', '#7d4a72', '#a0688e', '#c48fac'];
const WART: Ramp = ['#cdbb98', '#e8dcb8'];
const STEM: Ramp = ['#6c5f4c', '#958568', '#b9aa88', '#d8ccae'];
const GILL: Ramp = ['#2a1d22', '#4a3439'];
const ROOT: Ramp = ['#2a1d14', '#41301f', '#5c472f'];
const EYE = '#151012';
const FLASH: Ramp = ['#b8b0b4', '#d6d0d2', '#ece8e9', '#ffffff'];

const DEG = Math.PI / 180;

function sporeburstModel(id: string): EntityModel {
  return buildModel({
    id,
    textureSize: [128, 64],
    parts: [
      {
        name: 'body',
        pivot: [0, 5, 0],
        cubes: [
          // The stem, with a ragged skirt (annulus) under the cap.
          { from: [-4, 4, -4], size: [8, 11, 8] },
          { from: [-5, 13, -5], size: [10, 1, 10] },
        ],
      },
      {
        name: 'cap',
        parent: 'body',
        pivot: [0, 15, 0],
        cubes: [
          { from: [-8, 15, -8], size: [16, 4, 16] },
          { from: [-6, 19, -6], size: [12, 3, 12] },
          { from: [-3, 22, -3], size: [6, 1, 6] },
        ],
      },
      {
        name: 'leg_r',
        pivot: [-2, 5, 0],
        cubes: [
          { from: [-4, 0, -2], size: [3, 5, 3] },
          { from: [-4, 0, 1], size: [2, 1, 2] },
          { from: [-5, 0, -2], size: [1, 1, 2] },
        ],
      },
      {
        name: 'leg_l',
        pivot: [2, 5, 0],
        cubes: [
          { from: [1, 0, -2], size: [3, 5, 3] },
          { from: [2, 0, 1], size: [2, 1, 2] },
          { from: [4, 0, -2], size: [1, 1, 2] },
        ],
      },
    ],
    // Short legs and a big stride: it waddles.
    walk: { maxSwing: 35 * DEG, refSpeed: 1.6, stride: 0.7, limbs: { leg_r: 0, leg_l: Math.PI } },
  });
}

export const SPOREBURST_MODEL = sporeburstModel(SPOREBURST);
export const SPOREBURST_FLASH_MODEL = sporeburstModel(SPOREBURST_FLASH);

function paintSporeburst(m: EntityModel, seed: number, flash: boolean): Uint8Array {
  const p = new SkinPainter(128, 64, seed);
  const ramp = (normal: Ramp) => (flash ? FLASH : normal);
  const [stem, skirt] = cubesOf(m, 'body');
  p.cube(stem!, ramp(STEM), {
    base: 1.8,
    falloff: 1.2,
    pattern: strands(featureSeed(seed, 'fibre'), 1),
  });
  p.cube(skirt!, ramp(STEM), { base: 2.4, falloff: 1, bottom: -2 });
  // Two small dark eyes and a slit mouth high on the stem, under the cap's shadow.
  if (!flash) {
    const [w] = p.faceSize(stem!, 'front');
    p.rect(stem!, 'front', 0, 0, w, 1, STEM[0]!);
    p.rect(stem!, 'front', 2, 2, 1, 2, EYE);
    p.rect(stem!, 'front', w - 3, 2, 1, 2, EYE);
    p.rect(stem!, 'front', 3, 5, 2, 1, STEM[0]!);
  }
  const caps = cubesOf(m, 'cap');
  caps.forEach((cube, n) =>
    p.cube(cube, ramp(CAP), {
      base: 2 + n * 0.4,
      falloff: 1.4,
      top: 1,
      pattern: flash ? undefined : clumps(featureSeed(seed, `cap${n}`), 2, 1),
    }),
  );
  if (!flash) {
    // Cream warts as deliberate 2×2 dabs on the cap's top and rim, and radial gills underneath.
    const [rim, dome] = caps;
    for (const [cube, face] of [
      [rim!, 'front'],
      [rim!, 'back'],
      [rim!, 'left'],
      [rim!, 'right'],
    ] as const) {
      const [w] = p.faceSize(cube, face);
      for (let x = 2; x < w - 2; x += 5) p.rect(cube, face, x, 1, 2, 2, WART[0]!);
    }
    for (const cube of [rim!, dome!]) {
      const [w, d] = p.faceSize(cube, 'top');
      const dab = spots(featureSeed(seed, 'warts'), 5, 1);
      for (let y = 0; y < d; y++)
        for (let x = 0; x < w; x++)
          if (dab(x, y, 'top', w, d) > 0) p.rect(cube, 'top', x, y, 1, 1, WART[1]!);
    }
    const [gw, gd] = p.faceSize(rim!, 'bottom');
    p.rect(rim!, 'bottom', 0, 0, gw, gd, GILL[1]!);
    for (let x = 1; x < gw; x += 2) p.rect(rim!, 'bottom', x, 0, 1, gd, GILL[0]!);
  }
  for (const name of ['leg_r', 'leg_l'])
    for (const cube of cubesOf(m, name)) p.cube(cube, ramp(ROOT), { base: 1.2, falloff: 1 });
  return p.data;
}

export const SPOREBURST_PALETTE = [...CAP, ...WART, ...STEM, ...GILL, ...ROOT, EYE];
export const SPOREBURST_FLASH_PALETTE = [...FLASH];

/**
 * M13c's swell, drawn: the Sporeburst grows by a third and flashes pale every 4 ticks while it
 * swells, then leaves a spore cloud where it burst. A cancelled swell puts it back as it was.
 */
export class SporeSwellGoal extends SwellGoal {
  constructor(mob: MobHandle) {
    super(mob, { power: SPOREBURST_POWER, fuse: SWELL_TICKS });
  }

  override tick(): void {
    const ticks = this.swellTicks + 1;
    const renderable = this.ecs.get(this.id, RenderableC);
    if (renderable) {
      renderable.scale = 1 + (SWELL_GROWTH * ticks) / this.fuse;
      renderable.model = Math.floor(ticks / 4) % 2 === 1 ? SPOREBURST_FLASH : SPOREBURST;
    }
    if (ticks >= this.fuse) {
      const pos = this.ecs.get(this.id, TransformC)!.pos;
      spawnSporeCloud(this.ecs, [pos[0], Math.floor(pos[1] + 0.01), pos[2]]);
    }
    super.tick();
  }

  override stop(): void {
    super.stop();
    const renderable = this.ecs.get(this.id, RenderableC);
    if (renderable) {
      renderable.scale = 1;
      renderable.model = SPOREBURST;
    }
  }
}

export const SPOREBURST_DEFINITION: CreatureDefinition = {
  type: SPOREBURST,
  category: 'hostile',
  health: 20,
  width: 0.8,
  height: 1.4,
  speed: 0.1,
  model: () => SPOREBURST,
  goals: (mob) => [
    [PRIORITY.target, new TargetPlayerGoal(mob)],
    [PRIORITY.swell, new SporeSwellGoal(mob)],
    // It walks up without a sound or an attack of its own: the swell is the attack.
    [PRIORITY.attack, new ApproachGoal(mob, { stopDistance: 1.5 })],
    [PRIORITY.wander, new WanderGoal(mob)],
  ],
  // Only a Sporeburst that is killed drops anything; one that bursts leaves just the cloud.
  drops: (ctx) => [['spore_powder', rollCount(ctx.random, 1, 2)]],
};

registerCreature({
  definition: SPOREBURST_DEFINITION,
  models: [
    [SPOREBURST_MODEL, (seed) => paintSporeburst(SPOREBURST_MODEL, seed, false)],
    [SPOREBURST_FLASH_MODEL, (seed) => paintSporeburst(SPOREBURST_FLASH_MODEL, seed, true)],
  ],
});
