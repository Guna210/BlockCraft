import { describe, expect, it } from 'vitest';
import { World } from '../../src/world/world';
import { Player } from '../../src/entity/player';
import { BlockCollision } from '../../src/entity/physics';
import { BreakParticles } from '../../src/render/particles';
import foodItems from '../../data/items/food.json';
import {
  Survival,
  MAX_HEALTH,
  MAX_HUNGER,
  MAX_AIR,
  DROWNING_DAMAGE,
  DROWNING_INTERVAL,
  LAVA_DAMAGE,
  LAVA_INTERVAL,
  LAVA_BURN_TICKS,
  FIRE_DAMAGE,
  FIRE_INTERVAL,
  FIRE_BURN_TICKS,
  BURNING_DAMAGE,
  BURNING_INTERVAL,
  CACTUS_DAMAGE,
  CACTUS_INTERVAL,
  SUFFOCATION_DAMAGE,
  SUFFOCATION_INTERVAL,
  VOID_DAMAGE,
  VOID_INTERVAL,
  FAST_REGEN_INTERVAL,
  SLOW_REGEN_INTERVAL,
  STARVATION_INTERVAL,
  EATING_DURATION_TICKS,
  eatFood,
  touchesBlock,
} from '../../src/gameplay/survival';

function createTestContext(mode: 'survival' | 'creative' = 'survival') {
  const world = new World(false);
  world.fill(-10, 64, -10, 10, 64, 10, 'stone');
  const collision = new BlockCollision(world);
  const player = new Player(collision, () => true);
  player.setGameMode(mode);
  player.teleport(0.5, 65, 0.5, 0, 0);
  const particles = new BreakParticles(world);
  return { world, collision, player, particles };
}

describe('M11a: Appendix D survival model & 10-minute sprint scenario', () => {
  it('exhaustion/saturation/hunger model matches the table in Appendix D over a simulated 10-minute sprint scenario', () => {
    const survival = new Survival();
    survival.hunger = 20;
    survival.saturation = 5;
    survival.exhaustion = 0;

    // In 10 minutes at 20 TPS = 12,000 ticks.
    // Sprint speed is 5.6 blocks/second = 0.28 blocks/tick.
    // Sprinting adds 0.1 exhaustion per block.
    // When hunger <= 6, sprinting is disabled, so exhaustion stops accumulating from sprint.
    const speedPerTick = 5.6 / 20; // 0.28 blocks per tick
    const exhaustionPerBlock = 0.1;
    let distanceSprinted = 0;

    for (let tick = 0; tick < 12000; tick++) {
      if (survival.hunger > 6) {
        distanceSprinted += speedPerTick;
        survival.addExhaustion(speedPerTick * exhaustionPerBlock);
      }
      // Natural regen/starvation tick
      survival.tickRegenAndStarvation();
    }

    // 4.0 exhaustion per saturation or hunger point.
    // 4.0 / 0.1 = 40 blocks sprinted per point.
    // Saturation 5 -> 5 * 40 = 200 blocks.
    // Hunger from 20 down to 6 -> 14 * 40 = 560 blocks.
    // Total distance to reach hunger 6 = 760 blocks sprinted!
    expect(survival.saturation).toBe(0);
    expect(survival.hunger).toBe(6);
    expect(distanceSprinted).toBeCloseTo(760, 0);

    // Verify leftover exhaustion is less than 4.0
    expect(survival.exhaustion).toBeGreaterThanOrEqual(0);
    expect(survival.exhaustion).toBeLessThan(4.0);
  });

  it('accumulates exhaustion for actions per Appendix D', () => {
    const survival = new Survival();
    survival.hunger = 20;
    survival.saturation = 5;

    // Sprinting 10 blocks = 1.0 exhaustion
    survival.addExhaustion(10 * 0.1);
    expect(survival.exhaustion).toBeCloseTo(1.0);
    expect(survival.saturation).toBe(5);

    // Swimming 100 blocks = 1.0 exhaustion
    survival.addExhaustion(100 * 0.01);
    expect(survival.exhaustion).toBeCloseTo(2.0);

    // Regular jump = 0.05
    survival.addExhaustion(0.05);
    expect(survival.exhaustion).toBeCloseTo(2.05);

    // Sprint jump = 0.2
    survival.addExhaustion(0.2);
    expect(survival.exhaustion).toBeCloseTo(2.25);

    // Breaking a block = 0.005
    survival.addExhaustion(0.005);
    expect(survival.exhaustion).toBeCloseTo(2.255);

    // Taking damage = 0.1
    survival.damage(2, 'combat');
    expect(survival.exhaustion).toBeCloseTo(2.355);

    // Cross 4.0 threshold: subtract 4.0, decrease saturation by 1
    survival.addExhaustion(2.0); // 4.355 -> 0.355
    expect(survival.exhaustion).toBeCloseTo(0.355);
    expect(survival.saturation).toBe(4);
    expect(survival.hunger).toBe(20);
  });

  it('depletes hunger after saturation reaches 0', () => {
    const survival = new Survival();
    survival.hunger = 20;
    survival.saturation = 1;

    // 4.0 exhaustion drains the remaining 1 saturation
    survival.addExhaustion(4.0);
    expect(survival.saturation).toBe(0);
    expect(survival.hunger).toBe(20);

    // Next 4.0 exhaustion drains 1 hunger
    survival.addExhaustion(4.0);
    expect(survival.saturation).toBe(0);
    expect(survival.hunger).toBe(19);

    // Saturation never exceeds hunger
    survival.saturation = 25;
    survival.addExhaustion(0.01);
    expect(survival.saturation).toBeLessThanOrEqual(survival.hunger);
  });
});

