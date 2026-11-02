import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/entity/mobs';
import { World } from '../../src/world/world';
import { BlockCollision } from '../../src/entity/physics';
import { Player } from '../../src/entity/player';
import { deriveSeed } from '../../src/engine/rng';
import { hollowdeepHeights } from '../../src/gen/hollowdeep/shape';
import {
  UPDRAFT_CELL,
  UPDRAFT_GRAVITY,
  UPDRAFT_MAX_Y,
  UPDRAFT_MIN_Y,
  UpdraftField,
  clearUpdraftField,
  gravityFactor,
  setUpdraftField,
  updraftField,
  type UpdraftZone,
} from '../../src/world/updrafts';
import { setWorldDimension, worldDimension } from '../../src/world/world-dimension';
import { ItemEntityManager } from '../../src/entity/item-entity';
import { BlastCharges, PrimedChargeC } from '../../src/entity/blast-charge';
import { createEntityWorld } from '../../src/entity/ecs/systems';
import { HealthC, TransformC } from '../../src/entity/ecs/components';
import { BreakParticles } from '../../src/render/particles';
import { moveMob } from '../../src/entity/ai/movement';
import {
  FLIGHT_MAX_PATH,
  FLIGHT_NODE_BUDGET,
  FlightPath,
  FlightPathfinder,
} from '../../src/entity/ai/flight-path';
import {
  GLOWWING,
  GLOWWING_DEFINITION,
  GLOWWING_REPLAN_DISTANCE,
  GlowwingC,
  flightPathfinder,
} from '../../src/entity/mobs/glowwing';
import {
  MAGMAW,
  MAGMAW_BURN_TICKS,
  MAGMAW_DEFINITION,
  MAGMAW_LUNGE_RANGE,
  MagmawC,
  isLava,
} from '../../src/entity/mobs/magmaw';
import { glowwingSpot, magmawSpot } from '../../src/entity/mobs/hollowdeep-spawn-rules';
import { MOB_CAPS, MobSpawner, spawnRules, spawnRulesFor } from '../../src/entity/spawning';
import { EntityKindC } from '../../src/entity/ecs/components';
import { MobBodyC, type MobBody } from '../../src/entity/ai/components';
import { creatureTypeIds } from '../../src/entity/mobs/creature';
import {
  NIGHT_VISION_TICKS,
  NIGHT_VISION_FOOD,
  NIGHT_VISION_FLOOR,
} from '../../src/gameplay/survival';
import {
  applyPlayerData,
  deserializePlayerData,
  serializePlayerData,
} from '../../src/persist/serializers';
import { match } from '../../src/gameplay/crafting';
import { items } from '../../src/gameplay/items';
import { soundLibrary } from '../../src/audio/recipes';
import { getMood } from '../../src/audio/music/moods';
import { GROUND, flatWorld, run, scene } from './helpers/m13c-mobs';
import type { Vec3 } from '../../src/entity/ecs/model';

const SEED = 20251;
let zoneCache: UpdraftZone | null = null;
/** An Updraft of SEED, found once. */
function zone(): UpdraftZone {
  zoneCache ??= new UpdraftField(SEED).nearest(0, 0, 4000);
  expect(zoneCache, 'an Updraft within 4000 blocks').not.toBeNull();
  return zoneCache!;
}
/** A world holding SEED's Updraft field, with a stone pad at y 99 around the zone centre. */
function updraftWorld(): { world: World; z: UpdraftZone } {
  const z = zone();
  const world = new World(false);
  const x0 = Math.floor(z.x),
    z0 = Math.floor(z.z);
  world.fill(x0 - 20, 99, z0 - 20, x0 + 20, 99, z0 + 20, 'stone');
  setUpdraftField(world, new UpdraftField(SEED));
  return { world, z };
}

afterEach(() => vi.restoreAllMocks());

