import { mat4, vec3 } from 'gl-matrix';
import { defineComponent } from '../ecs/world';
import { HealthC, TransformC } from '../ecs/components';
import { computePose } from '../ecs/pose';
import type { Vec3 } from '../ecs/model';
import { MobBodyC, NavC, PLAYER_TARGET } from '../ai/components';
import { type MobHandle, type MobPlayer } from '../ai/runtime';
import { MobGoal } from '../ai/goals/mob-goal';
import { MeleeAttackGoal } from '../ai/goals/melee-attack';
import { VoxelRaycaster, createRayHit, intersectBox } from '../../world/raycast';
import type { World } from '../../world/world';
import { BlockRegistry } from '../../world/blocks/registry';
import { buildModel, SkinPainter, type PartSpec } from './kit';
import {
  PRIORITY,
  registerCreature,
  rollCount,
  creatureContext,
  type CreatureContext,
  type CreatureDefinition,
} from './creature';

export const CINDERWRAITH = 'cinderwraith';
export const ANGER_SIGHT_TICKS = 600;
export const TELEPORT_COOLDOWN = 80;
export const TELEPORT_ATTEMPTS = 32;
export const CINDER_PALETTE = ['#454954', '#878b8e', '#c4c2b9', '#78121e', '#ff4830'];
const STONE = CINDER_PALETTE.slice(0, 3);
const DEG = Math.PI / 180;
const arm = (name: string, x: number): PartSpec => ({
  name,
  parent: 'body',
  pivot: [x + 2, 23, 0],
  cubes: [
    { from: [x, 3, -1], size: [4, 20, 5] },
    { from: [x - 0.5, 0, 1], size: [5, 5, 7] },
  ],
});
export const CINDER_MODEL = buildModel({
  id: CINDERWRAITH,
  textureSize: [128, 128],
  parts: [
    {
      name: 'body',
      pivot: [0, 10, -2],
      cubes: [
        { from: [-5, 8, -6], size: [10, 13, 9] },
        { from: [-8, 19, -5], size: [16, 8, 10] },
        { from: [-5, 23, -7], size: [10, 4, 3] },
      ],
    },
    {
      name: 'head',
      parent: 'body',
      pivot: [0, 22, 5],
      cubes: [
        { from: [-4, 19, 3], size: [8, 7, 7] },
        { from: [-5, 24, 6], size: [10, 3, 5] },
        { from: [-3, 18, 5], size: [6, 2, 5] },
      ],
    },
    {
      name: 'eyes',
      parent: 'head',
      pivot: [0, 22, 10],
      emissive: true,
      cubes: [
        { from: [-3, 22, 10], size: [2, 1, 1] },
        { from: [1, 22, 10], size: [2, 1, 1] },
      ],
    },
    arm('arm_r', -11),
    arm('arm_l', 7),
    { name: 'leg_r', pivot: [-3, 11, -3], cubes: [{ from: [-5, 0, -6], size: [4, 11, 6] }] },
    { name: 'leg_l', pivot: [3, 11, -3], cubes: [{ from: [1, 0, -6], size: [4, 11, 6] }] },
  ],
  walk: {
    maxSwing: 10 * DEG,
    refSpeed: 2.8,
    stride: 1.8,
    limbs: { arm_r: 0, arm_l: Math.PI, leg_r: Math.PI, leg_l: 0 },
  },
  head: { part: 'head', maxYaw: 20 * DEG, maxPitch: 15 * DEG },
});

export function cinderSkin(seed: number): Uint8Array {
  const p = new SkinPainter(...CINDER_MODEL.textureSize, seed);
  for (const part of CINDER_MODEL.parts)
    for (const cube of part.cubes) {
      if (part.emissive) {
        p.cube(cube, CINDER_PALETTE.slice(3), { base: 1, falloff: 0 });
        continue;
      }
      p.cube(cube, STONE, { base: 1, falloff: 0, top: 1, bottom: -1 });
      if (part.name === 'body' && cube === part.cubes[1]) {
        // Shoulder ridge fissures align with the two ambient spark emission points.
        p.rect(cube, 'top', 2, 5, 1, 3, STONE[0]!);
        p.rect(cube, 'top', 14, 5, 1, 3, STONE[0]!);
      }
      // One deliberate stepped fissure, edged by pale ash. No per-texel noise.
      const w = cube.size[0],
        h = cube.size[1];
      const x = Math.max(1, Math.floor(w / 2) - (seed % 2));
      if (w >= 4 && h >= 4) {
        p.rect(cube, 'front', x, 1, 1, Math.floor(h / 2), STONE[0]!);
        p.rect(cube, 'front', x - 1, Math.floor(h / 2), 2, 1, STONE[0]!);
        p.rect(
          cube,
          'front',
          x - 1,
          Math.floor(h / 2) + 1,
          1,
          Math.max(1, h - Math.floor(h / 2) - 2),
          STONE[0]!,
        );
        p.rect(cube, 'front', x + 1, 1, 1, 2, STONE[2]!);
      }
    }
  return p.data;
}

