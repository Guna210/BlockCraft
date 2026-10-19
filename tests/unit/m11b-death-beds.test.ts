import { describe, expect, it } from 'vitest';
import { BlockRegistry } from '../../src/world/blocks/registry';
import {
  deathCauseForDamageSource,
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
});
