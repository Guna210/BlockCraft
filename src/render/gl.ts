import { renderPhaseStats } from '../engine/render-phase-stats';

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
  public readonly perDrawChecks: boolean;
  public readonly debugInspection: boolean;
  private onErrorCallback?: () => void;
  private onDrawSubmission?: () => void;
  private debugFrameActive = false;
  private debugFirstDrawSeen = false;
  private frameTerrainGpuWritesAfterFirstDraw = 0;
  private pendingTerrainGpuWritesAfterFrame = 0;
  private lastTerrainGpuWritesAfterFirstDraw = 0;

  private counts: ResourceCounts = {
    buffers: 0,
    vaos: 0,
    textures: 0,
    shaders: 0,
  };

  constructor(
    gl: WebGL2RenderingContext,
    perDrawChecks: boolean,
    onErrorCallback?: () => void,
    debugInspection = false,
    onDrawSubmission?: () => void,
  ) {
    this.gl = gl;
    this.perDrawChecks = perDrawChecks;
    this.debugInspection = debugInspection;
    this.onErrorCallback = onErrorCallback;
    this.onDrawSubmission = onDrawSubmission;
  }

  getCounts(): ResourceCounts {
    return { ...this.counts };
  }

  private checkErrors() {
    if (!this.perDrawChecks) return;
    this.drainErrors();
  }

  beginDebugFrame(): void {
    // A pinned load can start uploading for the next presentation before its rAF arrives.
    // Preserve every write already observed when that frame resumes.
    if (!this.debugInspection || this.debugFrameActive) return;
    this.debugFrameActive = true;
    this.debugFirstDrawSeen = false;
    this.frameTerrainGpuWritesAfterFirstDraw = this.pendingTerrainGpuWritesAfterFrame;
    this.pendingTerrainGpuWritesAfterFrame = 0;
  }

  endDebugFrame(): number {
    if (!this.debugInspection) return 0;
    this.debugFrameActive = false;
    this.lastTerrainGpuWritesAfterFirstDraw = this.frameTerrainGpuWritesAfterFirstDraw;
    return this.lastTerrainGpuWritesAfterFirstDraw;
  }

  /** A clear starts the render pass on backends that begin it before their first draw call. */
  recordRenderPassStart(): void {
    if (this.debugInspection) this.debugFirstDrawSeen = true;
  }

  getLastTerrainGpuWritesAfterFirstDraw(): number {
    return this.debugInspection ? this.lastTerrainGpuWritesAfterFirstDraw : 0;
  }

  /** Counts terrain data uploads after the first WebGL draw of this frame, in debug builds only. */
  recordTerrainGpuWrite(): void {
    if (!this.debugInspection || !this.debugFirstDrawSeen) return;
    if (this.debugFrameActive) this.frameTerrainGpuWritesAfterFirstDraw++;
    else this.pendingTerrainGpuWritesAfterFrame++;
  }

  recordDrawSubmission(): void {
    if (this.debugInspection) this.debugFirstDrawSeen = true;
    this.onDrawSubmission?.();
  }

  /**
   * Reads gl.getError() until NO_ERROR and calls the error callback once per error, whether or not
   * per-draw checking is on. Debug mode calls this once per frame (decisions/M01a-fix-gl-error-check.md).
   */
  drainErrors(): void {
    let error = this.gl.getError();
    while (error !== this.gl.NO_ERROR) {
      if (this.onErrorCallback) this.onErrorCallback();
      error = this.gl.getError();
    }
  }

  drawArrays(mode: number, first: number, count: number) {
    const start = renderPhaseStats.start();
    this.gl.drawArrays(mode, first, count);
    this.recordDrawSubmission();
    renderPhaseStats.end('drawSubmissionMs', start);
    this.checkErrors();
  }

  drawElements(mode: number, count: number, type: number, offset: number) {
    const start = renderPhaseStats.start();
    this.gl.drawElements(mode, count, type, offset);
    this.recordDrawSubmission();
    renderPhaseStats.end('drawSubmissionMs', start);
    this.checkErrors();
  }

  // --- Programs & Shaders ---

  createShader(type: number, source: string, checkStatus = true): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error('Could not create WebGL shader.');
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (checkStatus && !this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
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

    let program: WebGLProgram | undefined;
    try {
      program = this.linkProgram(vs, fs);
      this.checkProgramLink(program);
      this.gl.detachShader(program, vs);
      this.gl.detachShader(program, fs);
      return program;
    } catch (e) {
      if (program) this.deleteProgram(program);
      throw e;
    } finally {
      this.deleteShader(vs);
      this.deleteShader(fs);
    }
  }

  linkProgram(vs: WebGLShader, fs: WebGLShader): WebGLProgram {
    const program = this.gl.createProgram();
    if (!program) throw new Error('Could not create WebGL program.');
    this.gl.attachShader(program, vs);
    this.gl.attachShader(program, fs);
    this.gl.linkProgram(program);
    this.counts.shaders++;
    return program;
  }

  checkProgramLink(program: WebGLProgram): void {
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${this.gl.getProgramInfoLog(program)}`);
    }
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
