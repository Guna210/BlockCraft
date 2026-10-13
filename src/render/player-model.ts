import { mat4 } from 'gl-matrix';
import type { GLWrapper } from './gl';
import type { TextureAtlas } from './atlas';
import type { PlayerController } from '../engine/player-controller';
import type { UnderwaterView } from './underwater';
import { GLSL_SKY_ATMOSPHERE } from './sky';

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in float a_shade;
layout(location=3) in float a_side;
uniform mat4 u_model;
uniform mat4 u_viewProj;
out vec2 v_uv;
flat out float v_side;
out float v_shade;
out vec3 v_worldPos;
void main() {
  vec4 world = u_model * vec4(a_pos, 1.0);
  v_worldPos = world.xyz;
  v_uv = a_uv;
  v_shade = a_shade;
  v_side = a_side;
  gl_Position = u_viewProj * world;
}`;
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
flat in float v_side;
in float v_shade;
in vec3 v_worldPos;
uniform sampler2D u_atlas;
uniform vec2 u_atlasSize;
uniform vec2 u_tile;
uniform vec2 u_headSides;
uniform bool u_isHead;
uniform float u_light;
uniform vec3 u_eye;
uniform vec3 u_sunDir;
uniform float u_dayFactor;
uniform float u_twilightFactor;
uniform float u_nightFactor;
uniform float u_fogStart;
uniform float u_fogEnd;
uniform bool u_underwater;
uniform vec3 u_waterFogColor;
out vec4 fragColor;
${GLSL_SKY_ATMOSPHERE}
void main() {
  vec2 tile = u_isHead && v_side > 0.5 ? u_headSides : u_tile;
  vec2 uv = (tile + clamp(v_uv * 16.0, vec2(0.5), vec2(15.5))) / u_atlasSize;
  vec3 color = texture(u_atlas, uv).rgb * u_light * v_shade;
  vec3 delta = v_worldPos - u_eye;
  float distance = u_underwater ? length(delta) : length(delta.xz);
  float fog = smoothstep(u_fogStart, u_fogEnd, distance);
  vec3 fogColor = u_underwater ? u_waterFogColor : skyAtmosphereColor(normalize(delta + vec3(0.0, 1e-5, 0.0)), u_sunDir, u_dayFactor, u_twilightFactor, u_nightFactor);
  fragColor = vec4(mix(color, fogColor, fog), 1.0);
}`;

const PARTS = [
  // pivot x/y/z, centre relative to pivot, dimensions, texture, swing sign
  [0, 1.35, 0, 0, 0.225, 0, 0.45, 0.45, 0.45, 'player_head', 0],
  [0, 0.7, 0, 0, 0.325, 0, 0.34, 0.65, 0.48, 'player_coat', 0],
  [0, 1.3, -0.34, 0, -0.3, 0, 0.22, 0.6, 0.18, 'player_coat', 1],
  [0, 1.3, 0.34, 0, -0.3, 0, 0.22, 0.6, 0.18, 'player_coat', -1],
  [0, 0.7, -0.13, 0, -0.35, 0, 0.25, 0.7, 0.2, 'player_leg', -1],
  [0, 0.7, 0.13, 0, -0.35, 0, 0.25, 0.7, 0.2, 'player_leg', 1],
] as const;

