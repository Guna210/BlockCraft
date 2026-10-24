import { TransformC } from '../ecs/components';
import { registerEntityModel, type EntityModel, type Vec3 } from '../ecs/model';
import { playClip } from '../ecs/systems';
import type { MobHandle } from '../ai/runtime';
import { TargetPlayerGoal } from '../ai/goals/target-player';
import { RangedAttackGoal } from '../ai/goals/ranged-attack';
import { WanderGoal } from '../ai/goals/wander';
import { fireProjectile, registerProjectileKind } from '../projectiles';
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
import { PRIORITY, registerCreature, rollCount, type CreatureDefinition } from './creature';

export const THORNLING = 'thornling';
export const THORN_KIND = 'thorn';
export const THORN_MODEL_ID = 'projectile_thorn';
/** Launch speed of a thorn in blocks per tick; slow enough that its arc shows. */
export const THORN_SPEED = 0.9;
export const THORN_GRAVITY = 0.05;
/** Ticks between thorns. */
export const THORN_INTERVAL = 40;
const BLINK_TICKS = 70;

// A walking knot of dark briar with pale, red-tipped thorns, a few dark berries, and one eye.
const BRAMBLE: Ramp = ['#172114', '#24331d', '#354829', '#4b6136', '#667b44'];
const THORN: Ramp = ['#5c2a22', '#8f5a3c', '#c49d6c', '#e3c896'];
const BERRY: Ramp = ['#2c0c1c', '#5e1a33', '#93304c'];
const EYE: Ramp = ['#a37a1c', '#e2b23a', '#efe08a'];
const PUPIL = '#0f0b08';

const DEG = Math.PI / 180;

/** Short spikes poking out of the bush: [x, y, z, size]. */
const SPIKES: Array<[Vec3, Vec3]> = [
  [
    [-7, 9, -1],
    [2, 1, 1],
  ],
  [
    [5, 10, 1],
    [2, 1, 1],
  ],
  [
    [-7, 6, 2],
    [2, 1, 1],
  ],
  [
    [5, 6, -3],
    [2, 1, 1],
  ],
  [
    [-2, 17, 1],
    [1, 2, 1],
  ],
  [
    [2, 16, -2],
    [1, 2, 1],
  ],
  [
    [-1, 11, -7],
    [1, 1, 2],
  ],
  [
    [2, 7, -7],
    [1, 1, 2],
  ],
  [
    [3, 12, 5],
    [1, 1, 2],
  ],
  [
    [-4, 6, 5],
    [1, 1, 2],
  ],
];

function thornlingModel(): EntityModel {
  const leg = (name: string, x: number, z: number, splay: number): PartSpec => ({
    name,
    pivot: [x + 1, 5, z + 1],
    rotation: [0, 0, splay * DEG],
    cubes: [{ from: [x, 0, z], size: [2, 5, 2] }],
  });
  return buildModel({
    id: THORNLING,
    textureSize: [128, 64],
    parts: [
      {
        name: 'body',
        pivot: [0, 5, 0],
        cubes: [
          // A lumpy bush: a core with lobes on the top and the sides.
          { from: [-5, 4, -5], size: [10, 10, 10] },
          { from: [-4, 14, -4], size: [8, 3, 7] },
          { from: [-6, 5, -3], size: [2, 7, 6] },
          { from: [4, 6, -4], size: [2, 6, 6] },
          { from: [-3, 5, -6], size: [6, 7, 1] },
        ],
      },
      {
        name: 'thorns',
        parent: 'body',
        pivot: [0, 9, 0],
        cubes: SPIKES.map(([from, size]) => ({ from, size })),
      },
      {
        name: 'berries',
        parent: 'body',
        pivot: [0, 9, 0],
        cubes: [
          { from: [3, 13, 3], size: [2, 2, 2] },
          { from: [-6, 11, -4], size: [2, 2, 2] },
          { from: [-3, 15, -5], size: [2, 2, 2] },
        ],
      },
      {
        // The single eye sits in a hollow of the briar on the front.
        name: 'eye',
        parent: 'body',
        pivot: [0, 9, 5],
        cubes: [{ from: [-2, 7, 5], size: [4, 4, 1] }],
      },
      {
        // The lid hides inside the bush and slides over the eye to blink.
        name: 'lid',
        parent: 'body',
        pivot: [0, 9, 5],
        cubes: [{ from: [-2.5, 6.5, 3], size: [5, 5, 1] }],
      },
      leg('leg_fr', -4, 1, 10),
      leg('leg_fl', 2, 1, -10),
      leg('leg_br', -4, -4, 10),
      leg('leg_bl', 2, -4, -10),
    ],
    walk: {
      maxSwing: 40 * DEG,
      refSpeed: 2,
      stride: 1,
      limbs: { leg_fr: 0, leg_bl: 0, leg_fl: Math.PI, leg_br: Math.PI },
    },
    clips: {
      blink: {
        length: BLINK_TICKS,
        loop: true,
        channels: [
          {
            part: 'lid',
            property: 'position',
            interpolation: 'step',
            keys: [
              { tick: 0, value: [0, 0, 0] },
              { tick: BLINK_TICKS - 4, value: [0, 0, 3] },
              { tick: BLINK_TICKS, value: [0, 0, 0] },
            ],
          },
        ],
      },
    },
  });
}

export const THORNLING_MODEL = thornlingModel();

