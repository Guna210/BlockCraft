import type { World } from '../../world/world';
import type { EntityModel, KeyframeChannel, Vec3 } from '../ecs/model';
import { playClip } from '../ecs/systems';
import { defineComponent } from '../ecs/world';
import { PLAYER_TARGET } from '../ai/components';
import type { GoalFlag } from '../ai/goal';
import { MobGoal } from '../ai/goals/mob-goal';
import { boxGap, type MobHandle, type MobRuntime } from '../ai/runtime';
import { FlightPath, FlightPathfinder } from '../ai/flight-path';
import { SkinPainter, buildModel, cubesOf, type Ramp } from './kit';
import { PRIORITY, registerCreature, rollCount, type CreatureDefinition } from './creature';

export const GLOWWING = 'glowwing';
/** Noticed within this range; let go beyond 1.5× it. */
export const GLOWWING_RANGE = 32;
export const GLOWWING_CIRCLE_RADIUS = 6;
export const GLOWWING_CIRCLE_HEIGHT = 5;
export const GLOWWING_DAMAGE = 4;
/** A cached path is re-planned only when the goal cell moves at least this far from its goal. */
export const GLOWWING_REPLAN_DISTANCE = 4;
/** Fewest ticks between two path requests of one Glowwing. */
export const GLOWWING_REPLAN_COOLDOWN = 10;
const SPEED = 0.2;
const DIVE_SPEED = 0.42;
const CIRCLE_STEP = 0.06;
const DIVE_TICKS = 50;
const CLIMB_TICKS = 30;
const FLAP_TICKS = 24;
const LOOKAHEAD = 6;

// A pale, see-through violet-blue ray; the dorsal seam and trailing ribbons glow lumite-cyan.
const MEMBRANE: Ramp = ['#2b2652', '#424184', '#6274b4', '#93add9', '#c9e0f3'];
const GLOW: Ramp = ['#2fb9b0', '#7debdf', '#d8fff8'];
export const GLOWWING_PALETTE = [...MEMBRANE, ...GLOW];

function glowwingModel(): EntityModel {
  const flap = (part: string, sign: 1 | -1): KeyframeChannel => ({
    part,
    property: 'rotation',
    interpolation: 'linear',
    keys: [
      { tick: 0, value: [0, 0, sign * 0.32] },
      { tick: FLAP_TICKS / 2, value: [0, 0, -sign * 0.3] },
      { tick: FLAP_TICKS, value: [0, 0, sign * 0.32] },
    ],
  });
  const wave = (part: string, phase: number): KeyframeChannel => ({
    part,
    property: 'rotation',
    interpolation: 'linear',
    keys: [
      { tick: 0, value: [0.25 * phase, 0, 0] },
      { tick: FLAP_TICKS / 2, value: [-0.3 * phase, 0, 0] },
      { tick: FLAP_TICKS, value: [0.25 * phase, 0, 0] },
    ],
  });
  return buildModel({
    id: GLOWWING,
    textureSize: [128, 64],
    parts: [
      {
        name: 'body',
        pivot: [0, 2, 0],
        cubes: [
          { from: [-4, 1, -5], size: [8, 3, 10] },
          // Two forward head lobes.
          { from: [-4, 1.5, 5], size: [2, 1, 3] },
          { from: [2, 1.5, 5], size: [2, 1, 3] },
        ],
      },
      {
        name: 'seam',
        parent: 'body',
        pivot: [0, 4, 0],
        emissive: true,
        cubes: [
          { from: [-1, 4, -4], size: [2, 1, 8] },
          { from: [-3, 3, 5], size: [1, 1, 1] },
          { from: [2, 3, 5], size: [1, 1, 1] },
        ],
      },
      {
        name: 'wing_r',
        parent: 'body',
        // The membrane glows faintly on its own: a bioluminescent ray in an unlit cavern.
        emissive: true,
        pivot: [-4, 2, 0],
        cubes: [
          { from: [-10, 2, -4], size: [6, 1, 8] },
          { from: [-15, 2, -2], size: [5, 1, 5] },
        ],
      },
      {
        name: 'wing_l',
        parent: 'body',
        emissive: true,
        pivot: [4, 2, 0],
        cubes: [
          { from: [4, 2, -4], size: [6, 1, 8] },
          { from: [10, 2, -2], size: [5, 1, 5] },
        ],
      },
      {
        name: 'ribbon_r',
        parent: 'wing_r',
        pivot: [-13, 2.5, -2],
        emissive: true,
        cubes: [{ from: [-13.5, 2.5, -15], size: [1, 0, 13] }],
      },
      {
        name: 'ribbon_l',
        parent: 'wing_l',
        pivot: [13, 2.5, -2],
        emissive: true,
        cubes: [{ from: [12.5, 2.5, -15], size: [1, 0, 13] }],
      },
      {
        name: 'tail',
        parent: 'body',
        pivot: [0, 2, -5],
        cubes: [{ from: [-0.5, 2, -18], size: [1, 1, 13] }],
      },
    ],
    clips: {
      flap: {
        length: FLAP_TICKS,
        loop: true,
        channels: [
          flap('wing_r', 1),
          flap('wing_l', -1),
          wave('ribbon_r', 1),
          wave('ribbon_l', 1),
          wave('tail', -0.6),
        ],
      },
    },
  });
}

