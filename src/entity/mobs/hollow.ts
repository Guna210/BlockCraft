import type { EntityModel } from '../ecs/model';
import { TargetPlayerGoal } from '../ai/goals/target-player';
import { AvoidSunlightGoal } from '../ai/goals/avoid-sunlight';
import { MeleeAttackGoal } from '../ai/goals/melee-attack';
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
import { PRIORITY, registerCreature, rollCount, type CreatureDefinition } from './creature';

export const HOLLOW = 'hollow';
export const HOLLOW_DAMAGE = 3;
/** Chance of one iron ingot among a Hollow's drops. */
export const HOLLOW_IRON_CHANCE = 0.05;

// A gaunt husk of dried, grey-brown bark bound in faded linen strips, with ember eyes.
const BARK: Ramp = ['#1b1613', '#2c231c', '#3f3226', '#564431', '#6f5a3e'];
const CLOTH: Ramp = ['#4b4436', '#6a614b', '#8a7f61', '#aa9d7a'];
const EMBER: Ramp = ['#a8320c', '#f07a1a', '#ffd25a'];
const SOCKET = '#0e0a09';

const DEG = Math.PI / 180;

function hollowModel(): EntityModel {
  const leg = (name: string, x: number): PartSpec => ({
    name,
    pivot: [x + 1.5, 13, 0],
    cubes: [
      { from: [x, 0, -1.5], size: [3, 13, 3] },
      // A cloth binding round the knee.
      { from: [x, 5, -1.5], size: [3, 2, 3], inflate: 0.3 },
    ],
  });
  const arm = (name: string, x: number): PartSpec => ({
    name,
    parent: 'body',
    pivot: [x + 1, 23, 0],
    // Long arms hang forward from the hunched shoulders.
    rotation: [-20 * DEG, 0, 0],
    cubes: [
      { from: [x, 8, -1], size: [2, 15, 2] },
      { from: [x, 16, -1], size: [2, 2, 2], inflate: 0.3 },
      // Twig fingers.
      { from: [x, 5, -1], size: [1, 3, 1] },
      { from: [x + 1, 6, 0], size: [1, 2, 1] },
    ],
  });
  return buildModel({
    id: HOLLOW,
    textureSize: [64, 64],
    parts: [
      {
        name: 'body',
        pivot: [0, 13, 0],
        // Hunched: the torso leans well forward from the hips.
        rotation: [28 * DEG, 0, 0],
        cubes: [
          { from: [-4, 13, -2], size: [8, 11, 4] },
          // Linen strips wound round the chest and the waist.
          { from: [-4, 19, -2], size: [8, 2, 4], inflate: 0.3 },
          { from: [-4, 14, -2], size: [8, 2, 4], inflate: 0.3 },
          // Knotted bark on the shoulders.
          { from: [-5, 22, -1], size: [2, 2, 2] },
          { from: [3, 22, -1], size: [2, 2, 2] },
        ],
      },
      {
        name: 'head',
        parent: 'body',
        pivot: [0, 24, 0],
        // The face is lifted back toward level, so the head juts forward on its long neck.
        rotation: [-22 * DEG, 0, 0],
        cubes: [
          { from: [-1.5, 23, -1.5], size: [3, 3, 3] },
          { from: [-3, 26, -2], size: [6, 7, 6] },
          // A wrap of linen over the jaw, and a ragged hood strip over the crown.
          { from: [-3, 26, -2], size: [6, 2, 6], inflate: 0.3 },
          { from: [-3, 32, -2], size: [6, 1, 6], inflate: 0.3 },
        ],
      },
      arm('arm_r', -6),
      arm('arm_l', 4),
      leg('leg_r', -3.5),
      leg('leg_l', 0.5),
    ],
    walk: {
      maxSwing: 30 * DEG,
      refSpeed: 2.5,
      stride: 1.6,
      limbs: { leg_r: 0, leg_l: Math.PI, arm_r: Math.PI, arm_l: 0 },
    },
    head: { part: 'head', maxPitch: 30 * DEG },
  });
}

export const HOLLOW_MODEL = hollowModel();

