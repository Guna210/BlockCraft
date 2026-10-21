import { defineComponent, type EntityWorld } from '../ecs/world';
import { RenderableC, TransformC } from '../ecs/components';
import type { EntityModel, SkinGenerator } from '../ecs/model';
import type { MobHandle } from '../ai/runtime';
import { FleeGoal } from '../ai/goals/flee';
import { BreedGoal } from '../ai/goals/breed';
import { FollowFoodGoal } from '../ai/goals/follow-food';
import { ForageGoal } from '../ai/goals/forage';
import { WanderGoal } from '../ai/goals/wander';
import { items } from '../../gameplay/items';
import {
  SkinPainter,
  buildModel,
  clumps,
  combine,
  cubesOf,
  featureSeed,
  strands,
  type BoxSpec,
  type PartSpec,
  type Ramp,
} from './kit';
import {
  PRIORITY,
  creatureContext,
  isBaby,
  registerCreature,
  rollCount,
  type CreatureDefinition,
  type Drops,
} from './creature';

export const TUFTBUCK = 'tuftbuck';
export const GRAZE_MIN_TICKS = 600;
export const GRAZE_MAX_TICKS = 1200;
export const GRAZE_TICKS = 40;

// Palettes (dark → light). Shadows lean cool, highlights warm (ART.md §1.5).
const COAT: Ramp = ['#2f2a2e', '#4a3e3a', '#665445', '#83705a', '#a08c70'];
const MANE: Ramp = ['#241d22', '#3a2f30', '#54443e', '#71604f', '#8d7a62'];
const HORN: Ramp = ['#4a3f35', '#7a6a55', '#a89474', '#cdb995', '#e9dcbc'];
const HOOF: Ramp = ['#1c1a1f', '#2e2a2e', '#45403f'];
const EYE = '#e0a43a';
const PUPIL = '#141216';

/** Fleece ramps; the biome a Tuftbuck spawns in picks one. */
export const TUFTBUCK_WOOL = {
  cream: ['#8f7f63', '#b3a281', '#cfc09c', '#e4d7b6', '#f4ecd2'],
  umber: ['#2a1d17', '#3f2c21', '#57402e', '#70553d', '#8a6c4f'],
  snow: ['#9aa3ad', '#bcc4cb', '#d8dde1', '#ebeef0', '#fbfbf7'],
  tan: ['#7d5a33', '#9e7543', '#bd9257', '#d4ad70', '#e8c98e'],
  ash: ['#5f5b57', '#7d7872', '#9a948b', '#b6afa3', '#d0c9bb'],
} as const satisfies Record<string, Ramp>;
export type TuftbuckWool = keyof typeof TUFTBUCK_WOOL;

/** Fleece colour by biome: plains and meadow cream, taiga umber, snow white, savanna tan. */
export function tuftbuckWool(biome: string): TuftbuckWool {
  switch (biome) {
    case 'plains':
    case 'meadow':
      return 'cream';
    case 'pine_taiga':
      return 'umber';
    case 'snowy_tundra':
    case 'frost_peaks':
    case 'frozen_ocean':
      return 'snow';
    case 'savanna':
    case 'badlands':
    case 'desert':
      return 'tan';
    default:
      return 'ash';
  }
}

export const TUFTBUCK_SHEARED_MODEL = 'tuftbuck_sheared';
export const tuftbuckModelId = (wool: TuftbuckWool): string => `tuftbuck_${wool}`;

const DEG = Math.PI / 180;

