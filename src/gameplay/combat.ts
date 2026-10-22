import type { EntityWorld } from '../entity/ecs/world';
import { BodyC, HealthC, TransformC } from '../entity/ecs/components';
import type { Vec3 } from '../entity/ecs/model';
import { damageEntity, entityState } from '../entity/ecs/systems';
import { CombatC, MobBodyC, PLAYER_TARGET, TargetC, type TargetRef } from '../entity/ai/components';
import { feedMob } from '../entity/ai/goals/breed';
import type { Player } from '../entity/player';
import type { BlockInteraction } from './block-interaction';
import type { Action } from '../engine/input';
import { items } from './items';
import { getAttackDamage, getToolDurability, getTotalArmorDefense } from './tools';

/** Ticks after a hit during which smaller hits are ignored and bigger ones apply the difference. */
export const INVULNERABLE_TICKS = 10;
export const CRIT_MULTIPLIER = 1.5;
/** Knockback velocity in blocks per tick. */
export const KNOCKBACK_HORIZONTAL = 0.4;
export const KNOCKBACK_UP = 0.36;
export const SURVIVAL_REACH = 3;
export const CREATIVE_REACH = 5;
export const SWEEP_DAMAGE = 1;
export const SHIELD_SLOT = 40;

/** Ticks for the attack meter to recharge from 0 to 1 with this item in the main hand. */
export function attackPeriod(itemId: string | null | undefined): number {
  const type = itemId ? items.items.get(itemId)?.tool?.type : undefined;
  return type === 'sword' ? 12 : type === 'axe' ? 20 : 5;
}

/** Meter value after `ticks` ticks of recharge. */
export function cooldownProgress(ticks: number, period: number): number {
  return Math.max(0, Math.min(1, ticks / period));
}

/** Damage of a hit at meter value `c`: base × (0.2 + 0.8·c²). */
export function scaledDamage(base: number, c: number): number {
  return base * (0.2 + 0.8 * c * c);
}

export interface FallState {
  velY: number;
  onGround: boolean;
  inFluid: boolean;
}

/** Falling, off the ground, out of fluid and with the meter above 0.9. */
export function isCritical(state: FallState, c: number): boolean {
  return state.velY < 0 && !state.onGround && !state.inFluid && c > 0.9;
}

/** Damage after armor: amount × (1 − min(20, armor) / 25). */
export function armorReduced(amount: number, armor: number): number {
  return amount * (1 - Math.min(20, Math.max(0, armor)) / 25);
}

/** A shield faces the source when it lies in the front half-space of the player's yaw. */
export function shieldFaces(yaw: number, pos: Readonly<Vec3>, from: Readonly<Vec3>): boolean {
  return Math.cos(yaw) * (from[0] - pos[0]) + Math.sin(yaw) * (from[2] - pos[2]) > 0;
}

/** Sets the mob's velocity to a knockback away from (x, z). */
export function knockBack(ecs: EntityWorld, id: number, fromX: number, fromZ: number): void {
  const body = ecs.get(id, MobBodyC),
    pos = ecs.get(id, TransformC)?.pos;
  if (!body || !pos) return;
  let dx = pos[0] - fromX,
    dz = pos[2] - fromZ;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) {
    dx = 1;
    dz = 0;
  } else {
    dx /= length;
    dz /= length;
  }
  body.vel[0] = dx * KNOCKBACK_HORIZONTAL;
  body.vel[1] = KNOCKBACK_UP;
  body.vel[2] = dz * KNOCKBACK_HORIZONTAL;
  body.onGround = false;
}

export interface Attacker {
  ref: TargetRef;
  pos: Readonly<Vec3>;
}

/**
 * Damages an ECS entity with invulnerability frames. Outside the frames the full amount applies,
 * knockback follows and the frames start; inside them only a bigger hit lands, for the difference,
 * without knockback. Returns true when health was lost.
 */
export function hurtMob(
  ecs: EntityWorld,
  id: number,
  amount: number,
  attacker?: Attacker,
  knockback = true,
): boolean {
  if (!ecs.get(id, HealthC) || entityState(ecs, id) === 'dying' || !(amount > 0)) return false;
  const combat = ecs.get(id, CombatC);
  let applied = amount;
  let fresh = true;
  if (combat) {
    if (combat.invulnerableTicks > 0) {
      if (amount <= combat.lastDamage) return false;
      applied = amount - combat.lastDamage;
      fresh = false;
    } else combat.invulnerableTicks = INVULNERABLE_TICKS;
    combat.lastDamage = amount;
  }
  damageEntity(ecs, id, applied);
  if (attacker) {
    const target = ecs.get(id, TargetC);
    if (target) {
      target.attacker = attacker.ref;
      target.attackerPos = [...attacker.pos];
      target.hurtAt = ecs.time;
    }
    if (fresh && knockback) knockBack(ecs, id, attacker.pos[0], attacker.pos[2]);
  }
  return true;
}