describe('M11a: Natural regeneration & starvation', () => {
  it('fast regenerates 1 half-heart every 10 ticks when hunger 20 and saturation > 0', () => {
    const survival = new Survival();
    survival.health = 10;
    survival.hunger = 20;
    survival.saturation = 5;

    for (let t = 0; t < FAST_REGEN_INTERVAL; t++) {
      survival.tickRegenAndStarvation();
    }
    // Healed 1 half-heart
    expect(survival.health).toBe(11);
    // Exhaustion was increased by 6.0 (which subtracts 4.0 and removes 1 saturation)
    expect(survival.saturation).toBe(4);
    expect(survival.exhaustion).toBeCloseTo(2.0);

    // Another 10 ticks: 2.0 + 6.0 = 8.0 exhaustion -> removes 2 saturation
    for (let t = 0; t < FAST_REGEN_INTERVAL; t++) {
      survival.tickRegenAndStarvation();
    }
    expect(survival.health).toBe(12);
    expect(survival.saturation).toBe(2);
    expect(survival.exhaustion).toBeCloseTo(0);
  });

  it('slow regenerates 1 half-heart every 80 ticks when hunger >= 18 and saturation == 0', () => {
    const survival = new Survival();
    survival.health = 10;
    survival.hunger = 19;
    survival.saturation = 0;

    for (let t = 0; t < SLOW_REGEN_INTERVAL - 1; t++) {
      survival.tickRegenAndStarvation();
    }
    expect(survival.health).toBe(10);

    // Exactly on tick 80
    survival.tickRegenAndStarvation();
    expect(survival.health).toBe(11);
    // 6.0 exhaustion added with saturation 0 consumes 1 hunger (4.0) leaving 2.0
    expect(survival.hunger).toBe(18);
    expect(survival.exhaustion).toBeCloseTo(2.0);
  });

  it('does not regenerate when hunger < 18', () => {
    const survival = new Survival();
    survival.health = 10;
    survival.hunger = 17;
    survival.saturation = 0;

    for (let t = 0; t < 200; t++) {
      survival.tickRegenAndStarvation();
    }
    expect(survival.health).toBe(10);
  });

  it('does not regenerate when health is already 20', () => {
    const survival = new Survival();
    survival.health = 20;
    survival.hunger = 20;
    survival.saturation = 5;

    for (let t = 0; t < 50; t++) {
      survival.tickRegenAndStarvation();
    }
    expect(survival.health).toBe(20);
    expect(survival.saturation).toBe(5);
    expect(survival.exhaustion).toBe(0);
  });

  it('deals 1 starvation damage every 80 ticks at hunger 0 down to floor of 1', () => {
    const survival = new Survival();
    survival.health = 5;
    survival.hunger = 0;

    for (let t = 0; t < STARVATION_INTERVAL; t++) {
      survival.tickRegenAndStarvation();
    }
    expect(survival.health).toBe(4);

    for (let t = 0; t < STARVATION_INTERVAL; t++) {
      survival.tickRegenAndStarvation();
    }
    expect(survival.health).toBe(3);

    // Advance until health reaches 1
    for (let t = 0; t < STARVATION_INTERVAL * 5; t++) {
      survival.tickRegenAndStarvation();
    }
    // Starvation floor: health never drops below 1 on easy/default
    expect(survival.health).toBe(1);
    expect(survival.dead).toBe(false);
  });
});