describe('M20c Updraft field', () => {
  it('is a deterministic function of the seed, independent of query order', () => {
    const a = new UpdraftField(SEED),
      b = new UpdraftField(SEED),
      other = new UpdraftField(SEED + 1);
    const samples: Array<[number, number, number]> = [];
    for (let i = 0; i < 4000; i++)
      samples.push([((i * 7919) % 6000) - 3000, 60 + (i % 100), ((i * 104729) % 6000) - 3000]);
    const first = samples.map(([x, y, z]) => a.contains(x, y, z));
    // Query b in reverse, after thrashing its cache with far-away cells.
    for (let i = 0; i < 3000; i++) b.contains(i * 97, 100, -i * 89);
    const second = samples
      .slice()
      .reverse()
      .map(([x, y, z]) => b.contains(x, y, z))
      .reverse();
    expect(second).toEqual(first);
    const zoneA: UpdraftZone = { x: 0, z: 0, radius: 0 },
      zoneB: UpdraftZone = { x: 0, z: 0, radius: 0 };
    let differs = 0;
    for (let gx = -20; gx < 20; gx++)
      for (let gz = -20; gz < 20; gz++) {
        const hasA = a.zoneOfCell(gx, gz, zoneA);
        const hasB = other.zoneOfCell(gx, gz, zoneB);
        if (hasA !== hasB || (hasA && (zoneA.x !== zoneB.x || zoneA.z !== zoneB.z))) differs++;
      }
    expect(differs).toBeGreaterThan(0);
  });

  it('places every zone inside its own cell over a Driftstone Expanse chasm, between the sea and the roof', () => {
    const field = new UpdraftField(SEED);
    const heights = hollowdeepHeights(deriveSeed(SEED, 'hollowdeep:shape'));
    const out: UpdraftZone = { x: 0, z: 0, radius: 0 };
    let zones = 0;
    for (let gx = -21; gx < 21; gx++)
      for (let gz = -21; gz < 21; gz++) {
        if (!field.zoneOfCell(gx, gz, out)) continue;
        zones++;
        expect(out.radius).toBeGreaterThanOrEqual(5);
        expect(out.radius).toBeLessThanOrEqual(9);
        expect(out.x - out.radius).toBeGreaterThanOrEqual(gx * UPDRAFT_CELL);
        expect(out.x + out.radius).toBeLessThan((gx + 1) * UPDRAFT_CELL);
        expect(out.z - out.radius).toBeGreaterThanOrEqual(gz * UPDRAFT_CELL);
        expect(out.z + out.radius).toBeLessThan((gz + 1) * UPDRAFT_CELL);
        expect(heights(Math.floor(out.x), Math.floor(out.z)).floor).toBeLessThan(32);
        expect(field.contains(out.x, 100, out.z)).toBe(true);
        expect(field.contains(out.x + out.radius - 0.1, 100, out.z)).toBe(true);
        expect(field.contains(out.x + out.radius + 0.1, 100, out.z)).toBe(false);
        expect(field.contains(out.x, UPDRAFT_MIN_Y - 0.5, out.z)).toBe(false);
        expect(field.contains(out.x, UPDRAFT_MAX_Y + 0.5, out.z)).toBe(false);
      }
    console.log('M20c Updraft zones in 2016×2016', zones);
    expect(zones).toBeGreaterThan(3);
  });

  it('answers 1 for every world without a field, including the Overworld, and 40 % inside a zone', () => {
    const { world, z } = updraftWorld();
    const overworld = new World(false);
    expect(updraftField(world)).not.toBeNull();
    expect(updraftField(overworld)).toBeNull();
    expect(gravityFactor(overworld, z.x, 100, z.z)).toBe(1);
    expect(gravityFactor(world, z.x, 100, z.z)).toBe(UPDRAFT_GRAVITY);
    expect(gravityFactor(world, z.x + z.radius + 2, 100, z.z)).toBe(1);
    expect(worldDimension(overworld)).toBe('overworld');
    setWorldDimension(world, 'hollowdeep');
    expect(worldDimension(world)).toBe('hollowdeep');
    setUpdraftField(overworld, null); // removing another world's field is a no-op
    expect(updraftField(world)).not.toBeNull();
    setUpdraftField(world, null);
    expect(gravityFactor(world, z.x, 100, z.z)).toBe(1);
  });

  it('clearUpdraftField drops the field whichever world holds it', () => {
    const { world, z } = updraftWorld();
    expect(updraftField(world)).not.toBeNull();
    clearUpdraftField();
    expect(updraftField(world)).toBeNull();
    expect(gravityFactor(world, z.x, 100, z.z)).toBe(1);
  });
});