/** The hand holding a shield (main hand first), or null. */
function shieldSlot(player: Player): number | null {
  const inventory = player.inventory;
  if (inventory.held?.id === 'shield') return inventory.selectedSlot;
  return inventory.slots[SHIELD_SLOT]?.id === 'shield' ? SHIELD_SLOT : null;
}

export function playerArmor(player: Player): number {
  return getTotalArmorDefense(player.inventory.slots.slice(36, 40).map((stack) => stack?.id));
}

/** Whether the player is raising a shield ('use' held with a shield in either hand). */
export function isBlocking(player: Player): boolean {
  return shieldSlot(player) !== null && player.down('use');
}

/**
 * Damage from a mob or blast at `from`. A raised shield facing the source blocks all of it and
 * wears by one point; otherwise armor reduces it. Creative players take none. True when health
 * was lost.
 */
export function hurtPlayer(
  player: Player,
  amount: number,
  source: string,
  from: Readonly<Vec3>,
): boolean {
  if (player.mode !== 'survival' || player.dead || !(amount > 0)) return false;
  const slot = shieldSlot(player);
  if (slot !== null && player.down('use') && shieldFaces(player.yaw, player.pos, from)) {
    const shield = player.inventory.slots[slot]!;
    shield.damage = (shield.damage ?? 0) + 1;
    if (shield.damage >= (getToolDurability('shield') ?? Infinity))
      player.inventory.slots[slot] = null;
    return false;
  }
  const reduced = armorReduced(amount, playerArmor(player));
  if (reduced <= 0) return false;
  player.survival.damage(reduced, source);
  return true;
}

export interface EntityRayHit {
  id: number;
  distance: number;
}

/** Nearest living ECS entity box hit by the ray within `reach`. */
export function raycastEntities(
  ecs: EntityWorld,
  eye: Readonly<Vec3>,
  dir: Readonly<Vec3>,
  reach: number,
): EntityRayHit | null {
  let best: EntityRayHit | null = null;
  for (const id of ecs.query(TransformC, BodyC, HealthC)) {
    if (entityState(ecs, id) === 'dying') continue;
    const pos = ecs.get(id, TransformC)!.pos,
      body = ecs.get(id, BodyC)!;
    const half = body.width / 2;
    const t = rayBox(
      eye,
      dir,
      pos[0] - half,
      pos[1],
      pos[2] - half,
      pos[0] + half,
      pos[1] + body.height,
      pos[2] + half,
    );
    if (t !== null && t <= reach && (!best || t < best.distance)) best = { id, distance: t };
  }
  return best;
}

function rayBox(
  o: Readonly<Vec3>,
  d: Readonly<Vec3>,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): number | null {
  let near = 0,
    far = Infinity;
  const min = [minX, minY, minZ],
    max = [maxX, maxY, maxZ];
  for (let axis = 0; axis < 3; axis++) {
    const origin = o[axis]!,
      direction = d[axis]!;
    if (Math.abs(direction) < 1e-12) {
      if (origin < min[axis]! || origin > max[axis]!) return null;
      continue;
    }
    let t0 = (min[axis]! - origin) / direction,
      t1 = (max[axis]! - origin) / direction;
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return null;
  }
  return near;
}

export interface AttackResult {
  target: number;
  damage: number;
  cooldown: number;
  critical: boolean;
  landed: boolean;
  swept: number[];
}

/**
 * The player's side of melee: the attack meter, entity hits before block mining, crits, sweeps,
 * and feeding a mob with 'use'.
 */
export class PlayerCombat {
  private ticksSinceAttack = 1e9;
  private heldId: string | null = null;
  private attackPressed = false;
  private usePressed = false;
  private attackDown = false;
  private useDown = false;
  /** The last entity attack, for the debug API and tests. */
  lastAttack: AttackResult | null = null;

  constructor(
    readonly player: Player,
    readonly ecs: EntityWorld,
    private readonly interaction: BlockInteraction | null,
  ) {}