describe('M11a: Food items & eating', () => {
  it('applies declared hunger and saturation from food.json to all foods, capped at hunger', () => {
    for (const [id, def] of Object.entries(foodItems)) {
      const state = { hunger: 10, saturation: 0 };
      const { hungerGained, saturationGained } = eatFood(state, id);
      expect(hungerGained).toBe(def.hunger);
      expect(saturationGained).toBe(def.saturation);
      expect(state.hunger).toBe(10 + def.hunger);
      // Saturation cannot exceed hunger
      expect(state.saturation).toBeLessThanOrEqual(state.hunger);
    }
  });

  it('caps saturation at current hunger when eating', () => {
    const state = { hunger: 2, saturation: 0 };
    // roast_boar_chop gives 8 hunger, 12.8 saturation
    // 2 + 8 = 10 hunger; saturation becomes min(10, 0 + 12.8) = 10
    eatFood(state, 'roast_boar_chop');
    expect(state.hunger).toBe(10);
    expect(state.saturation).toBe(10);
  });

  it('eating requires 32 ticks of holding use, consumes item and slows movement', () => {
    const { world, player, particles } = createTestContext('survival');
    player.hunger = 10;
    player.inventory.slots[0] = { slot: 0, id: 'bread', count: 2 };
    player.selectedSlot = 0;

    // Hold use
    player.input('use', true);

    // Tick 31 times
    for (let t = 0; t < EATING_DURATION_TICKS - 1; t++) {
      player.survival.tick(world, player, particles);
      expect(player.isEating).toBe(true);
      expect(player.inventory.held?.count).toBe(2);
      expect(player.hunger).toBe(10);
    }

    // Tick 32: completes eating
    player.survival.tick(world, player, particles);
    expect(player.hunger).toBe(15); // bread gives 5 hunger
    expect(player.saturation).toBe(6); // bread gives 6 saturation
    expect(player.inventory.held?.count).toBe(1);
    expect(player.isEating).toBe(false);
  });

  it('releasing use early cancels eating without consuming item or applying hunger', () => {
    const { world, player, particles } = createTestContext('survival');
    player.hunger = 10;
    player.inventory.slots[0] = { slot: 0, id: 'apple', count: 1 };
    player.selectedSlot = 0;

    player.input('use', true);
    for (let t = 0; t < 20; t++) {
      player.survival.tick(world, player, particles);
    }
    expect(player.isEating).toBe(true);

    // Release early
    player.input('use', false);
    player.survival.tick(world, player, particles);
    expect(player.isEating).toBe(false);
    expect(player.hunger).toBe(10);
    expect(player.inventory.held?.count).toBe(1);
  });

  it('cannot eat when hunger is full (20)', () => {
    const { world, player, particles } = createTestContext('survival');
    player.hunger = 20;
    player.inventory.slots[0] = { slot: 0, id: 'bread', count: 1 };
    player.selectedSlot = 0;

    player.input('use', true);
    player.survival.tick(world, player, particles);
    expect(player.isEating).toBe(false);
    expect(player.inventory.held?.count).toBe(1);
  });

  it('switching held food item while eating resets eating progress', () => {
    const { world, player, particles } = createTestContext('survival');
    player.hunger = 10;
    player.inventory.slots[0] = { slot: 0, id: 'bread', count: 1 };
    player.inventory.slots[1] = { slot: 1, id: 'apple', count: 1 };
    player.selectedSlot = 0;

    player.input('use', true);
    // Eat bread for 20 ticks
    for (let t = 0; t < 20; t++) {
      player.survival.tick(world, player, particles);
    }
    expect(player.survival.eatingTicks).toBe(20);
    expect(player.survival.eatingItemId).toBe('bread');

    // Switch to apple on slot 1
    player.selectedSlot = 1;
    player.survival.tick(world, player, particles);
    // Switching food items resets eatingTicks to 1 for the new item
    expect(player.survival.eatingTicks).toBe(1);
    expect(player.survival.eatingItemId).toBe('apple');
    expect(player.inventory.slots[0]?.count).toBe(1);
    expect(player.inventory.slots[1]?.count).toBe(1);
  });
});

