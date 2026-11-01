import { BlockRegistry } from '../../world/blocks/registry';
import type { World } from '../../world/world';
import type { EntityModel, KeyframeChannel } from '../ecs/model';
import { playClip } from '../ecs/systems';
import { TransformC } from '../ecs/components';
import { defineComponent } from '../ecs/world';
import { PLAYER_TARGET } from '../ai/components';
import type { GoalFlag } from '../ai/goal';
import { MobGoal } from '../ai/goals/mob-goal';
import { boxGap, type MobHandle } from '../ai/runtime';
import { SkinPainter, buildModel, type PartSpec, type Ramp } from './kit';
import { PRIORITY, registerCreature, rollCount, type CreatureDefinition } from './creature';

export const MAGMAW = 'magmaw';
/** Lunges at a player within this many blocks. */
export const MAGMAW_LUNGE_RANGE = 6;
export const MAGMAW_DAMAGE = 5;
/** Burning ticks a lunge sets on the player (the survival burn path deals the damage). */
export const MAGMAW_BURN_TICKS = 100;
export const MAGMAW_LUNGE_COOLDOWN = 60;
const LUNGE_TICKS = 30;
const SWIM_SPEED = 0.12;
const CRAWL_SPEED = 0.1;
const SWIM_ATTEMPTS = 8;
const SWIM_RANGE = 8;

// Dark basalt armour plates; a molten seam runs along both flanks and lights the eyes.
const ARMOR: Ramp = ['#1c1312', '#352120', '#553126', '#784632'];
const SEAM: Ramp = ['#ff5a14', '#ffa63a', '#fff09c'];
export const MAGMAW_PALETTE = [...ARMOR, ...SEAM];

let lavaStates: Uint8Array | null = null;

/** True when the cell holds lava (any level). */
export function isLava(world: World, x: number, y: number, z: number): boolean {
  if (!lavaStates) {
    const registry = BlockRegistry.getInstance();
    lavaStates = new Uint8Array(registry.getMaxStateId() + 1);
    for (const id of registry.getAllStateIds())
      if (registry.getResolvedState(id)?.blockId === 'lava') lavaStates[id] = 1;
  }
  return lavaStates[world.getBlockStateId(x, y, z)] === 1;
}

function magmawModel(): EntityModel {
  const sway = (part: string, amount: number, phase: number): KeyframeChannel => ({
    part,
    property: 'rotation',
    interpolation: 'linear',
    keys: [0, 5, 10, 15, 20].map((tick) => ({
      tick,
      value: [0, amount * Math.sin(((tick / 20) * 2 + phase) * Math.PI), 0],
    })),
  });
  const seam = (name: string, parent: string, x: number, y: number, z: number, d: number) =>
    ({
      name,
      parent,
      pivot: [0, y, z],
      emissive: true,
      cubes: [
        { from: [-x - 0.5, y, z], size: [1, 1, d] },
        { from: [x - 0.5, y, z], size: [1, 1, d] },
      ],
    }) satisfies PartSpec;
  return buildModel({
    id: MAGMAW,
    textureSize: [128, 64],
    parts: [
      {
        name: 'seg1',
        pivot: [0, 4, 0],
        cubes: [{ from: [-3.5, 0, -1], size: [7, 7, 9] }],
      },
      seam('seam1', 'seg1', 3.5, 3, -1, 9),
      {
        name: 'head',
        parent: 'seg1',
        pivot: [0, 4, 8],
        cubes: [
          { from: [-3, 1, 8], size: [6, 6, 7] },
          // Lower jaw and a ridge of brow plates.
          { from: [-2.5, 0, 9], size: [5, 2, 6] },
          { from: [-3.5, 6, 8], size: [7, 2, 4] },
        ],
      },
      {
        name: 'eyes',
        parent: 'head',
        pivot: [0, 5, 13],
        emissive: true,
        cubes: [
          { from: [-3.5, 5, 12], size: [1, 1, 1] },
          { from: [2.5, 5, 12], size: [1, 1, 1] },
        ],
      },
      {
        name: 'seg2',
        parent: 'seg1',
        pivot: [0, 4, -1],
        cubes: [{ from: [-3, 0.5, -9], size: [6, 6, 8] }],
      },
      seam('seam2', 'seg2', 3, 3, -9, 8),
      {
        name: 'seg3',
        parent: 'seg2',
        pivot: [0, 4, -9],
        cubes: [{ from: [-2.5, 1, -16], size: [5, 5, 7] }],
      },
      seam('seam3', 'seg3', 2.5, 3, -16, 7),
      {
        name: 'tail',
        parent: 'seg3',
        pivot: [0, 4, -16],
        cubes: [
          { from: [-1.5, 1.5, -22], size: [3, 4, 6] },
          { from: [-0.5, 1, -27], size: [1, 6, 5] },
        ],
      },
    ],
    clips: {
      swim: {
        length: 20,
        loop: true,
        channels: [
          sway('head', 0.1, 0),
          sway('seg2', 0.22, 0.4),
          sway('seg3', 0.3, 0.8),
          sway('tail', 0.42, 1.2),
        ],
      },
    },
  });
}

