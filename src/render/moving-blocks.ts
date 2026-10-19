import type { mat4 } from 'gl-matrix';
import type { GLWrapper } from './gl';
import type { TextureAtlas, AtlasRect as TileRect } from './atlas';
import { CORNERS, FACES, FS, INDICES, VS, worldLight } from './drops';
import { BlockRegistry } from '../world/blocks/registry';
import { CUBE_BOX, stateBoxes, type Box } from '../world/shape-geometry';
import type { World } from '../world/world';

/** Most blocks in flight at once: a 12-block push plus its head, and room for several pistons. */
const CAPACITY = 128;
const FLOATS_PER_VERTEX = 7;
const VERTICES_PER_BOX = 36;
const MAX_BOXES_PER_PART = 3;

/**
 * Draws the blocks a piston is sliding. Each one is a `piston_moving` cell in the world, which the
 * mesher skips; this renderer draws the carried block at its cell plus the interpolated offset, so
 * it glides instead of snapping from cell to cell.
 */
export class MovingBlockRenderer {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;
  private readonly vp: WebGLUniformLocation;
  private readonly data = new Float32Array(
    CAPACITY * MAX_BOXES_PER_PART * VERTICES_PER_BOX * FLOATS_PER_VERTEX,
  );
  private readonly faces: Array<readonly TileRect[]> = [];
  private disposed = false;
  draws = 0;
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
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.wrapper.deleteBuffer(this.buffer);
    this.wrapper.deleteVertexArray(this.vao);
    this.wrapper.deleteProgram(this.program);
  }

  private tiles(state: number): readonly TileRect[] {
    let rects = this.faces[state];
    if (!rects) {
      const registry = BlockRegistry.getInstance();
      rects = FACES.map((face) => {
        const name = registry.getFaceTexture(state, face) ?? '__missing_texture__';
        return (this.atlas.rects.get(name) ?? this.atlas.rects.get(`${name}_0`))!;
      });
      this.faces[state] = rects;
    }
    return rects;
  }

  /** `alpha` is the fraction of the current tick that has passed. */
  render(
    world: World | null,
    vp: mat4,
    texture: WebGLTexture,
    skyBrightness: number,
    alpha: number,
  ): number {
    this.draws = this.triangles = 0;
    if (this.disposed || !world) return 0;
    const views = world.current.mechanics.movingBlocks();
    if (views.length === 0) return 0;
    const registry = BlockRegistry.getInstance();
    const d = this.data;
    let n = 0;
    for (const view of views.slice(0, CAPACITY)) {
      const progress = Math.max(
        0,
        Math.min(1, (world.ticks.time + alpha - view.start) / view.duration),
      );
      const light = worldLight(world, view.x + 0.5, view.y + 0.5, view.z + 0.5, skyBrightness);
      for (const part of view.parts) {
        const resolved = registry.getResolvedState(part.stateId);
        if (!resolved || part.stateId === 0) continue;
        const rects = this.tiles(part.stateId);
        const boxes: readonly Box[] =
          resolved.definition.fullOpaqueCube || resolved.definition.model === undefined
            ? [CUBE_BOX]
            : (stateBoxes(resolved) ?? [CUBE_BOX]);
        const cutoff = resolved.definition.renderLayer === 'opaque' ? 0 : 0.1;
        const ox = view.x + part.from[0]! + view.move[0]! * progress;
        const oy = view.y + part.from[1]! + view.move[1]! * progress;
        const oz = view.z + part.from[2]! + view.move[2]! * progress;
        for (const box of boxes.slice(0, MAX_BOXES_PER_PART)) {
          for (let face = 0; face < 6; face++) {
            const rect = rects[face]!;
            const shade = face === 2 ? 1 : face === 3 ? 0.55 : 0.82;
            const corners = CORNERS[face]!;
            // The tile's u axis runs from corner 1 to corner 2 and v from corner 1 (top) to corner 0.
            const uAxis =
              corners[2]![0] !== corners[1]![0] ? 0 : corners[2]![1] !== corners[1]![1] ? 1 : 2;
            const vAxis =
              corners[0]![0] !== corners[1]![0] ? 0 : corners[0]![1] !== corners[1]![1] ? 1 : 2;
            for (let t = 0; t < 6; t++) {
              const corner = INDICES[t]!;
              const flags = corners[corner]!;
              const px = flags[0] ? box[3] : box[0];
              const py = flags[1] ? box[4] : box[1];
              const pz = flags[2] ? box[5] : box[2];
              const p = [px, py, pz];
              const u = corners[2]![uAxis] === 1 ? p[uAxis]! : 1 - p[uAxis]!;
              const toward = corners[1]![vAxis] === 1 ? p[vAxis]! : 1 - p[vAxis]!;
              const v = 1 - toward;
              d[n++] = ox + px;
              d[n++] = oy + py;
              d[n++] = oz + pz;
              d[n++] = (rect.x + 0.5 + u * 15) / this.atlas.width;
              d[n++] = (rect.y + 0.5 + v * 15) / this.atlas.height;
              d[n++] = light * shade;
              d[n++] = cutoff;
            }
          }
        }
      }
    }
    const vertices = n / FLOATS_PER_VERTEX;
    if (!vertices) return 0;
    this.triangles = vertices / 3;
    const gl = this.wrapper.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n);
    gl.uniformMatrix4fv(this.vp, false, vp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    this.wrapper.drawArrays(gl.TRIANGLES, 0, vertices);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
    this.draws = 1;
    return 1;
  }
}
