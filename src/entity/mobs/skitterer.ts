import { TransformC } from '../ecs/components';
import type { EntityModel } from '../ecs/model';
import { getWorldTime, sunElevationSin } from '../../world/time';
import { PLAYER_TARGET } from '../ai/components';
import type { MobHandle } from '../ai/runtime';
import { TargetPlayerGoal } from '../ai/goals/target-player';
import { ClimbWallGoal } from '../ai/goals/climb-wall';
import { LeapGoal } from '../ai/goals/leap';
import { MeleeAttackGoal } from '../ai/goals/melee-attack';
import { WanderGoal } from '../ai/goals/wander';
import { SkinPainter, buildModel, cubesOf, type PartSpec, type Ramp } from './kit';
import { PRIORITY, registerCreature, rollCount, type CreatureDefinition } from './creature';

export const SKITTERER = 'skitterer';
export const SKITTERER_DAMAGE = 2;
/** Sky light at its cell from which daylight makes a Skitterer neutral. */
export const SKITTERER_DAYLIGHT_SKY = 12;

// A low, glossy crawler: deep blue-green plates with a bright sheen, amber seams, dark legs.
const CARAPACE: Ramp = ['#0d1820', '#172a3a', '#21405a', '#346683', '#7fbccb'];
const SEAM: Ramp = ['#6e4410', '#b07a22', '#e0b050'];
const LEG: Ramp = ['#110d0c', '#261f1c', '#41362f', '#5f5045'];
const EYE = '#c9f2a0';

const DEG = Math.PI / 180;

function skittererModel(): EntityModel {
  // Each leg rises out to a knee, then drops to the ground; `side` 1 is the left (+X).
  const leg = (name: string, side: 1 | -1, z: number, sweep: number): PartSpec => {
    const x = side > 0 ? 4 : -4;
    return {
      name,
      parent: 'body',
      pivot: [x, 4, z],
      rotation: [0, sweep * side * DEG, 0],
      cubes: [
        { from: side > 0 ? [x, 4, z - 0.5] : [x - 7, 4, z - 0.5], size: [7, 1, 1] },
        { from: side > 0 ? [x + 6, 0, z - 0.5] : [x - 7, 0, z - 0.5], size: [1, 5, 1] },
      ],
    };
  };
  return buildModel({
    id: SKITTERER,
    textureSize: [128, 64],
    parts: [
      {
        name: 'body',
        pivot: [0, 4, 0],
        cubes: [
          // Thorax, then a long domed abdomen in two plates.
          { from: [-4, 2, -1], size: [8, 5, 7] },
          { from: [-5, 2, -11], size: [10, 6, 10] },
          { from: [-4, 8, -10], size: [8, 1, 8] },
          // A spiked ridge down the abdomen.
          { from: [-0.5, 9, -8], size: [1, 1, 2] },
          { from: [-0.5, 9, -4], size: [1, 1, 2] },
        ],
      },
      {
        name: 'head',
        parent: 'body',
        pivot: [0, 5, 6],
        cubes: [
          { from: [-3, 2, 6], size: [6, 4, 4] },
          // Hooked mandibles.
          { from: [-3, 2, 10], size: [1, 1, 3] },
          { from: [2, 2, 10], size: [1, 1, 3] },
          { from: [-2, 2, 12], size: [1, 1, 1] },
          { from: [1, 2, 12], size: [1, 1, 1] },
        ],
      },
      leg('leg_l1', 1, 4, -25),
      leg('leg_l2', 1, 1, 0),
      leg('leg_l3', 1, -2, 25),
      leg('leg_r1', -1, 4, -25),
      leg('leg_r2', -1, 1, 0),
      leg('leg_r3', -1, -2, 25),
    ],
    // A tripod gait: front and back on one side move with the middle leg of the other.
    walk: {
      maxSwing: 30 * DEG,
      refSpeed: 2,
      stride: 0.8,
      limbs: {
        leg_l1: 0,
        leg_r2: 0,
        leg_l3: 0,
        leg_r1: Math.PI,
        leg_l2: Math.PI,
        leg_r3: Math.PI,
      },
    },
    head: { part: 'head', maxPitch: 20 * DEG, maxYaw: 30 * DEG },
  });
}

export const SKITTERER_MODEL = skittererModel();

