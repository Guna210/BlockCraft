import { AnimatorC } from '../ecs/components';
import type { EntityModel } from '../ecs/model';
import { playClip } from '../ecs/systems';
import { MobBodyC } from '../ai/components';
import { FleeGoal } from '../ai/goals/flee';
import { BreedGoal } from '../ai/goals/breed';
import { FollowFoodGoal } from '../ai/goals/follow-food';
import { LayEggGoal } from '../ai/goals/lay-egg';
import { WanderGoal } from '../ai/goals/wander';
import {
  SkinPainter,
  buildModel,
  clumps,
  combine,
  cubesOf,
  featureSeed,
  spots,
  strands,
  type PartSpec,
  type Ramp,
} from './kit';
import { PRIORITY, isBaby, registerCreature, rollCount, type CreatureDefinition } from './creature';

export const DAPPLEFOWL = 'dapplefowl';
/** Eggs every 5–10 minutes. */
export const EGG_MIN_TICKS = 6000;
export const EGG_MAX_TICKS = 12000;
/** Fluttering caps the fall at this many blocks per tick. */
export const FLUTTER_FALL_SPEED = 0.1;
const FLAP_TICKS = 8;

// Slate-teal plumage with cream dapples, an ember crest fan, ochre beak and legs.
const PLUMAGE: Ramp = ['#1d2c3a', '#2b4252', '#3c5b69', '#527780', '#6e9496'];
const DAPPLE: Ramp = ['#b9b08c', '#d8cfa8', '#f1e9c8'];
const CREST: Ramp = ['#7a2e14', '#b04a1a', '#e07a24', '#f4ad3c', '#ffd877'];
const HORNY: Ramp = ['#5a3f1c', '#8e6a2c', '#c49a44', '#e8c56a'];
const EYE = '#101418';
const GLINT = '#f4f0e0';

const DEG = Math.PI / 180;

function dapplefowlModel(): EntityModel {
  const leg = (name: string, x: number): PartSpec => ({
    name,
    pivot: [x + 0.5, 5, 0],
    cubes: [
      { from: [x, 0, -0.5], size: [1, 5, 1] },
      { from: [x - 0.5, 0, -1], size: [2, 1, 3] },
    ],
  });
  const flap = (sign: 1 | -1) => ({
    part: sign < 0 ? 'wing_r' : 'wing_l',
    property: 'rotation' as const,
    interpolation: 'linear' as const,
    keys: [0, 70, 10, 70, 0].map((degrees, n) => ({
      tick: n * 2,
      value: [0, 0, sign * degrees * DEG] as [number, number, number],
    })),
  });
  return buildModel({
    id: DAPPLEFOWL,
    textureSize: [64, 64],
    parts: [
      {
        name: 'body',
        pivot: [0, 9, 0],
        cubes: [
          { from: [-4, 5, -4], size: [8, 8, 8] },
          // Rounding: a band round the middle and caps above and below.
          { from: [-4.5, 6, -3], size: [9, 6, 6] },
          { from: [-3, 13, -3], size: [6, 1, 6] },
          { from: [-3, 4, -3], size: [6, 1, 6] },
        ],
      },
      {
        name: 'head',
        parent: 'body',
        pivot: [0, 12, 3],
        cubes: [
          { from: [-2.5, 11, 2], size: [5, 5, 5] },
          { from: [-1, 12, 7], size: [2, 2, 2] },
        ],
      },
      {
        name: 'crest',
        parent: 'head',
        pivot: [0, 16, 4],
        rotation: [-20 * DEG, 0, 0],
        cubes: [
          { from: [-0.5, 16, 3], size: [1, 7, 2] },
          { from: [-1.5, 16, 4], size: [1, 5, 1] },
          { from: [0.5, 16, 4], size: [1, 5, 1] },
        ],
      },
      {
        name: 'wing_r',
        parent: 'body',
        pivot: [-4.5, 11, 0],
        rotation: [0, 0, -10 * DEG],
        cubes: [{ from: [-5.5, 6, -3], size: [1, 5, 6] }],
      },
      {
        name: 'wing_l',
        parent: 'body',
        pivot: [4.5, 11, 0],
        rotation: [0, 0, 10 * DEG],
        cubes: [{ from: [4.5, 6, -3], size: [1, 5, 6] }],
      },
      {
        name: 'tail',
        parent: 'body',
        pivot: [0, 10, -4],
        rotation: [-35 * DEG, 0, 0],
        cubes: [{ from: [-2, 9, -6], size: [4, 5, 2] }],
      },
      leg('leg_r', -2.5),
      leg('leg_l', 1.5),
    ],
    walk: { maxSwing: 45 * DEG, refSpeed: 2, stride: 0.7, limbs: { leg_r: 0, leg_l: Math.PI } },
    head: { part: 'head', maxPitch: 40 * DEG },
    clips: {
      flap: {
        length: FLAP_TICKS,
        loop: false,
        // The rest pose already tilts each wing by 10°, so the keys add to it.
        channels: [flap(-1), flap(1)],
      },
    },
  });
}