export const GLOWWING_MODEL = glowwingModel();

export function glowwingSkin(seed: number): Uint8Array {
  const m = GLOWWING_MODEL;
  const p = new SkinPainter(...m.textureSize, seed);
  const [disc, lobeR, lobeL] = cubesOf(m, 'body');
  p.cube(disc!, MEMBRANE, { base: 2.5, top: 1, bottom: -1, falloff: 0 });
  for (const lobe of [lobeR!, lobeL!]) p.cube(lobe, MEMBRANE, { base: 2, top: 1, falloff: 0 });
  // A darker gill row on the underside, two short slits a side.
  p.rect(disc!, 'bottom', 1, 3, 1, 3, MEMBRANE[0]!);
  p.rect(disc!, 'bottom', 6, 3, 1, 3, MEMBRANE[0]!);
  for (const name of ['wing_r', 'wing_l']) {
    for (const wing of cubesOf(m, name)) {
      // A flat pale membrane inside a darker rim, with one lighter vein along it.
      p.cube(wing, MEMBRANE, {
        base: 3,
        top: 0,
        bottom: -1,
        falloff: 0,
        pattern: (x, y, face, w, h) =>
          face === 'top' || face === 'bottom'
            ? x === 0 || x === w - 1 || y === 0 || y === h - 1
              ? -2
              : y === Math.floor(h / 2)
                ? 1
                : 0
            : -1,
      });
    }
  }
  for (const cube of [...cubesOf(m, 'seam'), ...cubesOf(m, 'ribbon_r'), ...cubesOf(m, 'ribbon_l')])
    p.cube(cube, GLOW, {
      base: 1,
      top: 1,
      bottom: 0,
      falloff: 0,
      pattern: (_x, y, _face, _w, h) => (h > 6 && y % 4 === 3 ? -1 : 0),
    });
  p.cube(cubesOf(m, 'tail')[0]!, MEMBRANE, { base: 1, top: 1, falloff: 0 });
  return p.data;
}

/** Each world's flight searches share one pathfinder and its per-tick budget. */
const pathfinders = new WeakMap<World, FlightPathfinder>();

export function flightPathfinder(runtime: MobRuntime): FlightPathfinder {
  let pathfinder = pathfinders.get(runtime.world);
  if (!pathfinder) {
    pathfinder = new FlightPathfinder((x, y, z) => runtime.classify(x, y, z) === 'passable');
    pathfinders.set(runtime.world, pathfinder);
  }
  return pathfinder;
}

export type GlowwingPhase = 'roam' | 'circle' | 'dive' | 'climb';

interface GlowwingState {
  phase: GlowwingPhase;
  /** Ticks spent in the current phase. */
  phaseTicks: number;
  /** Ticks the next circle lasts before a dive. */
  circleTicks: number;
  angle: number;
  path: FlightPath;
  nextPlan: number;
  /** Dives that hit the player, for tests. */
  hits: number;
}
export const GlowwingC = defineComponent<GlowwingState>('glowwing');

/**
 * Circles above the player, dives at it, climbs out and circles again. It flies straight when the
 * way ahead is open; otherwise it follows a cached 3D path, re-planned only when its goal moves far
 * or a waypoint is blocked, never every tick.
 */
export class GlowwingGoal extends MobGoal {
  readonly name = 'glowwing_hunt';
  override readonly flags: readonly GoalFlag[] = ['move', 'look', 'target'];
  private readonly goal: Vec3 = [0, 0, 0];

  constructor(mob: MobHandle) {
    super(mob);
  }

  canStart(): boolean {
    return this.body.flying;
  }

  private get state(): GlowwingState {
    return this.ecs.get(this.id, GlowwingC)!;
  }