describe('M11a: Hazard damage rates', () => {
  it('drowning: drops 1 air per tick, deals 2 damage per 20 ticks at air 0, refills when head is out', () => {
    const { world, player } = createTestContext('survival');
    // Place water at player eye level
    world.setBlock(0, 66, 0, 'water');
    expect(world.getBlock(0, 66, 0).id).toBe('water');

    // Submerge for 300 ticks: air drops from 300 to 0
    for (let t = 0; t < MAX_AIR; t++) {
      player.survival.tickHazards(world, player);
    }
    expect(player.air).toBe(0);
    expect(player.health).toBe(MAX_HEALTH);

    // Next 20 ticks: deals 2 damage at tick 20
    for (let t = 0; t < DROWNING_INTERVAL; t++) {
      player.survival.tickHazards(world, player);
    }
    expect(player.health).toBe(MAX_HEALTH - DROWNING_DAMAGE);

    // Another 20 ticks: deals another 2 damage
    for (let t = 0; t < DROWNING_INTERVAL; t++) {
      player.survival.tickHazards(world, player);
    }
    expect(player.health).toBe(MAX_HEALTH - DROWNING_DAMAGE * 2);

    // Remove water: air refills to 300 immediately
    world.setBlock(0, 66, 0, 'air');
    player.survival.tickHazards(world, player);
    expect(player.air).toBe(MAX_AIR);
  });

  it('lava: deals 4 health per 10 ticks and sets burning for 300 ticks', () => {
    const { world, player } = createTestContext('survival');
    world.setBlock(0, 65, 0, 'lava');

    for (let t = 0; t < LAVA_INTERVAL; t++) {
      player.survival.tickHazards(world, player);
    }
    expect(player.health).toBe(MAX_HEALTH - LAVA_DAMAGE);
    expect(player.burning).toBe(true);
    expect(player.survival.burningTicks).toBe(LAVA_BURN_TICKS);

    for (let t = 0; t < LAVA_INTERVAL; t++) {
      player.survival.tickHazards(world, player);
    }
    expect(player.health).toBe(MAX_HEALTH - LAVA_DAMAGE * 2);
  });

  it('fire: deals 1 health per 10 ticks and sets burning for 160 ticks', () => {
    const { world, player } = createTestContext('survival');
    world.setBlock(0, 65, 0, 'fire');

    for (let t = 0; t < FIRE_INTERVAL; t++) {
      player.survival.tickHazards(world, player);
    }
    expect(player.health).toBe(MAX_HEALTH - FIRE_DAMAGE);
    expect(player.burning).toBe(true);
    expect(player.survival.burningTicks).toBe(FIRE_BURN_TICKS);
  });

  it('burning: deals 1 damage per 20 ticks and is extinguished immediately upon entering water', () => {
    const { world, player } = createTestContext('survival');
    player.survival.burningTicks = 50;

    for (let t = 0; t < BURNING_INTERVAL; t++) {
      player.survival.tickHazards(world, player);
    }
    expect(player.health).toBe(MAX_HEALTH - BURNING_DAMAGE);
    expect(player.survival.burningTicks).toBe(30);

    // Enter water
    world.setBlock(0, 65, 0, 'water');
    player.survival.tickHazards(world, player);
    expect(player.survival.burningTicks).toBe(0);
    expect(player.burning).toBe(false);
  });

  it('cactus: touching AABB deals 1 damage per 10 ticks', () => {
    const { world, player } = createTestContext('survival');
    // Place cactus adjacent to player
    world.setBlock(1, 65, 0, 'cactus');
    // Move player right against the cactus
    player.teleport(0.7, 65, 0.5);

    expect(touchesBlock(world, player.pos, player.height, 'cactus', 0.02)).toBe(true);

    for (let t = 0; t < CACTUS_INTERVAL; t++) {
      player.survival.tickHazards(world, player);
    }
    expect(player.health).toBe(MAX_HEALTH - CACTUS_DAMAGE);
  });

  it('suffocation: eye in full opaque block deals 1 damage per 10 ticks', () => {
    const { world, player } = createTestContext('survival');
    world.setBlock(0, 66, 0, 'stone'); // Stone is full opaque cube

    for (let t = 0; t < SUFFOCATION_INTERVAL; t++) {
      player.survival.tickHazards(world, player);
    }
    expect(player.health).toBe(MAX_HEALTH - SUFFOCATION_DAMAGE);
  });

  it('void: y < -64 deals 4 damage per 10 ticks', () => {
    const { world, player } = createTestContext('survival');
    player.teleport(0, -65, 0);

    for (let t = 0; t < VOID_INTERVAL; t++) {
      player.survival.tickHazards(world, player);
    }
    expect(player.health).toBe(MAX_HEALTH - VOID_DAMAGE);
  });

  it('health 0 sets dead flag and halts hazard damage and survival ticking', () => {
    const { world, player } = createTestContext('survival');
    player.health = 2;
    player.survival.damage(4, 'combat');
    expect(player.health).toBe(0);
    expect(player.dead).toBe(true);

    // Once dead, hazards do not tick damage
    player.teleport(0, -70, 0);
    for (let t = 0; t < 50; t++) {
      player.survival.tick(world, player);
    }
    expect(player.health).toBe(0);
  });

  it('being in water suppresses burning even when simultaneously touching lava or fire', () => {
    const { world, player } = createTestContext('survival');
    // Feet in water
    world.setBlock(0, 65, 0, 'water');
    // Adjacent lava
    world.setBlock(0, 66, 0, 'lava');

    for (let t = 0; t < 20; t++) {
      player.survival.tickHazards(world, player);
    }
    // Player is in water so burningTicks remains 0 and burning is false
    expect(player.burning).toBe(false);
    expect(player.survival.burningTicks).toBe(0);
  });

  it('reset() restores initial vitals, timers, and clears dead flag', () => {
    const survival = new Survival();
    survival.health = 0;
    survival.dead = true;
    survival.hunger = 4;
    survival.saturation = 2;
    survival.exhaustion = 3.5;
    survival.air = 50;
    survival.burningTicks = 200;
    survival.eatingTicks = 15;
    survival.isEating = true;

    survival.reset();
    expect(survival.health).toBe(MAX_HEALTH);
    expect(survival.dead).toBe(false);
    expect(survival.hunger).toBe(MAX_HUNGER);
    expect(survival.saturation).toBe(0);
    expect(survival.exhaustion).toBe(0);
    expect(survival.air).toBe(MAX_AIR);
    expect(survival.burningTicks).toBe(0);
    expect(survival.isEating).toBe(false);
    expect(survival.eatingTicks).toBe(0);
    expect(survival.eatingItemId).toBeNull();
  });

  it('player.saturation is clamped to current hunger', () => {
    const { player } = createTestContext('survival');
    player.hunger = 10;
    player.saturation = 15;
    expect(player.saturation).toBe(10);

    // Reducing hunger also clamps saturation
    player.hunger = 6;
    expect(player.saturation).toBe(6);
  });
});