export const MAGMAW_MODEL = magmawModel();

export function magmawSkin(seed: number): Uint8Array {
  const p = new SkinPainter(...MAGMAW_MODEL.textureSize, seed);
  for (const part of MAGMAW_MODEL.parts)
    for (const cube of part.cubes) {
      if (part.emissive) {
        p.cube(cube, SEAM, { base: 1, top: 1, bottom: -1, falloff: 0 });
        continue;
      }
      // Overlapping plates: a dark seam every 3 texels across the back and flanks.
      p.cube(cube, ARMOR, {
        base: 2,
        top: 1,
        bottom: -1,
        falloff: 1,
        pattern: (x, _y, face) =>
          face === 'top' || face === 'left' || face === 'right' ? (x % 3 === 2 ? -1 : 0) : 0,
      });
    }
  return p.data;
}

export type MagmawMode = 'swim' | 'lunge' | 'return';

interface MagmawState {
  mode: MagmawMode;
  modeTicks: number;
  cooldown: number;
  /** The last lava cell it swam in; it goes back there after a lunge. */
  homeX: number;
  homeY: number;
  homeZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  hasTarget: boolean;
  nextTarget: number;
  /** Lunges started and lunges that hit, for tests. */
  lunges: number;
  hits: number;
}
export const MagmawC = defineComponent<MagmawState>('magmaw');

/**
 * Swims through lava only, lunges onto the shore at a player within 6 blocks, burning them, then
 * crawls straight back to the lava it left. It never wanders on land.
 */
export class MagmawGoal extends MobGoal {
  readonly name = 'magmaw';
  override readonly flags: readonly GoalFlag[] = ['move', 'look', 'jump', 'target'];

  constructor(mob: MobHandle) {
    super(mob);
  }

  canStart(): boolean {
    return true;
  }

  private get state(): MagmawState {
    return this.ecs.get(this.id, MagmawC)!;
  }

  /** Whether the middle of its body is in lava. */
  inLava(): boolean {
    const pos = this.pos;
    return isLava(
      this.runtime.world,
      Math.floor(pos[0]),
      Math.floor(pos[1] + this.height / 2),
      Math.floor(pos[2]),
    );
  }

