import type { EntityModel, KeyframeChannel, Vec3 } from '../ecs/model';
import { AmphibiousWanderGoal } from '../ai/goals/amphibious-wander';
import { WITHDRAW_TICKS, WithdrawGoal } from '../ai/goals/withdraw';
import { hash2 } from '../../engine/rng';
import {
  SkinPainter,
  buildModel,
  clumps,
  cubesOf,
  featureSeed,
  type PartSpec,
  type Ramp,
} from './kit';
import { PRIORITY, isBaby, registerCreature, type CreatureDefinition } from './creature';

export const MOSSBACK = 'mossback';
/** Ticks to pull the head and legs in at the start of the withdraw clip. */
export const RETRACT_TICKS = 4;

// A stepped, ochre-brown plated dome under a blanket of moss with a few tiny flowers; olive skin.
const PLATE: Ramp = ['#2a1f15', '#43301f', '#5f452b', '#7c5d3a', '#9a7a4e'];
const MOSS: Ramp = ['#1f3a1c', '#2d5326', '#3f6e2f', '#58893a', '#78a648'];
const SKIN: Ramp = ['#2c2e28', '#43463a', '#5d604e', '#787a63', '#94957a'];
const PETAL_PINK: Ramp = ['#c4607f', '#e88aa8', '#f6c4d4'];
const PETAL_GOLD: Ramp = ['#b8901e', '#f0cf4a', '#fbeaa0'];
const PETAL_WHITE: Ramp = ['#c9c4b2', '#f6f3e6'];
const EYE = '#0e0f0c';
const GLINT = '#d8d6b8';

const DEG = Math.PI / 180;

function mossbackModel(): EntityModel {
  const leg = (name: string, x: number, z: number): PartSpec => ({
    name,
    pivot: [x + 2, 4, z + 2],
    cubes: [{ from: [x, 0, z], size: [4, 4, 4] }],
  });
  // Pulled in over RETRACT_TICKS, held, and out again over the last 8 ticks.
  const withdraw = (part: string, offset: Vec3): KeyframeChannel => ({
    part,
    property: 'position',
    interpolation: 'linear',
    keys: [
      { tick: 0, value: [0, 0, 0] },
      { tick: RETRACT_TICKS, value: offset },
      { tick: WITHDRAW_TICKS - 8, value: offset },
      { tick: WITHDRAW_TICKS, value: [0, 0, 0] },
    ],
  });
  return buildModel({
    id: MOSSBACK,
    textureSize: [128, 64],
    parts: [
      { name: 'body', pivot: [0, 6, 0], cubes: [{ from: [-6, 3, -7], size: [12, 3, 14] }] },
      {
        name: 'shell',
        parent: 'body',
        pivot: [0, 8, 0],
        cubes: [
          { from: [-7, 5, -8], size: [14, 4, 16] },
          { from: [-6, 9, -7], size: [12, 3, 14] },
          { from: [-4, 12, -5], size: [8, 2, 10] },
        ],
      },
      {
        name: 'garden',
        parent: 'shell',
        pivot: [0, 14, 0],
        cubes: [
          // Moss tufts.
          { from: [-3, 14, -3], size: [2, 1, 2] },
          { from: [2, 14, 2], size: [2, 1, 2] },
          // A fern frond.
          { from: [2, 14, -4], size: [1, 3, 1] },
          // Three flowers: stem, then blossom.
          { from: [0, 14, 1], size: [1, 2, 1] },
          { from: [-0.5, 16, 0.5], size: [2, 1, 2] },
          { from: [-2, 14, 3], size: [1, 1, 1] },
          { from: [-2.5, 15, 2.5], size: [2, 1, 2] },
          { from: [-5, 12, 0], size: [1, 1, 1] },
          { from: [-5.5, 13, -0.5], size: [2, 1, 2] },
        ],
      },
      {
        name: 'head',
        parent: 'body',
        pivot: [0, 6, 8],
        cubes: [
          { from: [-2, 4, 6], size: [4, 3, 3] },
          { from: [-2.5, 3, 8], size: [5, 5, 5] },
          { from: [-1.5, 3, 13], size: [3, 2, 1] },
        ],
      },
      {
        name: 'tail',
        parent: 'body',
        pivot: [0, 5, -8],
        cubes: [{ from: [-1, 4, -10], size: [2, 2, 2] }],
      },
      leg('leg_fr', -7, 3),
      leg('leg_fl', 3, 3),
      leg('leg_br', -7, -7),
      leg('leg_bl', 3, -7),
    ],
    walk: {
      maxSwing: 25 * DEG,
      refSpeed: 0.8,
      stride: 0.8,
      limbs: { leg_fr: 0, leg_bl: 0, leg_fl: Math.PI, leg_br: Math.PI },
    },
    head: { part: 'head', maxYaw: 45 * DEG, maxPitch: 25 * DEG },
    clips: {
      withdraw: {
        length: WITHDRAW_TICKS,
        loop: false,
        channels: [
          withdraw('head', [0, -1, -6]),
          withdraw('tail', [0, 0, 2]),
          withdraw('leg_fr', [1, 3, 0]),
          withdraw('leg_fl', [-1, 3, 0]),
          withdraw('leg_br', [1, 3, 0]),
          withdraw('leg_bl', [-1, 3, 0]),
        ],
      },
    },
  });
}

export const MOSSBACK_MODEL = mossbackModel();