function hollowSkin(seed: number): Uint8Array {
  const m = HOLLOW_MODEL,
    p = new SkinPainter(64, 64, seed);
  // Bark: flat shades with vertical grain strokes and a few knots.
  const grain = combine(
    strands(featureSeed(seed, 'grain'), 1),
    clumps(featureSeed(seed, 'knot'), 2, 1),
  );
  const cloth = (cube: Parameters<SkinPainter['cube']>[0]) =>
    p.cube(cube, CLOTH, { base: 1.8, falloff: 1.4 });
  const [torso, chest, waist, knotR, knotL] = cubesOf(m, 'body');
  p.cube(torso!, BARK, { base: 2.2, falloff: 1.4, pattern: grain });
  cloth(chest!);
  cloth(waist!);
  for (const knot of [knotR!, knotL!]) p.cube(knot, BARK, { base: 2.6, falloff: 1.6 });
  const [neck, skull, jaw, hood] = cubesOf(m, 'head');
  p.cube(neck!, BARK, { base: 1.5 });
  p.cube(skull!, BARK, { base: 2.4, falloff: 1.2, pattern: grain });
  cloth(jaw!);
  cloth(hood!);
  // Deep sockets with ember eyes, the brighter core toward the middle of the face.
  const [w] = p.faceSize(skull!, 'front');
  p.rect(skull!, 'front', 0, 2, w, 3, BARK[1]!);
  p.rect(skull!, 'front', 1, 2, 2, 2, SOCKET);
  p.rect(skull!, 'front', w - 3, 2, 2, 2, SOCKET);
  p.rect(skull!, 'front', 1, 3, 1, 1, EMBER[1]!);
  p.rect(skull!, 'front', 2, 3, 1, 1, EMBER[2]!);
  p.rect(skull!, 'front', w - 3, 3, 1, 1, EMBER[2]!);
  p.rect(skull!, 'front', w - 2, 3, 1, 1, EMBER[1]!);
  p.rect(skull!, 'front', 2, 2, 1, 1, EMBER[0]!);
  p.rect(skull!, 'front', w - 3, 2, 1, 1, EMBER[0]!);
  // A dark crack of a mouth under the jaw wrap's edge.
  p.rect(jaw!, 'front', 2, 0, 2, 1, SOCKET);
  for (const name of ['arm_r', 'arm_l']) {
    const [arm, band, fingerA, fingerB] = cubesOf(m, name);
    p.cube(arm!, BARK, { base: 2, falloff: 1.4, pattern: strands(featureSeed(seed, name), 1) });
    cloth(band!);
    for (const finger of [fingerA!, fingerB!]) p.cube(finger, BARK, { base: 1, falloff: 1 });
  }
  for (const name of ['leg_r', 'leg_l']) {
    const [leg, band] = cubesOf(m, name);
    p.cube(leg!, BARK, { base: 1.8, falloff: 1.4, pattern: strands(featureSeed(seed, name), 1) });
    cloth(band!);
  }
  return p.data;
}

export const HOLLOW_PALETTE = [...BARK, ...CLOTH, ...EMBER, SOCKET];

export const HOLLOW_DEFINITION: CreatureDefinition = {
  type: HOLLOW,
  category: 'hostile',
  health: 20,
  width: 0.7,
  height: 1.95,
  speed: 0.115,
  model: () => HOLLOW,
  goals: (mob) => [
    [PRIORITY.target, new TargetPlayerGoal(mob)],
    // In daylight it walks into shade instead of fighting in the open.
    [PRIORITY.avoidSunlight, new AvoidSunlightGoal(mob)],
    [PRIORITY.attack, new MeleeAttackGoal(mob, { damage: HOLLOW_DAMAGE })],
    [PRIORITY.wander, new WanderGoal(mob)],
  ],
  drops: (ctx) => [
    ['bark_strips', rollCount(ctx.random, 1, 2)],
    ['iron_ingot', ctx.random() < HOLLOW_IRON_CHANCE ? 1 : 0],
  ],
};

registerCreature({
  definition: HOLLOW_DEFINITION,
  models: [[HOLLOW_MODEL, hollowSkin]],
});