export const DAPPLEFOWL_MODEL = dapplefowlModel();

function dapplefowlSkin(seed: number): Uint8Array {
  const m = DAPPLEFOWL_MODEL,
    p = new SkinPainter(64, 64, seed);
  const dappled = (cube: (typeof m.parts)[number]['cubes'][number], label: string) => {
    p.cube(cube, PLUMAGE, {
      base: 2.2,
      falloff: 1.4,
      pattern: clumps(featureSeed(seed, label), 2, 0.7),
    });
    // Cream dapples laid over the plumage in round 2×2 spots.
    const pattern = spots(featureSeed(seed, label + ':dapples'), 4, 1);
    const rects = ['right', 'front', 'left', 'back', 'top'] as const;
    for (const face of rects) {
      const [w, h] = p.faceSize(cube, face);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (pattern(x, y, face, w, h) > 0)
            p.rect(cube, face, x, y, 1, 1, DAPPLE[(x + y) % 3 === 0 ? 2 : y < h / 2 ? 1 : 0]!);
    }
  };
  cubesOf(m, 'body').forEach((cube, n) => dappled(cube, `body${n}`));
  const [head, beak] = cubesOf(m, 'head');
  p.cube(head!, PLUMAGE, { base: 2.6, pattern: clumps(featureSeed(seed, 'head'), 2, 0.6) });
  p.cube(beak!, HORNY, { base: 2, falloff: 1.5 });
  // Round dark eyes with a glint, one on each side of the head.
  for (const face of ['right', 'left'] as const) {
    const [w] = p.faceSize(head!, face);
    const x = face === 'right' ? w - 3 : 1;
    p.rect(head!, face, x, 1, 2, 2, EYE);
    p.rect(head!, face, x, 1, 1, 1, GLINT);
  }
  for (const plume of cubesOf(m, 'crest'))
    p.cube(plume, CREST, {
      base: 2.2,
      falloff: 3,
      pattern: strands(featureSeed(seed, 'crest'), 0.6),
    });
  for (const wing of ['wing_r', 'wing_l']) {
    const [cube] = cubesOf(m, wing);
    p.cube(cube!, PLUMAGE, {
      base: 1.6,
      falloff: 1.2,
      // Feather rows: a dark seam every third row, light tips at the trailing edge.
      pattern: combine(
        (_x, y) => (y % 3 === 2 ? -1 : 0),
        (x, _y, _face, w) => (x === w - 1 ? 1 : 0),
      ),
    });
  }
  const [tail] = cubesOf(m, 'tail');
  p.cube(tail!, PLUMAGE, {
    base: 1.2,
    falloff: -1.6,
    pattern: strands(featureSeed(seed, 'tail'), 1),
  });
  for (const name of ['leg_r', 'leg_l'])
    for (const cube of cubesOf(m, name)) p.cube(cube, HORNY, { base: 1.6 });
  return p.data;
}

export const DAPPLEFOWL_PALETTE = [...PLUMAGE, ...DAPPLE, ...CREST, ...HORNY, EYE, GLINT];

export const DAPPLEFOWL_DEFINITION: CreatureDefinition = {
  type: DAPPLEFOWL,
  category: 'passive',
  health: 4,
  width: 0.5,
  height: 0.8,
  speed: 0.08,
  foods: ['seed'],
  maxFallSpeed: FLUTTER_FALL_SPEED,
  model: () => DAPPLEFOWL,
  goals: (mob) => [
    [PRIORITY.flee, new FleeGoal(mob)],
    [PRIORITY.breed, new BreedGoal(mob)],
    [PRIORITY.followFood, new FollowFoodGoal(mob)],
    [PRIORITY.layEgg, new LayEggGoal(mob, { min: EGG_MIN_TICKS, max: EGG_MAX_TICKS, item: 'egg' })],
    [PRIORITY.wander, new WanderGoal(mob)],
  ],
  drops: (ctx, id) =>
    isBaby(ctx.ecs, id)
      ? []
      : [
          ['feather', rollCount(ctx.random, 0, 2)],
          ['raw_fowl', 1],
        ],
  // Flaps its wings while it falls.
  tick(ctx, id) {
    const body = ctx.ecs.get(id, MobBodyC);
    if (!body || body.onGround || body.inFluid || body.vel[1] >= 0) return;
    const animator = ctx.ecs.get(id, AnimatorC);
    if (animator && !animator.clips.some((clip) => clip.name === 'flap'))
      playClip(ctx.ecs, id, 'flap');
  },
};

registerCreature({
  definition: DAPPLEFOWL_DEFINITION,
  models: [[DAPPLEFOWL_MODEL, dapplefowlSkin]],
  spawn: { biomes: ['plains', 'savanna'], groupSize: [2, 4], weight: 8 },
});