describe('M20c shared gravity factor', () => {
  function jumpApex(world: World, x: number, z: number): number {
    const player = new Player(new BlockCollision(world), () => true);
    player.teleport(x, 100, z, 0, 0);
    for (let i = 0; i < 5; i++) player.tick();
    const base = player.pos[1];
    player.input('jump', true);
    player.tick();
    player.input('jump', false);
    let apex = base;
    for (let i = 0; i < 100; i++) {
      player.tick();
      apex = Math.max(apex, player.pos[1]);
    }
    expect(player.pos[1]).toBeCloseTo(base, 3);
    return apex - base;
  }

  it('lets the player jump at least twice as high inside an Updraft', () => {
    const { world, z } = updraftWorld();
    const inside = jumpApex(world, z.x, z.z);
    const outside = jumpApex(world, Math.floor(z.x) + 19.5, Math.floor(z.z) + 19.5);
    console.log('M20c jump apex inside/outside', inside.toFixed(3), outside.toFixed(3));
    expect(outside).toBeGreaterThan(1.1);
    expect(outside).toBeLessThan(1.4);
    expect(inside / outside).toBeGreaterThanOrEqual(2);
  });

  it('slows the fall of mobs, item entities and Blast Charges by the same factor', () => {
    const { world, z } = updraftWorld();
    const collision = new BlockCollision(world);
    const fall = (x: number, zz: number): number => {
      const transform = {
        pos: [x, 130, zz] as Vec3,
        previous: [x, 130, zz] as Vec3,
        yaw: 0,
        previousYaw: 0,
      };
      const body: MobBody = {
        speed: 0.1,
        flying: false,
        climbing: false,
        vel: [0, 0, 0],
        onGround: false,
        inFluid: false,
        horizontalCollision: false,
        wish: [0, 0, 0],
        jump: false,
        climb: false,
      };
      for (let i = 0; i < 10; i++) moveMob(collision, transform, { width: 0.6, height: 1.8 }, body);
      return 130 - transform.pos[1];
    };
    const mobIn = fall(z.x, z.z),
      mobOut = fall(Math.floor(z.x) + 19.5, Math.floor(z.z) + 19.5);
    expect(mobIn / mobOut).toBeCloseTo(UPDRAFT_GRAVITY, 1);

    const items = new ItemEntityManager(world);
    const player = new Player(collision, () => true);
    player.teleport(z.x + 300, 100, z.z, 0, 0);
    const still = { velocity: [0, 0, 0] as [number, number, number], pickupDelay: 40 };
    const inside = items.spawn('stick', 1, z.x, 130, z.z, still)!;
    const outside = items.spawn('stick', 1, Math.floor(z.x) + 19.5, 130, Math.floor(z.z) + 19.5, {
      ...still,
      velocity: [0, 0, 0],
    })!;
    for (let i = 0; i < 10; i++) items.tick(player);
    expect((130 - inside.pos[1]) / (130 - outside.pos[1])).toBeCloseTo(UPDRAFT_GRAVITY, 1);

    const ecs = createEntityWorld();
    const charges = new BlastCharges(
      world,
      ecs,
      { world, ecs, player: () => null } as never,
      new BreakParticles(world),
      () => {},
    );
    const cx = Math.floor(z.x),
      cz = Math.floor(z.z);
    world.setBlock(cx, 140, cz, 'blast_charge');
    world.setBlock(cx + 19, 140, cz + 19, 'blast_charge');
    const a = charges.prime(cx, 140, cz)!,
      b = charges.prime(cx + 19, 140, cz + 19)!;
    for (let i = 0; i < 10; i++) ecs.tick();
    const va = ecs.get(a, PrimedChargeC)!.vel[1],
      vb = ecs.get(b, PrimedChargeC)!.vel[1];
    // Both start at +0.12 per tick and lose 0.04 × factor each tick (less a little drag).
    expect((0.12 - va) / (0.12 - vb)).toBeCloseTo(UPDRAFT_GRAVITY, 1);
    expect(ecs.get(a, TransformC)!.pos[1]).toBeGreaterThan(ecs.get(b, TransformC)!.pos[1]);
    charges.dispose();
    setUpdraftField(world, null);
  });
});

