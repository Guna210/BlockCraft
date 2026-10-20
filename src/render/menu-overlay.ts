import type { GLWrapper } from './gl';

const VS = `#version 300 es
uniform mat3 u_transform;
out vec2 v_uv;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  v_uv = corner;
  vec3 clip = u_transform * vec3(corner, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
uniform sampler2D u_image;
uniform float u_alpha;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_image, v_uv);
  fragColor = vec4(c.rgb, c.a * u_alpha);
}`;

/** One 2D canvas drawn into the WebGL frame as a textured quad. */
export interface OverlayLayer {
  source: HTMLCanvasElement;
  /** Re-upload the canvas before drawing it (its pixels changed). */
  dirty: boolean;
  texture: WebGLTexture | null;
}

export function overlayLayer(source: HTMLCanvasElement): OverlayLayer {
  return { source, dirty: true, texture: null };
}

/**
 * Composites the main menu's pixel-art canvases into the WebGL frame, after the panorama, so the
 * frame the canvas presents is the whole menu. Nearest filtering keeps the UI pixels square.
 */
export class MenuOverlayRenderer {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly transform: WebGLUniformLocation;
  private readonly alpha: WebGLUniformLocation;
  private readonly matrix = new Float32Array(9);

  constructor(private readonly wrapper: GLWrapper) {
    const gl = wrapper.gl;
    this.program = wrapper.createProgram(VS, FS);
    this.vao = wrapper.createVertexArray();
    this.transform = gl.getUniformLocation(this.program, 'u_transform')!;
    this.alpha = gl.getUniformLocation(this.program, 'u_alpha')!;
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_image'), 0);
  }

  /**
   * Draws `layer` with its top-left texel at (x, y) in canvas pixels, `w`×`h` canvas pixels large,
   * rotated by `angle` radians around its centre.
   */
  draw(
    layer: OverlayLayer,
    x: number,
    y: number,
    w: number,
    h: number,
    angle = 0,
    alpha = 1,
  ): void {
    const gl = this.wrapper.gl;
    if (!layer.texture) {
      layer.texture = this.wrapper.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, layer.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      layer.dirty = true;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, layer.texture);
    if (layer.dirty) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.source);
      layer.dirty = false;
    }

    // Unit quad → canvas pixels (scale, rotate about the centre, translate) → clip space.
    const cw = gl.drawingBufferWidth;
    const ch = gl.drawingBufferHeight;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const cx = x + w / 2;
    const cy = y + h / 2;
    // pixel(u, v) = centre + R · ((u - 0.5) w, (v - 0.5) h); clip = (2 px / cw - 1, 1 - 2 py / ch)
    const ax = cos * w,
      bx = -sin * h,
      ay = sin * w,
      by = cos * h;
    const tx = cx - 0.5 * ax - 0.5 * bx;
    const ty = cy - 0.5 * ay - 0.5 * by;
    const m = this.matrix;
    m[0] = (2 * ax) / cw;
    m[1] = (-2 * ay) / ch;
    m[2] = 0;
    m[3] = (2 * bx) / cw;
    m[4] = (-2 * by) / ch;
    m[5] = 0;
    m[6] = (2 * tx) / cw - 1;
    m[7] = 1 - (2 * ty) / ch;
    m[8] = 1;

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    // The canvas stays opaque: only colour is blended, destination alpha is kept.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.transform, false, m);
    gl.uniform1f(this.alpha, alpha);
    gl.bindVertexArray(this.vao);
    this.wrapper.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }
}
