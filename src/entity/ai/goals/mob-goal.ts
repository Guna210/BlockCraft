import { BaseGoal } from '../goal';
import { BodyC, LookTargetC, TransformC } from '../../ecs/components';
import type { Vec3 } from '../../ecs/model';
import type { EntityWorld } from '../../ecs/world';
import { MobBodyC, TargetC, type MobBody, type Target } from '../components';
import type { Navigator } from '../navigation';
import type { BlockPos } from '../pathfinding';
import type { MobHandle, MobRuntime } from '../runtime';

/** A goal bound to one mob, with shortcuts to its components. */
export abstract class MobGoal extends BaseGoal {
  constructor(protected readonly mob: MobHandle) {
    super();
  }

  protected get runtime(): MobRuntime {
    return this.mob.runtime;
  }

  protected get ecs(): EntityWorld {
    return this.mob.runtime.ecs;
  }

  protected get id(): number {
    return this.mob.id;
  }

  protected get pos(): Vec3 {
    return this.ecs.get(this.id, TransformC)!.pos;
  }

  protected get height(): number {
    return this.ecs.get(this.id, BodyC)?.height ?? 1;
  }

  protected get body(): MobBody {
    return this.ecs.get(this.id, MobBodyC)!;
  }

  protected get targeting(): Target {
    return this.ecs.get(this.id, TargetC)!;
  }

  protected get nav(): Navigator {
    return this.runtime.navigator(this.id);
  }

  /** The current target if it is still alive, else null. */
  protected get liveTarget(): number | null {
    const target = this.ecs.get(this.id, TargetC)?.target ?? null;
    return target !== null && this.runtime.targetAlive(target) ? target : null;
  }

  protected lookAt(point: Readonly<Vec3> | null): void {
    const look = this.ecs.get(this.id, LookTargetC);
    if (look) look.target = point ? [point[0], point[1], point[2]] : null;
  }

  protected distanceTo(point: Readonly<Vec3>): number {
    const pos = this.pos;
    return Math.hypot(point[0] - pos[0], point[1] - pos[1], point[2] - pos[2]);
  }

  protected randomInt(min: number, max: number): number {
    return min + Math.floor(this.runtime.random() * (max - min + 1));
  }
}

/**
 * A cell in column (x, z) near height y where a mob `height` blocks tall can stand: free (or water)
 * cells for its body with something solid below. Tries y, y+1, y−1, … within `range`.
 */
export function findStandable(
  runtime: MobRuntime,
  x: number,
  y: number,
  z: number,
  height: number,
  range = 4,
): BlockPos | null {
  const cells = Math.max(1, Math.ceil(height - 1e-6));
  for (let i = 0; i <= range * 2; i++) {
    const cy = y + (i % 2 === 1 ? (i + 1) / 2 : -i / 2);
    if (standable(runtime, x, cy, z, cells)) return [x, cy, z];
  }
  return null;
}

export function standable(
  runtime: MobRuntime,
  x: number,
  y: number,
  z: number,
  cells: number,
): boolean {
  for (let k = 0; k < cells; k++) {
    const kind = runtime.classify(x, y + k, z);
    if (kind === 'solid' || kind === 'forbidden') return false;
  }
  return runtime.classify(x, y - 1, z) === 'solid';
}