  override tick(): void {
    const state = this.state;
    flightPathfinder(this.runtime).tick(this.ecs.time);
    const player = this.runtime.player();
    const range = this.targeting.target === PLAYER_TARGET ? GLOWWING_RANGE * 1.5 : GLOWWING_RANGE;
    const hunting = !!player && player.targetable() && this.distanceTo(player.pos) <= range;
    if (!hunting) {
      if (this.targeting.target === PLAYER_TARGET) this.targeting.target = null;
      if (state.phase !== 'roam') this.enter('roam');
      this.roam();
      return;
    }
    this.targeting.target = PLAYER_TARGET;
    if (state.phase === 'roam') this.enter('circle');
    state.phaseTicks++;
    const p = player.pos;
    const goal = this.goal;
    if (state.phase === 'circle') {
      state.angle += CIRCLE_STEP;
      goal[0] = p[0] + Math.cos(state.angle) * GLOWWING_CIRCLE_RADIUS;
      goal[1] = p[1] + GLOWWING_CIRCLE_HEIGHT;
      goal[2] = p[2] + Math.sin(state.angle) * GLOWWING_CIRCLE_RADIUS;
      this.flyTo(goal, SPEED);
      if (state.phaseTicks >= state.circleTicks) this.enter('dive');
    } else if (state.phase === 'dive') {
      goal[0] = p[0];
      goal[1] = p[1] + player.height * 0.6;
      goal[2] = p[2];
      this.flyTo(goal, DIVE_SPEED);
      const own = this.runtime.entityBounds(this.id)!;
      const box = this.runtime.targetBounds(PLAYER_TARGET)!;
      if (boxGap(own, box) <= 0.3) {
        if (this.runtime.hurtTarget(PLAYER_TARGET, GLOWWING_DAMAGE, this.id)) state.hits++;
        this.enter('climb');
      } else if (state.phaseTicks >= DIVE_TICKS) this.enter('climb');
    } else {
      // Climb out past the player and up, then circle again.
      const pos = this.pos;
      const dx = pos[0] - p[0],
        dz = pos[2] - p[2];
      const d = Math.max(1e-3, Math.hypot(dx, dz));
      goal[0] = p[0] + (dx / d) * GLOWWING_CIRCLE_RADIUS;
      goal[1] = p[1] + GLOWWING_CIRCLE_HEIGHT + 2;
      goal[2] = p[2] + (dz / d) * GLOWWING_CIRCLE_RADIUS;
      this.flyTo(goal, SPEED);
      if (state.phaseTicks >= CLIMB_TICKS) {
        state.angle = Math.atan2(dz, dx);
        this.enter('circle');
      }
    }
    this.lookAt(state.phase === 'dive' ? goal : null);
  }

  override stop(): void {
    flightPathfinder(this.runtime).cancel(this.state.path);
    this.state.path.clear();
    this.lookAt(null);
  }

  private enter(phase: GlowwingPhase): void {
    const state = this.state;
    state.phase = phase;
    state.phaseTicks = 0;
    if (phase === 'circle') state.circleTicks = this.randomInt(60, 110);
  }

  /** Slow drifting with nobody to hunt: a wide loop, turning away from rock ahead. */
  private roam(): void {
    const state = this.state;
    state.angle += 0.02;
    const pos = this.pos,
      body = this.body;
    const hx = Math.cos(state.angle),
      hz = Math.sin(state.angle);
    const ahead = this.runtime.classify(
      Math.floor(pos[0] + hx * 2),
      Math.floor(pos[1]),
      Math.floor(pos[2] + hz * 2),
    );
    if (ahead !== 'passable') state.angle += 0.6;
    const below = this.runtime.classify(
      Math.floor(pos[0]),
      Math.floor(pos[1]) - 2,
      Math.floor(pos[2]),
    );
    body.wish[0] = hx * SPEED * 0.5;
    body.wish[1] = below === 'passable' ? Math.sin(state.angle * 3) * 0.03 : 0.06;
    body.wish[2] = hz * SPEED * 0.5;
  }

  /** True when the straight line toward (x, y, z) is open air for the next few blocks. */
  private clearAhead(x: number, y: number, z: number): boolean {
    const pos = this.pos;
    const fromY = pos[1] + this.height / 2;
    const dx = x - pos[0],
      dy = y - fromY,
      dz = z - pos[2];
    const d = Math.hypot(dx, dy, dz);
    const steps = Math.min(LOOKAHEAD, Math.ceil(d));
    for (let i = 1; i <= steps; i++) {
      const t = i / Math.max(d, 1);
      const cx = Math.floor(pos[0] + dx * t),
        cy = Math.floor(fromY + dy * t),
        cz = Math.floor(pos[2] + dz * t);
      if (this.runtime.classify(cx, cy, cz) !== 'passable') return false;
    }
    return true;
  }

