import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { World } from '../../src/world/world';
import {
  DIMENSIONS,
  DIMENSION_SCALE,
  otherDimension,
  scaleCoordinate,
  type DimensionId,
} from '../../src/world/dimension';
import {
  PORTAL_ARRIVAL_COOLDOWN,
  PORTAL_LINK_RADIUS,
  PORTAL_SEARCH_RADIUS,
  PORTAL_TRAVEL_TICKS,
  PortalGuard,
  PortalIndex,
  PortalTravel,
  buildPortal,
  findLinkedPortal,
  findPortalFrame,
  lightPortal,
  placeArrivalPortal,
  portalArrivalPoint,
  portalIntact,
  portalSearchOffsets,
  type PortalAxis,
  type PortalRecord,
} from '../../src/world/portals';
import { SaveManager, type SaveSession } from '../../src/persist/save-manager';
import { createFakeIdb } from './helpers/fake-idb';
import { WorldManager } from '../../src/world/world-manager';

const Y = 65;
const registry = () => BlockRegistry.getInstance();

/** A world with the guard installed, the way WorldManager runs one. */
function makeWorld(): { world: World; index: PortalIndex; guard: PortalGuard } {
  const world = new World(false);
  const index = new PortalIndex();
  const guard = new PortalGuard(world, index);
  world.listeners.add(guard);
  return { world, index, guard };
}

/**
 * The 4×5 Lumite frame around an opening whose min cell is (x, y, z) on `axis`; corners are left
 * out unless asked for.
 */
function frame(world: World, x: number, y: number, z: number, axis: PortalAxis, corners = false) {
  for (let v = -1; v <= 3; v++)
    for (let u = -1; u <= 2; u++) {
      const inside = u >= 0 && u <= 1 && v >= 0 && v <= 2;
      const corner = (u === -1 || u === 2) && (v === -1 || v === 3);
      if (inside || (corner && !corners)) continue;
      if (axis === 'x') world.setBlock(x + u, y + v, z, 'lumite_block');
      else world.setBlock(x, y + v, z + u, 'lumite_block');
    }
}

function ground(world: World, x0: number, z0: number, x1: number, z1: number, y: number) {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) world.setBlock(x, y, z, 'stone');
}

function portalBlocks(world: World, p: PortalRecord): string[] {
  const ids: string[] = [];
  for (let v = 0; v < 3; v++)
    for (let u = 0; u < 2; u++) {
      const x = p.axis === 'x' ? p.x + u : p.x;
      const z = p.axis === 'x' ? p.z : p.z + u;
      const block = world.getBlock(x, p.y + v, z);
      ids.push(block.id === 'portal' ? `portal:${block.state['axis']}` : block.id);
    }
  return ids;
}

describe('M20a — dimensions', () => {
  it('scales horizontal coordinates 1:4 between the Overworld and the Hollowdeep', () => {
    expect(DIMENSION_SCALE).toBe(4);
    expect(scaleCoordinate(400, 'overworld', 'hollowdeep')).toBe(100);
    expect(scaleCoordinate(100, 'hollowdeep', 'overworld')).toBe(400);
    expect(scaleCoordinate(-37, 'overworld', 'overworld')).toBe(-37);
    expect(otherDimension('overworld')).toBe('hollowdeep');
    expect(otherDimension('hollowdeep')).toBe('overworld');
  });

  it("gives each dimension its own generator and biome list; the Hollowdeep is M20b's cavern", () => {
    expect(DIMENSIONS.overworld.createPipeline([]).getStages().length).toBeGreaterThan(0);
    expect(
      DIMENSIONS.hollowdeep
        .createPipeline([])
        .getStages()
        .map((stage) => stage.name),
    ).toEqual(['hollowdeep:shape', 'hollowdeep:features', 'hollowdeep:ores']);
    expect(DIMENSIONS.overworld.biomeIds).toContain('plains');
    expect(DIMENSIONS.hollowdeep.biomeIds).toEqual([
      'glowcap_forest',
      'magma_sea',
      'driftstone_expanse',
      'voidglass_geodes',
    ]);
    // Portals there stand above the magma sea and under the lowest ceiling.
    expect(DIMENSIONS.hollowdeep.portalMinY).toBe(41);
    expect(DIMENSIONS.hollowdeep.portalMaxY + 5).toBeLessThan(158);
  });
});