/** Air everywhere except a wall at x = 5 (y 0–30, z -30–30) with an opening above it. */
const wallAir = (x: number, y: number, z: number): boolean =>
  !(x === 5 && y >= -30 && y <= 6 && z >= -30 && z <= 30);

describe('M20c flight pathfinding', () => {
  it('finishes a long search over several ticks within the per-tick node budget', () => {
    const air = vi.fn(wallAir);
    const finder = new FlightPathfinder(air);
    const path = new FlightPath();
    finder.request(path, 0, 0, 0, 10, 0, 0);
    let ticks = 0;
    while (path.status === 'pending' && ticks < 200) {
      finder.tick(ticks++);
      expect(finder.lastExpansions).toBeLessThanOrEqual(FLIGHT_NODE_BUDGET);
      // A second call in the same tick does no work.
      finder.tick(ticks - 1);
    }
    expect(path.status).toBe('ready');
    expect(ticks).toBeGreaterThan(1);
    expect(finder.searches).toBe(1);
    expect(path.length).toBeGreaterThan(1);
    expect(path.length).toBeLessThanOrEqual(FLIGHT_MAX_PATH);
    // Every waypoint is air, and consecutive ones are face neighbours, going over the wall.
    let top = -Infinity;
    for (let i = 0; i < path.length; i++) {
      const x = path.cells[i * 3]!,
        y = path.cells[i * 3 + 1]!,
        z = path.cells[i * 3 + 2]!;
      expect(wallAir(x, y, z)).toBe(true);
      top = Math.max(top, y);
      if (i > 0) {
        const d =
          Math.abs(x - path.cells[i * 3 - 3]!) +
          Math.abs(y - path.cells[i * 3 - 2]!) +
          Math.abs(z - path.cells[i * 3 - 1]!);
        expect(d).toBe(1);
      }
    }
    expect(top).toBeGreaterThan(6);
    expect(path.cells[0]).toBe(0);
  });

  it('shares one budget between flyers and ignores repeat requests while pending', () => {
    const finder = new FlightPathfinder(wallAir);
    const paths = [new FlightPath(), new FlightPath(), new FlightPath()];
    for (const p of paths) finder.request(p, 0, 0, 0, 10, 0, 3);
    finder.request(paths[0]!, 0, 0, 0, 10, 0, 3);
    expect(paths[0]!.plans).toBe(1);
    expect(finder.pending).toBe(3);
    for (let t = 0; t < 400 && paths.some((p) => p.status === 'pending'); t++) {
      finder.tick(t);
      expect(finder.lastExpansions).toBeLessThanOrEqual(FLIGHT_NODE_BUDGET);
    }
    expect(paths.every((p) => p.status === 'ready')).toBe(true);
    expect(finder.searches).toBe(3);
  });

  it('gives up on unreachable goals without exceeding the budget', () => {
    // A sealed box of air around the start.
    const finder = new FlightPathfinder(
      (x, y, z) => Math.abs(x) <= 2 && Math.abs(y) <= 2 && Math.abs(z) <= 2,
    );
    const path = new FlightPath();
    finder.request(path, 0, 0, 0, 15, 0, 0);
    for (let t = 0; t < 10; t++) finder.tick(t);
    // Partial path to the box wall nearest the goal, which is closer by more than a block.
    expect(path.status).toBe('ready');
    expect(path.cells[(path.length - 1) * 3]).toBe(2);
    const sealed = new FlightPathfinder((x, y, z) => x === 0 && y === 0 && z === 0);
    const none = new FlightPath();
    sealed.request(none, 0, 0, 0, 15, 0, 0);
    sealed.tick(0);
    expect(none.status).toBe('failed');
  });

  it('a Glowwing caches its path and re-plans only when the goal moves far or the path is blocked', () => {
    const world = flatWorld({ radius: 3 });
    // A wall across x = 4 from the floor to y 80 forces a path over it.
    world.fill(4, 64, -20, 4, 80, 20, 'stone');
    const s = scene(world, [12.5, GROUND, 0.5]);
    s.player.alive = false; // nobody to hunt: drive flyTo directly
    const id = s.runtime.spawn(GLOWWING, 0.5, 70, 0.5);
    const goal = s.runtime.navigator(id); // ensure handles exist
    expect(goal).toBeDefined();
    const ai = GLOWWING_DEFINITION.goals(s.runtime.handle(id))[0]![1] as unknown as {
      flyTo(target: Vec3, speed: number): void;
    };
    const state = s.ecs.get(id, GlowwingC)!;
    const target: Vec3 = [10.5, 70, 0.5];
    const finder = flightPathfinder(s.runtime);
    const request = vi.spyOn(finder, 'request');
    for (let t = 0; t < 60; t++) {
      ai.flyTo(target, 0.2);
      s.ecs.time++;
      finder.tick(s.ecs.time);
    }
    expect(state.path.status).toBe('ready');
    expect(request).toHaveBeenCalledTimes(1);
    // A small target move keeps the cached path.
    target[2] += GLOWWING_REPLAN_DISTANCE - 1.5;
    for (let t = 0; t < 30; t++) {
      ai.flyTo(target, 0.2);
      s.ecs.time++;
      finder.tick(s.ecs.time);
    }
    expect(request).toHaveBeenCalledTimes(1);
    // A far move re-plans once (then waits for the new path).
    target[2] += GLOWWING_REPLAN_DISTANCE + 2;
    for (let t = 0; t < 30; t++) {
      ai.flyTo(target, 0.2);
      s.ecs.time++;
      finder.tick(s.ecs.time);
    }
    expect(request).toHaveBeenCalledTimes(2);
    expect(state.path.plans).toBe(2);
    // Blocking the next waypoint re-plans too.
    expect(state.path.status).toBe('ready');
    const o = state.path.index * 3;
    world.setBlock(
      state.path.cells[o]!,
      state.path.cells[o + 1]!,
      state.path.cells[o + 2]!,
      'stone',
    );
    s.ecs.time += 20;
    ai.flyTo(target, 0.2);
    expect(request).toHaveBeenCalledTimes(3);
    s.runtime.dispose();
  });
});