function skittererSkin(seed: number): Uint8Array {
  const m = SKITTERER_MODEL,
    p = new SkinPainter(128, 64, seed);
  const [thorax, abdomen, plate, spikeA, spikeB] = cubesOf(m, 'body');
  p.cube(thorax!, CARAPACE, { base: 1.6, falloff: 1.4 });
  p.cube(abdomen!, CARAPACE, { base: 1.8, falloff: 1.6 });
  p.cube(plate!, CARAPACE, { base: 2, top: 1 });
  // Gloss: a bright sheen streak along the top of each plate, toward the light.
  const [pw, pd] = p.faceSize(plate!, 'top');
  p.rect(plate!, 'top', 1, 1, 2, pd - 3, CARAPACE[4]!);
  p.rect(plate!, 'top', 3, 1, 1, 2, CARAPACE[4]!);
  p.rect(thorax!, 'top', 1, 1, 2, 2, CARAPACE[4]!);
  // Amber seams between the abdomen's segments, on the top and down the sides.
  for (const row of [2, 5]) p.rect(plate!, 'top', 0, row, pw, 1, SEAM[1]!);
  for (const face of ['left', 'right'] as const) {
    const [w] = p.faceSize(abdomen!, face);
    for (const col of [3, 6])
      p.rect(abdomen!, face, face === 'left' ? col : w - 1 - col, 0, 1, 4, SEAM[0]!);
  }
  const [sw] = p.faceSize(abdomen!, 'back');
  p.rect(abdomen!, 'back', 2, 1, sw - 4, 1, SEAM[2]!);
  for (const spike of [spikeA!, spikeB!]) p.cube(spike, SEAM, { base: 1.5, falloff: 1 });
  const [head, ...mandibles] = cubesOf(m, 'head');
  p.cube(head!, CARAPACE, { base: 1.4, falloff: 1.2 });
  // Four pale eyes in two pairs across the brow.
  const [hw] = p.faceSize(head!, 'front');
  for (const x of [1, hw - 2]) p.rect(head!, 'front', x, 1, 1, 1, EYE);
  for (const x of [2, hw - 3]) p.rect(head!, 'front', x, 0, 1, 1, EYE);
  for (const mandible of mandibles) p.cube(mandible, LEG, { base: 2.5, falloff: 1 });
  for (const name of ['leg_l1', 'leg_l2', 'leg_l3', 'leg_r1', 'leg_r2', 'leg_r3']) {
    const [upper, lower] = cubesOf(m, name);
    p.cube(upper!, LEG, { base: 2, top: 1 });
    p.cube(lower!, LEG, { base: 1.4, falloff: 1.4 });
  }
  return p.data;
}

export const SKITTERER_PALETTE = [...CARAPACE, ...SEAM, ...LEG, EYE];

/**
 * Daylight makes a Skitterer neutral: the sun is up and its cell is open to the sky. In caves and
 * at night it is hostile.
 */
export function inDaylight(mob: MobHandle): boolean {
  const world = mob.runtime.world;
  if (sunElevationSin(getWorldTime()) <= 0 || !world.lightEngine) return false;
  const pos = mob.runtime.ecs.get(mob.id, TransformC)!.pos;
  const sky = world.getLight(Math.floor(pos[0]), Math.floor(pos[1] + 0.3), Math.floor(pos[2])).sky;
  return sky >= SKITTERER_DAYLIGHT_SKY;
}

/** Targets the player at night or in the dark; in daylight only once the player has hit it. */
export class SkittererTargetGoal extends TargetPlayerGoal {
  private provoked(): boolean {
    return this.targeting.attacker === PLAYER_TARGET || !inDaylight(this.mob);
  }

  override canStart(): boolean {
    return this.provoked() && super.canStart();
  }

  override shouldContinue(): boolean {
    return this.provoked() && super.shouldContinue();
  }
}

export const SKITTERER_DEFINITION: CreatureDefinition = {
  type: SKITTERER,
  category: 'hostile',
  health: 16,
  // Drawn 1.2× its model size; collision width stays under one block.
  scale: 1.2,
  width: 0.95,
  height: 0.7,
  speed: 0.13,
  climbing: true,
  model: () => SKITTERER,
  goals: (mob) => [
    [PRIORITY.target, new SkittererTargetGoal(mob)],
    [PRIORITY.climb, new ClimbWallGoal(mob)],
    [PRIORITY.leap, new LeapGoal(mob, { range: 4 })],
    [PRIORITY.attack, new MeleeAttackGoal(mob, { damage: SKITTERER_DAMAGE })],
    [PRIORITY.wander, new WanderGoal(mob)],
  ],
  drops: (ctx) => [
    ['silk', rollCount(ctx.random, 0, 2)],
    ['carapace', rollCount(ctx.random, 0, 1)],
  ],
};

registerCreature({
  definition: SKITTERER_DEFINITION,
  models: [[SKITTERER_MODEL, skittererSkin]],
});