  input(action: Action, down: boolean): void {
    if (action === 'attack') {
      if (down && !this.attackDown) this.attackPressed = true;
      this.attackDown = down;
    }
    if (action === 'use') {
      if (down && !this.useDown) this.usePressed = true;
      this.useDown = down;
    }
  }

  clear(): void {
    this.attackPressed = this.usePressed = this.attackDown = this.useDown = false;
  }

  /** The attack meter, 0 right after a swing and 1 when fully recharged. */
  get cooldown(): number {
    return cooldownProgress(this.ticksSinceAttack, attackPeriod(this.heldId));
  }

  get reach(): number {
    return this.player.mode === 'creative' ? CREATIVE_REACH : SURVIVAL_REACH;
  }

  /** Runs before block interaction so an entity in front of a block takes the click. */
  tick(): void {
    const player = this.player;
    const held = player.inventory.held?.id ?? null;
    if (held !== this.heldId) {
      this.heldId = held;
      this.ticksSinceAttack = 0;
    }
    this.ticksSinceAttack++;
    const attack = this.attackPressed,
      use = this.usePressed;
    this.attackPressed = this.usePressed = false;
    if (player.dead || player.detached || (!attack && !use)) return;
    const hit = this.pick();
    if (attack) {
      if (hit) {
        this.attack(hit.id);
        this.interaction?.holdAttack();
      }
      this.ticksSinceAttack = 0;
    }
    if (use && hit && held && feedMob(this.ecs, hit.id, held)) {
      if (player.mode === 'survival') player.inventory.consumeSelected();
      this.interaction?.cancelUse();
    }
  }

  /** The entity under the crosshair, if it is nearer than the targeted block. */
  pick(): EntityRayHit | null {
    const p = this.player;
    const eye: Vec3 = [p.pos[0], p.pos[1] + p.eye, p.pos[2]];
    const dir: Vec3 = [
      Math.cos(p.yaw) * Math.cos(p.pitch),
      Math.sin(p.pitch),
      Math.sin(p.yaw) * Math.cos(p.pitch),
    ];
    const hit = raycastEntities(this.ecs, eye, dir, this.reach);
    if (!hit) return null;
    if (this.interaction) {
      this.interaction.updateTarget();
      const block = this.interaction.target;
      if (block.hit && block.distance < hit.distance) return null;
    }
    return hit;
  }

  /** Hits an entity with the held item at the current meter value. */
  attack(id: number): AttackResult {
    const player = this.player,
      ecs = this.ecs;
    const heldStack = player.inventory.held;
    const held = heldStack?.id ?? null;
    const c = this.cooldown;
    let damage = scaledDamage(getAttackDamage(heldStack), c);
    const critical = isCritical(
      { velY: player.vel[1], onGround: player.onGround, inFluid: player.inFluid !== null },
      c,
    );
    if (critical) damage *= CRIT_MULTIPLIER;
    const attacker: Attacker = { ref: PLAYER_TARGET, pos: player.pos };
    const landed = hurtMob(ecs, id, damage, attacker);
    const swept: number[] = [];
    const sword = held !== null && items.items.get(held)?.tool?.type === 'sword';
    if (sword && c >= 1 && player.onGround && !player.isSprinting) {
      const target = boxOf(ecs, id);
      for (const other of ecs.query(TransformC, BodyC, HealthC)) {
        if (other === id || entityState(ecs, other) === 'dying' || !target) continue;
        const box = boxOf(ecs, other)!;
        const pos = ecs.get(other, TransformC)!.pos;
        if (gap(target, box) > 1) continue;
        if (Math.hypot(pos[0] - player.pos[0], pos[1] - player.pos[1], pos[2] - player.pos[2]) > 3)
          continue;
        if (hurtMob(ecs, other, SWEEP_DAMAGE, attacker)) swept.push(other);
      }
    }
    if (player.mode === 'survival') player.survival.addExhaustion(0.1);
    this.lastAttack = { target: id, damage, cooldown: c, critical, landed, swept };
    return this.lastAttack;
  }
}

type Box = [number, number, number, number, number, number];

function boxOf(ecs: EntityWorld, id: number): Box | null {
  const pos = ecs.get(id, TransformC)?.pos,
    body = ecs.get(id, BodyC);
  if (!pos || !body) return null;
  const half = body.width / 2;
  return [pos[0] - half, pos[1], pos[2] - half, pos[0] + half, pos[1] + body.height, pos[2] + half];
}

function gap(a: Box, b: Box): number {
  return Math.max(0, a[0] - b[3], b[0] - a[3], a[1] - b[4], b[1] - a[4], a[2] - b[5], b[2] - a[5]);
}