describe('M20c Glowwing', () => {
  it('is a 14-health hostile flyer that circles, dives at the player, climbs out and drops Luminous Membrane', () => {
    expect(GLOWWING_DEFINITION.health).toBe(14);
    expect(GLOWWING_DEFINITION.category).toBe('hostile');
    expect(GLOWWING_DEFINITION.flying).toBe(true);
    expect(creatureTypeIds()).toContain(GLOWWING);
    const drops = GLOWWING_DEFINITION.drops({ random: () => 0.5 } as never, 0);
    expect(drops[0]![0]).toBe('luminous_membrane');

    const world = flatWorld({ radius: 3 });
    const s = scene(world, [0.5, GROUND, 0.5]);
    const id = s.runtime.spawn(GLOWWING, 8.5, 72, 0.5);
    const state = s.ecs.get(id, GlowwingC)!;
    const phases = new Set<string>();
    const order: string[] = [];
    let seenHits = 0;
    let lowest = Infinity,
      highestCircle = -Infinity;
    run(s.ecs, 600, () => {
      phases.add(state.phase);
      if (order[order.length - 1] !== state.phase) order.push(state.phase);
      const y = s.ecs.get(id, TransformC)!.pos[1];
      if (state.phase === 'circle') highestCircle = Math.max(highestCircle, y);
      lowest = Math.min(lowest, y);
      // A hit always ends the dive.
      if (s.player.hits.length > seenHits) {
        seenHits = s.player.hits.length;
        expect(state.phase).toBe('climb');
      }
    });
    expect([...phases]).toEqual(expect.arrayContaining(['circle', 'dive', 'climb']));
    expect(order.indexOf('dive')).toBeGreaterThan(order.indexOf('circle'));
    expect(order.lastIndexOf('climb')).toBeGreaterThan(order.indexOf('dive'));
    expect(highestCircle).toBeGreaterThan(GROUND + 3);
    expect(lowest).toBeLessThan(GROUND + 2);
    expect(s.player.hits.length).toBeGreaterThan(0);
    expect(state.hits).toBeGreaterThan(0);
    expect(s.player.hits[0]!.amount).toBe(4);
    s.runtime.dispose();
  });

  it('never pathfinds in open air, and the shared budget holds for many flyers', () => {
    const world = flatWorld({ radius: 3 });
    const s = scene(world, [0.5, GROUND, 0.5]);
    for (let n = 0; n < 12; n++) s.runtime.spawn(GLOWWING, -10.5 + n * 2, 74, 6.5);
    const finder = flightPathfinder(s.runtime);
    let maxExpansions = 0;
    run(s.ecs, 200, () => (maxExpansions = Math.max(maxExpansions, finder.lastExpansions)));
    expect(maxExpansions).toBeLessThanOrEqual(FLIGHT_NODE_BUDGET);
    // Open air above a flat floor: straight flight, no searches at all.
    expect(finder.searches).toBe(0);
    s.runtime.dispose();
  });
});