interface CinderState {
  lastHealth: number;
  cooldownUntil: number;
  unseen: number;
}
export const CinderC = defineComponent<CinderState>('cinderwraith');

/** Conservative safe landing: a full solid support and two air blocks, wholly in a loaded column. */
export function safeCinderSpot(world: World, x: number, y: number, z: number): boolean {
  if (y < 1 || y > 318 || !world.hasColumn(Math.floor(x / 16), Math.floor(z / 16))) return false;
  const registry = BlockRegistry.getInstance();
  const below = registry.getResolvedState(world.getBlockStateId(x, y - 1, z))!.definition;
  return (
    below.fullOpaqueCube &&
    below.id !== 'cactus' &&
    below.id !== 'magma' &&
    world.getBlock(x, y, z).id === 'air' &&
    world.getBlock(x, y + 1, z).id === 'air'
  );
}

/** Bounded seeded search. Failed attempts still consume the cooldown. */
export function teleportCinder(ctx: CreatureContext, id: number, toward?: Readonly<Vec3>): boolean {
  const { ecs } = ctx;
  const state = ecs.get(id, CinderC)!;
  if (ecs.time < state.cooldownUntil) return false;
  state.cooldownUntil = ecs.time + TELEPORT_COOLDOWN;
  const t = ecs.get(id, TransformC)!;
  const from = t.pos;
  const world = ctx.items.world;
  for (let n = 0; n < TELEPORT_ATTEMPTS; n++) {
    const angle = ctx.random() * Math.PI * 2;
    const radius = 4 + ctx.random() * 12;
    const x = Math.floor(from[0] + Math.cos(angle) * radius);
    const z = Math.floor(from[2] + Math.sin(angle) * radius);
    const y = Math.floor(from[1]) + Math.floor(ctx.random() * 7) - 3;
    const spot: Vec3 = [x + 0.5, y, z + 0.5];
    const distance = vec3.distance(from, spot);
    if (distance < 4 || distance > 16 || !safeCinderSpot(world, x, y, z)) continue;
    if (toward && vec3.distance(spot, toward) >= vec3.distance(from, toward) - 2) continue;
    ctx.particles?.ember(id, from, ctx.random, 8);
    t.pos = spot;
    t.previous = [...spot];
    const body = ecs.get(id, MobBodyC)!;
    body.vel.fill(0);
    body.wish.fill(0);
    body.jump = false;
    ecs.get(id, NavC)?.navigator.stop();
    ctx.particles?.ember(id, spot, ctx.random, 8);
    return true;
  }
  return false;
}

/** Uses the actual posed head box; body rays never count. The cheap slab test precedes DDA. */
export class CinderSight {
  private readonly ray: VoxelRaycaster;
  private readonly hit = createRayHit();
  private readonly boxHit = createRayHit();
  private readonly pose = new Float32Array(24 * 16);
  private readonly headPose = this.pose.subarray(16, 32) as unknown as mat4;
  private readonly inverse = mat4.create();
  private readonly origin = vec3.create();
  private readonly endpoint = vec3.create();
  constructor(private readonly mob: MobHandle) {
    this.ray = new VoxelRaycaster(mob.runtime.world);
  }

  gazed(player: MobPlayer): boolean {
    const gaze = player.gaze?.();
    if (!gaze) return false;
    const pos = this.mob.runtime.ecs.get(this.mob.id, TransformC)!.pos;
    if (vec3.distance(player.pos, pos) > 64) return false;
    computePose(this.mob.runtime.ecs, this.mob.id, 1, this.pose);
    // Head is part 1. Inverse maps the world ray into model pixels, preserving its world-distance parameter.
    mat4.invert(this.inverse, this.headPose);
    vec3.transformMat4(this.origin, gaze.origin, this.inverse);
    vec3.add(this.endpoint, gaze.origin, gaze.direction);
    vec3.transformMat4(this.endpoint, this.endpoint, this.inverse);
    vec3.subtract(this.endpoint, this.endpoint, this.origin);
    if (
      !intersectBox(
        this.origin[0]!,
        this.origin[1]!,
        this.origin[2]!,
        this.endpoint[0]!,
        this.endpoint[1]!,
        this.endpoint[2]!,
        0,
        0,
        0,
        [-4, 19, 3, 4, 26, 10],
        this.boxHit,
      ) ||
      this.boxHit.distance > 64
    )
      return false;
    return !this.ray.cast(...gaze.origin, ...gaze.direction, this.boxHit.distance, this.hit).hit;
  }

