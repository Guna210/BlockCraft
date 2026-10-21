import { TransformC } from '../ecs/components';
import type { EntityModel, Vec3 } from '../ecs/model';
import type { MobHandle } from '../ai/runtime';
import { FleeGoal } from '../ai/goals/flee';
import { BreedGoal } from '../ai/goals/breed';
import { FollowFoodGoal } from '../ai/goals/follow-food';
import { ForageGoal } from '../ai/goals/forage';
import { WanderGoal } from '../ai/goals/wander';
import {
  SkinPainter,
  buildModel,
  clumps,
  combine,
  cubesOf,
  featureSeed,
  strands,
  type PartSpec,
  type Ramp,
} from './kit';
import { PRIORITY, isBaby, registerCreature, rollCount, type CreatureDefinition } from './creature';

export const ROOTBOAR = 'rootboar';
export const ROOT_MIN_TICKS = 1200;
export const ROOT_MAX_TICKS = 2400;
export const ROOT_TICKS = 30;

// A dark, grizzled hide; a near-black bristle crest with rusty tips; a dark leathery snout.
const HIDE: Ramp = ['#1f1a1c', '#33282a', '#4b3a33', '#654e3f', '#80664f'];
const BRISTLE: Ramp = ['#151215', '#2a2124', '#4a3529', '#7a5434', '#a2733f'];
const SNOUT: Ramp = ['#1d1719', '#30262a', '#4a3c39', '#66554b', '#83705f'];
const TUSK: Ramp = ['#8c8270', '#c4b89a', '#ece2c6'];
const EYE = '#d6a640';
const PUPIL = '#0f0d10';

const DEG = Math.PI / 180;

function rootboarModel(): EntityModel {
  const leg = (name: string, x: number, z: number): PartSpec => ({
    name,
    pivot: [x + 1.5, 6, z + 1.5],
    cubes: [{ from: [x, 0, z], size: [3, 6, 3] }],
  });
  return buildModel({
    id: ROOTBOAR,
    textureSize: [128, 64],
    parts: [
      {
        name: 'body',
        pivot: [0, 10, 0],
        cubes: [
          { from: [-4.5, 6, -8], size: [9, 8, 15] },
          // The shoulders stand higher than the haunches.
          { from: [-5, 9, 0], size: [10, 7, 7] },
        ],
      },
      {
        // A crest of stiff bristles along the spine, tallest over the shoulders.
        name: 'ridge',
        parent: 'body',
        pivot: [0, 14, 0],
        cubes: [
          [-7, 14, 2],
          [-5, 14, 3],
          [-3, 14, 3],
          [-1, 14, 4],
          [1, 16, 3],
          [3, 16, 4],
          [5, 16, 3],
        ].flatMap(([z, y, h]) => [
          { from: [-0.5, y!, z!] as Vec3, size: [1, h!, 1] as Vec3 },
          { from: [-1.5, y!, z! + 1] as Vec3, size: [1, h! - 1, 1] as Vec3 },
          { from: [0.5, y!, z! + 1] as Vec3, size: [1, h! - 1, 1] as Vec3 },
        ]),
      },
      {
        name: 'head',
        parent: 'body',
        pivot: [0, 12, 7],
        rotation: [10 * DEG, 0, 0],
        cubes: [
          { from: [-3.5, 7, 7], size: [7, 7, 6] },
          // A long, tapering snout ending in a small dark nose rather than a flat disc.
          { from: [-2, 7, 13], size: [4, 4, 5] },
          { from: [-1.5, 7, 18], size: [3, 3, 2] },
          { from: [-3.5, 14, 8], size: [2, 3, 1] },
          { from: [1.5, 14, 8], size: [2, 3, 1] },
        ],
      },
      {
        // Tusks curving up and back from the sides of the snout.
        name: 'tusks',
        parent: 'head',
        pivot: [0, 9, 16],
        cubes: [
          { from: [-3, 8, 16], size: [1, 4, 1] },
          { from: [-3, 11, 14], size: [1, 1, 2] },
          { from: [2, 8, 16], size: [1, 4, 1] },
          { from: [2, 11, 14], size: [1, 1, 2] },
        ],
      },
      {
        name: 'tail',
        parent: 'body',
        pivot: [0, 13, -8],
        rotation: [20 * DEG, 0, 0],
        cubes: [{ from: [-0.5, 9, -9], size: [1, 4, 1] }],
      },
      leg('leg_fr', -4.5, 3),
      leg('leg_fl', 1.5, 3),
      leg('leg_br', -4.5, -7),
      leg('leg_bl', 1.5, -7),
    ],
    walk: {
      maxSwing: 35 * DEG,
      refSpeed: 2.5,
      stride: 1.2,
      limbs: { leg_fr: 0, leg_bl: 0, leg_fl: Math.PI, leg_br: Math.PI },
    },
    head: { part: 'head', maxPitch: 30 * DEG },
    clips: {
      root: {
        length: ROOT_TICKS,
        loop: false,
        channels: [
          {
            part: 'head',
            property: 'rotation',
            interpolation: 'linear',
            keys: [
              { tick: 0, value: [0, 0, 0] },
              { tick: 5, value: [0.7, 0, 0] },
              { tick: 9, value: [0.55, 0.2, 0] },
              { tick: 13, value: [0.7, -0.2, 0] },
              { tick: 17, value: [0.55, 0.2, 0] },
              { tick: 21, value: [0.7, -0.2, 0] },
              { tick: 25, value: [0.7, 0, 0] },
              { tick: 30, value: [0, 0, 0] },
            ],
          },
        ],
      },
    },
  });
}

