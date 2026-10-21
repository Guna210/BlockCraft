import type { EntityModel, KeyframeChannel } from '../ecs/model';
import { playClip } from '../ecs/systems';
import { FlockGoal } from '../ai/goals/flock';
import { getWorldTime, sunElevationSin } from '../../world/time';
import type { World } from '../../world/world';
import { SkinPainter, buildModel, cubesOf, featureSeed, clumps, type Ramp } from './kit';
import { PRIORITY, registerCreature, type CreatureDefinition } from './creature';

export const GLIMMER_MOTH = 'glimmer_moth';
/** Moths spawn only in air with at least this much block light (near torches or lumite). */
export const MOTH_MIN_BLOCK_LIGHT = 8;
const FLUTTER_TICKS = 6;

// Warm glowing wings with lumite-cyan eyespots and a fuzzy umber body.
const WING: Ramp = ['#7a5a2a', '#b88a3a', '#e6bc5a', '#f8df8a', '#fff6c8'];
const EYESPOT: Ramp = ['#1f8fa6', '#37c8e0', '#9ff4ff'];
const FUZZ: Ramp = ['#3a2c1e', '#5a4630', '#7c6444', '#9c8460'];

function glimmerMothModel(): EntityModel {
  const flutter = (part: string, sign: 1 | -1): KeyframeChannel => ({
    part,
    property: 'rotation',
    interpolation: 'linear',
    keys: [
      { tick: 0, value: [0, 0, sign * 0.9] },
      { tick: FLUTTER_TICKS / 2, value: [0, 0, -sign * 0.45] },
      { tick: FLUTTER_TICKS, value: [0, 0, sign * 0.9] },
    ],
  });
  return buildModel({
    id: GLIMMER_MOTH,
    textureSize: [32, 32],
    emissive: true,
    parts: [
      {
        name: 'body',
        pivot: [0, 3, 0],
        cubes: [
          { from: [-1, 2, -1], size: [2, 2, 3] },
          { from: [-0.5, 2, -4], size: [1, 1, 3] },
          { from: [-0.5, 2.5, 2], size: [1, 1, 1] },
          { from: [-1.5, 3.5, 2.5], size: [1, 1, 2] },
          { from: [0.5, 3.5, 2.5], size: [1, 1, 2] },
        ],
      },
      {
        name: 'wing_r',
        parent: 'body',
        pivot: [-1, 3, 0],
        cubes: [
          { from: [-6, 3, -2], size: [5, 0, 5] },
          { from: [-5, 3, -4], size: [4, 0, 2] },
        ],
      },
      {
        name: 'wing_l',
        parent: 'body',
        pivot: [1, 3, 0],
        cubes: [
          { from: [1, 3, -2], size: [5, 0, 5] },
          { from: [1, 3, -4], size: [4, 0, 2] },
        ],
      },
    ],
    clips: {
      flutter: {
        length: FLUTTER_TICKS,
        loop: true,
        channels: [flutter('wing_r', -1), flutter('wing_l', 1)],
      },
    },
  });
}

export const GLIMMER_MOTH_MODEL = glimmerMothModel();

function glimmerMothSkin(seed: number): Uint8Array {
  const m = GLIMMER_MOTH_MODEL,
    p = new SkinPainter(32, 32, seed);
  for (const cube of cubesOf(m, 'body'))
    p.cube(cube, FUZZ, { base: 1.8, pattern: clumps(featureSeed(seed, 'fuzz'), 1, 0.8) });
  for (const name of ['wing_r', 'wing_l']) {
    const [fore, hind] = cubesOf(m, name);
    for (const wing of [fore!, hind!]) {
      // Glow brightest at the root, with a darker veined rim.
      p.cube(wing, WING, {
        base: 2.6,
        top: 0.6,
        bottom: -0.2,
        pattern: (x, y, _face, w, h) =>
          x === 0 || x === w - 1 || y === 0 || y === h - 1 ? -1.6 : (x + y) % 4 === 0 ? -0.6 : 0.4,
      });
    }
    // One eyespot on each forewing, on both sides.
    for (const face of ['top', 'bottom'] as const) {
      p.rect(fore!, face, 1, 1, 2, 2, EYESPOT[1]!);
      p.rect(fore!, face, 1, 1, 1, 1, EYESPOT[2]!);
      p.rect(fore!, face, 2, 2, 1, 1, EYESPOT[0]!);
    }
  }
  return p.data;
}

export const GLIMMER_MOTH_PALETTE = [...WING, ...EYESPOT, ...FUZZ];

/** Night (the sun below the horizon) and lit by a light source. */
export function mothSpawnSpot(world: World, x: number, y: number, z: number): boolean {
  return (
    sunElevationSin(getWorldTime()) < 0 &&
    world.getBlock(x, y, z).id === 'air' &&
    world.getLight(x, y, z).block >= MOTH_MIN_BLOCK_LIGHT
  );
}

export const GLIMMER_MOTH_DEFINITION: CreatureDefinition = {
  type: GLIMMER_MOTH,
  category: 'ambient',
  health: 2,
  width: 0.4,
  height: 0.3,
  speed: 0.12,
  flying: true,
  model: () => GLIMMER_MOTH,
  goals: (mob) => [[PRIORITY.flock, new FlockGoal(mob)]],
  drops: () => [],
  setup(ctx, id) {
    playClip(ctx.ecs, id, 'flutter');
  },
};

registerCreature({
  definition: GLIMMER_MOTH_DEFINITION,
  models: [[GLIMMER_MOTH_MODEL, glimmerMothSkin]],
  spawn: { biomes: [], groupSize: [2, 4], weight: 10, where: mothSpawnSpot },
});