/** Model space: faces +Z, right side −X, 16 units per block. */
function tuftbuckModel(id: string): EntityModel {
  // Forward-curling horn: up from the crown and a little back, over the top, then down and
  // forward to a tip above the eye.
  const segments: Array<[x: number, y: number, z: number, w: number, h: number, d: number]> = [
    [-3, 22, 9, 2, 2, 2],
    [-3, 24, 8, 1, 3, 2],
    [-3.5, 27, 8, 1, 1, 4],
    [-3.5, 25, 11, 1, 2, 2],
    [-4, 24, 12, 1, 1, 2],
  ];
  const horn = (side: 1 | -1): BoxSpec[] =>
    segments.map(([x, y, z, w, h, d]) => ({
      from: [side < 0 ? x : -x - w, y, z],
      size: [w, h, d],
    }));
  const leg = (name: string, x: number, z: number): PartSpec => ({
    name,
    pivot: [x + 1.5, 9, z + 1.5],
    cubes: [{ from: [x, 0, z], size: [3, 9, 3] }],
  });
  return buildModel({
    id,
    textureSize: [128, 64],
    parts: [
      { name: 'body', pivot: [0, 13, 0], cubes: [{ from: [-4.5, 9, -7], size: [9, 8, 14] }] },
      {
        // Long hair hanging from the back and flanks: shorn by shears, regrown by grazing.
        name: 'fleece',
        parent: 'body',
        pivot: [0, 13, 0],
        cubes: [
          { from: [-5, 16, -7], size: [10, 2, 11], inflate: 0.5 },
          { from: [-5.5, 6, -7], size: [1, 11, 11] },
          { from: [4.5, 6, -7], size: [1, 11, 11] },
          { from: [-4.5, 7, -8], size: [9, 10, 1] },
        ],
      },
      {
        // A dark, shaggy mane over the shoulders and hanging down the chest.
        name: 'mane',
        parent: 'body',
        pivot: [0, 17, 5],
        cubes: [
          { from: [-5, 14, 2], size: [10, 7, 6], inflate: 0.25 },
          { from: [-3.5, 6, 6], size: [7, 9, 3] },
        ],
      },
      {
        name: 'head',
        parent: 'body',
        pivot: [0, 19, 8],
        cubes: [
          { from: [-2.5, 17, 7], size: [5, 5, 6] },
          { from: [-2, 16, 13], size: [4, 4, 4] },
          { from: [-1, 12, 14], size: [2, 4, 2] },
          { from: [-5, 20, 9], size: [3, 1, 2] },
          { from: [2, 20, 9], size: [3, 1, 2] },
        ],
      },
      { name: 'horn_r', parent: 'head', pivot: [-2, 22, 10], cubes: horn(-1) },
      { name: 'horn_l', parent: 'head', pivot: [2, 22, 10], cubes: horn(1) },
      {
        name: 'tail',
        parent: 'body',
        pivot: [0, 16, -7],
        rotation: [-35 * DEG, 0, 0],
        cubes: [{ from: [-1, 15, -9], size: [2, 4, 2] }],
      },
      leg('leg_fr', -4.5, 3),
      leg('leg_fl', 1.5, 3),
      leg('leg_br', -4.5, -6),
      leg('leg_bl', 1.5, -6),
    ],
    walk: {
      maxSwing: 40 * DEG,
      refSpeed: 2.5,
      stride: 1.5,
      limbs: { leg_fr: 0, leg_bl: 0, leg_fl: Math.PI, leg_br: Math.PI },
    },
    head: { part: 'head', maxPitch: 35 * DEG },
    clips: {
      graze: {
        length: GRAZE_TICKS,
        loop: false,
        channels: [
          {
            part: 'head',
            property: 'rotation',
            interpolation: 'linear',
            keys: [
              { tick: 0, value: [0, 0, 0] },
              { tick: 6, value: [1.0, 0, 0] },
              { tick: 12, value: [0.85, 0, 0] },
              { tick: 18, value: [1.0, 0, 0] },
              { tick: 24, value: [0.85, 0, 0] },
              { tick: 30, value: [1.0, 0, 0] },
              { tick: 35, value: [1.0, 0, 0] },
              { tick: 40, value: [0, 0, 0] },
            ],
          },
          {
            part: 'head',
            property: 'position',
            interpolation: 'linear',
            keys: [
              { tick: 0, value: [0, 0, 0] },
              { tick: 6, value: [0, -4, 1] },
              { tick: 35, value: [0, -4, 1] },
              { tick: 40, value: [0, 0, 0] },
            ],
          },
        ],
      },
    },
  });
}

/** Every Tuftbuck model shares this geometry; variants differ only in skin. */
export const TUFTBUCK_GEOMETRY = tuftbuckModel('tuftbuck_geometry');

