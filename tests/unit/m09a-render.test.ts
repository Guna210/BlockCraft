import { expect, it, vi } from 'vitest';
import { mat4 } from 'gl-matrix';
import { DropRenderer } from '../../src/render/drops';
import { TextureAtlas, ATLAS_MAX_MIP } from '../../src/render/atlas';
import { textureGenerators } from '../../src/render/textures';
import { inventoryItemGenerators } from '../../src/render/textures/inventory-items';
import { World } from '../../src/world/world';
import { Player } from '../../src/entity/player';
import { BlockCollision } from '../../src/entity/physics';
import { ItemEntityManager } from '../../src/entity/item-entity';
import { BreakParticles } from '../../src/render/particles';
import { BlockRegistry } from '../../src/world/blocks/registry';
import type { GLWrapper } from '../../src/render/gl';
import type { PlayerController } from '../../src/engine/player-controller';

it('M09a lazily uploads one item atlas, batches mixed atlases correctly, reuses storage and frees resources', () => {
  const tiles = new Map<string, Uint8Array>();
  for (const [id, generate] of Object.entries(textureGenerators)) {
    const data = generate(42);
    if (Array.isArray(data)) data.forEach((frame, i) => tiles.set(`${id}_${i}`, frame));
    else tiles.set(id, data);
  }
  const atlas = new TextureAtlas(tiles);
  const additionalTiles = new Map(
    Object.entries(inventoryItemGenerators).map(([id, generate]) => [id, generate(42)]),
  );
  const itemAtlas = new TextureAtlas(additionalTiles, { width: 256 });
  console.log(
    'M09a atlas sizes',
    JSON.stringify({
      terrain: [atlas.width, atlas.height],
      items: [itemAtlas.width, itemAtlas.height],
      terrainTiles: tiles.size,
      itemTiles: additionalTiles.size,
    }),
  );
  expect(atlas.rects.has('clay_lump')).toBe(false);
  expect(itemAtlas.rects.has('clay_lump')).toBe(true);
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};
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
    'enable',
    'disable',
    'depthMask',
    'texImage2D',
    'texParameteri',
  ])
    calls[name] = vi.fn(() => ({}));
  let bound: unknown = null;
  calls.bindTexture = vi.fn((_target, texture) => {
    bound = texture;
  });
  const gl = new Proxy(calls, { get: (obj, key) => obj[String(key)] ?? 1 });
  const mainTexture = {} as WebGLTexture,
    addedTexture = {} as WebGLTexture;
  const draws: Array<{ first: number; count: number; texture: unknown }> = [];
  const createTexture = vi.fn(() => addedTexture);
  const deleteTexture = vi.fn(),
    deleteBuffer = vi.fn(),
    deleteVertexArray = vi.fn(),
    deleteProgram = vi.fn();
  const wrapper = {
    gl,
    createProgram: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({})),
    createVertexArray: vi.fn(() => ({})),
    createTexture,
    deleteTexture,
    deleteBuffer,
    deleteVertexArray,
    deleteProgram,
    drawArrays: vi.fn((_mode: number, first: number, count: number) =>
      draws.push({ first, count, texture: bound }),
    ),
  } as unknown as GLWrapper;
  const renderer = new DropRenderer(wrapper, atlas);
  expect(createTexture).not.toHaveBeenCalled();
  const world = new World(),
    player = new Player(new BlockCollision(world), () => true);
  const entities = new ItemEntityManager(world),
    particles = new BreakParticles(world);
  const controller = {
    player,
    itemEntities: entities,
    particles,
    camera: { yaw: 0, pitch: 0 },
    renderAlpha: 1,
  } as unknown as PlayerController;
  expect(renderer.render(controller, mat4.create(), mainTexture, 1)).toBe(0);
  expect(createTexture).not.toHaveBeenCalled();
  entities.spawn('dirt', 1, 0.5, 65, 0.5);
  entities.spawn('clay_lump', 4, 0.5, 65, 0.5);
  entities.spawn('iron_helmet', 1, 0.5, 65, 0.5);
  particles.spawn(BlockRegistry.getInstance().getDefaultStateId('stone')!, 0, 65, 0);
  expect(renderer.render(controller, mat4.create(), mainTexture, 1)).toBe(3);
  expect(draws).toEqual([
    { first: 0, count: 36, texture: mainTexture },
    { first: 36, count: 12, texture: addedTexture },
    { first: 48, count: 96, texture: mainTexture },
  ]);
  expect(renderer.itemDraws).toBe(2);
  expect(renderer.particleDraws).toBe(1);
  expect(renderer.triangles).toBe(48);
  expect(createTexture).toHaveBeenCalledTimes(1);
  expect(calls.texImage2D).toHaveBeenCalledTimes(ATLAS_MAX_MIP + 1);
  for (let level = 0; level <= ATLAS_MAX_MIP; level++) {
    const upload = calls.texImage2D!.mock.calls[level]!;
    expect(upload[1]).toBe(level);
    expect(upload[3]).toBe(itemAtlas.width >> level);
    expect(upload[4]).toBe(itemAtlas.height >> level);
    expect(upload[8]).toEqual(itemAtlas.mips[level]);
  }
  const data = calls.bufferSubData!.mock.calls[0]![2] as Float32Array;
  const dirt = atlas.rects.get('dirt')!,
    clay = itemAtlas.rects.get('clay_lump')!;
  expect(data[3]).toBeCloseTo((dirt.x + 0.5) / atlas.width);
  expect(data[36 * 7 + 3]).toBeCloseTo((clay.x + 0.5) / itemAtlas.width);
  expect(data[36 * 7 + 4]).toBeCloseTo((clay.y + 15.5) / itemAtlas.height);
  renderer.render(controller, mat4.create(), mainTexture, 1);
  expect(createTexture).toHaveBeenCalledTimes(1);
  expect(calls.texImage2D).toHaveBeenCalledTimes(ATLAS_MAX_MIP + 1);
  expect(calls.bufferData).toHaveBeenCalledTimes(1);
  expect(calls.bufferSubData!.mock.calls[1]![2]).toBe(data);
  for (const entity of entities.pool) entity.active = false;
  for (const particle of particles.pool) particle.active = false;
  draws.length = 0;
  calls.bufferSubData!.mockClear();
  calls.useProgram!.mockClear();
  expect(renderer.render(controller, mat4.create(), mainTexture, 1)).toBe(0);
  expect(draws).toEqual([]);
  expect(calls.bufferSubData).not.toHaveBeenCalled();
  expect(calls.useProgram).not.toHaveBeenCalled();
  renderer.dispose();
  renderer.dispose();
  expect(deleteTexture).toHaveBeenCalledExactlyOnceWith(addedTexture);
  expect(deleteBuffer).toHaveBeenCalledTimes(1);
  expect(deleteVertexArray).toHaveBeenCalledTimes(1);
  expect(deleteProgram).toHaveBeenCalledTimes(1);
  entities.spawn('clay_lump', 1, 0.5, 65, 0.5);
  expect(renderer.render(controller, mat4.create(), mainTexture, 1)).toBe(0);
  expect(draws).toEqual([]);
  expect(createTexture).toHaveBeenCalledTimes(1);
});