/** Flat stone with a lava pool x, z ∈ [-3, 3], y 58–63, and the player at `at`. */
function lavaScene(at: Vec3) {
  const world = flatWorld({ radius: 2 });
  world.fill(-3, 58, -3, 3, 63, 3, 'lava');
  const s = scene(world, at);
  const player = Object.assign(s.player, {
    burning: 0,
    ignite(ticks: number) {
      player.burning = Math.max(player.burning, ticks);
    },
  });
  return { ...s, player };
}
function bodyInLava(world: World, p: Readonly<Vec3>): boolean {
  return isLava(world, Math.floor(p[0]), Math.floor(p[1] + 0.3), Math.floor(p[2]));
}

describe('M20c Magmaw', () => {
  it('is a 24-health hostile that drops Emberite Scale', () => {
    expect(MAGMAW_DEFINITION.health).toBe(24);
    expect(MAGMAW_DEFINITION.category).toBe('hostile');
    expect(creatureTypeIds()).toContain(MAGMAW);
    const drops = MAGMAW_DEFINITION.drops({ random: () => 0.5 } as never, 0);
    expect(drops[0]![0]).toBe('emberite_scale');
  });

  it('swims in lava only, never leaving it, and takes no lava damage', () => {
    const s = lavaScene([0.5, GROUND, 40.5]);
    s.player.alive = false;
    const id = s.runtime.spawn(MAGMAW, 0.5, 60, 0.5);
    const start = [...s.ecs.get(id, TransformC)!.pos];
    let moved = 0;
    run(s.ecs, 600, () => {
      const p = s.ecs.get(id, TransformC)!.pos;
      expect(bodyInLava(s.world, p)).toBe(true);
      moved = Math.max(moved, Math.hypot(p[0] - start[0]!, p[2] - start[2]!));
    });
    expect(moved).toBeGreaterThan(1);
    expect(s.ecs.get(id, HealthC)!.current).toBe(24);
    expect(s.ecs.get(id, MobBodyC)!.flying).toBe(true);
    s.runtime.dispose();
  });

  it('lunges at a player within 6 blocks, burning them through ignite, and ignores one farther away', () => {
    const far = lavaScene([3.5 + MAGMAW_LUNGE_RANGE + 1, GROUND, 0.5]);
    const idFar = far.runtime.spawn(MAGMAW, 0.5, 61, 0.5);
    run(far.ecs, 200);
    expect(far.ecs.get(idFar, MagmawC)!.lunges).toBe(0);
    expect(far.player.hits).toHaveLength(0);
    far.runtime.dispose();

    const near = lavaScene([5.5, GROUND, 0.5]);
    const id = near.runtime.spawn(MAGMAW, 0.5, 61, 0.5);
    let sawLunge = false;
    run(near.ecs, 120, () => {
      if (near.ecs.get(id, MagmawC)!.mode === 'lunge') sawLunge = true;
    });
    expect(sawLunge).toBe(true);
    expect(near.ecs.get(id, MagmawC)!.lunges).toBeGreaterThan(0);
    expect(near.player.hits.length).toBeGreaterThan(0);
    expect(near.player.hits[0]!.amount).toBe(5);
    expect(near.player.burning).toBe(MAGMAW_BURN_TICKS);
    near.runtime.dispose();
  });

  it('does not ignite a player whose i-frames absorb the hit', () => {
    const s = lavaScene([5.5, GROUND, 0.5]);
    const hurt = vi.spyOn(s.player, 'hurt').mockReturnValue(false);
    const id = s.runtime.spawn(MAGMAW, 0.5, 61, 0.5);
    run(s.ecs, 120);
    expect(s.ecs.get(id, MagmawC)!.lunges).toBeGreaterThan(0);
    expect(hurt).toHaveBeenCalled();
    expect(s.ecs.get(id, MagmawC)!.hits).toBe(0);
    expect(s.player.burning).toBe(0);
    s.runtime.dispose();
  });

  it('goes straight back into the lava after landing on the shore', () => {
    const s = lavaScene([0.5, GROUND, 40.5]);
    s.player.alive = false;
    const id = s.runtime.spawn(MAGMAW, 0.5, 61, 0.5);
    run(s.ecs, 2);
    const t = s.ecs.get(id, TransformC)!;
    t.pos[0] = t.previous[0] = 6.5;
    t.pos[1] = t.previous[1] = GROUND;
    let back = -1;
    let farthest = 0;
    run(s.ecs, 200, (n) => {
      farthest = Math.max(farthest, Math.abs(t.pos[0]));
      if (back < 0 && bodyInLava(s.world, t.pos)) back = n;
    });
    expect(back).toBeGreaterThanOrEqual(0);
    expect(back).toBeLessThan(120);
    expect(farthest).toBeLessThanOrEqual(6.6);
    expect(s.ecs.get(id, MagmawC)!.mode).toBe('swim');
    s.runtime.dispose();
  });
});