  /** Steers toward a point, along a cached flight path when rock is in the way. */
  flyTo(target: Readonly<Vec3>, speed: number): void {
    const state = this.state,
      path = state.path,
      pos = this.pos;
    if (this.clearAhead(target[0], target[1], target[2])) {
      if (path.status === 'ready' || path.status === 'failed') path.clear();
      this.steer3(target[0], target[1], target[2], speed);
      return;
    }
    const gx = Math.floor(target[0]),
      gy = Math.floor(target[1]),
      gz = Math.floor(target[2]);
    const cx = Math.floor(pos[0]),
      cy = Math.floor(pos[1] + this.height / 2),
      cz = Math.floor(pos[2]);
    const pathfinder = flightPathfinder(this.runtime);
    const moved =
      Math.hypot(gx - path.goalX, gy - path.goalY, gz - path.goalZ) >= GLOWWING_REPLAN_DISTANCE;
    let blocked = false;
    if (path.status === 'ready') {
      // Skip waypoints already reached.
      while (path.index < path.length - 1 && this.near(path, path.index)) path.index++;
      const o = path.index * 3;
      blocked =
        this.runtime.classify(path.cells[o]!, path.cells[o + 1]!, path.cells[o + 2]!) !==
        'passable';
      if (path.index >= path.length - 1 && this.near(path, path.index)) path.clear();
    }
    const needsPlan =
      path.status === 'idle' ||
      ((path.status === 'ready' || path.status === 'failed') && (moved || blocked));
    if (needsPlan && this.ecs.time >= state.nextPlan) {
      state.nextPlan = this.ecs.time + GLOWWING_REPLAN_COOLDOWN;
      pathfinder.request(path, cx, cy, cz, gx, gy, gz);
    }
    if (path.status === 'ready' && !blocked) {
      const o = path.index * 3;
      this.steer3(path.cells[o]! + 0.5, path.cells[o + 1]! + 0.5, path.cells[o + 2]! + 0.5, speed);
    } else {
      // Waiting for a path, or none exists: hover in place and lift a little.
      const body = this.body;
      body.wish[0] = 0;
      body.wish[1] = 0.02;
      body.wish[2] = 0;
    }
  }

  private near(path: FlightPath, index: number): boolean {
    const pos = this.pos,
      o = index * 3;
    return (
      Math.abs(pos[0] - (path.cells[o]! + 0.5)) < 0.6 &&
      Math.abs(pos[1] + this.height / 2 - (path.cells[o + 1]! + 0.5)) < 0.7 &&
      Math.abs(pos[2] - (path.cells[o + 2]! + 0.5)) < 0.6
    );
  }

  private steer3(x: number, y: number, z: number, speed: number): void {
    const pos = this.pos,
      body = this.body;
    const dx = x - pos[0],
      dy = y - (pos[1] + this.height / 2),
      dz = z - pos[2];
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) {
      body.wish[0] = body.wish[1] = body.wish[2] = 0;
      return;
    }
    const s = Math.min(speed, d) / d;
    body.wish[0] = dx * s;
    body.wish[1] = dy * s;
    body.wish[2] = dz * s;
  }
}

export const GLOWWING_DEFINITION: CreatureDefinition = {
  type: GLOWWING,
  category: 'hostile',
  health: 14,
  width: 0.9,
  height: 0.45,
  speed: SPEED,
  flying: true,
  model: () => GLOWWING,
  goals: (mob) => [[PRIORITY.attack, new GlowwingGoal(mob)]],
  drops: (ctx) => [['luminous_membrane', rollCount(ctx.random, 1, 2)]],
  setup(ctx, id) {
    ctx.ecs.add(id, GlowwingC, {
      phase: 'roam',
      phaseTicks: 0,
      circleTicks: 80,
      angle: ctx.random() * Math.PI * 2,
      path: new FlightPath(),
      nextPlan: 0,
      hits: 0,
    });
    playClip(ctx.ecs, id, 'flap');
  },
};

registerCreature({ definition: GLOWWING_DEFINITION, models: [[GLOWWING_MODEL, glowwingSkin]] });