function paintShared(p: SkinPainter, model: EntityModel): void {
  const s = p.seed;
  const [body] = cubesOf(model, 'body');
  p.cube(body!, COAT, { base: 2, pattern: clumps(featureSeed(s, 'coat'), 2, 1) });
  const [hump, chest] = cubesOf(model, 'mane');
  for (const cube of [hump!, chest!])
    p.cube(cube, MANE, { base: 2, falloff: 1.5, pattern: strands(featureSeed(s, 'mane'), 1) });
  p.fringe(chest!, 3, featureSeed(s, 'chest'));
  const [skull, muzzle, beard, earR, earL] = cubesOf(model, 'head');
  p.cube(skull!, COAT, { base: 2.4, pattern: clumps(featureSeed(s, 'face'), 2, 0.6) });
  // A long face, pale toward the nose, with a dark blaze down its front.
  p.cube(muzzle!, COAT, { base: 3.2, falloff: 0.6 });
  p.rect(skull!, 'front', 2, 0, 1, 5, MANE[1]!);
  p.rect(muzzle!, 'top', 1, 0, 2, 4, MANE[2]!);
  p.cube(beard!, MANE, { base: 1.5, pattern: strands(featureSeed(s, 'beard'), 1) });
  p.fringe(beard!, 1, featureSeed(s, 'beard tip'));
  for (const ear of [earR!, earL!]) p.cube(ear, COAT, { base: 2.5 });
  // Eyes on the sides of the skull, near the front: amber with a dark horizontal pupil.
  const [depth] = p.faceSize(skull!, 'right');
  p.rect(skull!, 'right', depth - 4, 2, 3, 1, EYE);
  p.rect(skull!, 'right', depth - 3, 2, 1, 1, PUPIL);
  p.rect(skull!, 'left', 1, 2, 3, 1, EYE);
  p.rect(skull!, 'left', 2, 2, 1, 1, PUPIL);
  // Nostrils and the mouth line on the front of the muzzle.
  p.rect(muzzle!, 'front', 0, 1, 1, 1, HOOF[0]!);
  p.rect(muzzle!, 'front', 3, 1, 1, 1, HOOF[0]!);
  p.rect(muzzle!, 'front', 1, 3, 2, 1, MANE[1]!);
  // Pale horns with darker growth ridges.
  for (const side of ['horn_r', 'horn_l'])
    cubesOf(model, side).forEach((segment, n) =>
      p.cube(segment, HORN, {
        base: 3.2 - n * 0.2,
        falloff: 0.4,
        pattern: (x, y, face) =>
          face === 'top' || face === 'bottom' ? 0.4 : (x + y + n) % 3 === 0 ? -1.6 : 0,
      }),
    );
  const [tail] = cubesOf(model, 'tail');
  p.cube(tail!, MANE, { base: 2.5, pattern: strands(featureSeed(s, 'tail'), 1) });
  for (const name of ['leg_fr', 'leg_fl', 'leg_br', 'leg_bl']) {
    const [leg] = cubesOf(model, name);
    p.cube(leg!, COAT, { base: 1.8, falloff: 1.2 });
    for (const face of ['right', 'front', 'left', 'back'] as const) {
      const [w, h] = p.faceSize(leg!, face);
      p.rect(leg!, face, 0, h - 2, w, 1, HOOF[2]!);
      p.rect(leg!, face, 0, h - 1, w, 1, HOOF[1]!);
    }
    p.rect(leg!, 'bottom', 0, 0, 3, 3, HOOF[0]!);
  }
}

function paintFleece(p: SkinPainter, model: EntityModel, wool: Ramp | null): void {
  const hair = cubesOf(model, 'fleece');
  if (!wool) {
    for (const cube of hair) p.clear(cube);
    return;
  }
  const s = p.seed;
  const [saddle, ...curtains] = hair;
  p.cube(saddle!, wool, { base: 2.6, top: 0.8, pattern: clumps(featureSeed(s, 'saddle'), 2, 1) });
  // Long locks: vertical strands that darken toward the ragged ends.
  curtains.forEach((curtain, n) => {
    p.cube(curtain, wool, {
      base: 2.4,
      falloff: 2,
      pattern: combine(
        strands(featureSeed(s, `locks${n}`), 1),
        clumps(featureSeed(s, `tufts${n}`), 2, 0.5),
      ),
    });
    p.fringe(curtain, 3, featureSeed(s, `fringe${n}`));
  });
}

function tuftbuckSkin(wool: Ramp | null): SkinGenerator {
  return (seed) => {
    const p = new SkinPainter(128, 64, seed);
    paintShared(p, TUFTBUCK_GEOMETRY);
    paintFleece(p, TUFTBUCK_GEOMETRY, wool);
    return p.data;
  };
}

