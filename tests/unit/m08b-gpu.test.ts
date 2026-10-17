import { expect, it, vi } from 'vitest';
import { mat4 } from 'gl-matrix';
import { ChunkRenderer } from '../../src/render/chunk-renderer';
import type { GLWrapper } from '../../src/render/gl';
import { TextureAtlas } from '../../src/render/atlas';
import { buildMeshLookupTables, greedyMesh } from '../../src/mesh/greedy';
import { BlockRegistry } from '../../src/world/blocks/registry';

it('sorts only translucent near geometry after meaningful camera movement and frees private EBO/depth resources', () => {
  const calls = new Map<string, ReturnType<typeof vi.fn>>();
  const gl = new Proxy(
    { drawingBufferWidth: 1280, drawingBufferHeight: 720 },
    {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target];
        const name = String(key);
        if (name.toUpperCase() === name) return name;
        if (!calls.has(name))
          calls.set(
            name,
            vi.fn(() => ({})),
          );
        return calls.get(name);
      },
    },
  );
  const buffers = new Set<object>(),
    textures = new Set<object>();
  const drawVaos: object[] = [];
  let bound: object;
  const wrapper = {
    gl,
    createProgram: () => ({}),
    createVertexArray: () => ({}),
    deleteVertexArray: () => {},
    createBuffer: () => {
      const b = {};
      buffers.add(b);
      return b;
    },
    deleteBuffer: (b: object) => buffers.delete(b),
    createTexture: () => {
      const t = {};
      textures.add(t);
      return t;
    },
    deleteTexture: (t: object) => textures.delete(t),
    drawElements: () => drawVaos.push(bound),
  } as unknown as GLWrapper;
  const renderer = new ChunkRenderer(wrapper);
  const registry = BlockRegistry.getInstance();
  const tables = buildMeshLookupTables(registry, () => 0);
  const blocks = new Uint16Array(18 ** 3);
  blocks[343] = registry.getDefaultStateId('water')!;
  const mesh = greedyMesh(blocks, tables);
  const near = renderer.uploadSectionMesh(0, 0, 0, mesh);
  const far = renderer.uploadSectionMesh(4, 0, 0, mesh);
  blocks[343] = registry.getDefaultStateId('stone')!;
  renderer.uploadSectionMesh(1, 0, 0, greedyMesh(blocks, tables));
  calls.get('bindVertexArray')!.mockImplementation((vao: object) => {
    bound = vao;
  });
  const atlas = new TextureAtlas(
    new Map([
      ['water_0', new Uint8Array(1024)],
      ['lava_0', new Uint8Array(1024)],
    ]),
  );
  const view = mat4.fromScaling(mat4.create(), [0.01, 0.01, 0.01]);
  const render = (x: number) => {
    renderer.setAtmosphere({
      cameraPos: [x, 0, 0],
      fogStart: 80,
      fogEnd: 100,
      sunDir: [0, 1, 0],
      dayFactor: 1,
      twilightFactor: 0,
      nightFactor: 0,
    });
    renderer.render(view, {} as WebGLTexture, atlas);
  };
  render(0);
  expect(calls.get('bufferSubData')).toHaveBeenCalledTimes(1);
  expect(drawVaos.slice(-2)).toEqual([far.translucent!.vao, near.translucent!.vao]);
  render(0.1);
  expect(calls.get('bufferSubData')).toHaveBeenCalledTimes(1);
  render(1);
  expect(calls.get('bufferSubData')).toHaveBeenCalledTimes(2);
  const framebufferCreates = calls.get('createFramebuffer')!.mock.calls.length;
  render(1);
  expect(calls.get('createFramebuffer')).toHaveBeenCalledTimes(framebufferCreates);
  expect(calls.get('bufferSubData')).toHaveBeenCalledTimes(2);
  expect(calls.get('blitFramebuffer')).toHaveBeenCalledTimes(4);
  expect(drawVaos).toHaveLength(12); // One opaque and two translucent submissions per frame.
  renderer.clearAllMeshes();
  expect(buffers.size).toBe(0);
  // The renderer retains its two plains tint fallback textures across world resets.
  expect(textures.size).toBe(2);
  expect(calls.get('deleteFramebuffer')).toHaveBeenCalledTimes(framebufferCreates);
});
