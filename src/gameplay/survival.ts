import { BlockRegistry } from '../world/blocks/registry';
import type { Position } from '../entity/physics';
import type { World } from '../world/world';
import type { BreakParticles } from '../render/particles';
import { items } from './items';

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
export const MAX_AIR = 300;

export const DROWNING_INTERVAL = 20;
export const DROWNING_DAMAGE = 2;

export const LAVA_INTERVAL = 10;
export const LAVA_DAMAGE = 4;
export const LAVA_BURN_TICKS = 300;

export const FIRE_INTERVAL = 10;
export const FIRE_DAMAGE = 1;
export const FIRE_BURN_TICKS = 160;

export const BURNING_INTERVAL = 20;
export const BURNING_DAMAGE = 1;

export const CACTUS_INTERVAL = 10;
export const CACTUS_DAMAGE = 1;

export const SUFFOCATION_INTERVAL = 10;
export const SUFFOCATION_DAMAGE = 1;

export const VOID_INTERVAL = 10;
export const VOID_DAMAGE = 4;

export const FAST_REGEN_INTERVAL = 10;
export const SLOW_REGEN_INTERVAL = 80;
export const STARVATION_INTERVAL = 80;
export const STARVATION_DAMAGE = 1;

export const EATING_DURATION_TICKS = 32;

/**
 * Procedural block state mappings for crumb particles that match each food item's primary colors.
 */
export const FOOD_CRUMB_BLOCKS: Record<string, string> = {
  wild_berries: 'wild_rose',
  apple: 'red_stained_glass',
  bread: 'hay_bale',
  raw_tuftbuck_shank: 'pink_stained_glass',
  roast_tuftbuck_shank: 'clayrock_brown',
  raw_boar_chop: 'clayrock_terracotta',
  roast_boar_chop: 'clayrock_dark_brown',
  raw_fowl: 'clayrock_white',
  roast_fowl: 'clayrock_orange',
  baked_tuber: 'clayrock_yellow',
  mushroom_broth: 'brown_mushroom',
  glowcap_stew: 'lumite_block',
};

export function getFoodCrumbStateId(
  foodId: string,
  registry = BlockRegistry.getInstance(),
): number {
  const blockId = FOOD_CRUMB_BLOCKS[foodId] ?? 'hay_bale';
  return registry.getDefaultStateId(blockId) ?? 1;
}

export function spawnFoodCrumbs(
  particles: BreakParticles,
  foodId: string,
  pos: Position,
  yaw: number,
  pitch: number,
  eye: number,
  registry = BlockRegistry.getInstance(),
): void {
  const stateId = getFoodCrumbStateId(foodId, registry);
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const x = pos[0] + cosYaw * cosPitch * 0.4;
  const y = pos[1] + eye - 0.2 + sinPitch * 0.4;
  const z = pos[2] + sinYaw * cosPitch * 0.4;
  particles.spawn(stateId, x, y, z);
}