describe('M20a — portal frames', () => {
  beforeEach(() => registry());

  for (const axis of ['x', 'z'] as const) {
    it(`finds a 4×5 frame on the ${axis} axis from any of its six interior cells, corners optional`, () => {
      const { world } = makeWorld();
      frame(world, 10, Y, 20, axis);
      for (let v = 0; v < 3; v++)
        for (let u = 0; u < 2; u++) {
          const x = axis === 'x' ? 10 + u : 10;
          const z = axis === 'x' ? 20 : 20 + u;
          expect(findPortalFrame(world, x, Y + v, z)).toEqual({ x: 10, y: Y, z: 20, axis });
        }
    });
  }

  it('accepts a frame with its corners filled too', () => {
    const { world } = makeWorld();
    frame(world, 0, Y, 0, 'x', true);
    expect(findPortalFrame(world, 1, Y + 2, 0)).toEqual({ x: 0, y: Y, z: 0, axis: 'x' });
  });

  it('rejects a frame missing any non-corner block, a blocked opening, and other blocks', () => {
    const { world } = makeWorld();
    frame(world, 0, Y, 0, 'x');
    world.setBlock(-1, Y + 1, 0, 'stone');
    expect(findPortalFrame(world, 0, Y, 0)).toBeNull();
    world.setBlock(-1, Y + 1, 0, 'lumite_block');
    expect(findPortalFrame(world, 0, Y, 0)).not.toBeNull();
    world.setBlock(1, Y + 2, 0, 'dirt');
    expect(findPortalFrame(world, 0, Y, 0)).toBeNull();
    world.setBlock(1, Y + 2, 0, 'air');
    // Too wide: a 3-wide opening is not a portal frame.
    const { world: wide } = makeWorld();
    for (let v = 0; v < 3; v++) {
      wide.setBlock(-1, Y + v, 0, 'lumite_block');
      wide.setBlock(3, Y + v, 0, 'lumite_block');
    }
    for (let u = 0; u < 3; u++) {
      wide.setBlock(u, Y - 1, 0, 'lumite_block');
      wide.setBlock(u, Y + 3, 0, 'lumite_block');
    }
    expect(findPortalFrame(wide, 0, Y, 0)).toBeNull();
    expect(findPortalFrame(wide, 1, Y, 0)).toBeNull();
  });

  it('lighting fills the opening with portal blocks of the frame axis and indexes the portal', () => {
    const { world, index } = makeWorld();
    frame(world, 30, Y, 40, 'z');
    const portal = lightPortal(world, index, 30, Y + 1, 41)!;
    expect(portal).toEqual({ x: 30, y: Y, z: 40, axis: 'z' });
    expect(portalBlocks(world, portal)).toEqual(Array(6).fill('portal:z'));
    expect(index.all()).toEqual([portal]);
    expect(portalIntact(world, portal)).toBe(true);
    expect(world.getBlockDefinition('portal')!.lightEmission).toBeGreaterThan(0);
    // An empty spot with no frame lights nothing.
    expect(lightPortal(world, index, 100, Y, 100)).toBeNull();
    expect(index.size).toBe(1);
  });

  it('breaking any frame block removes every portal block', () => {
    for (const [u, v] of [
      [0, -1],
      [1, 3],
      [-1, 0],
      [2, 2],
    ]) {
      const { world, index } = makeWorld();
      frame(world, 0, Y, 0, 'x');
      const portal = lightPortal(world, index, 0, Y, 0)!;
      world.setBlockStateId(u!, Y + v!, 0, 0);
      expect(portalBlocks(world, portal)).toEqual(Array(6).fill('air'));
      expect(index.size).toBe(0);
    }
  });

  it('breaking a portal block or blowing up the frame removes the rest; corners do not matter', () => {
    const { world, index } = makeWorld();
    frame(world, 0, Y, 0, 'x', true);
    const portal = lightPortal(world, index, 0, Y, 0)!;
    world.setBlockStateId(-1, Y - 1, 0, 0);
    expect(index.size).toBe(1);
    world.setBlockStateId(1, Y + 1, 0, 0);
    expect(portalBlocks(world, portal)).toEqual(Array(6).fill('air'));
    expect(index.size).toBe(0);

    frame(world, 0, Y, 0, 'x');
    const again = lightPortal(world, index, 0, Y, 0)!;
    world.removeBlocks([{ x: 2, y: Y + 1, z: 0, state: world.getBlockStateId(2, Y + 1, 0) }]);
    expect(portalBlocks(world, again)).toEqual(Array(6).fill('air'));
    expect(index.size).toBe(0);
  });

  it('edits next to a portal leave it alone', () => {
    const { world, index } = makeWorld();
    frame(world, 0, Y, 0, 'x');
    const portal = lightPortal(world, index, 0, Y, 0)!;
    world.setBlock(0, Y, 1, 'stone');
    world.setBlock(3, Y, 0, 'stone');
    expect(portalIntact(world, portal)).toBe(true);
    expect(index.size).toBe(1);
  });
});

