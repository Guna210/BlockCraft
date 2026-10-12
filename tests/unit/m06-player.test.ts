import { describe, expect, it } from 'vitest';
import { World } from '../../src/world/world';
import { Player } from '../../src/entity/player';
import { BlockCollision } from '../../src/entity/physics';
import { TickLoop } from '../../src/engine/loop';
import { PlayerController } from '../../src/engine/player-controller';
import { Camera } from '../../src/render/camera';
import { InputEngine } from '../../src/engine/input';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { buildMeshLookupTables, greedyMesh } from '../../src/mesh/greedy';
import { decodeVertex } from '../../src/mesh/vertex';
import { genHayTop, genHaySide, PAL_HAY } from '../../src/render/textures/hay';

function scene(ready: (x: number, z: number) => boolean = () => true) {
  const world = new World(false);
  world.fill(-10, 64, -10, 40, 64, 10, 'stone');
  const collision = new BlockCollision(world);
  const player = new Player(collision, ready);
  player.teleport(0.5, 65, 0.5, 0, 0);
  return { world, collision, player };
}
function ticks(player: Player, n: number) {
  for (let i = 0; i < n; i++) player.tick();
}

describe('M06a fixed tick simulation', () => {
  it('produces identical physics at 30, 60 and 144 FPS render rates', () => {
    const results = [30, 60, 144].map((fps) => {
      const { player } = scene();
      player.input('forward', true);
      const loop = new TickLoop(() => player.tick());
      for (let frame = 0; frame < fps * 5; frame++) loop.advance(1 / fps);
      return player.snapshot();
    });
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
    expect(results[0]!.pos[0] - 0.5).toBeCloseTo(21.37, 2);
  });
  it('drops excess accumulated ticks and never spirals', () => {
    let count = 0;
    const loop = new TickLoop(() => count++);
    const alpha = loop.advance(10.025);
    expect(count).toBe(5);
    expect(alpha).toBeCloseTo(0.5);
    loop.advance(0.025);
    expect(count).toBe(6);
  });
  it('discards a whole-tick remainder at floating-point catch-up boundaries', () => {
    let count = 0;
    const loop = new TickLoop(() => count++);
    expect(loop.advance(1)).toBeCloseTo(0);
    expect(count).toBe(5);
    loop.advance(0.05);
    expect(count).toBe(6);
  });
  it('manual ticks use the same function, synchronously, only while paused', () => {
    let count = 0;
    const loop = new TickLoop(() => count++);
    expect(() => loop.tick(1)).toThrow();
    loop.pause();
    loop.advance(1);
    expect(count).toBe(0);
    loop.tick(100);
    expect(count).toBe(100);
    expect(() => loop.tick(-1)).toThrow();
    expect(() => loop.tick(0.5)).toThrow();
    loop.resume();
    loop.advance(0.05);
    expect(count).toBe(101);
  });
});

