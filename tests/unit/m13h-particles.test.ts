import { expect, it, vi } from 'vitest';
import { mat4 } from 'gl-matrix';
import { DropRenderer, FS } from '../../src/render/drops';
import { TextureAtlas } from '../../src/render/atlas';
import { textureGenerators } from '../../src/render/textures';
import { World } from '../../src/world/world';
import { Player } from '../../src/entity/player';
import { BlockCollision } from '../../src/entity/physics';
import { ItemEntityManager } from '../../src/entity/item-entity';
import { BreakParticles } from '../../src/render/particles';
import type { GLWrapper } from '../../src/render/gl';
import type { PlayerController } from '../../src/engine/player-controller';

it('M13h batches small bright square embers with alpha fading and restores blending', () => {
  const tiles = new Map<string, Uint8Array>();
  for (const [id, gen] of Object.entries(textureGenerators)) {
    const tile = gen(42);
    if (Array.isArray(tile)) tile.forEach((frame, n) => tiles.set(`${id}_${n}`, frame));
    else tiles.set(id, tile);
  }
  const world = new World();
  const particles = new BreakParticles(world);
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};
  const gl = new Proxy(calls, {
    get: (obj, key) => {
      const name = String(key);
      if (/^[A-Z_0-9]+$/.test(name)) return name;
      return (obj[name] ??= vi.fn(() => ({})));
    },
  });
  const draw = vi.fn();
  const wrapper = {
    gl,
    createProgram: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({})),
    createVertexArray: vi.fn(() => ({})),
    drawArrays: draw,
    deleteBuffer: vi.fn(),
    deleteVertexArray: vi.fn(),
    deleteProgram: vi.fn(),
  } as unknown as GLWrapper;
  const renderer = new DropRenderer(wrapper, new TextureAtlas(tiles));
  const controller = {
    player: new Player(new BlockCollision(world), () => true),
    particles,
    itemEntities: new ItemEntityManager(world),
    camera: { yaw: 0, pitch: 0 },
    renderAlpha: 1,
  } as unknown as PlayerController;
  // Compare the square near the origin so float32 world-coordinate rounding does not skew its edges.
  particles.ember(1, [0.5, 0.5, 0.5], () => 0.5);
  expect(renderer.render(controller, mat4.create(), {} as WebGLTexture, 0)).toBe(1);
  expect(draw).toHaveBeenCalledTimes(1);
  expect(draw.mock.calls[0]![2]).toBe(6);
  const data = calls.bufferSubData!.mock.calls[0]![2] as Float32Array;
  const young = data.slice(0, 42);
  expect(young[6]).toBe(-1);
  // All four edges stay equal; the smaller square retains a bright, smooth fade.
  const width = Math.abs(young[9]! - young[16]!);
  expect(width).toBeCloseTo(Math.abs(young[2]! - young[30]!), 6);
  expect(width).toBeCloseTo(Math.abs(young[8]! - young[1]!), 6);
  expect(width).toBeLessThan(0.05);
  expect(young[5]).toBeGreaterThan(0.95);
  expect(FS).toContain('vec4(1.0,0.28,0.12,v_light)');
  for (let n = 0; n < 8; n++) particles.tick();
  renderer.render(controller, mat4.create(), {} as WebGLTexture, 0);
  expect(data[5]).toBeLessThan(young[5]!);
  expect(calls.blendFunc).toHaveBeenCalledWith('SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA');
  expect(calls.disable!.mock.calls.at(-1)).toEqual(['BLEND']);
  renderer.dispose();
});

it('M13h limits all embers to 128 slots and never evicts active debris or embers', () => {
  const particles = new BreakParticles(new World());
  for (let n = 0; n < 20; n++) particles.spawn(1, n, 2, 3);
  const debris = particles.pool.filter((p) => p.active);
  const snapshot = debris.map((p) => ({ pos: [...p.pos], age: p.age, state: p.state }));
  for (let owner = 0; owner < 20; owner++) particles.ember(owner, [0, 0, 0], () => 0.5, 24);
  const embers = particles.pool.filter((p) => p.active && p.emberOwner !== null);
  expect(embers).toHaveLength(128);
  const random = vi.fn(() => 0.5);
  particles.ember(99, [0, 0, 0], random, 24);
  expect(random).not.toHaveBeenCalled();
  debris.forEach((p, n) => {
    expect(p.active).toBe(true);
    expect(p.emberOwner).toBeNull();
    expect({ pos: p.pos, age: p.age, state: p.state }).toEqual(snapshot[n]);
  });
  // A full pool skips emission even while the global ember quota has room.
  for (let n = 0; n < 32; n++) particles.spawn(1, n, 2, 3);
  expect(particles.pool.every((p) => p.active && p.emberOwner === null)).toBe(true);
  particles.ember(99, [0, 0, 0], random, 24);
  expect(random).not.toHaveBeenCalled();
  for (let n = 0; n < 25; n++) particles.tick();
  particles.ember(99, [0, 0, 0], random, 24);
  expect(particles.pool.filter((p) => p.active && p.emberOwner === 99)).toHaveLength(24);
});