function thornlingSkin(seed: number): Uint8Array {
  const m = THORNLING_MODEL,
    p = new SkinPainter(128, 64, seed);
  // Briar: flat shades with crossing stems as strokes and a few darker tangles.
  const briar = combine(
    strands(featureSeed(seed, 'stems'), 1),
    clumps(featureSeed(seed, 'tangle'), 2, 1),
  );
  for (const lobe of cubesOf(m, 'body'))
    p.cube(lobe, BRAMBLE, { base: 2.2, falloff: 1.6, pattern: briar });
  for (const spike of cubesOf(m, 'thorns')) {
    p.cube(spike, THORN, { base: 2, falloff: 1 });
    // The outer end of each thorn is red-brown.
    for (const face of ['top', 'right', 'left', 'front', 'back'] as const) {
      const [w, h] = p.faceSize(spike, face);
      if (w > 1) p.rect(spike, face, spike.from[0] < 0 ? 0 : w - 1, 0, 1, h, THORN[0]!);
    }
  }
  for (const berry of cubesOf(m, 'berries')) {
    p.cube(berry, BERRY, { base: 1, falloff: 1 });
    p.rect(berry, 'top', 0, 0, 1, 1, BERRY[2]!);
  }
  const [eye] = cubesOf(m, 'eye');
  p.cube(eye!, EYE, { base: 1.5, falloff: 1 });
  // A vertical slit pupil with a pale glint, in a darker ring.
  p.rect(eye!, 'front', 0, 0, 4, 4, EYE[1]!);
  p.rect(eye!, 'front', 0, 0, 4, 1, EYE[0]!);
  p.rect(eye!, 'front', 1, 1, 2, 2, EYE[2]!);
  p.rect(eye!, 'front', 1, 0, 1, 4, PUPIL);
  p.rect(eye!, 'front', 2, 1, 1, 1, '#ffffff');
  const [lid] = cubesOf(m, 'lid');
  p.cube(lid!, BRAMBLE, { base: 1.6, falloff: 1 });
  for (const name of ['leg_fr', 'leg_fl', 'leg_br', 'leg_bl']) {
    const [leg] = cubesOf(m, name);
    p.cube(leg!, BRAMBLE, { base: 1.4, falloff: 1.4 });
  }
  return p.data;
}

export const THORNLING_PALETTE = [...BRAMBLE, ...THORN, ...BERRY, ...EYE, PUPIL, '#ffffff'];

/** The thorn in flight: a barbed spine, point first along +Z. */
export const THORN_MODEL = buildModel({
  id: THORN_MODEL_ID,
  textureSize: [32, 16],
  parts: [
    {
      name: 'spine',
      pivot: [0, 0, 0],
      cubes: [
        { from: [-0.5, -0.5, -4], size: [1, 1, 7] },
        { from: [-0.5, -0.5, 3], size: [1, 1, 2] },
        { from: [-1.5, -0.5, -3], size: [3, 1, 1] },
        { from: [-0.5, -1.5, -1], size: [1, 3, 1] },
      ],
    },
  ],
});

function thornSkin(seed: number): Uint8Array {
  const p = new SkinPainter(32, 16, seed);
  const [spine, point, barbA, barbB] = cubesOf(THORN_MODEL, 'spine');
  p.cube(spine!, THORN, { base: 1.6, falloff: 1 });
  p.cube(point!, THORN, { base: 0.4, falloff: 0.6 });
  p.cube(barbA!, THORN, { base: 2.4, falloff: 1 });
  p.cube(barbB!, THORN, { base: 2.4, falloff: 1 });
  return p.data;
}

export const THORN_PALETTE = [...THORN];

registerEntityModel(THORN_MODEL, thornSkin);
registerProjectileKind({
  id: THORN_KIND,
  model: THORN_MODEL_ID,
  gravity: THORN_GRAVITY,
  drag: 0.99,
  damageScale: 2.5,
  pickup: false,
});

/** Lobs one thorn from the eye toward `aim`. Mob thorns can never be picked up. */
export function fireThorn(mob: MobHandle, aim: Readonly<Vec3>): number {
  const pos = mob.runtime.ecs.get(mob.id, TransformC)!.pos;
  const dx = aim[0] - pos[0],
    dz = aim[2] - pos[2];
  const flat = Math.hypot(dx, dz) || 1;
  const from: Vec3 = [pos[0] + (dx / flat) * 0.6, pos[1] + 0.6, pos[2] + (dz / flat) * 0.6];
  return fireProjectile(mob.runtime.ecs, {
    kind: THORN_KIND,
    from,
    aimAt: aim,
    speed: THORN_SPEED,
    owner: mob.id,
    pickup: false,
  });
}

export const THORNLING_DEFINITION: CreatureDefinition = {
  type: THORNLING,
  category: 'hostile',
  health: 16,
  width: 0.8,
  height: 1.1,
  speed: 0.09,
  model: () => THORNLING,
  goals: (mob) => [
    [PRIORITY.target, new TargetPlayerGoal(mob)],
    [
      PRIORITY.attack,
      new RangedAttackGoal(mob, {
        fire: (aim) => fireThorn(mob, aim),
        interval: THORN_INTERVAL,
        minRange: 8,
        maxRange: 12,
      }),
    ],
    [PRIORITY.wander, new WanderGoal(mob)],
  ],
  drops: (ctx) => [
    ['thorn', rollCount(ctx.random, 1, 2)],
    ['stick', rollCount(ctx.random, 0, 2)],
  ],
  setup(ctx, id) {
    playClip(ctx.ecs, id, 'blink');
  },
};

registerCreature({
  definition: THORNLING_DEFINITION,
  models: [[THORNLING_MODEL, thornlingSkin]],
});
