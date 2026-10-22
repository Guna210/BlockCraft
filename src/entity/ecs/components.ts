import { defineComponent } from './world';
import type { Vec3 } from './model';

/** Ticks of red tint after damage; matches the 10-tick invulnerability of M13c. */
export const HURT_TICKS = 10;
/** Red mix of the hurt and death tint. */
export const HURT_TINT = 0.4;
/** Ticks of the death tip-over; the entity is removed on the tick after it lies flat. */
export const DEATH_TICKS = 20;

export interface EntityKind {
  type: string;
}

/** Feet-centre position and body yaw (forward is (cos yaw, 0, sin yaw)), plus last tick's values. */
export interface Transform {
  pos: Vec3;
  previous: Vec3;
  yaw: number;
  previousYaw: number;
  /** Optional world pitch for oriented entities such as projectiles. */
  pitch?: number;
  previousPitch?: number;
}

/** Collision size in blocks, centred on the transform horizontally. */
export interface Body {
  width: number;
  height: number;
}

/** current ≤ 0 means dying; deathTicks counts the tip-over. */
export interface Health {
  current: number;
  max: number;
  hurtTicks: number;
  deathTicks: number;
  previousDeathTicks: number;
}

export interface Renderable {
  model: string;
  /** Uniform model scale (a baby is 0.5); 1 when absent. */
  scale?: number;
}

export interface PlayingClip {
  name: string;
  /** EntityWorld.time when the clip started. */
  start: number;
}

/** Procedural animation state, with last tick's values for render interpolation. */
export interface Animator {
  walkPhase: number;
  previousWalkPhase: number;
  /** Horizontal speed in blocks per second over the last tick. */
  speed: number;
  previousSpeed: number;
  headYaw: number;
  previousHeadYaw: number;
  headPitch: number;
  previousHeadPitch: number;
  clips: PlayingClip[];
}

/** Where the head tracks; null returns the head to rest. */
export interface LookTarget {
  target: Vec3 | null;
}

export const EntityKindC = defineComponent<EntityKind>('kind');
export const TransformC = defineComponent<Transform>('transform');
export const BodyC = defineComponent<Body>('body');
export const HealthC = defineComponent<Health>('health');
export const RenderableC = defineComponent<Renderable>('renderable');
export const AnimatorC = defineComponent<Animator>('animator');
export const LookTargetC = defineComponent<LookTarget>('look');