describe('M20a — portal index', () => {
  it('indexes a portal under every column its frame touches and survives a round trip', () => {
    const index = new PortalIndex();
    const across: PortalRecord = { x: 15, y: Y, z: 3, axis: 'x' };
    const along: PortalRecord = { x: -20, y: 30, z: -1, axis: 'z' };
    index.add(across);
    index.add(along);
    index.add({ ...across });
    expect(index.size).toBe(2);
    expect(index.inColumn(0, 0)).toEqual([across]);
    expect(index.inColumn(1, 0)).toEqual([across]);
    expect(index.inColumn(-2, -1)).toEqual([along]);
    expect(index.inColumn(-2, 0)).toEqual([along]);
    expect(index.portalAt(16, Y + 2, 3)).toBe(across);
    expect(index.portalAt(17, Y, 3)).toBeNull();

    const copy = new PortalIndex();
    copy.load(index.serialize());
    expect(copy.all()).toEqual(index.all());
    copy.remove(copy.all()[0]!);
    expect(copy.inColumn(0, 0)).toBeUndefined();
    expect(copy.inColumn(1, 0)).toBeUndefined();
    expect(() => copy.load([1, 2, 3])).toThrow(/malformed/);
    expect(() => copy.load([1, 2, 3, 7])).toThrow(/malformed/);
  });

  it('links to the nearest standing portal within 32 blocks horizontally and drops stale ones', () => {
    const { world, index } = makeWorld();
    const far: PortalRecord = { x: 100 + PORTAL_LINK_RADIUS + 4, y: Y, z: 100, axis: 'x' };
    const near: PortalRecord = { x: 120, y: Y + 30, z: 110, axis: 'z' };
    buildPortal(world, index, far);
    buildPortal(world, index, near);
    expect(findLinkedPortal(world, index, 100, Y, 100)).toBe(near);
    expect(findLinkedPortal(world, index, 300, Y, 300)).toBeNull();
    // A portal the world no longer holds (an unsaved dimension regenerated) is forgotten.
    const stale: PortalRecord = { x: 101, y: Y, z: 100, axis: 'x' };
    world.setBlock(101, Y - 1, 100, 'stone');
    index.add(stale);
    expect(findLinkedPortal(world, index, 100, Y, 100)).toBe(near);
    expect(index.all()).not.toContain(stale);
  });
});