function mossbackSkin(seed: number): Uint8Array {
  const m = MOSSBACK_MODEL,
    p = new SkinPainter(128, 64, seed);
  const [belly] = cubesOf(m, 'body');
  p.cube(belly!, SKIN, { base: 2, pattern: clumps(featureSeed(seed, 'belly'), 2, 1) });
  const shells = cubesOf(m, 'shell');
  shells.forEach((tier, n) => {
    // Plates: a dark seam every four texels, offset per row so the plates interlock.
    p.cube(tier, PLATE, {
      base: 2.2,
      falloff: 1.2,
      pattern: (x, y, face) =>
        face !== 'top' && face !== 'bottom' && (x + (Math.floor(y / 2) % 2) * 2) % 4 === 0 ? -2 : 0,
    });
    // Moss grows in patches on each tier's top, leaving plates showing between them, and hangs
    // over the top edge of the sides in short drips.
    // Each patch is a 3×3 block: a light top-left corner, a mid-green body, a shaded bottom edge.
    const [tw, td] = p.faceSize(tier, 'top');
    for (let y = 0; y < td; y++)
      for (let x = 0; x < tw; x++) {
        const row = Math.floor(y / 3),
          shifted = x + (row % 2) * 2,
          col = Math.floor(shifted / 3);
        if (hash2(featureSeed(seed, `moss${n}`), col, row) >= 0.6) continue;
        const lx = shifted % 3,
          ly = y % 3;
        const shade = lx === 0 && ly === 0 ? 4 : ly === 2 ? 2 : 3;
        p.rect(tier, 'top', x, y, 1, 1, MOSS[shade]!);
      }
    for (const face of ['right', 'front', 'left', 'back'] as const) {
      const [w] = p.faceSize(tier, face);
      for (let x = 0; x < w; x++) {
        const drip = Math.floor(
          hash2(featureSeed(seed, `drip${n}`) + face.length, Math.floor(x / 2), 0) * 3,
        );
        for (let y = 0; y < drip; y++) p.rect(tier, face, x, y, 1, 1, MOSS[2 - y]!);
      }
    }
  });
  const garden = cubesOf(m, 'garden');
  const [tuftA, tuftB, fern, stemA, bloomA, stemB, bloomB, stemC, bloomC] = garden;
  for (const tuft of [tuftA!, tuftB!])
    p.cube(tuft, MOSS, { base: 3, pattern: clumps(featureSeed(seed, 'tuft'), 2, 1) });
  p.cube(fern!, MOSS, { base: 2.5, falloff: 2 });
  for (const stem of [stemA!, stemB!, stemC!]) p.cube(stem, MOSS, { base: 1.5 });
  p.cube(bloomA!, PETAL_PINK, { base: 1.5, falloff: 1 });
  p.cube(bloomB!, PETAL_GOLD, { base: 1.5, falloff: 1 });
  p.cube(bloomC!, PETAL_WHITE, { base: 1, falloff: 1 });
  for (const bloom of [bloomA!, bloomB!, bloomC!]) p.rect(bloom, 'top', 0, 0, 1, 1, PETAL_GOLD[1]!);
  const [neck, head, beak] = cubesOf(m, 'head');
  p.cube(neck!, SKIN, { base: 1.8, pattern: clumps(featureSeed(seed, 'neck'), 2, 1) });
  p.cube(head!, SKIN, { base: 2.4, pattern: clumps(featureSeed(seed, 'head'), 2, 1) });
  p.cube(beak!, SKIN, { base: 1, falloff: 0.6 });
  for (const face of ['right', 'left'] as const) {
    const [w] = p.faceSize(head!, face);
    const x = face === 'right' ? w - 2 : 0;
    p.rect(head!, face, x, 1, 2, 1, EYE);
    p.rect(head!, face, face === 'right' ? x + 1 : x, 1, 1, 1, GLINT);
  }
  const [tail] = cubesOf(m, 'tail');
  p.cube(tail!, SKIN, { base: 1.6 });
  for (const name of ['leg_fr', 'leg_fl', 'leg_br', 'leg_bl']) {
    const [leg] = cubesOf(m, name);
    // Scaly, elephantine legs: clumped scales with dark toenail marks at the front.
    p.cube(leg!, SKIN, { base: 2, falloff: 1, pattern: clumps(featureSeed(seed, name), 2, 1) });
    p.rect(leg!, 'front', 0, 3, 1, 1, PLATE[0]!);
    p.rect(leg!, 'front', 2, 3, 1, 1, PLATE[0]!);
  }
  return p.data;
}

export const MOSSBACK_PALETTE = [
  ...PLATE,
  ...MOSS,
  ...SKIN,
  ...PETAL_PINK,
  ...PETAL_GOLD,
  ...PETAL_WHITE,
  EYE,
  GLINT,
];

export const MOSSBACK_DEFINITION: CreatureDefinition = {
  type: MOSSBACK,
  category: 'passive',
  health: 30,
  width: 0.95,
  height: 0.9,
  speed: 0.035,
  model: () => MOSSBACK,
  goals: (mob) => [
    [PRIORITY.withdraw, new WithdrawGoal(mob, { clip: 'withdraw', retractTicks: RETRACT_TICKS })],
    [PRIORITY.wander, new AmphibiousWanderGoal(mob)],
  ],
  drops: (ctx, id) => (isBaby(ctx.ecs, id) ? [] : [['shell_plate', 1]]),
};

registerCreature({
  definition: MOSSBACK_DEFINITION,
  models: [[MOSSBACK_MODEL, mossbackSkin]],
});
