// Helper to format shader error logs
export function formatShaderError(log: string, source: string): string {
  // ANGLE/Chromium typically logs: ERROR: 0:12: 'foo' : undeclared identifier
  // The numbers are file:line.
  const lines = log.split('\n');
  const sourceLines = source.split('\n');
  const outLines: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^ERROR:\s*\d+:(\d+):/);
    if (match) {
      const lineNum = parseInt(match[1]!, 10);
      outLines.push(line);
      // Give some context
      if (lineNum > 0 && lineNum <= sourceLines.length) {
        outLines.push(`    ${lineNum}: ${sourceLines[lineNum - 1]}`);
      }
    } else {
      outLines.push(line);
    }
  }

  return outLines.join('\n');
}

export type ResourceCounts = {
  buffers: number;
  vaos: number;
  textures: number;
  shaders: number; // Includes both shaders and programs
};

export class GLWrapper {
  public gl: WebGL2RenderingContext;
  private debug: boolean;
  private onErrorCallback?: () => void;

  private counts: ResourceCounts = {
    buffers: 0,
    vaos: 0,
    textures: 0,
    shaders: 0,
  };

  constructor(gl: WebGL2RenderingContext, debug: boolean, onErrorCallback?: () => void) {
    this.gl = gl;
    this.debug = debug;
    this.onErrorCallback = onErrorCallback;
  }

  getCounts(): ResourceCounts {
    return { ...this.counts };
  }

  private checkErrors() {
    if (!this.debug) return;
    let error = this.gl.getError();
    while (error !== this.gl.NO_ERROR) {
      if (this.onErrorCallback) this.onErrorCallback();
      error = this.gl.getError();
    }
  }

  drawArrays(mode: number, first: number, count: number) {
    this.gl.drawArrays(mode, first, count);
    this.checkErrors();
  }

  drawElements(mode: number, count: number, type: number, offset: number) {
    this.gl.drawElements(mode, count, type, offset);
    this.checkErrors();
  }

  // --- Programs & Shaders ---

  createShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error('Could not create WebGL shader.');
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const log = this.gl.getShaderInfoLog(shader) || '';
      const formatted = formatShaderError(log, source);
      this.gl.deleteShader(shader);
      throw new Error(`Shader compilation failed:\n${formatted}`);
    }

    this.counts.shaders++;
    return shader;
  }

  deleteShader(shader: WebGLShader) {
    this.gl.deleteShader(shader);
    this.counts.shaders--;
  }

  createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const vs = this.createShader(this.gl.VERTEX_SHADER, vertexSource);
    let fs: WebGLShader;
    try {
      fs = this.createShader(this.gl.FRAGMENT_SHADER, fragmentSource);
    } catch (e) {
      this.deleteShader(vs);
      throw e;
    }

    const program = this.gl.createProgram();
    if (!program) {
      this.deleteShader(vs);
      this.deleteShader(fs);
      throw new Error('Could not create WebGL program.');
    }

    this.gl.attachShader(program, vs);
    this.gl.attachShader(program, fs);
    this.gl.linkProgram(program);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const log = this.gl.getProgramInfoLog(program);
      this.gl.deleteProgram(program);
      this.deleteShader(vs);
      this.deleteShader(fs);
      throw new Error(`Program link failed: ${log}`);
    }

    // Shaders can be detached and deleted after linking
    this.gl.detachShader(program, vs);
    this.gl.detachShader(program, fs);
    this.deleteShader(vs);
    this.deleteShader(fs);

    this.counts.shaders++;
    return program;
  }

  deleteProgram(program: WebGLProgram) {
    this.gl.deleteProgram(program);
    this.counts.shaders--;
  }

  // --- Buffers ---

  createBuffer(): WebGLBuffer {
    const buffer = this.gl.createBuffer();
    if (!buffer) throw new Error('Could not create WebGL buffer.');
    this.counts.buffers++;
    return buffer;
  }

  deleteBuffer(buffer: WebGLBuffer) {
    this.gl.deleteBuffer(buffer);
    this.counts.buffers--;
  }

  // --- VAOs ---

  createVertexArray(): WebGLVertexArrayObject {
    const vao = this.gl.createVertexArray();
    if (!vao) throw new Error('Could not create WebGL VAO.');
    this.counts.vaos++;
    return vao;
  }

  deleteVertexArray(vao: WebGLVertexArrayObject) {
    this.gl.deleteVertexArray(vao);
    this.counts.vaos--;
  }

  // --- Textures ---

  createTexture(): WebGLTexture {
    const texture = this.gl.createTexture();
    if (!texture) throw new Error('Could not create WebGL texture.');
    this.counts.textures++;
    return texture;
  }

  deleteTexture(texture: WebGLTexture) {
    this.gl.deleteTexture(texture);
    this.counts.textures--;
  }
}