describe('M20a — arrival portals', () => {
  const noPause = () => Promise.resolve();

  it('searches a bounded, seeded set of spots within 16 blocks, nearest first', () => {
    const a = portalSearchOffsets(7);
    expect(a).toEqual(portalSearchOffsets(7));
    expect(a).not.toEqual(portalSearchOffsets(8));
    expect(a[0]).toEqual([0, 0]);
    expect(a.length).toBeLessThanOrEqual(48);
    for (let i = 1; i < a.length; i++) {
      const [dx, dz] = a[i]!;
      const [px, pz] = a[i - 1]!;
      expect(dx * dx + dz * dz).toBeLessThanOrEqual(PORTAL_SEARCH_RADIUS * PORTAL_SEARCH_RADIUS);
      expect(dx * dx + dz * dz).toBeGreaterThanOrEqual(px * px + pz * pz);
    }
  });

  it('builds the new portal on solid, dry ground with air above when there is some', async () => {
    const { world, index } = makeWorld();
    ground(world, 80, 80, 120, 120, 40);
    // Water covers the exact point: the portal goes somewhere dry instead.
    for (let x = 98; x <= 102; x++)
      for (let z = 98; z <= 102; z++) world.setBlock(x, 41, z, 'water');
    const portal = await placeArrivalPortal(
      world,
      index,
      DIMENSIONS.hollowdeep,
      'x',
      100,
      44,
      100,
      1234,
      noPause,
    );
    expect(portal.y).toBe(41);
    expect(Math.hypot(portal.x - 100, portal.z - 100)).toBeLessThanOrEqual(
      PORTAL_SEARCH_RADIUS + 1,
    );
    expect(portalIntact(world, portal)).toBe(true);
    for (let u = -1; u <= 2; u++)
      for (let w = -1; w <= 1; w++)
        // The frame's bottom row is set into the ground; stone stays on both sides of it.
        expect(world.getBlock(portal.x + u, 40, portal.z + w).id).toBe(
          w === 0 ? 'lumite_block' : 'stone',
        );
    const [ax, ay, az] = portalArrivalPoint(portal);
    expect(world.getBlock(Math.floor(ax), ay, Math.floor(az)).id).toBe('portal');
    expect(world.getBlock(Math.floor(ax), ay - 1, Math.floor(az)).id).toBe('lumite_block');
    expect(world.getBlock(Math.floor(ax), ay, Math.floor(az) + 1).id).toBe('air');
    expect(index.all()).toEqual([portal]);
  });

  it('builds a platform with an air pocket when nowhere is safe', async () => {
    const { world, index } = makeWorld();
    const portal = await placeArrivalPortal(
      world,
      index,
      DIMENSIONS.hollowdeep,
      'z',
      100.4,
      400,
      -7.6,
      99,
      noPause,
    );
    // Clamped into the Hollowdeep's range.
    expect(portal).toEqual({ x: 100, y: DIMENSIONS.hollowdeep.portalMaxY, z: -8, axis: 'z' });
    expect(portalIntact(world, portal)).toBe(true);
    for (let w = -2; w <= 2; w++)
      for (let u = -2; u <= 3; u++)
        expect(world.getBlock(portal.x + w, portal.y - 1, portal.z + u).id).toBe(
          u >= -1 && u <= 2 && w === 0 ? 'lumite_block' : 'duskrock',
        );
    expect(world.getBlock(portal.x + 1, portal.y, portal.z).id).toBe('air');
  });

  it('raises a fallback platform out of rock and lava, and seals the lava around its pocket', async () => {
    const { world, index } = makeWorld();
    // A magma sea up to y 45 over solid rock: nothing is safe, and the point is inside the lava.
    world.fill(80, 20, -20, 120, 30, 20, 'duskrock');
    world.fill(80, 31, -20, 120, 45, 20, 'lava');
    const portal = await placeArrivalPortal(
      world,
      index,
      DIMENSIONS.hollowdeep,
      'x',
      100,
      25,
      0,
      5,
      noPause,
    );
    expect(portal).toEqual({ x: 100, y: 46, z: 0, axis: 'x' });
    expect(portalIntact(world, portal)).toBe(true);
    // The pocket's floor seals the lava under it, and no lava touches the pocket.
    for (let u = -2; u <= 3; u++)
      for (let w = -2; w <= 2; w++) {
        const below = world.getBlock(portal.x + u, 45, portal.z + w).id;
        expect(below === 'duskrock' || below === 'lumite_block').toBe(true);
      }
    for (let u = -3; u <= 4; u++)
      for (let w = -3; w <= 3; w++)
        for (let y = 45; y <= 50; y++)
          expect(world.getBlock(portal.x + u, y, portal.z + w).id).not.toBe('lava');
  });

  it('yields while it searches so no slice runs past its budget', async () => {
    const { world, index } = makeWorld();
    let pauses = 0;
    await placeArrivalPortal(
      world,
      index,
      DIMENSIONS.overworld,
      'x',
      0,
      64,
      0,
      5,
      async () => {
        pauses++;
      },
      0,
    );
    expect(pauses).toBeGreaterThan(0);
  });
});

describe('M20a — standing in a portal', () => {
  function litPortal() {
    const { world, index } = makeWorld();
    frame(world, 0, Y, 0, 'x');
    const portal = lightPortal(world, index, 0, Y, 0)!;
    return { world, index, portal };
  }

  it('travels after 80 ticks inside, with the warp ramping up meanwhile', () => {
    const { world, index, portal } = litPortal();
    const travel = new PortalTravel();
    const trips: PortalRecord[] = [];
    travel.onTravel = (p) => trips.push(p);
    for (let i = 1; i < PORTAL_TRAVEL_TICKS; i++) {
      travel.tick(world, index, 1.0, Y, 0.5);
      expect(travel.warp).toBeCloseTo(i / PORTAL_TRAVEL_TICKS);
    }
    expect(trips).toEqual([]);
    travel.tick(world, index, 1.0, Y, 0.5);
    expect(trips).toEqual([portal]);
    expect(travel.travelling).toBe(true);
    travel.tick(world, index, 1.0, Y, 0.5);
    expect(trips).toHaveLength(1);
  });

  it('starts over when the player steps out, and after arriving waits for a step out and the cooldown', () => {
    const { world, index } = litPortal();
    const travel = new PortalTravel();
    let trips = 0;
    travel.onTravel = () => trips++;
    for (let i = 0; i < 40; i++) travel.tick(world, index, 1.0, Y, 0.5);
    travel.tick(world, index, 1.0, Y, 3.5);
    expect(travel.ticksInside).toBe(0);

    travel.arrived();
    expect(travel.warp).toBe(1);
    for (let i = 0; i < 200; i++) travel.tick(world, index, 1.0, Y, 0.5);
    expect(trips).toBe(0);
    expect(travel.warp).toBe(0);
    travel.tick(world, index, 1.0, Y, 3.5);
    for (let i = 0; i < PORTAL_TRAVEL_TICKS; i++) travel.tick(world, index, 1.0, Y, 0.5);
    expect(trips).toBe(1);

    travel.arrived();
    travel.tick(world, index, 1.0, Y, 3.5);
    for (let i = 0; i < PORTAL_TRAVEL_TICKS; i++) travel.tick(world, index, 1.0, Y, 0.5);
    // The cooldown ate the first ticks back inside.
    expect(trips).toBe(1);
    for (let i = 0; i < PORTAL_ARRIVAL_COOLDOWN; i++) travel.tick(world, index, 1.0, Y, 0.5);
    expect(trips).toBe(2);
  });

  it('does not read the world at all while the dimension has no portal', () => {
    const index = new PortalIndex();
    const world = new Proxy({} as World, {
      get() {
        throw new Error('the world was read');
      },
    });
    const travel = new PortalTravel();
    for (let i = 0; i < 100; i++) travel.tick(world, index, 0, Y, 0);
    expect(travel.ticksInside).toBe(0);
  });
});