export const ROOTBOAR_MODEL = rootboarModel();

function rootboarSkin(seed: number): Uint8Array {
  const m = ROOTBOAR_MODEL,
    p = new SkinPainter(128, 64, seed);
  const grizzle = combine(
    clumps(featureSeed(seed, 'hide'), 2, 1),
    strands(featureSeed(seed, 'grizzle'), 0.5),
  );
  const [flank, shoulders] = cubesOf(m, 'body');
  p.cube(flank!, HIDE, { base: 2, falloff: 1.4, pattern: grizzle });
  p.cube(shoulders!, HIDE, { base: 2.2, falloff: 1.2, pattern: grizzle });
  for (const crest of cubesOf(m, 'ridge'))
    p.cube(crest, BRISTLE, {
      base: 1.8,
      falloff: 2.4,
      top: 1.5,
      pattern: strands(featureSeed(seed, 'bristle'), 1.2),
    });
  const [skull, snout, nose, earR, earL] = cubesOf(m, 'head');
  p.cube(skull!, HIDE, { base: 2.3, pattern: clumps(featureSeed(seed, 'face'), 2, 0.7) });
  p.cube(snout!, SNOUT, {
    base: 2,
    falloff: 1,
    pattern: clumps(featureSeed(seed, 'snout'), 2, 0.5),
  });
  p.cube(nose!, SNOUT, { base: 0.8, falloff: 0.6 });
  p.rect(nose!, 'front', 0, 1, 1, 1, PUPIL);
  p.rect(nose!, 'front', 2, 1, 1, 1, PUPIL);
  for (const ear of [earR!, earL!]) p.cube(ear, BRISTLE, { base: 2, falloff: 1.5 });
  // Small amber eyes set high on the head's sides, just behind the snout.
  const [depth] = p.faceSize(skull!, 'right');
  p.rect(skull!, 'right', depth - 2, 2, 1, 1, EYE);
  p.rect(skull!, 'right', depth - 3, 2, 1, 1, PUPIL);
  p.rect(skull!, 'left', 1, 2, 1, 1, EYE);
  p.rect(skull!, 'left', 2, 2, 1, 1, PUPIL);
  for (const tusk of cubesOf(m, 'tusks')) p.cube(tusk, TUSK, { base: 1.6, falloff: 1.4 });
  const [tail] = cubesOf(m, 'tail');
  p.cube(tail!, BRISTLE, { base: 1.5, falloff: -1.5 });
  for (const name of ['leg_fr', 'leg_fl', 'leg_br', 'leg_bl']) {
    const [leg] = cubesOf(m, name);
    p.cube(leg!, HIDE, { base: 1.4, falloff: 1.2 });
    for (const face of ['right', 'front', 'left', 'back'] as const) {
      const [w, h] = p.faceSize(leg!, face);
      p.rect(leg!, face, 0, h - 1, w, 1, BRISTLE[0]!);
    }
  }
  return p.data;
}

export const ROOTBOAR_PALETTE = [...HIDE, ...BRISTLE, ...SNOUT, ...TUSK, EYE, PUPIL];

/** Drops one tuber at the snout of a rooting Rootboar. */
function dropTuber(mob: MobHandle): void {
  const items = mob.runtime.spawnContext?.items;
  const transform = mob.runtime.ecs.get(mob.id, TransformC);
  if (!items || !transform) return;
  const reach = 0.9;
  items.spawn(
    'tuber',
    1,
    transform.pos[0] + Math.cos(transform.yaw) * reach,
    transform.pos[1] + 0.3,
    transform.pos[2] + Math.sin(transform.yaw) * reach,
  );
}

export const ROOTBOAR_DEFINITION: CreatureDefinition = {
  type: ROOTBOAR,
  category: 'passive',
  health: 12,
  width: 0.9,
  height: 0.95,
  speed: 0.1,
  foods: ['tuber'],
  model: () => ROOTBOAR,
  goals: (mob) => [
    [PRIORITY.flee, new FleeGoal(mob)],
    [PRIORITY.breed, new BreedGoal(mob)],
    [PRIORITY.followFood, new FollowFoodGoal(mob)],
    [
      PRIORITY.forage,
      new ForageGoal(mob, {
        name: 'root',
        min: ROOT_MIN_TICKS,
        max: ROOT_MAX_TICKS,
        ground: ['dirt', 'grass_block'],
        duration: ROOT_TICKS,
        clip: 'root',
        act: () => dropTuber(mob),
      }),
    ],
    [PRIORITY.wander, new WanderGoal(mob)],
  ],
  drops: (ctx, id) => (isBaby(ctx.ecs, id) ? [] : [['raw_boar_chop', rollCount(ctx.random, 1, 3)]]),
};

registerCreature({
  definition: ROOTBOAR_DEFINITION,
  models: [[ROOTBOAR_MODEL, rootboarSkin]],
  spawn: {
    biomes: ['oakwood_forest', 'birch_grove', 'pine_taiga'],
    groupSize: [2, 4],
    weight: 10,
  },
});
