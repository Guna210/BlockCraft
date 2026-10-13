import { it, expect, vi } from 'vitest';
import { mat4 } from 'gl-matrix';
import { DropRenderer } from '../../src/render/drops';
import { TextureAtlas } from '../../src/render/atlas';
import { textureGenerators } from '../../src/render/textures';
import { World } from '../../src/world/world';
import { Player } from '../../src/entity/player';
import { BlockCollision } from '../../src/entity/physics';
import { ItemEntityManager } from '../../src/entity/item-entity';
import { BreakParticles } from '../../src/render/particles';
import { BlockRegistry } from '../../src/world/blocks/registry';
import type { GLWrapper } from '../../src/render/gl';
import type { PlayerController } from '../../src/engine/player-controller';

it('M07b 100 mixed block/sprite items and 16 lit textured particles use two submissions and reuse GPU storage', () => {
  const tiles = new Map<string, Uint8Array>();
  for (const [id, gen] of Object.entries(textureGenerators)) {
    const tile = gen(42);
    if (Array.isArray(tile)) tile.forEach((frame, n) => tiles.set(`${id}_${n}`, frame));
    else tiles.set(id, tile);
  }
  const atlas = new TextureAtlas(tiles),
    world = new World(),
    player = new Player(new BlockCollision(world), () => true);
  const entities = new ItemEntityManager(world),
    particles = new BreakParticles(world);
  const glCalls: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of [
    'getUniformLocation',
    'bindVertexArray',
    'bindBuffer',
    'bufferData',
    'enableVertexAttribArray',
    'vertexAttribPointer',
    'useProgram',
    'bufferSubData',
    'uniformMatrix4fv',
    'activeTexture',
    'bindTexture',
    'enable',
    'disable',
    'depthMask',
  ])
    glCalls[name] = vi.fn(() => ({}));
  const gl = new Proxy(glCalls, { get: (obj, key) => obj[String(key)] ?? 1 });
  const draw = vi.fn(),
    allocate = vi.fn(() => ({}));
  const wrapper = {
    gl,
    createProgram: allocate,
    createBuffer: allocate,
    createVertexArray: allocate,
    drawArrays: draw,
  } as unknown as GLWrapper;
  const renderer = new DropRenderer(wrapper, atlas),
    stone = BlockRegistry.getInstance().getDefaultStateId('stone')!;
  for (let n = 0; n < 100; n++)
    entities.spawn(n % 2 ? 'wooden_pickaxe' : 'grass_block', 1, 0.5, 65, 0.5);
  particles.spawn(stone, 0, 65, 0);
  world.lightEngine.storage.setSkyLight(0, 4, 0, 0, 1, 0, 15);
  const c = {
    player,
    itemEntities: entities,
    particles,
    camera: { yaw: 0, pitch: 0 },
    renderAlpha: 1,
  } as unknown as PlayerController;
  expect(renderer.render(c, mat4.create(), {} as WebGLTexture, 1)).toBe(2);
  expect(draw.mock.calls.map((call) => call[2])).toEqual([50 * 36 + 50 * 6, 16 * 6]);
  expect(renderer.triangles).toBe((50 * 36 + 50 * 6 + 16 * 6) / 3);
  const upload = glCalls.bufferSubData!.mock.calls[0]! as unknown as [
    number,
    number,
    Float32Array,
    number,
    number,
  ];
  const data = upload[2];
  expect(upload[4]).toBe(renderer.triangles * 3 * 7);
  // Vertex light reflects the actual sample; opaque grass keeps encoded dirt alpha visible.
  expect(data[5]).toBeCloseTo(0.82);
  expect(data[6]).toBe(0);
  const grass = atlas.rects.get('grass_side')!;
  expect(data[3]).toBeCloseTo((grass.x + 0.5) / atlas.width);
  const saved = data.slice(0, upload[4]);
  renderer.render(c, mat4.create(), {} as WebGLTexture, 0.1);
  expect(glCalls.bufferSubData!.mock.calls[1]![2]).toBe(data);
  expect(data[5]).toBeLessThan(saved[5]!);
  expect(allocate).toHaveBeenCalledTimes(3);
  expect(glCalls.bufferData).toHaveBeenCalledTimes(1);
  for (const entity of entities.pool) if (entity.active) entity.age += 8;
  renderer.render(c, mat4.create(), {} as WebGLTexture, 1);
  expect([...data.slice(0, 3)]).not.toEqual([...saved.slice(0, 3)]);
  expect(data[3]).toBe(saved[3]);
  expect(glCalls.bufferData).toHaveBeenCalledTimes(1);
  for (const entity of entities.pool) entity.active = false;
  for (const particle of particles.pool) particle.active = false;
  draw.mockClear();
  glCalls.bufferSubData!.mockClear();
  glCalls.useProgram!.mockClear();
  expect(renderer.render(c, mat4.create(), {} as WebGLTexture, 1)).toBe(0);
  expect(draw).not.toHaveBeenCalled();
  expect(glCalls.bufferSubData).not.toHaveBeenCalled();
  expect(glCalls.useProgram).not.toHaveBeenCalled();
});