describe('M20a — saving portals and dimensions', () => {
  beforeEach(() => registry());

  function session(world: World, portals: PortalIndex): SaveSession {
    return {
      name: 'w',
      seedString: 'seed',
      worldType: 'default',
      world,
      player: () => null,
      items: () => null,
      portals: () => portals.serialize(),
    };
  }

  it('keeps each dimension’s columns and portal index apart and loads the one asked for', async () => {
    const fake = createFakeIdb();
    const saves = new SaveManager({ env: () => fake.env });
    const overworld = makeWorld();
    frame(overworld.world, 0, Y, 0, 'x');
    lightPortal(overworld.world, overworld.index, 0, Y, 0);
    const store = await saves.create('w');
    saves.attach(session(overworld.world, overworld.index), store);
    await saves.save('manual');

    const hollowdeep = makeWorld();
    const loaded = await saves.loadDimension('hollowdeep');
    expect(loaded.store.size).toBe(0);
    expect(loaded.entities).toBeUndefined();
    saves.session!.world = hollowdeep.world;
    saves.session!.portals = () => hollowdeep.index.serialize();
    saves.switchDimension(hollowdeep.world, loaded.store);
    buildPortal(hollowdeep.world, hollowdeep.index, { x: 25, y: 70, z: 25, axis: 'z' });
    await saves.save('manual');

    const reread = new SaveManager({ env: () => fake.env });
    const back = await reread.load('w', () => 'hollowdeep');
    expect(back.store.dim).toBe('hollowdeep');
    expect(back.store.has(1, 1)).toBe(true);
    expect(back.store.has(0, 0)).toBe(false);
    const hollowIndex = new PortalIndex();
    hollowIndex.load(back.entities?.portals);
    expect(hollowIndex.all()).toEqual([{ x: 25, y: 70, z: 25, axis: 'z' }]);

    const first = await reread.load('w');
    expect(first.store.dim).toBe('overworld');
    expect(first.store.has(0, 0)).toBe(true);
    const overIndex = new PortalIndex();
    overIndex.load(first.entities?.portals);
    expect(overIndex.all()).toEqual([{ x: 0, y: Y, z: 0, axis: 'x' }]);
  });
});

describe('M20a — failed travel', () => {
  for (const failure of ['throws', 'rejects'] as const) {
    it(`clears the travelling state when the dimension change ${failure}`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const travel = new PortalTravel();
      travel.travelling = true;
      travel.ticksInside = PORTAL_TRAVEL_TICKS;
      travel.warp = 1;
      const manager = Object.create(WorldManager.prototype) as {
        dimension: DimensionId;
        portalTravel: PortalTravel;
        changeDimension: () => Promise<PortalRecord>;
      };
      manager.dimension = 'overworld';
      manager.portalTravel = travel;
      manager.changeDimension =
        failure === 'throws'
          ? () => {
              throw new Error('no session');
            }
          : () => Promise.reject(new Error('store closed'));
      await (
        manager as unknown as { travelThroughPortal(p: PortalRecord): Promise<void> }
      ).travelThroughPortal({ x: 0, y: 64, z: 0, axis: 'x' });
      expect(travel.travelling).toBe(false);
      expect(travel.ticksInside).toBe(0);
      expect(travel.warp).toBe(0);
      expect(warn).toHaveBeenCalledOnce();
      warn.mockRestore();
    });
  }
});