  sees(player: MobPlayer): boolean {
    const p = this.mob.runtime.ecs.get(this.mob.id, TransformC)!.pos;
    const origin: Vec3 = [p[0], p[1] + 1.4, p[2]];
    const end: Vec3 = [player.pos[0], player.pos[1] + player.height * 0.85, player.pos[2]];
    const d = vec3.distance(origin, end);
    return !this.ray.cast(
      ...origin,
      end[0] - origin[0],
      end[1] - origin[1],
      end[2] - origin[2],
      d,
      this.hit,
    ).hit;
  }
}

class CinderTargetGoal extends MobGoal {
  readonly name = 'cinder_target';
  override readonly flags = ['target'] as const;
  private readonly sight: CinderSight;
  constructor(mob: MobHandle) {
    super(mob);
    this.sight = new CinderSight(mob);
  }
  private updatedAt = -1;
  canStart(): boolean {
    this.update();
    return true;
  }
  override shouldContinue(): boolean {
    this.update();
    return true;
  }
  private update(): void {
    if (this.updatedAt === this.ecs.time) return;
    this.updatedAt = this.ecs.time;
    const state = this.ecs.get(this.id, CinderC)!;
    const player = this.runtime.player();
    const health = this.ecs.get(this.id, HealthC)!.current;
    const hurt = health < state.lastHealth;
    state.lastHealth = health;
    const valid = player && player.targetable() && this.distanceTo(player.pos) <= 64;
    if (!valid) {
      this.targeting.target = null;
      state.unseen = 0;
    } else {
      if (hurt && this.targeting.attacker === PLAYER_TARGET) {
        this.targeting.target = PLAYER_TARGET;
        state.unseen = 0;
      }
      if (this.targeting.target === null && this.sight.gazed(player)) {
        this.targeting.target = PLAYER_TARGET;
        state.unseen = 0;
      }
      if (this.targeting.target !== null) {
        state.unseen = this.sight.sees(player) ? 0 : state.unseen + 1;
        if (state.unseen >= ANGER_SIGHT_TICKS) this.targeting.target = null;
      }
    }
    const ctx = creatureContext(this.ecs)!;
    if (hurt) teleportCinder(ctx, this.id);
    else if (
      this.targeting.target !== null &&
      player &&
      (this.distanceTo(player.pos) > 10 || this.ecs.get(this.id, NavC)?.navigator.failed)
    )
      teleportCinder(ctx, this.id, player.pos);
  }
}

export const CINDER_DEFINITION: CreatureDefinition = {
  type: CINDERWRAITH,
  category: 'hostile',
  health: 30,
  width: 0.95,
  height: 1.75,
  speed: 0.14,
  model: () => CINDERWRAITH,
  goals: (mob) => [
    [PRIORITY.target, new CinderTargetGoal(mob)],
    [PRIORITY.attack, new MeleeAttackGoal(mob, { damage: 4 })],
  ],
  drops: (ctx) => [['cinder_shard', rollCount(ctx.random, 0, 1)]],
  setup: (ctx, id) => {
    ctx.ecs.add(id, CinderC, { lastHealth: 30, cooldownUntil: 0, unseen: 0 });
  },
  tick: (ctx, id) => {
    if (!ctx.particles || ctx.ecs.time % 3 !== 0) return;
    const t = ctx.ecs.get(id, TransformC)!;
    // Two fissures on the shoulder ridge, in model coordinates (front is +Z).
    const side = ctx.random() < 0.5 ? -0.375 : 0.375;
    const forward = 0.0625;
    const spark: Vec3 = [
      t.pos[0] + Math.sin(t.yaw) * side + Math.cos(t.yaw) * forward,
      t.pos[1] + 27 / 16,
      t.pos[2] - Math.cos(t.yaw) * side + Math.sin(t.yaw) * forward,
    ];
    ctx.particles.ember(id, spark, ctx.random);
  },
};
registerCreature({ definition: CINDER_DEFINITION, models: [[CINDER_MODEL, cinderSkin]] });
