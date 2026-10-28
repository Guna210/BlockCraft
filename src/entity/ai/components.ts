import { defineComponent } from '../ecs/world';
import type { Vec3 } from '../ecs/model';
import type { GoalSelector } from './goal';
import type { Navigator } from './navigation';

export type MobCategory = 'passive' | 'hostile' | 'ambient';

/** Who a mob attacks or was hurt by: the player, or an ECS entity id. */
export const PLAYER_TARGET = 0;
export type TargetRef = number;

export interface Mob {
  category: MobCategory;
  /** Item ids the mob follows and can be bred with. */
  foods: ReadonlySet<string>;
}

/** Movement abilities, the velocity integrated by the movement system, and this tick's intent. */
export interface MobBody {
  /** Walking speed in blocks per tick. */
  speed: number;
  flying: boolean;
  /** Can climb walls (see ClimbWallGoal). */
  climbing: boolean;
  /** Velocity in blocks per tick. Knockback is added here. */
  vel: Vec3;
  onGround: boolean;
  inFluid: boolean;
  /** The last move was stopped by a wall on x or z. */
  horizontalCollision: boolean;
  /** Desired velocity in blocks per tick (y only for flyers), written by goals and the navigator. */
  wish: Vec3;
  /** Fastest fall in blocks per tick (a fluttering bird); no cap when absent. */
  maxFallSpeed?: number;
  /** Jump this tick if on the ground; swim up if in water. */
  jump: boolean;
  /** Move up along the wall while it blocks horizontal movement. */
  climb: boolean;
  /** Held against a ceiling while a climbing mob pursues along its underside. */
  ceilingCling?: boolean;
}

export interface Ai {
  /** Built on the first AI tick from `goals`, so spawners need no runtime. */
  selector: GoalSelector | null;
}

export interface Nav {
  navigator: Navigator;
}

export interface Target {
  target: TargetRef | null;
  /** Who hurt the mob last, and EntityWorld.time when it happened. */
  attacker: TargetRef | null;
  attackerPos: Vec3 | null;
  hurtAt: number;
}

export interface Love {
  /** Ticks left in love after being fed; 0 when not in love. */
  loveTicks: number;
  /** Ticks before the mob can breed again. */
  cooldown: number;
  baby: boolean;
}

/** Age of a creature: a baby grows up when ageTicks reaches the grow-up time. */
export interface Age {
  baby: boolean;
  ageTicks: number;
}

/** Multiplies incoming damage (a Mossback withdrawn into its shell takes ×0.2). */
export interface DamageScale {
  scale: number;
}

/** Invulnerability frames after a hit: a bigger hit inside them applies only the difference. */
export interface Combatant {
  invulnerableTicks: number;
  lastDamage: number;
}

export const MobC = defineComponent<Mob>('mob');
export const MobBodyC = defineComponent<MobBody>('mobBody');
export const AiC = defineComponent<Ai>('ai');
export const NavC = defineComponent<Nav>('nav');
export const TargetC = defineComponent<Target>('target');
export const LoveC = defineComponent<Love>('love');
export const CombatC = defineComponent<Combatant>('combat');
export const AgeC = defineComponent<Age>('age');
export const DamageScaleC = defineComponent<DamageScale>('damageScale');
