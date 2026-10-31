import type { Action } from '../engine/input';
import { PLAYER_TARGET } from '../entity/ai/components';
import type { EntityWorld } from '../entity/ecs/world';
import { fireProjectile } from '../entity/projectiles';
import type { Player } from '../entity/player';
import { getToolDurability } from './tools';

export const BOW_CHARGE_TICKS = 20;
export const BOW_MIN_CHARGE = 0.1;

export function bowChargeSpeed(charge: number): number {
  const c = Math.max(0, Math.min(1, charge));
  return (3 * (c * c + 2 * c)) / 3;
}

/** The player bow input, charge meter and item use for a single ECS world. */
export class BowController {
  private useDown = false;
  private active = false;
  private chargeTicks = 0;
  onDraw: () => void = () => {};
  onRelease: () => void = () => {};

  constructor(
    readonly player: Player,
    readonly ecs: EntityWorld,
  ) {}

  get charging(): boolean {
    return this.active && this.useDown;
  }

  get charge(): number {
    return this.charging ? this.chargeTicks / BOW_CHARGE_TICKS : 0;
  }

  /** Returns true when the bow owns this use input, including an empty or broken bow. */
  input(action: Action, down: boolean): boolean {
    if (action !== 'use') return false;
    if (down) {
      if (this.useDown) return true;
      if (this.player.inventory.held?.id !== 'bow') return false;
      this.useDown = true;
      this.chargeTicks = 0;
      this.active = this.canCharge();
      if (this.active) this.onDraw();
      return true;
    }
    if (!this.useDown) return false;
    const charge = this.charge;
    const shouldFire = this.active && charge >= BOW_MIN_CHARGE;
    const wasActive = this.active;
    this.useDown = false;
    this.active = false;
    this.chargeTicks = 0;
    if (shouldFire) this.fire(charge);
    if (wasActive) this.onRelease();
    return true;
  }

  tick(): void {
    if (!this.charging) return;
    if (this.player.detached || this.player.inventory.held?.id !== 'bow' || !this.canCharge()) {
      this.cancel();
      return;
    }
    this.chargeTicks = Math.min(BOW_CHARGE_TICKS, this.chargeTicks + 1);
  }

  clear(): void {
    this.cancel();
    this.useDown = false;
  }

  private canCharge(): boolean {
    return this.player.mode === 'creative' || this.findArrow() !== -1;
  }

  private findArrow(): number {
    for (let slot = 0; slot < this.player.inventory.slots.length; slot++) {
      if (slot >= 36 && slot !== 40) continue;
      const stack = this.player.inventory.slots[slot];
      if (stack?.id === 'arrow' && stack.count > 0) return slot;
    }
    return -1;
  }

  private fire(charge: number): void {
    const player = this.player,
      bowSlot = player.inventory.selectedSlot,
      bow = player.inventory.slots[bowSlot];
    if (player.detached || player.dead || player.inventory.held?.id !== 'bow' || !bow) return;
    if (player.mode === 'survival') {
      const arrowSlot = this.findArrow();
      if (arrowSlot < 0) return;
      const arrows = player.inventory.slots[arrowSlot]!;
      arrows.count--;
      if (arrows.count === 0) player.inventory.slots[arrowSlot] = null;
    }
    const from: [number, number, number] = [
        player.pos[0],
        player.pos[1] + player.eye,
        player.pos[2],
      ],
      dir: [number, number, number] = [
        Math.cos(player.yaw) * Math.cos(player.pitch),
        Math.sin(player.pitch),
        Math.sin(player.yaw) * Math.cos(player.pitch),
      ];
    fireProjectile(this.ecs, {
      kind: 'arrow',
      from,
      dir,
      speed: bowChargeSpeed(charge),
      owner: PLAYER_TARGET,
      pickup: player.mode === 'survival',
    });
    const durability = getToolDurability('bow');
    if (durability !== null) {
      bow.damage = (bow.damage ?? 0) + 1;
      if (bow.damage >= durability) player.inventory.slots[bowSlot] = null;
    }
  }

  private cancel(): void {
    this.active = false;
    this.chargeTicks = 0;
  }
}