describe('M06a collision and movement', () => {
  it('sweeps the whole displacement through a wall and resolves head bonks', () => {
    const { world, collision, player } = scene();
    world.fill(3, 65, -1, 3, 68, 1, 'stone');
    expect(collision.sweep(player.pos, 1.8, 0, 20)).toBeCloseTo(2.2);
    player.input('sprint', true);
    player.input('forward', true);
    ticks(player, 100);
    expect(player.pos[0]).toBeCloseTo(2.7);
    expect(player.vel[0]).toBe(0);
    world.fill(-1, 67, -1, 2, 67, 1, 'stone');
    player.teleport(0.5, 65, 0.5);
    player.input('forward', false);
    player.input('jump', true);
    player.tick();
    expect(player.pos[1]).toBeCloseTo(65.2);
    expect(player.vel[1]).toBe(0);
  });
  it('steps up a half slab, but never a full block or into an obstructed stepped position', () => {
    const { world, player } = scene();
    world.setBlock(2, 65, 0, 'stone_slab');
    player.input('forward', true);
    ticks(player, 12);
    expect(player.pos[0]).toBeGreaterThan(2);
    expect(player.pos[1]).toBe(65.5);
    world.setBlock(4, 65, 0, 'stone');
    ticks(player, 20);
    expect(player.pos[0]).toBeCloseTo(3.7);
    player.teleport(0.5, 65, 0.5);
    world.setBlock(2, 67, 0, 'stone');
    ticks(player, 20);
    expect(player.pos[0]).toBeCloseTo(1.7);
  });
  it('sneaks through a 1.5 gap and cannot stand into its ceiling', () => {
    const { world, player } = scene();
    world.fill(2, 67, -1, 8, 67, 1, 'stone_slab');
    player.input('forward', true);
    ticks(player, 20);
    expect(player.pos[0]).toBeGreaterThan(2);
    // Bottom slabs at y66 leave exactly 1.5 blocks above the y65 floor.
    player.teleport(0.5, 65, 0.5);
    world.fill(2, 67, -1, 8, 67, 1, 'air');
    for (let x = 2; x <= 8; x++)
      for (let z = -1; z <= 1; z++) world.setBlock(x, 66, z, 'stone_slab', { half: 'top' });
    ticks(player, 20);
    expect(player.pos[0]).toBeCloseTo(1.7);
    player.input('sneak', true);
    ticks(player, 50);
    expect(player.pos[0]).toBeGreaterThan(3);
    player.input('sneak', false);
    player.tick();
    expect(player.height).toBe(1.5);
  });
  it('clips diagonal sneaking at cliff edges', () => {
    const { world, player } = scene();
    world.fill(2, 64, -10, 40, 64, 10, 'air');
    player.input('sneak', true);
    player.input('forward', true);
    player.input('right', true);
    ticks(player, 60);
    expect(player.pos[0]).toBeGreaterThan(2);
    expect(player.pos[0]).toBeLessThan(2.3);
    expect(player.pos[1]).toBe(65);
    expect(player.onGround).toBe(true);
  });
  it('reports leaving ground on the same tick that walking crosses a ledge', () => {
    const { world, player } = scene();
    world.fill(2, 64, -10, 40, 64, 10, 'air');
    player.teleport(2.29, 65, 0.5, 0, 0);
    player.input('forward', true);
    player.tick();
    expect(player.onGround).toBe(false);
    expect(player.pos[1]).toBe(65);
    player.tick();
    expect(player.pos[1]).toBeLessThan(65);
  });
  it('does not step up while a jump is already moving upward', () => {
    const { world, player } = scene();
    world.setBlock(2, 65, 0, 'stone_slab');
    player.teleport(1.69, 65, 0.5, 0, 0);
    player.input('forward', true);
    player.input('jump', true);
    player.tick();
    expect(player.pos[1]).toBeCloseTo(65.405);
    expect(player.pos[0]).toBeCloseTo(1.7);
    expect(player.onGround).toBe(false);
  });
  it('jumps higher than one block and caps downward velocity at 60', () => {
    const { player } = scene();
    player.input('jump', true);
    player.tick();
    player.input('jump', false);
    let apex = player.pos[1];
    for (let i = 0; i < 15; i++) {
      player.tick();
      apex = Math.max(apex, player.pos[1]);
    }
    expect(apex - 65).toBeGreaterThan(1);
    expect(apex - 65).toBeLessThan(1.3);
    player.teleport(0.5, 300, 0.5);
    ticks(player, 50);
    expect(player.vel[1]).toBe(-60);
  });
  it('uses 20 percent ground acceleration in the air', () => {
    const ground = scene().player,
      air = scene().player;
    air.teleport(0.5, 100, 0.5);
    ground.input('forward', true);
    air.input('forward', true);
    ground.tick();
    air.tick();
    expect(air.vel[0]).toBeCloseTo(ground.vel[0] * 0.2);
  });
  it('double-tap forward sprints within seven ticks, but not later', () => {
    const { player } = scene();
    player.input('forward', true);
    player.tick();
    player.input('forward', false);
    ticks(player, 5);
    player.input('forward', true);
    ticks(player, 4);
    expect(player.vel[0]).toBe(5.6);
    player.clearInput();
    player.input('forward', true);
    player.tick();
    player.input('forward', false);
    ticks(player, 8);
    player.input('forward', true);
    ticks(player, 4);
    expect(player.vel[0]).toBe(4.3);
  });
  it('ejects on the shortest free axis, preferring up on ties', () => {
    const { world, collision, player } = scene();
    world.setBlock(0, 65, 0, 'stone');
    player.teleport(0.5, 65.5, 0.5);
    collision.eject(player.pos, 1.8);
    expect(player.pos).toEqual([0.5, 66, 0.5]);
    player.teleport(0.9, 65, 0.5);
    collision.eject(player.pos, 1.8);
    expect(player.pos[0]).toBeCloseTo(1.3);
  });
  it('freezes gravity and movement in current or destination unloaded terrain', () => {
    let loaded = false;
    const { player } = scene(() => loaded);
    player.teleport(15.5, 100, 0.5);
    player.input('forward', true);
    ticks(player, 100);
    expect(player.pos).toEqual([15.5, 100, 0.5]);
    expect(player.vel[1]).toBe(0);
    loaded = true;
    player.tick();
    expect(player.pos[1]).toBeLessThan(100);
    const next = scene((x) => x < 16).player;
    next.teleport(15.69, 65, 0.5);
    next.input('forward', true);
    ticks(next, 100);
    expect(next.pos[0]).toBeLessThanOrEqual(15.7);
    expect(next.pos[1]).toBe(65);
  });
});

