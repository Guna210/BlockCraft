import type { GoalFlag } from '../goal';
import { BlockRegistry } from '../../../world/blocks/registry';
import { EntityKindC, TransformC } from '../../ecs/components';
import type { Vec3 } from '../../ecs/model';
import { entityState } from '../../ecs/systems';
import { MobBodyC } from '../components';
import type { MobHandle } from '../runtime';
import { MobGoal } from './mob-goal';

/** Blocks a flock is drawn to. */
export const FLOCK_LIGHT_BLOCKS: readonly string[] = ['torch', 'wall_torch', 'lumite_block'];

let lightStates: Set<number> | null = null;

function lightStateIds(): Set<number> {
  if (!lightStates) {
    const registry = BlockRegistry.getInstance();
    lightStates = new Set();
    for (const id of registry.getAllStateIds())
      if (FLOCK_LIGHT_BLOCKS.includes(registry.getResolvedState(id)!.blockId)) lightStates.add(id);
  }
  return lightStates;
}

export interface FlockOptions {
  /** Flockmates are other mobs of the same type within this distance. */
  neighborRange?: number;
  lightRange?: number;
  speed?: number;
}

const SEPARATION = 1.5;
const LIGHT_SEARCH_INTERVAL = 20;

/**
 * Boids flight for flying mobs: separation, alignment and cohesion with flockmates, plus attraction
 * to the nearest torch or lumite within 8 blocks, around which the flock circles.
 */
export class FlockGoal extends MobGoal {
  readonly name = 'flock';
  override readonly flags: readonly GoalFlag[] = ['move'];
  private readonly neighborRange: number;
  private readonly lightRange: number;
  private readonly speed: number;
  private light: Vec3 | null = null;
  private lightSearch = 0;
  private heading: Vec3 = [1, 0, 0];

  constructor(mob: MobHandle, options: FlockOptions = {}) {
    super(mob);
    this.neighborRange = options.neighborRange ?? 4;
    this.lightRange = options.lightRange ?? 8;
    this.speed = options.speed ?? 1;
  }

  /** The light the flock circles, if one is in range. */
  get lightTarget(): Readonly<Vec3> | null {
    return this.light;
  }

  canStart(): boolean {
    return this.body.flying;
  }

  override tick(): void {
    const ecs = this.ecs,
      pos = this.pos,
      type = ecs.get(this.id, EntityKindC)?.type;
    if (--this.lightSearch <= 0) {
      this.light = this.findLight();
      this.lightSearch = LIGHT_SEARCH_INTERVAL;
    }
    const separation: Vec3 = [0, 0, 0],
      alignment: Vec3 = [0, 0, 0],
      cohesion: Vec3 = [0, 0, 0];
    let neighbors = 0;
    for (const other of ecs.query(MobBodyC, TransformC, EntityKindC)) {
      if (other === this.id || ecs.get(other, EntityKindC)!.type !== type) continue;
      if (entityState(ecs, other) === 'dying') continue;
      const p = ecs.get(other, TransformC)!.pos;
      const dx = pos[0] - p[0],
        dy = pos[1] - p[1],
        dz = pos[2] - p[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > this.neighborRange) continue;
      neighbors++;
      if (d < SEPARATION && d > 1e-6) {
        separation[0] += dx / (d * d);
        separation[1] += dy / (d * d);
        separation[2] += dz / (d * d);
      }
      const v = ecs.get(other, MobBodyC)!.vel;
      alignment[0] += v[0];
      alignment[1] += v[1];
      alignment[2] += v[2];
      cohesion[0] += p[0] - pos[0];
      cohesion[1] += p[1] - pos[1];
      cohesion[2] += p[2] - pos[2];
    }
    const steer: Vec3 = [0, 0, 0];
    add(steer, separation, 1.5);
    if (neighbors > 0) {
      add(steer, normalized(alignment), 0.5);
      add(steer, normalized(cohesion), 0.3);
    }
    if (this.light) {
      const toLight: Vec3 = [
        this.light[0] - pos[0],
        this.light[1] - pos[1],
        this.light[2] - pos[2],
      ];
      const d = Math.hypot(toLight[0], toLight[1], toLight[2]);
      // Pulled in from afar; close by, the pull turns sideways so the flock orbits the light.
      const pull = normalized(toLight);
      add(steer, pull, d > 2 ? 1 : 0.2);
      add(steer, [-pull[2], 0, pull[0]], d > 2 ? 0.3 : 1);
    }
    const r = this.runtime;
    add(steer, [r.random() - 0.5, (r.random() - 0.5) * 0.5, r.random() - 0.5], 0.4);
    add(steer, this.heading, 0.6);
    if (r.classify(Math.floor(pos[0]), Math.floor(pos[1]) - 1, Math.floor(pos[2])) === 'solid')
      steer[1] += 0.5;
    const direction = normalized(steer);
    if (direction[0] !== 0 || direction[1] !== 0 || direction[2] !== 0) this.heading = direction;
    const speed = this.body.speed * this.speed;
    this.body.wish[0] = this.heading[0] * speed;
    this.body.wish[1] = this.heading[1] * speed;
    this.body.wish[2] = this.heading[2] * speed;
  }

  /** Centre of the nearest light block within range. */
  findLight(): Vec3 | null {
    const pos = this.pos;
    const states = lightStateIds();
    const world = this.runtime.world;
    const x0 = Math.floor(pos[0]),
      y0 = Math.floor(pos[1]),
      z0 = Math.floor(pos[2]);
    const r = Math.ceil(this.lightRange);
    let best: Vec3 | null = null,
      bestDistance = this.lightRange * this.lightRange;
    for (let dy = -r; dy <= r; dy++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          const distance = dx * dx + dy * dy + dz * dz;
          if (distance > bestDistance) continue;
          if (!states.has(world.getBlockStateId(x0 + dx, y0 + dy, z0 + dz))) continue;
          best = [x0 + dx + 0.5, y0 + dy + 0.5, z0 + dz + 0.5];
          bestDistance = distance;
        }
    return best;
  }
}

function add(out: Vec3, v: Readonly<Vec3>, scale: number): void {
  out[0] += v[0] * scale;
  out[1] += v[1] * scale;
  out[2] += v[2] * scale;
}

function normalized(v: Readonly<Vec3>): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length < 1e-9 ? [0, 0, 0] : [v[0] / length, v[1] / length, v[2] / length];
}
