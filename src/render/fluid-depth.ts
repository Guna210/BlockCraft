import type { GLWrapper } from './gl';

/** The opaque/cutout pass supplies scene depth before any translucent writes. */
export class FluidDepth {
  private texture: WebGLTexture | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private width = 0;
  private height = 0;
  constructor(private wrapper: GLWrapper) {}

  capture(): void {
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
        gl.getParameter(gl.DEPTH_BITS) === 32 ? gl.DEPTH32F_STENCIL8 : gl.DEPTH24_STENCIL8,
        this.width,
        this.height,
        0,
        gl.DEPTH_STENCIL,
        gl.getParameter(gl.DEPTH_BITS) === 32
          ? gl.FLOAT_32_UNSIGNED_INT_24_8_REV
          : gl.UNSIGNED_INT_24_8,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(
        gl.DRAW_FRAMEBUFFER,
        gl.DEPTH_STENCIL_ATTACHMENT,
        gl.TEXTURE_2D,
        this.texture,
        0,
      );
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
    }
    // Stencil is requested on the default context so its packed depth format
    // is explicit. Resolving that existing depth avoids redrawing the world.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.framebuffer);
    gl.blitFramebuffer(
      0,
      0,
      this.width,
      this.height,
      0,
      0,
      this.width,
      this.height,
      gl.DEPTH_BUFFER_BIT,
      gl.NEAREST,
    );
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