describe('M06a damage and flight', () => {
  it.each(['stone', 'water', 'hay_bale', 'creative'])(
    'handles a ten-block fall onto %s',
    (material) => {
      const { world, player } = scene();
      if (material === 'water') world.setBlock(0, 65, 0, 'water');
      if (material === 'hay_bale') world.setBlock(0, 64, 0, 'hay_bale');
      if (material === 'creative') player.setGameMode('creative');
      player.teleport(0.5, 75, 0.5);
      ticks(player, 40);
      expect(player.pos[1]).toBe(65);
      expect(player.health).toBe(material === 'stone' ? 13 : 20);
    },
  );
  it('applies damage and stops velocity when a fall ends exactly on the floor at a tick boundary', () => {
    const { player } = scene();
    player.teleport(0.5, 74, 0.5);
    ticks(player, 15);
    expect(player.pos[1]).toBeCloseTo(65);
    expect(player.onGround).toBe(true);
    expect(player.health).toBeCloseTo(14);
    expect(player.vel[1]).toBe(0);
  });
  it('measures falls from the jump apex and resets on water entry before landing', () => {
    const { world, player } = scene();
    player.teleport(0.5, 75, 0.5);
    player.vel[1] = 8.9;
    let apex = 75;
    for (let i = 0; i < 40; i++) {
      player.tick();
      apex = Math.max(apex, player.pos[1]);
    }
    expect(player.health).toBeCloseTo(20 - (apex - 65 - 3));
    player.health = 20;
    world.setBlock(0, 68, 0, 'water');
    player.teleport(0.5, 75, 0.5);
    ticks(player, 40);
    expect(player.health).toBe(20);
  });
  it('resets fall distance when terminal-speed motion entirely crosses a water layer', () => {
    const { world, player } = scene();
    world.setBlock(0, 95, 0, 'stone');
    world.setBlock(0, 99, 0, 'water');
    player.teleport(0.5, 100, 0.5);
    player.vel[1] = -60;
    ticks(player, 5);
    expect(player.pos[1]).toBe(96);
    expect(player.health).toBe(20);
  });
  it('double-tap jump toggles creative flight and survival disables it', () => {
    const { player } = scene();
    player.setGameMode('creative');
    player.input('jump', true);
    player.tick();
    player.input('jump', false);
    player.tick();
    player.input('jump', true);
    player.tick();
    expect(player.flying).toBe(true);
    const y = player.pos[1];
    ticks(player, 20);
    expect(player.pos[1] - y).toBeCloseTo(10.9);
    player.input('jump', false);
    ticks(player, 20);
    const held = player.pos[1];
    ticks(player, 20);
    expect(player.pos[1]).toBe(held);
    player.input('sneak', true);
    ticks(player, 10);
    expect(player.pos[1]).toBeCloseTo(held - 5.45);
    player.setGameMode('survival');
    expect(player.flying).toBe(false);
  });
});