describe('M20c Hollowdeep spawning', () => {
  it('keeps each dimension to its own rules', () => {
    const hollowdeep = spawnRulesFor('hollowdeep');
    expect(spawnRulesFor('overworld')).toBe(spawnRules);
    expect(hollowdeep.rules.map((r) => r.type).sort()).toEqual([GLOWWING, MAGMAW]);
    for (const rule of spawnRules.rules) {
      expect(rule.type).not.toBe(GLOWWING);
      expect(rule.type).not.toBe(MAGMAW);
    }
    for (const rule of hollowdeep.rules) expect(rule.category).toBe('hostile');
  });

  it('accepts open cavern air for Glowwings and magma-sea lava for Magmaws only', () => {
    const world = new World(false);
    world.fill(-8, 30, -8, 8, 40, 8, 'lava');
    world.fill(-8, 80, -8, 8, 80, 8, 'stone');
    expect(magmawSpot(world, 0, 40, 0)).toBe(true);
    expect(magmawSpot(world, 0, 30, 0)).toBe(false); // nothing below
    expect(magmawSpot(world, 0, 41, 0)).toBe(false);
    world.setBlock(0, 70, 0, 'lava');
    world.setBlock(0, 69, 0, 'lava');
    expect(magmawSpot(world, 0, 70, 0)).toBe(false); // above the sea
    expect(glowwingSpot(world, 3, 60, 3)).toBe(true);
    expect(glowwingSpot(world, 3, 44, 3)).toBe(false); // too close to the sea
    expect(glowwingSpot(world, 3, 84, 3)).toBe(true);
    expect(glowwingSpot(world, 3, 83, 3)).toBe(false); // rock within three below
    expect(glowwingSpot(world, 3, 79, 3)).toBe(false); // rock above
    world.setBlock(4, 60, 3, 'stone');
    expect(glowwingSpot(world, 3, 60, 3)).toBe(false); // rock beside
  });

  it('spawns only Hollowdeep creatures in the Hollowdeep, within the hostile cap', () => {
    const world = new World(false);
    world.worldType = 'flat';
    for (let cx = -7; cx < 7; cx++)
      for (let cz = -7; cz < 7; cz++) {
        const column = world.getColumn(cx, cz, true)!;
        column.biomes.fill('magma_sea');
      }
    world.fill(-112, 0, -112, 111, 29, 111, 'stone');
    world.fill(-112, 30, -112, 111, 40, 111, 'lava');
    world.fill(-112, 120, -112, 111, 121, 111, 'stone');
    world.worldType = 'default';
    setWorldDimension(world, 'hollowdeep');
    const s = scene(world, [0.5, 90, 0.5], { spawnRules: spawnRulesFor(worldDimension(world)) });
    expect(s.runtime.spawner).toBeInstanceOf(MobSpawner);
    for (let i = 0; i < 1500; i++) s.runtime.spawner!.tick();
    const types = new Map<string, number>();
    for (const id of s.ecs.query(EntityKindC)) {
      const kind = s.ecs.get(id, EntityKindC)!;
      types.set(kind.type, (types.get(kind.type) ?? 0) + 1);
    }
    console.log('M20c Hollowdeep spawns', Object.fromEntries(types));
    expect(types.get(GLOWWING) ?? 0).toBeGreaterThan(0);
    expect(types.get(MAGMAW) ?? 0).toBeGreaterThan(0);
    expect([...types.keys()].every((t) => t === GLOWWING || t === MAGMAW)).toBe(true);
    expect(s.runtime.spawner!.count('hostile')).toBeLessThanOrEqual(MOB_CAPS.hostile);
    for (const id of s.ecs.query(EntityKindC)) {
      const kind = s.ecs.get(id, EntityKindC)!;
      const p = s.ecs.get(id, TransformC)!.pos;
      if (kind.type === MAGMAW) expect(p[1]).toBeLessThanOrEqual(41);
      else expect(p[1]).toBeGreaterThan(44);
    }
    s.runtime.dispose();
  });
});

