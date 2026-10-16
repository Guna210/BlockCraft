import type { GLWrapper } from './gl';
import type { mat4 } from 'gl-matrix';
import type { TextureAtlas } from './atlas';
import type { GPUSectionMesh } from './chunk-renderer';
import { WALL_TORCH_GLSL } from '../mesh/wall-torch';
import { VERTEX_LAYOUT } from '../mesh/vertex';
import { bayerGlsl } from './dither';

const VS_DEPTH = `#version 300 es
precision highp float;
layout(location=0) in uint a_word0;
layout(location=1) in uint a_word1;
uniform mat4 u_viewProj;
uniform vec3 u_sectionOrigin;
#ifdef CUTOUT
uniform vec2 u_atlasSize;
out vec2 v_uv;
flat out vec2 v_tileOrigin;
#endif
${WALL_TORCH_GLSL}
void main() {
  uint normal=(a_word0>>15u)&7u;
  uint material=a_word0>>28u;
  bool fluid=material==4u || material==5u;
  vec3 p=vec3(float(a_word0&31u),float((a_word0>>5u)&31u),float((a_word0>>10u)&31u));
  p.y += fluid ? -float((a_word1>>12u)&63u)/64.0 : float((a_word1>>30u)&1u)*0.5;
  vec2 uv=vec2(float((a_word1>>${VERTEX_LAYOUT.uShift}u)&31u),float((a_word1>>${VERTEX_LAYOUT.vShift}u)&31u));
  if(normal>=6u) p+=wallTorchOffset(uv.x,uv.y,normal-6u,material);
  else if(!fluid) {
    float inset=float(a_word1>>31u)/32.0;
    if(normal==0u) p.x+=inset;
    if(normal==1u) p.x-=inset;
    if(normal==4u) p.z+=inset;
    if(normal==5u) p.z-=inset;
  }
  #ifdef CUTOUT
  uint tile=a_word1&${VERTEX_LAYOUT.tileMask}u;
  uint columns=uint(u_atlasSize.x/24.0);
  v_tileOrigin=(vec2(float(tile%columns),float(tile/columns))*24.0+4.0)/u_atlasSize;
  v_uv=uv;
  #endif
  gl_Position=u_viewProj*vec4(u_sectionOrigin+p,1.0);
}`;
const FS_DEPTH = `#version 300 es
precision highp float;
uniform float u_fade;
const float BAYER_4X4[16]=${bayerGlsl()};
#ifdef CUTOUT
in vec2 v_uv;
flat in vec2 v_tileOrigin;
uniform sampler2D u_atlasSampler;
uniform vec2 u_atlasSize;
#endif
void main() {
  ivec2 pixel=ivec2(gl_FragCoord.xy);
  if(u_fade<1.0 && BAYER_4X4[(pixel.y&3)*4+(pixel.x&3)]>=u_fade) discard;
  #ifdef CUTOUT
  vec2 size=vec2(16.0)/u_atlasSize;
  vec2 halfTexel=vec2(0.5)/u_atlasSize;
  vec2 uv=clamp(v_tileOrigin+fract(v_uv)*size,v_tileOrigin+halfTexel,v_tileOrigin+size-halfTexel);
  if(textureGrad(u_atlasSampler,uv,dFdx(v_uv)*size,dFdy(v_uv)*size).a<0.5) discard;
  #endif
}`;

/** The opaque/cutout pass supplies scene depth before any translucent writes. */
export class FluidDepth {
  private texture: WebGLTexture | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private width = 0;
  private height = 0;
  private programs: WebGLProgram[];
  private locations: Array<Record<string, WebGLUniformLocation>>;
  constructor(private wrapper: GLWrapper) {
    const cutout = (source: string) =>
      source.replace('#version 300 es', '#version 300 es\n#define CUTOUT');
    this.programs = [
      wrapper.createProgram(VS_DEPTH, FS_DEPTH),
      wrapper.createProgram(cutout(VS_DEPTH), cutout(FS_DEPTH)),
    ];
    this.locations = this.programs.map((program) =>
      Object.fromEntries(
        ['viewProj', 'sectionOrigin', 'fade', 'atlasSampler', 'atlasSize'].map((name) => [
          name,
          wrapper.gl.getUniformLocation(program, `u_${name}`)!,
        ]),
      ),
    );
  }
  render(
    viewProj: mat4,
    atlas: TextureAtlas,
    columns: readonly GPUSectionMesh[][],
    fades: readonly number[],
  ): { draws: number; triangles: number } {
    const gl = this.wrapper.gl;
    let draws = 0,
      triangles = 0;
    this.capture(() => {
      for (let pass = 0; pass < 2; pass++) {
        gl.useProgram(this.programs[pass]!);
        const loc = this.locations[pass]!;
        gl.uniformMatrix4fv(loc.viewProj!, false, viewProj);
        if (pass === 1) {
          gl.uniform1i(loc.atlasSampler!, 0);
          gl.uniform2f(loc.atlasSize!, atlas.width, atlas.height);
        }
        for (let c = 0; c < columns.length; c++) {
          gl.uniform1f(loc.fade!, fades[c]!);
          for (const mesh of columns[c]!) {
            const bucket = pass === 0 ? mesh.opaque : mesh.cutout;
            if (!bucket) continue;
            gl.uniform3f(loc.sectionOrigin!, mesh.sx * 16, mesh.sy * 16, mesh.sz * 16);
            gl.bindVertexArray(bucket.vao);
            this.wrapper.drawElements(gl.TRIANGLES, bucket.indexCount, gl.UNSIGNED_INT, 0);
            draws++;
            triangles += bucket.indexCount / 3;
          }
        }
      }
    });
    return { draws, triangles };
  }
  private capture(draw: () => void): void {
    const gl = this.wrapper.gl;
    if (
      this.width !== gl.drawingBufferWidth ||
      this.height !== gl.drawingBufferHeight ||
      !this.texture
    ) {
      this.dispose();
      this.width = gl.drawingBufferWidth;
      this.height = gl.drawingBufferHeight;
      this.texture = this.wrapper.createTexture();
      this.framebuffer = gl.createFramebuffer();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.DEPTH_COMPONENT24,
        this.width,
        this.height,
        0,
        gl.DEPTH_COMPONENT,
        gl.UNSIGNED_INT,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(
        gl.DRAW_FRAMEBUFFER,
        gl.DEPTH_ATTACHMENT,
        gl.TEXTURE_2D,
        this.texture,
        0,
      );
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    draw();
    gl.activeTexture(gl.TEXTURE4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
  }
  dispose(): void {
    if (this.texture) this.wrapper.deleteTexture(this.texture);
    if (this.framebuffer) this.wrapper.gl.deleteFramebuffer(this.framebuffer);
    this.texture = null;
    this.framebuffer = null;
  }
}