export function touchesBlock(
  world: World,
  pos: Position,
  height: number,
  blockId: string,
  expand = 0,
): boolean {
  const minX = Math.floor(pos[0] - 0.3 - expand);
  const maxX = Math.floor(pos[0] + 0.3 + expand);
  const minY = Math.floor(pos[1] - expand);
  const maxY = Math.floor(pos[1] + height + expand);
  const minZ = Math.floor(pos[2] - 0.3 - expand);
  const maxZ = Math.floor(pos[2] + 0.3 + expand);

  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (
          pos[0] + 0.3 + expand > x &&
          pos[0] - 0.3 - expand < x + 1 &&
          pos[1] + height + expand > y &&
          pos[1] - expand < y + 1 &&
          pos[2] + 0.3 + expand > z &&
          pos[2] - 0.3 - expand < z + 1
        ) {
          if (world.getBlock(x, y, z).id === blockId) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

export interface SurvivalHost {
  pos: Position;
  yaw: number;
  pitch: number;
  eye: number;
  height: number;
  mode: 'survival' | 'creative';
  inventory: {
    held: { id: string; count: number } | null;
    consumeSelected: () => void;
  };
  down: (action: string) => boolean;
  collision: {
    inWater: (pos: Position, height: number) => boolean;
  };
}

export class Survival {
  private _health: number = MAX_HEALTH;
  get health(): number {
    return this._health;
  }
  set health(val: number) {
    if (val <= 0) {
      this._health = 0;
      this.dead = true;
    } else {
      this._health = Math.min(MAX_HEALTH, val);
      if (this.dead) {
        this.dead = false;
      }
    }
  }
  public hunger: number = MAX_HUNGER;
  public saturation: number = 0;
  public exhaustion: number = 0;
  public air: number = MAX_AIR;
  public burningTicks: number = 0;
  public dead: boolean = false;
  public useConsumed: boolean = false;

  public eatingTicks: number = 0;
  public eatingItemId: string | null = null;
  public isEating: boolean = false;

  public fastRegenTicks: number = 0;
  public slowRegenTicks: number = 0;
  public starvationTicks: number = 0;

  public drowningTicks: number = 0;
  public lavaTicks: number = 0;
  public fireTicks: number = 0;
  public burnDamageTicks: number = 0;
  public cactusTicks: number = 0;
  public suffocationTicks: number = 0;
  public voidTicks: number = 0;

  get isBurning(): boolean {
    return this.burningTicks > 0;
  }

  reset(): void {
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.saturation = 0;
    this.exhaustion = 0;
    this.air = MAX_AIR;
    this.burningTicks = 0;
    this.dead = false;
    this.useConsumed = false;
    this.eatingTicks = 0;
    this.eatingItemId = null;
    this.isEating = false;
    this.fastRegenTicks = 0;
    this.slowRegenTicks = 0;
    this.starvationTicks = 0;
    this.drowningTicks = 0;
    this.lavaTicks = 0;
    this.fireTicks = 0;
    this.burnDamageTicks = 0;
    this.cactusTicks = 0;
    this.suffocationTicks = 0;
    this.voidTicks = 0;
  }

  damage(amount: number, source?: string): void {
    if (this.dead || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    if (source !== 'starvation') {
      this.addExhaustion(0.1);
    }
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
    }
  }

  heal(amount: number): void {
    if (this.dead || amount <= 0) return;
    this.health = Math.min(MAX_HEALTH, this.health + amount);
  }

  addExhaustion(amount: number): void {
    if (this.dead || !Number.isFinite(amount) || amount <= 0) return;
    this.exhaustion += amount;
    while (this.exhaustion >= 4.0) {
      this.exhaustion -= 4.0;
      if (this.saturation > 0) {
        this.saturation = Math.max(0, this.saturation - 1);
      } else {
        this.hunger = Math.max(0, this.hunger - 1);
      }
    }
    this.saturation = Math.min(this.saturation, this.hunger);
  }

  eatFood(foodId: string): boolean {
    if (this.dead || this.hunger >= MAX_HUNGER) return false;
    const def = items.get(foodId);
    if (def.kind !== 'food') return false;
    const hungerVal = def.hunger ?? 0;
    const saturationVal = def.saturation ?? 0;
    this.hunger = Math.min(MAX_HUNGER, this.hunger + hungerVal);
    this.saturation = Math.min(this.hunger, this.saturation + saturationVal);
    return true;
  }

  tickRegenAndStarvation(mode: 'survival' | 'creative' = 'survival'): void {
    if (this.dead || mode !== 'survival') return;

    if (this.health < MAX_HEALTH) {
      if (this.hunger === MAX_HUNGER && this.saturation > 0) {
        this.slowRegenTicks = 0;
        this.fastRegenTicks++;
        if (this.fastRegenTicks >= FAST_REGEN_INTERVAL) {
          this.fastRegenTicks = 0;
          this.health = Math.min(MAX_HEALTH, this.health + 1);
          this.addExhaustion(6.0);
        }
      } else if (this.hunger >= 18) {
        this.fastRegenTicks = 0;
        this.slowRegenTicks++;
        if (this.slowRegenTicks >= SLOW_REGEN_INTERVAL) {
          this.slowRegenTicks = 0;
          this.health = Math.min(MAX_HEALTH, this.health + 1);
          this.addExhaustion(6.0);
        }
      } else {
        this.fastRegenTicks = 0;
        this.slowRegenTicks = 0;
      }
    } else {
      this.fastRegenTicks = 0;
      this.slowRegenTicks = 0;
    }

    if (this.hunger === 0) {
      this.starvationTicks++;
      if (this.starvationTicks >= STARVATION_INTERVAL) {
        this.starvationTicks = 0;
        if (this.health > 1) {
          const dmg = Math.min(STARVATION_DAMAGE, this.health - 1);
          if (dmg > 0) {
            this.damage(dmg, 'starvation');
          }
        }
      }
    } else {
      this.starvationTicks = 0;
    }
  }

  tickHazards(world: World, host: SurvivalHost): void {
    if (this.dead || host.mode !== 'survival') return;

    const [px, py, pz] = host.pos;
    const eyeY = py + host.eye;

    const eyeBlock = world.getBlock(Math.floor(px), Math.floor(eyeY), Math.floor(pz)).id;
    const headInWater = eyeBlock === 'water';
    const bodyInWater = host.collision.inWater(host.pos, host.height) || headInWater;

    // 1. Water drowning
    if (headInWater) {
      if (this.air > 0) {
        this.air = Math.max(0, this.air - 1);
        this.drowningTicks = 0;
      } else {
        this.drowningTicks++;
        if (this.drowningTicks >= DROWNING_INTERVAL) {
          this.drowningTicks = 0;
          this.damage(DROWNING_DAMAGE, 'drowning');
        }
      }
    } else {
      this.air = MAX_AIR;
      this.drowningTicks = 0;
    }

    // 2. Extinguish burning if in water
    if (bodyInWater) {
      this.burningTicks = 0;
      this.burnDamageTicks = 0;
    }

    // 3. Lava contact
    const inLava = touchesBlock(world, host.pos, host.height, 'lava', 0);
    if (inLava) {
      if (!bodyInWater) {
        this.burningTicks = LAVA_BURN_TICKS;
      }
      this.lavaTicks++;
      if (this.lavaTicks >= LAVA_INTERVAL) {
        this.lavaTicks = 0;
        this.damage(LAVA_DAMAGE, 'lava');
      }
    } else {
      this.lavaTicks = 0;
    }

    // 4. Fire block contact
    const inFire = touchesBlock(world, host.pos, host.height, 'fire', 0);
    if (inFire) {
      if (!bodyInWater) {
        this.burningTicks = Math.max(this.burningTicks, FIRE_BURN_TICKS);
      }
      this.fireTicks++;
      if (this.fireTicks >= FIRE_INTERVAL) {
        this.fireTicks = 0;
        this.damage(FIRE_DAMAGE, 'fire');
      }
    } else {
      this.fireTicks = 0;
    }

    // 5. Burning damage (if not in water and not in lava or fire)
    if (!bodyInWater && !inLava && !inFire && this.burningTicks > 0) {
      this.burningTicks--;
      this.burnDamageTicks++;
      if (this.burnDamageTicks >= BURNING_INTERVAL) {
        this.burnDamageTicks = 0;
        this.damage(BURNING_DAMAGE, 'burning');
      }
    } else if (inLava || inFire) {
      this.burnDamageTicks = 0;
    } else {
      this.burnDamageTicks = 0;
    }

    // 6. Cactus contact (touching AABB)
    const inCactus = touchesBlock(world, host.pos, host.height, 'cactus', 0.02);
    if (inCactus) {
      this.cactusTicks++;
      if (this.cactusTicks >= CACTUS_INTERVAL) {
        this.cactusTicks = 0;
        this.damage(CACTUS_DAMAGE, 'cactus');
      }
    } else {
      this.cactusTicks = 0;
    }

    // 7. Suffocation (eye inside full opaque block)
    const eyeState = world.getBlockStateId(Math.floor(px), Math.floor(eyeY), Math.floor(pz));
    const resolved = BlockRegistry.getInstance().getResolvedState(eyeState);
    const inSuffocation = resolved?.definition.fullOpaqueCube === true;
    if (inSuffocation) {
      this.suffocationTicks++;
      if (this.suffocationTicks >= SUFFOCATION_INTERVAL) {
        this.suffocationTicks = 0;
        this.damage(SUFFOCATION_DAMAGE, 'suffocation');
      }
    } else {
      this.suffocationTicks = 0;
    }

    // 8. Void damage (y < -64)
    if (py < -64) {
      this.voidTicks++;
      if (this.voidTicks >= VOID_INTERVAL) {
        this.voidTicks = 0;
        this.damage(VOID_DAMAGE, 'void');
      }
    } else {
      this.voidTicks = 0;
    }
  }

  tickEating(host: SurvivalHost, particles: BreakParticles | null): void {
    if (!host.down('use')) {
      this.useConsumed = false;
    }
    if (this.dead || host.mode !== 'survival') {
      this.isEating = false;
      this.eatingTicks = 0;
      this.eatingItemId = null;
      return;
    }

    const held = host.inventory.held;
    const itemDef = held ? items.items.get(held.id) : undefined;
    const canEat =
      host.down('use') &&
      !this.useConsumed &&
      this.hunger < MAX_HUNGER &&
      itemDef !== undefined &&
      itemDef.kind === 'food';

    if (canEat && held) {
      if (this.eatingItemId !== held.id) {
        this.eatingItemId = held.id;
        this.eatingTicks = 0;
      }
      this.isEating = true;
      this.eatingTicks++;

      if (particles && (this.eatingTicks % 4 === 0 || this.eatingTicks === EATING_DURATION_TICKS)) {
        spawnFoodCrumbs(particles, held.id, host.pos, host.yaw, host.pitch, host.eye);
      }

      if (this.eatingTicks >= EATING_DURATION_TICKS) {
        this.eatFood(held.id);
        host.inventory.consumeSelected();
        this.eatingTicks = 0;
        this.eatingItemId = null;
        this.isEating = false;
      }
    } else {
      this.isEating = false;
      this.eatingTicks = 0;
      this.eatingItemId = null;
    }
  }

  tick(world: World, host: SurvivalHost, particles: BreakParticles | null = null): void {
    if (this.dead) return;
    this.saturation = Math.min(this.saturation, this.hunger);
    this.tickRegenAndStarvation(host.mode);
    this.tickHazards(world, host);
    this.tickEating(host, particles);
  }
}