/** Six articulated boxes. Static geometry and procedural atlas skin are created once. */
export class PlayerModelRenderer {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly locations: Record<string, WebGLUniformLocation>;
  private readonly model = mat4.create();
  private readonly root = mat4.create();
  private readonly vector: [number, number, number] = [0, 0, 0];
  public lastPartDraws = 0;
  constructor(private readonly wrapper: GLWrapper) {
    const gl = wrapper.gl;
    this.program = wrapper.createProgram(VS, FS);
    this.locations = Object.fromEntries(
      [
        'model',
        'viewProj',
        'atlas',
        'atlasSize',
        'tile',
        'headSides',
        'isHead',
        'light',
        'eye',
        'sunDir',
        'dayFactor',
        'twilightFactor',
        'nightFactor',
        'fogStart',
        'fogEnd',
        'underwater',
        'waterFogColor',
      ].map((name) => [name, gl.getUniformLocation(this.program, `u_${name}`)!]),
    );
    this.vao = wrapper.createVertexArray();
    const buffer = wrapper.createBuffer();
    const faces = [
      [
        [0.5, -0.5, -0.5],
        [0.5, 0.5, -0.5],
        [0.5, 0.5, 0.5],
        [0.5, -0.5, 0.5],
      ],
      [
        [-0.5, -0.5, 0.5],
        [-0.5, 0.5, 0.5],
        [-0.5, 0.5, -0.5],
        [-0.5, -0.5, -0.5],
      ],
      [
        [-0.5, 0.5, 0.5],
        [0.5, 0.5, 0.5],
        [0.5, 0.5, -0.5],
        [-0.5, 0.5, -0.5],
      ],
      [
        [-0.5, -0.5, -0.5],
        [0.5, -0.5, -0.5],
        [0.5, -0.5, 0.5],
        [-0.5, -0.5, 0.5],
      ],
      [
        [0.5, -0.5, 0.5],
        [0.5, 0.5, 0.5],
        [-0.5, 0.5, 0.5],
        [-0.5, -0.5, 0.5],
      ],
      [
        [-0.5, -0.5, -0.5],
        [-0.5, 0.5, -0.5],
        [0.5, 0.5, -0.5],
        [0.5, -0.5, -0.5],
      ],
    ];
    const vertices: number[] = [];
    faces.forEach((corners, face) => {
      for (const index of [0, 1, 2, 0, 2, 3])
        vertices.push(
          ...corners[index]!,
          index < 2 ? 0 : 1,
          index === 0 || index === 3 ? 1 : 0,
          face === 2 ? 1 : face === 3 ? 0.5 : 0.8,
          face === 0 ? 0 : 1,
        );
    });
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
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
  render(
    controller: PlayerController | null,
    viewProj: mat4,
    atlasTexture: WebGLTexture,
    atlas: TextureAtlas,
    underwater: UnderwaterView,
    skyBrightness: number,
    sunDir: readonly [number, number, number],
    day: number,
    twilight: number,
    night: number,
    fogStart: number,
    fogEnd: number,
  ): number {
    this.lastPartDraws = 0;
    const p = controller?.player;
    if (!controller || !p || p.detached || controller.perspective === 0) return 0;
    const gl = this.wrapper.gl,
      loc = this.locations;
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    gl.uniform1i(loc.atlas!, 0);
    gl.uniform2f(loc.atlasSize!, atlas.width, atlas.height);
    const hair = atlas.rects.get('player_hair')!;
    gl.uniform2f(loc.headSides!, hair.x, hair.y);
    gl.uniformMatrix4fv(loc.viewProj!, false, viewProj);
    gl.uniform3fv(loc.eye!, controller.camera.position);
    gl.uniform3fv(loc.sunDir!, sunDir);
    gl.uniform1f(loc.dayFactor!, day);
    gl.uniform1f(loc.twilightFactor!, twilight);
    gl.uniform1f(loc.nightFactor!, night);
    gl.uniform1f(loc.fogStart!, fogStart);
    gl.uniform1f(loc.fogEnd!, fogEnd);
    gl.uniform1i(loc.underwater!, underwater.submerged ? 1 : 0);
    gl.uniform3fv(loc.waterFogColor!, underwater.fogColor);
    const light = p.collision.world.getLight(
      Math.floor(p.pos[0]),
      Math.floor(p.pos[1] + 1),
      Math.floor(p.pos[2]),
    );
    gl.uniform1f(
      loc.light!,
      Math.max(
        0.04,
        (0.04 + (0.96 * light.sky) / 15) * skyBrightness,
        0.04 + (0.96 * light.block) / 15,
        underwater.brightnessFloor,
      ),
    );
    const alpha = controller.renderAlpha;
    for (let axis = 0; axis < 3; axis++)
      this.vector[axis] = p.previous[axis]! + (p.pos[axis]! - p.previous[axis]!) * alpha;
    mat4.fromTranslation(this.root, this.vector);
    mat4.rotateY(this.root, this.root, -p.yaw);
    const distance = p.previousWalkDistance + (p.walkDistance - p.previousWalkDistance) * alpha;
    const amount = p.previousWalkAmount + (p.walkAmount - p.previousWalkAmount) * alpha;
    const swing = Math.sin((distance * Math.PI * 2) / 1.7) * 0.65 * amount;
    gl.bindVertexArray(this.vao);
    for (const part of PARTS) {
      mat4.copy(this.model, this.root);
      this.vector[0] = part[0];
      this.vector[1] = part[1];
      this.vector[2] = part[2];
      mat4.translate(this.model, this.model, this.vector);
      if (part[10]) mat4.rotateZ(this.model, this.model, swing * part[10]);
      if (part[9] === 'player_head') mat4.rotateZ(this.model, this.model, p.pitch * 0.3);
      this.vector[0] = part[3];
      this.vector[1] = part[4];
      this.vector[2] = part[5];
      mat4.translate(this.model, this.model, this.vector);
      this.vector[0] = part[6];
      this.vector[1] = part[7];
      this.vector[2] = part[8];
      mat4.scale(this.model, this.model, this.vector);
      gl.uniformMatrix4fv(loc.model!, false, this.model);
      gl.uniform1i(loc.isHead!, part[9] === 'player_head' ? 1 : 0);
      const rect = atlas.rects.get(part[9])!;
      gl.uniform2f(loc.tile!, rect.x, rect.y);
      this.wrapper.drawArrays(gl.TRIANGLES, 0, 36);
      this.lastPartDraws++;
    }
    gl.bindVertexArray(null);
    return this.lastPartDraws;
  }
}