  override tick(): void {
    const state = this.state,
      body = this.body,
      pos = this.pos;
    state.modeTicks++;
    if (state.cooldown > 0) state.cooldown--;
    const inLava = this.inLava();
    if (inLava) {
      state.homeX = Math.floor(pos[0]);
      state.homeY = Math.floor(pos[1] + this.height / 2);
      state.homeZ = Math.floor(pos[2]);
    }
    const player = this.runtime.player();
    const target =
      player && player.targetable() && this.distanceTo(player.pos) <= MAGMAW_LUNGE_RANGE * 2
        ? player
        : null;
    this.targeting.target = target ? PLAYER_TARGET : null;

    if (state.mode === 'lunge') {
      body.flying = false;
      if (target) {
        this.lookAt(target.pos);
        const own = this.runtime.entityBounds(this.id)!;
        const box = this.runtime.targetBounds(PLAYER_TARGET)!;
        if (boxGap(own, box) <= 0.35) {
          if (this.runtime.hurtTarget(PLAYER_TARGET, MAGMAW_DAMAGE, this.id)) state.hits++;
          target.ignite?.(MAGMAW_BURN_TICKS);
          this.setMode('return');
          return;
        }
      }
      if (state.modeTicks >= LUNGE_TICKS || (state.modeTicks > 4 && body.onGround))
        this.setMode('return');
      return;
    }
    if (!inLava) {
      // Out of lava (after a lunge, or knocked out): straight back home, never wandering.
      if (state.mode !== 'return') this.setMode('return');
      body.flying = false;
      const dx = state.homeX + 0.5 - pos[0],
        dz = state.homeZ + 0.5 - pos[2];
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const s = Math.min(CRAWL_SPEED, d) / d;
        body.wish[0] = dx * s;
        body.wish[2] = dz * s;
      }
      if (body.horizontalCollision && body.onGround) body.jump = true;
      this.lookAt(null);
      return;
    }
    // In lava: swim.
    body.flying = true;
    if (state.mode !== 'swim') {
      this.setMode('swim');
      state.cooldown = Math.max(state.cooldown, MAGMAW_LUNGE_COOLDOWN);
    }
    if (target && state.cooldown === 0 && this.distanceTo(target.pos) <= MAGMAW_LUNGE_RANGE) {
      this.lunge(target.pos);
      return;
    }
    this.swim();
    this.lookAt(target ? target.pos : null);
  }

  private setMode(mode: MagmawMode): void {
    this.state.mode = mode;
    this.state.modeTicks = 0;
  }

  /** Leaps out of the lava toward the player. */
  private lunge(at: Readonly<[number, number, number]>): void {
    const state = this.state,
      body = this.body,
      pos = this.pos;
    const dx = at[0] - pos[0],
      dz = at[2] - pos[2];
    const d = Math.max(0.5, Math.hypot(dx, dz));
    const rise = at[1] - pos[1];
    // Horizontal speed reaches the player in about 10 ticks; the hop clears the shore.
    const speed = Math.min(0.6, d / 10 + 0.1);
    body.vel[0] = (dx / d) * speed;
    body.vel[2] = (dz / d) * speed;
    body.vel[1] = Math.max(0.45, Math.min(0.85, 0.45 + rise * 0.12));
    body.wish[0] = body.vel[0];
    body.wish[2] = body.vel[2];
    body.flying = false;
    state.lunges++;
    state.cooldown = MAGMAW_LUNGE_COOLDOWN;
    this.setMode('lunge');
  }

  /** Wanders between lava cells; every step stays in lava. */
  private swim(): void {
    const state = this.state,
      body = this.body,
      pos = this.pos,
      world = this.runtime.world;
    if (!state.hasTarget || this.ecs.time >= state.nextTarget) this.pickTarget();
    if (!state.hasTarget) return;
    const cy = pos[1] + this.height / 2;
    const dx = state.targetX + 0.5 - pos[0],
      dy = state.targetY + 0.5 - cy,
      dz = state.targetZ + 0.5 - pos[2];
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.6) {
      state.hasTarget = false;
      return;
    }
    const s = Math.min(SWIM_SPEED, d) / d;
    const wx = dx * s,
      wy = dy * s,
      wz = dz * s;
    // Never swim out: the cell the body is heading into must be lava too.
    const reach = 0.5 / Math.max(1e-6, Math.hypot(wx, wy, wz));
    if (
      !isLava(
        world,
        Math.floor(pos[0] + wx * reach * 1.6),
        Math.floor(cy + wy * reach * 1.6),
        Math.floor(pos[2] + wz * reach * 1.6),
      )
    ) {
      state.hasTarget = false;
      body.wish[0] = body.wish[1] = body.wish[2] = 0;
      return;
    }
    body.wish[0] = wx;
    body.wish[1] = wy;
    body.wish[2] = wz;
  }

  /** A random lava cell within 8 blocks, from a fixed number of probes. */
  private pickTarget(): void {
    const state = this.state,
      pos = this.pos,
      world = this.runtime.world;
    state.hasTarget = false;
    state.nextTarget = this.ecs.time + this.randomInt(40, 100);
    for (let i = 0; i < SWIM_ATTEMPTS; i++) {
      const x = Math.floor(pos[0] + (this.runtime.random() * 2 - 1) * SWIM_RANGE);
      const y = Math.floor(pos[1] + (this.runtime.random() * 2 - 1) * 2);
      const z = Math.floor(pos[2] + (this.runtime.random() * 2 - 1) * SWIM_RANGE);
      if (!isLava(world, x, y, z)) continue;
      state.targetX = x;
      state.targetY = y;
      state.targetZ = z;
      state.hasTarget = true;
      return;
    }
  }

  override stop(): void {
    this.lookAt(null);
  }
}

export const MAGMAW_DEFINITION: CreatureDefinition = {
  type: MAGMAW,
  category: 'hostile',
  health: 24,
  width: 0.9,
  height: 0.6,
  speed: SWIM_SPEED,
  flying: true,
  model: () => MAGMAW,
  goals: (mob) => [[PRIORITY.attack, new MagmawGoal(mob)]],
  drops: (ctx) => [['emberite_scale', rollCount(ctx.random, 1, 2)]],
  setup(ctx, id) {
    const pos = ctx.ecs.get(id, TransformC)!.pos;
    ctx.ecs.add(id, MagmawC, {
      mode: 'swim',
      modeTicks: 0,
      cooldown: 0,
      homeX: Math.floor(pos[0]),
      homeY: Math.floor(pos[1]),
      homeZ: Math.floor(pos[2]),
      targetX: 0,
      targetY: 0,
      targetZ: 0,
      hasTarget: false,
      nextTarget: 0,
      lunges: 0,
      hits: 0,
    });
    playClip(ctx.ecs, id, 'swim');
  },
};

registerCreature({ definition: MAGMAW_DEFINITION, models: [[MAGMAW_MODEL, magmawSkin]] });
