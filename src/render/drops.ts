import type { mat4 } from 'gl-matrix';
import type { GLWrapper } from './gl';
import type { TextureAtlas, AtlasRect as TileRect } from './atlas';
import type { PlayerController } from '../engine/player-controller';
import { BlockRegistry } from '../world/blocks/registry';
import type { BlockFaceDirection } from '../world/blocks/types';
import { items } from '../gameplay/items';
import { ITEM_CAPACITY } from '../entity/item-entity';
import { PARTICLE_CAPACITY } from './particles';
import type { World } from '../world/world';

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;layout(location=1) in vec2 a_uv;
layout(location=2) in float a_light;layout(location=3) in float a_cutoff;
uniform mat4 u_vp;out vec2 v_uv;out float v_light;flat out float v_cutoff;
void main(){v_uv=a_uv;v_light=a_light;v_cutoff=a_cutoff;gl_Position=u_vp*vec4(a_pos,1.0);}`;
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;in float v_light;flat in float v_cutoff;uniform sampler2D u_atlas;out vec4 color;
void main(){vec4 tex=texture(u_atlas,v_uv);if(tex.a<v_cutoff)discard;color=vec4(tex.rgb*v_light,1.0);}`;
const FACES: readonly BlockFaceDirection[] = ['east', 'west', 'top', 'bottom', 'south', 'north'];
const CORNERS = [
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
const INDICES = [0, 1, 2, 0, 2, 3];

/** Two batched submissions, persistent CPU/GPU buffers, and cached per-state atlas faces. */
export class DropRenderer {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;
  private readonly vp: WebGLUniformLocation;
  private readonly data = new Float32Array((ITEM_CAPACITY * 36 + PARTICLE_CAPACITY * 6) * 7);
  private readonly faces: Array<readonly TileRect[]> = [];
  private readonly sprites = new Map<string, TileRect>();
  private cursor = 0;
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
        if (!rect) throw new Error(`Missing item sprite: ${item.id}`);
        this.sprites.set(item.id, rect);
      }
  }
  private light(world: World, x: number, y: number, z: number, skyBrightness: number): number {
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
  private vertex(
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    light: number,
    cutoff = 0.1,
  ): void {
    const d = this.data;
    let n = this.cursor;
    d[n++] = x;
    d[n++] = y;
    d[n++] = z;
    d[n++] = u / this.atlas.width;
    d[n++] = v / this.atlas.height;
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
    if (!c?.player || !c.itemEntities || !c.particles) return 0;
    const alpha = c.renderAlpha,
      world = c.player.collision.world,
      registry = BlockRegistry.getInstance();
    for (let n = 0; n < ITEM_CAPACITY; n++) {
      const e = c.itemEntities.pool[n]!;
      if (!e.active) continue;
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
        const rect = this.sprites.get(e.item.id)!;
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
          );
        }
      }
    }
    const itemVertices = this.cursor / 7;
    const yaw = c.camera.yaw,
      pitch = c.camera.pitch;
    const rx = -Math.sin(yaw),
      rz = Math.cos(yaw),
      ux = -Math.cos(yaw) * Math.sin(pitch),
      uy = Math.cos(pitch),
      uz = -Math.sin(yaw) * Math.sin(pitch);
    for (let n = 0; n < PARTICLE_CAPACITY; n++) {
      const p = c.particles.pool[n]!;
      if (!p.active) continue;
      const x = p.previous[0] + (p.pos[0] - p.previous[0]) * alpha,
        y = p.previous[1] + (p.pos[1] - p.previous[1]) * alpha,
        z = p.previous[2] + (p.pos[2] - p.previous[2]) * alpha;
      const rect = this.faces[p.state]![p.face]!,
        light = this.light(world, x, y, z, skyBrightness),
        cutoff = registry.getResolvedState(p.state)!.definition.renderLayer === 'opaque' ? 0 : 0.1;
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
    if (itemVertices) {
      this.wrapper.drawArrays(gl.TRIANGLES, 0, itemVertices);
      this.itemDraws = 1;
    }
    gl.depthMask(false);
    if (particleVertices) {
      this.wrapper.drawArrays(gl.TRIANGLES, itemVertices, particleVertices);
      this.particleDraws = 1;
    }
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
    return this.itemDraws + this.particleDraws;
  }
}