describe('M20c Glowcap Stew', () => {
  it('crafts from Glowcap and Bowl and is a food item', () => {
    expect(
      match([
        [
          { id: 'glowcap', count: 1 },
          { id: 'bowl', count: 1 },
        ],
      ])?.result,
    ).toEqual({
      id: 'glowcap_stew',
      count: 1,
    });
    expect(match([[{ id: 'glowcap', count: 1 }]])).toBeNull();
    expect(items.get(NIGHT_VISION_FOOD).kind).toBe('food');
  });

  it('grants 30 s of night vision that counts down, saves, and clears on death', () => {
    const world = new World(false);
    world.fill(-5, 64, -5, 5, 64, 5, 'stone');
    const player = new Player(new BlockCollision(world), () => true);
    player.teleport(0.5, 65, 0.5, 0, 0);
    player.survival.hunger = 10;
    expect(player.survival.eatFood('glowcap_stew')).toBe(true);
    expect(player.survival.nightVisionTicks).toBe(NIGHT_VISION_TICKS);
    expect(NIGHT_VISION_TICKS).toBe(30 * 20);
    expect(NIGHT_VISION_FLOOR).toBeGreaterThan(0.5);
    for (let i = 0; i < 100; i++) player.survival.tick(world, player);
    expect(player.survival.nightVisionTicks).toBe(NIGHT_VISION_TICKS - 100);

    const saved = deserializePlayerData(serializePlayerData(player));
    expect(saved.nightVisionTicks).toBe(NIGHT_VISION_TICKS - 100);
    const other = new Player(new BlockCollision(world), () => true);
    applyPlayerData(other, saved);
    expect(other.survival.nightVisionTicks).toBe(NIGHT_VISION_TICKS - 100);

    player.survival.dead = true;
    expect(player.survival.nightVisionTicks).toBe(0);
    const none = deserializePlayerData(serializePlayerData(player));
    expect(none.nightVisionTicks).toBeUndefined();
    applyPlayerData(other, none);
    expect(other.survival.nightVisionTicks).toBe(0);
    // Other foods leave night vision alone.
    other.survival.hunger = 5;
    expect(other.survival.eatFood('bread')).toBe(true);
    expect(other.survival.nightVisionTicks).toBe(0);
  });
});

describe('M20c voices and music', () => {
  it('has distinct idle, hurt and death voices for both creatures and a Hollowdeep mood', () => {
    for (const type of [GLOWWING, MAGMAW])
      for (const voice of ['idle', 'hurt', 'death']) {
        const recipe = soundLibrary[`creature.${type}.${voice}`];
        expect(recipe, `${type} ${voice}`).toBeDefined();
        expect(recipe!.duration).toBeGreaterThan(0.3);
      }
    expect(soundLibrary['creature.glowwing.idle']).not.toBe(soundLibrary['creature.magmaw.idle']);
    const mood = getMood('hollowdeep');
    expect(mood).not.toBe(getMood('overworld'));
  });
});
