import type { GLWrapper } from './gl';

/** The opaque/cutout pass supplies scene depth before any translucent writes. */
export class FluidDepth {
  private texture: WebGLTexture | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private width = 0;
  private height = 0;
  constructor(private wrapper: GLWrapper) {}
  capture(draw: () => void): void {
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
