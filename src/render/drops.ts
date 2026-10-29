import type { mat4 } from 'gl-matrix';
import type { GLWrapper } from './gl';
import { TextureAtlas, ATLAS_MAX_MIP, type AtlasRect as TileRect } from './atlas';
import { inventoryItemGenerators } from './textures/inventory-items';
import type { PlayerController } from '../engine/player-controller';
import { BlockRegistry } from '../world/blocks/registry';
import type { BlockFaceDirection } from '../world/blocks/types';
import { items } from '../gameplay/items';
import { ITEM_CAPACITY } from '../entity/item-entity';
import { PARTICLE_CAPACITY } from './particles';
import type { World } from '../world/world';
import { settings } from '../engine/settings';

export const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;layout(location=1) in vec2 a_uv;
layout(location=2) in float a_light;layout(location=3) in float a_cutoff;
uniform mat4 u_vp;out vec2 v_uv;out float v_light;flat out float v_cutoff;
void main(){v_uv=a_uv;v_light=a_light;v_cutoff=a_cutoff;gl_Position=u_vp*vec4(a_pos,1.0);}`;
export const FS = `#version 300 es
precision highp float;
in vec2 v_uv;in float v_light;flat in float v_cutoff;uniform sampler2D u_atlas;out vec4 color;
void main(){if(v_cutoff<-2.5){color=vec4(1.0,0.95,0.8,v_light);return;}if(v_cutoff<-1.5){color=vec4(0.47,0.44,0.48,v_light);return;}if(v_cutoff<0.0){color=vec4(1.0,0.28,0.12,v_light);return;}vec4 tex=texture(u_atlas,v_uv);if(tex.a<v_cutoff)discard;color=vec4(tex.rgb*v_light,1.0);}`;
export const FACES: readonly BlockFaceDirection[] = [
  'east',
  'west',
  'top',
  'bottom',
  'south',
  'north',
];
export const CORNERS = [
  [
    [1, 0, 0],
    [1, 1, 0],
    [1, 1, 1],
    [1, 0, 1],
  ],
  [
    [0, 0, 1],
    [0, 1, 1],
    [0, 1, 0],
    [0, 0, 0],
  ],
  [
    [0, 1, 1],
    [1, 1, 1],
    [1, 1, 0],
    [0, 1, 0],
  ],
  [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
    [0, 0, 1],
  ],
  [
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
    [0, 0, 1],
  ],
  [
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [1, 0, 0],
  ],
] as const;
export const INDICES = [0, 1, 2, 0, 2, 3];

/** Light level 0.04..1 at a world position, as the drawn sprites and moving blocks use it. */
export function worldLight(
  world: World,
  x: number,
  y: number,
  z: number,
  skyBrightness: number,
): number {
  x = Math.floor(x);
  y = Math.floor(y);
  z = Math.floor(z);
  if (y > 319) return Math.max(0.04, skyBrightness);
  if (y < 0) return 0.04;
  const cx = Math.floor(x / 16),
    cz = Math.floor(z / 16),
    lx = ((x % 16) + 16) % 16,
    lz = ((z % 16) + 16) % 16;
  const storage = world.lightEngine.storage;
  const sky = storage.getSkyLight(cx, y >> 4, cz, lx, y & 15, lz);
  const block = storage.getBlockLight(cx, y >> 4, cz, lx, y & 15, lz);
  return Math.max(0.04, (0.04 + (0.96 * sky) / 15) * skyBrightness, 0.04 + (0.96 * block) / 15);
}

/** Persistent batches; additional world sprites allocate their atlas only on first use. */
export class DropRenderer {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;
  private readonly vp: WebGLUniformLocation;
  private readonly data = new Float32Array((ITEM_CAPACITY * 36 + PARTICLE_CAPACITY * 6) * 7);
  private readonly faces: Array<readonly TileRect[]> = [];
  private readonly sprites = new Map<string, TileRect>();
  private cursor = 0;
  private itemAtlas: TextureAtlas | null = null;
  private itemTexture: WebGLTexture | null = null;
  private disposed = false;
  itemDraws = 0;
  particleDraws = 0;
  triangles = 0;
  constructor(
    private readonly wrapper: GLWrapper,
    private readonly atlas: TextureAtlas,
  ) {
    const gl = wrapper.gl;
    this.program = wrapper.createProgram(VS, FS);
    this.vp = gl.getUniformLocation(this.program, 'u_vp')!;
    this.vao = wrapper.createVertexArray();
    this.buffer = wrapper.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    for (let attr = 0; attr < 4; attr++) {
      gl.enableVertexAttribArray(attr);
      gl.vertexAttribPointer(
        attr,
        attr === 0 ? 3 : attr === 1 ? 2 : 1,
        gl.FLOAT,
        false,
        28,
        attr === 0 ? 0 : attr === 1 ? 12 : attr === 2 ? 20 : 24,
      );
    }
    gl.bindVertexArray(null);
    const registry = BlockRegistry.getInstance();
    for (const state of registry.getAllStateIds())
      this.faces[state] = FACES.map((face) => {
        const name = registry.getFaceTexture(state, face) ?? '__missing_texture__';
        const rect = atlas.rects.get(name) ?? atlas.rects.get(`${name}_0`);
        // Air has no renderable texture and never becomes geometry.
        if (!rect && state !== 0) throw new Error(`Missing drop face: ${name}`);
        return rect!;
      });
    for (const item of items.items.values())
      if (item.texture) {
        const rect = atlas.rects.get(item.texture);
        if (!rect && !inventoryItemGenerators[item.texture])
          throw new Error(`Missing item sprite: ${item.id}`);
        if (rect) this.sprites.set(item.id, rect);
      }
  }
  private ensureItemAtlas(): TextureAtlas {
    if (this.itemAtlas) return this.itemAtlas;
    const tiles = new Map<string, Uint8Array>();
    for (const [id, generate] of Object.entries(inventoryItemGenerators))
      tiles.set(id, generate(42));
    const atlas = new TextureAtlas(tiles, { width: 256 });
    const gl = this.wrapper.gl;
    const texture = this.wrapper.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    for (let level = 0; level <= ATLAS_MAX_MIP; level++)
      gl.texImage2D(
        gl.TEXTURE_2D,
        level,
        gl.RGBA,
        atlas.width >> level,
        atlas.height >> level,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        atlas.mips[level]!,
      );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, ATLAS_MAX_MIP);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.itemAtlas = atlas;
    this.itemTexture = texture;
    return atlas;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.itemTexture) this.wrapper.deleteTexture(this.itemTexture);
    this.itemTexture = null;
    this.itemAtlas = null;
    this.wrapper.deleteBuffer(this.buffer);
    this.wrapper.deleteVertexArray(this.vao);
    this.wrapper.deleteProgram(this.program);
  }
  private light(world: World, x: number, y: number, z: number, skyBrightness: number): number {
    return worldLight(world, x, y, z, skyBrightness);
  }
  private vertex(
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    light: number,
    cutoff = 0.1,
    atlas: TextureAtlas = this.atlas,
  ): void {
    const d = this.data;
    let n = this.cursor;
    d[n++] = x;
    d[n++] = y;
    d[n++] = z;
    d[n++] = u / atlas.width;
    d[n++] = v / atlas.height;
    d[n++] = light;
    d[n++] = cutoff;
    this.cursor = n;
  }
  render(
    c: PlayerController | null,
    vp: mat4,
    texture: WebGLTexture,
    skyBrightness: number,
  ): number {
    this.cursor = 0;
    this.itemDraws = this.particleDraws = this.triangles = 0;
    if (this.disposed || !c?.player || !c.itemEntities || !c.particles) return 0;
    const alpha = c.renderAlpha,
      world = c.player.collision.world,
      registry = BlockRegistry.getInstance();
    let hasEmbers = false;
    let terrainVertices = 0;
    let hasAdditionalItems = false;
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1 && !hasAdditionalItems) break;
      for (let n = 0; n < ITEM_CAPACITY; n++) {
        const e = c.itemEntities.pool[n]!;
        if (!e.active) continue;
        const additional = !e.item.block && !this.sprites.has(e.item.id);
        if (pass === 0 && additional) hasAdditionalItems = true;
        if (additional !== (pass === 1)) continue;
        const spriteAtlas = additional ? this.ensureItemAtlas() : this.atlas;
        const time = e.age - 1 + alpha;
        const x = e.previous[0] + (e.pos[0] - e.previous[0]) * alpha,
          y =
            e.previous[1] +
            (e.pos[1] - e.previous[1]) * alpha +
            0.22 +
            Math.sin(time * 0.15 + e.phase) * 0.1,
          z = e.previous[2] + (e.pos[2] - e.previous[2]) * alpha;
        const angle = time * 0.1 + e.phase,
          cos = Math.cos(angle),
          sin = Math.sin(angle);
        const light = this.light(world, x, y, z, skyBrightness);
        if (e.item.block) {
          const state = registry.getDefaultStateId(e.item.block)!;
          const faces = this.faces[state]!;
          const cutoff =
            registry.getResolvedState(state)!.definition.renderLayer === 'opaque' ? 0 : 0.1;
          for (let face = 0; face < 6; face++) {
            const rect = faces[face]!,
              shade = face === 2 ? 1 : face === 3 ? 0.55 : 0.82;
            for (let t = 0; t < 6; t++) {
              const corner = INDICES[t]!,
                p = CORNERS[face]![corner]!;
              const px = (p[0] - 0.5) * 0.3,
                pz = (p[2] - 0.5) * 0.3;
              this.vertex(
                x + px * cos + pz * sin,
                y + (p[1] - 0.5) * 0.3,
                z - px * sin + pz * cos,
                rect.x + (corner < 2 ? 0.5 : 15.5),
                rect.y + (corner === 0 || corner === 3 ? 15.5 : 0.5),
                light * shade,
                cutoff,
              );
            }
          }
        } else {
          const rect = additional
            ? spriteAtlas.rects.get(e.item.texture!)!
            : this.sprites.get(e.item.id)!;
          for (let t = 0; t < 6; t++) {
            const corner = INDICES[t]!,
              px = corner < 2 ? -0.18 : 0.18,
              py = corner === 0 || corner === 3 ? -0.18 : 0.18;
            this.vertex(
              x + px * cos,
              y + py,
              z - px * sin,
              rect.x + (corner < 2 ? 0.5 : 15.5),
              rect.y + (corner === 0 || corner === 3 ? 15.5 : 0.5),
              light,
              0.1,
              spriteAtlas,
            );
          }
        }
      }
      if (pass === 0) terrainVertices = this.cursor / 7;
    }
    const itemVertices = this.cursor / 7;
    const yaw = c.camera.yaw,
      pitch = c.camera.pitch;
    const rx = -Math.sin(yaw),
      rz = Math.cos(yaw),
      ux = -Math.cos(yaw) * Math.sin(pitch),
      uy = Math.cos(pitch),
      uz = -Math.sin(yaw) * Math.sin(pitch);
    if (settings.particles)
      for (let n = 0; n < PARTICLE_CAPACITY; n++) {
        const p = c.particles.pool[n]!;
        if (!p.active) continue;
        const x = p.previous[0] + (p.pos[0] - p.previous[0]) * alpha,
          y = p.previous[1] + (p.pos[1] - p.previous[1]) * alpha,
          z = p.previous[2] + (p.pos[2] - p.previous[2]) * alpha;
        if (p.smoke) {
          hasEmbers = true;
          const fade = Math.max(0, 1 - (p.age + alpha) / p.lifetime);
          const size = 0.14 + (p.age + alpha) * 0.035;
          for (let t = 0; t < 6; t++) {
            const corner = INDICES[t]!;
            const sx = (corner < 2 ? -1 : 1) * size,
              sy = (corner === 0 || corner === 3 ? -1 : 1) * size;
            this.vertex(
              x + rx * sx + ux * sy,
              y + uy * sy,
              z + rz * sx + uz * sy,
              0,
              0,
              fade * 0.7,
              p.age < 2 ? -3 : -2,
            );
          }
          continue;
        }
        if (p.emberOwner !== null) {
          hasEmbers = true;
          const fade = Math.max(0, 1 - (p.age + alpha) / p.lifetime);
          for (let t = 0; t < 6; t++) {
            const corner = INDICES[t]!;
            const top = corner === 1 || corner === 2;
            const half = 0.022 * (0.6 + 0.4 * fade);
            const sx = (corner < 2 ? -1 : 1) * half;
            const sy = (top ? 1 : -1) * half;
            // A small, hot red square stays bright while drifting, then fades smoothly.
            this.vertex(
              x + rx * sx + ux * sy,
              y + uy * sy,
              z + rz * sx + uz * sy,
              0,
              0,
              Math.sqrt(fade),
              -1,
            );
          }
          continue;
        }
        const rect = this.faces[p.state]![p.face]!,
          light = this.light(world, x, y, z, skyBrightness),
          cutoff =
            registry.getResolvedState(p.state)!.definition.renderLayer === 'opaque' ? 0 : 0.1;
        for (let t = 0; t < 6; t++) {
          const corner = INDICES[t]!,
            sx = corner < 2 ? -0.045 : 0.045,
            sy = corner === 0 || corner === 3 ? -0.045 : 0.045;
          this.vertex(
            x + rx * sx + ux * sy,
            y + uy * sy,
            z + rz * sx + uz * sy,
            rect.x + p.u + (corner < 2 ? 0.5 : 2.5),
            rect.y + p.v + (corner === 0 || corner === 3 ? 2.5 : 0.5),
            light,
            cutoff,
          );
        }
      }
    const allVertices = this.cursor / 7,
      particleVertices = allVertices - itemVertices;
    this.triangles = allVertices / 3;
    if (!allVertices) return 0;
    const gl = this.wrapper.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    // WebGL2's offset/length overload avoids constructing a subarray every frame.
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.cursor);
    gl.uniformMatrix4fv(this.vp, false, vp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    if (terrainVertices) {
      this.wrapper.drawArrays(gl.TRIANGLES, 0, terrainVertices);
      this.itemDraws++;
    }
    const additionalVertices = itemVertices - terrainVertices;
    if (additionalVertices) {
      gl.bindTexture(gl.TEXTURE_2D, this.itemTexture);
      this.wrapper.drawArrays(gl.TRIANGLES, terrainVertices, additionalVertices);
      this.itemDraws++;
      gl.bindTexture(gl.TEXTURE_2D, texture);
    }
    gl.depthMask(false);
    if (particleVertices) {
      if (hasEmbers) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
      this.wrapper.drawArrays(gl.TRIANGLES, itemVertices, particleVertices);
      this.particleDraws = 1;
      if (hasEmbers) gl.disable(gl.BLEND);
    }
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
    return this.itemDraws + this.particleDraws;
  }
}
