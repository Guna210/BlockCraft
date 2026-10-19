import { describe, expect, it, vi } from 'vitest';
import { Camera } from '../../src/render/camera';
import { InputEngine } from '../../src/engine/input';
import { PlayerController } from '../../src/engine/player-controller';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { World } from '../../src/world/world';
import { TICKS_PER_DAY, dayNumber, timeOfDay } from '../../src/world/time';
import {
  deathCauseForDamageSource,
  hostileWithin,
  nextMorningAbsoluteTime,
  resolveBedRespawn,
  sleepRefusalReason,
} from '../../src/gameplay/death-beds';

const registry = BlockRegistry.getInstance();

function bedWorld(obstructed = false) {
  const foot = registry.getStateId('bed', { facing: 'east', part: 'foot' })!;
  const head = registry.getStateId('bed', { facing: 'east', part: 'head' })!;
  const cells = new Map([
    ['2,64,3', foot],
    ['3,64,3', head],
  ]);
  return {
    getBlockStateId: (x: number, y: number, z: number) => cells.get(`${x},${y},${z}`) ?? 0,
    hasColumn: () => true,
    entityQuery: { query: () => [] },
    footSpawn: [2.5, 64 + 9 / 16, 3.5] as [number, number, number],
    obstructed,
  };
}

describe('M11b death causes and bed respawn', () => {
  it.each([
    ['drowning', 'Drowned'],
    ['lava', 'Burned in lava'],
    ['fire', 'Burned in fire'],
    ['burning', 'Burned'],
    ['fall', 'Fell from a height'],
    ['starvation', 'Starved'],
    ['cactus', 'Pricked by a cactus'],
    ['suffocation', 'Suffocated'],
    ['void', 'Fell into the void'],
    ['killed', 'Killed'],
  ])('maps %s damage to the cause label %s', (source, label) => {
    expect(deathCauseForDamageSource(source)).toBe(label);
  });

  it('uses world spawn when the bed pair has no two-block player clearance', () => {
    const world = bedWorld(true);
    const worldSpawn: [number, number, number] = [0.5, 65, 0.5];
    const result = resolveBedRespawn(
      world,
      world.footSpawn,
      worldSpawn,
      (_x, _y, _z, height) => !world.obstructed && height <= 1.8,
    );
    expect(result).toEqual(worldSpawn);
  });

  it('refuses sleep during the day', () => {
    expect(sleepRefusalReason(1000, false)).toBe('day');
    expect(sleepRefusalReason(13000, false)).toBeNull();
  });

  it('advances sleep from day 5 at 13000 to sunrise on day 6 without resetting the day count', () => {
    const nextMorning = nextMorningAbsoluteTime(5 * TICKS_PER_DAY + 13000);

    expect(nextMorning).toBe(6 * TICKS_PER_DAY);
    expect(dayNumber(nextMorning)).toBe(6);
    expect(timeOfDay(nextMorning)).toBeCloseTo(0);
  });

  it('refuses sleep for hostiles within 8 blocks and allows sleep at 9 blocks', () => {
    const world = new World(false);
    let hostileX = 8;
    world.entityQuery.addProvider('m11b-sleep-test', () => [
      {
        id: 'test-hostile',
        type: 'hostile',
        minX: hostileX - 0.1,
        minY: -0.1,
        minZ: -0.1,
        maxX: hostileX + 0.1,
        maxY: 0.1,
        maxZ: 0.1,
      },
    ]);

    expect(sleepRefusalReason(5 * TICKS_PER_DAY + 13000, hostileWithin(world, [0, 0, 0], 8))).toBe(
      'hostile',
    );

    hostileX = 9;
    const hostileNearby = hostileWithin(world, [0, 0, 0], 8);
    expect(hostileNearby).toBe(false);
    expect(sleepRefusalReason(5 * TICKS_PER_DAY + 13000, hostileNearby)).toBeNull();
  });

  it.each([2, 3])(
    'breaking bed half x=%i removes both halves and drops exactly one bed',
    (breakX) => {
      const world = new World(false);
      world.fill(-2, 64, -2, 6, 64, 2, 'stone');
      world.setBlockStateId(
        2,
        65,
        0,
        registry.getStateId('bed', { facing: 'east', part: 'foot' })!,
      );
      world.setBlockStateId(
        3,
        65,
        0,
        registry.getStateId('bed', { facing: 'east', part: 'head' })!,
      );

      const controller = new PlayerController(
        new Camera(1),
        new InputEngine(document.createElement('canvas')),
        () => true,
      );
      controller.spawn(world, 0.5, 65, 0.5, 'survival');
      controller.loop.pause();
      const interaction = controller.interaction!;
      vi.spyOn(interaction.raycaster, 'cast').mockImplementation(
        (_ox, _oy, _oz, _dx, _dy, _dz, _reach, out) => {
          const stateId = world.getBlockStateId(breakX, 65, 0);
          out.hit = stateId !== 0;
          out.x = breakX;
          out.y = 65;
          out.z = 0;
          out.stateId = stateId;
          out.face = 'top';
          out.distance = 2;
          return out;
        },
      );
      interaction.input('attack', true);
      for (let tick = 0; tick < 12; tick++) interaction.tick();

      expect(world.getBlockStateId(2, 65, 0)).toBe(0);
      expect(world.getBlockStateId(3, 65, 0)).toBe(0);
      expect(
        controller
          .itemEntities!.pool.filter((entity) => entity.active)
          .map((entity) => ({ id: entity.item.id, count: entity.count })),
      ).toEqual([{ id: 'bed', count: 1 }]);
      controller.reset();
    },
  );
});