/** Every colour a Tuftbuck skin may use, per model id. */
export const TUFTBUCK_PALETTES: Record<string, string[]> = Object.fromEntries([
  ...(Object.keys(TUFTBUCK_WOOL) as TuftbuckWool[]).map((wool) => [
    tuftbuckModelId(wool),
    [...COAT, ...MANE, ...HORN, ...HOOF, EYE, PUPIL, ...TUFTBUCK_WOOL[wool]],
  ]),
  [TUFTBUCK_SHEARED_MODEL, [...COAT, ...MANE, ...HORN, ...HOOF, EYE, PUPIL]],
]);

export interface TuftbuckState {
  sheared: boolean;
  /** The model with its fleece, restored by grazing. */
  woolModel: string;
}

export const TuftbuckC = defineComponent<TuftbuckState>('tuftbuck');

/** Shears off the fleece: it regrows the next time the Tuftbuck grazes. */
export function setSheared(ecs: EntityWorld, id: number, sheared: boolean): void {
  const state = ecs.get(id, TuftbuckC),
    renderable = ecs.get(id, RenderableC);
  if (!state) return;
  state.sheared = sheared;
  if (renderable) renderable.model = sheared ? TUFTBUCK_SHEARED_MODEL : state.woolModel;
}

function isShears(itemId: string): boolean {
  return items.items.get(itemId)?.tool?.type === 'shears';
}

/** Turns the grass under a grazing Tuftbuck to dirt and regrows its fleece. */
function graze(mob: MobHandle, x: number, y: number, z: number): void {
  mob.runtime.world.setBlock(x, y, z, 'dirt');
  setSheared(mob.runtime.ecs, mob.id, false);
}

export const TUFTBUCK_DEFINITION: CreatureDefinition = {
  type: TUFTBUCK,
  category: 'passive',
  health: 10,
  width: 0.9,
  height: 1.35,
  speed: 0.1,
  foods: ['wheat'],
  model: (ctx, x, z) => tuftbuckModelId(tuftbuckWool(ctx.items.world.getBiome(x, z))),
  goals: (mob) => [
    [PRIORITY.flee, new FleeGoal(mob)],
    [PRIORITY.breed, new BreedGoal(mob)],
    [PRIORITY.followFood, new FollowFoodGoal(mob)],
    [
      PRIORITY.forage,
      new ForageGoal(mob, {
        name: 'graze',
        min: GRAZE_MIN_TICKS,
        max: GRAZE_MAX_TICKS,
        ground: ['grass_block'],
        duration: GRAZE_TICKS,
        clip: 'graze',
        act: (x, y, z) => graze(mob, x, y, z),
      }),
    ],
    [PRIORITY.wander, new WanderGoal(mob)],
  ],
  setup(ctx, id) {
    const model = ctx.ecs.get(id, RenderableC)!.model;
    ctx.ecs.add(id, TuftbuckC, { sheared: false, woolModel: model });
  },
  drops(ctx, id): Drops {
    if (isBaby(ctx.ecs, id)) return [];
    const drops: Drops = [['raw_tuftbuck_shank', 1]];
    if (!ctx.ecs.get(id, TuftbuckC)?.sheared) drops.unshift(['wool', 1]);
    return drops;
  },
  interact(ctx, id, itemId) {
    if (!isShears(itemId)) return null;
    const state = ctx.ecs.get(id, TuftbuckC);
    if (!state || state.sheared || isBaby(ctx.ecs, id)) return null;
    shear(ctx.ecs, id);
    return 'wear';
  },
};

/** Drops 1–3 wool from an unsheared adult and marks it sheared; false when there is nothing to shear. */
export function shear(ecs: EntityWorld, id: number): boolean {
  const ctx = creatureContext(ecs),
    state = ecs.get(id, TuftbuckC);
  if (!ctx || !state || state.sheared || isBaby(ecs, id)) return false;
  setSheared(ecs, id, true);
  const pos = ecs.get(id, TransformC)!.pos;
  ctx.items.spawn('wool', rollCount(ctx.random, 1, 3), pos[0], pos[1] + 0.8, pos[2]);
  return true;
}

registerCreature({
  definition: TUFTBUCK_DEFINITION,
  models: [
    ...(Object.keys(TUFTBUCK_WOOL) as TuftbuckWool[]).map(
      (wool) =>
        [
          { ...TUFTBUCK_GEOMETRY, id: tuftbuckModelId(wool) },
          tuftbuckSkin(TUFTBUCK_WOOL[wool]),
        ] as [EntityModel, SkinGenerator],
    ),
    [{ ...TUFTBUCK_GEOMETRY, id: TUFTBUCK_SHEARED_MODEL }, tuftbuckSkin(null)],
  ],
});