describe('M06a render integration', () => {
  it('interpolates camera and detaches on direct legacy camera writes until input or look', () => {
    const { world } = scene();
    const camera = new Camera(1),
      input = new InputEngine(document.createElement('canvas'));
    const c = new PlayerController(camera, input, () => true);
    c.spawn(world, 0.5, 65, 0.5, 'survival');
    input.setAction('forward', true);
    c.frame(0.075);
    expect(camera.position[0]).toBeCloseTo(0.55);
    expect(camera.position[1]).toBeCloseTo(66.62);
    camera.position[0] = 100;
    camera.position[1] = 100;
    camera.position[2] = 100;
    camera.yaw = 1;
    c.frame(0.05);
    expect(c.player!.detached).toBe(true);
    expect(Array.from(camera.position)).toEqual([100, 100, 100]);
    c.frame(1);
    expect(Array.from(camera.position)).toEqual([100, 100, 100]);
    c.look(0, 0);
    expect(c.player!.detached).toBe(false);
    expect(c.player!.pos[1]).toBeCloseTo(98.38);
    c.loop.pause();
    c.tick(2);
    expect(camera.position[0]).toBeCloseTo(c.player!.pos[0]);
  });
  it('preserves the legacy initial spawn camera until the first player control', () => {
    const { world } = scene();
    const camera = new Camera(1),
      input = new InputEngine(document.createElement('canvas'));
    camera.position[0] = 0.5;
    camera.position[1] = 65.82;
    camera.position[2] = 0.5;
    const c = new PlayerController(camera, input, () => true);
    c.spawn(world, 0.5, 65, 0.5, 'survival', true);
    c.frame(1);
    expect(camera.position[1]).toBeCloseTo(65.82);
    expect(c.player!.pos[1]).toBe(65);
    expect(c.player!.onGround).toBe(true);
    input.setAction('forward', true);
    c.frame(0.05);
    expect(c.player!.detached).toBe(false);
    expect(c.player!.pos[1]).toBe(65);
    expect(camera.position[1]).toBeCloseTo(66.62);
  });
  it('packs half-height slab positions without altering integer cube vertices', () => {
    const registry = BlockRegistry.getInstance(),
      tables = buildMeshLookupTables(registry, () => 0);
    const padded = new Uint16Array(18 ** 3);
    padded[1 + 18 + 18 * 18] = registry.getDefaultStateId('stone_slab')!;
    const mesh = greedyMesh(padded, tables);
    const ys: number[] = [];
    for (let i = 0; i < mesh.models.vertices.length; i += 2)
      ys.push(decodeVertex(mesh.models.vertices[i]!, mesh.models.vertices[i + 1]!).y);
    expect(mesh.models.quadCount).toBe(6);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(0.5);
  });
  it.each([genHayTop, genHaySide])(
    'hay tiles are deterministic, palette limited and high contrast',
    (gen) => {
      const tile = gen(42);
      expect(tile).toEqual(gen(42));
      expect(tile).not.toEqual(gen(7));
      expect(PAL_HAY.length).toBeLessThanOrEqual(12);
      const luma: number[] = [];
      for (let i = 0; i < tile.length; i += 4) {
        const rgba = Array.from(tile.slice(i, i + 4));
        expect(PAL_HAY).toContainEqual(rgba);
        luma.push(tile[i]! * 0.2126 + tile[i + 1]! * 0.7152 + tile[i + 2]! * 0.0722);
      }
      expect(Math.max(...luma) - Math.min(...luma)).toBeGreaterThanOrEqual(60);
    },
  );
});
