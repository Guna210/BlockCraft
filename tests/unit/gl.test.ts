import { describe, it, expect } from 'vitest';
import { GLWrapper, formatShaderError } from '../../src/render/gl';

// Mock WebGL2RenderingContext
class MockWebGL2RenderingContext {
  NO_ERROR = 0;
  VERTEX_SHADER = 35633;
  FRAGMENT_SHADER = 35632;
  COMPILE_STATUS = 35713;
  LINK_STATUS = 35714;

  errorQueue: number[] = [0];

  getError() {
    if (this.errorQueue.length > 1) {
      return this.errorQueue.shift() as number;
    }
    return this.errorQueue[0] as number;
  }

  drawArrays() {}
  drawElements() {}

  createShader() {
    return {};
  }
  shaderSource() {}
  compileShader() {}
  getShaderParameter(_shader: WebGLShader, pname: number) {
    if (pname === this.COMPILE_STATUS) return true;
    return true;
  }
  getShaderInfoLog() {
    return '';
  }
  deleteShader() {}

  createProgram() {
    return {};
  }
  attachShader() {}
  linkProgram() {}
  getProgramParameter(_program: WebGLProgram, pname: number) {
    if (pname === this.LINK_STATUS) return true;
    return true;
  }
  getProgramInfoLog() {
    return '';
  }
  detachShader() {}
  deleteProgram() {}

  createBuffer() {
    return {};
  }
  deleteBuffer() {}

  createVertexArray() {
    return {};
  }
  deleteVertexArray() {}

  createTexture() {
    return {};
  }
  deleteTexture() {}
}

describe('GLWrapper', () => {
  it('tracks resources correctly', () => {
    const gl = new MockWebGL2RenderingContext() as unknown as WebGL2RenderingContext;
    const wrapper = new GLWrapper(gl, false);

    expect(wrapper.getCounts()).toEqual({ buffers: 0, vaos: 0, textures: 0, shaders: 0 });

    const buf = wrapper.createBuffer();
    expect(wrapper.getCounts().buffers).toBe(1);

    const vao = wrapper.createVertexArray();
    expect(wrapper.getCounts().vaos).toBe(1);

    const tex = wrapper.createTexture();
    expect(wrapper.getCounts().textures).toBe(1);

    const prog = wrapper.createProgram('vs', 'fs');
    // Shaders are created and deleted during program creation
    expect(wrapper.getCounts().shaders).toBe(1);

    wrapper.deleteBuffer(buf);
    expect(wrapper.getCounts().buffers).toBe(0);

    wrapper.deleteVertexArray(vao);
    expect(wrapper.getCounts().vaos).toBe(0);

    wrapper.deleteTexture(tex);
    expect(wrapper.getCounts().textures).toBe(0);

    wrapper.deleteProgram(prog);
    expect(wrapper.getCounts().shaders).toBe(0);
  });

  it('checks gl.getError() in debug mode until NO_ERROR', () => {
    const mockGl = new MockWebGL2RenderingContext();
    const gl = mockGl as unknown as WebGL2RenderingContext;
    let errCount = 0;

    const wrapper = new GLWrapper(gl, true, () => {
      errCount++;
    });

    mockGl.errorQueue = [1282, 1281, 1280, 0]; // 3 errors then NO_ERROR

    wrapper.drawArrays(0, 0, 1);

    expect(errCount).toBe(3);
    expect(mockGl.getError()).toBe(0);
  });

  it('does not check gl.getError() if debug is false', () => {
    const mockGl = new MockWebGL2RenderingContext();
    const gl = mockGl as unknown as WebGL2RenderingContext;
    let errCount = 0;

    const wrapper = new GLWrapper(gl, false, () => {
      errCount++;
    });

    mockGl.errorQueue = [1282, 0];

    wrapper.drawArrays(0, 0, 1);

    expect(errCount).toBe(0);
    expect(mockGl.errorQueue.length).toBe(2); // Error still in queue
  });

  it('formats shader errors', () => {
    const source = `void main() {
    float a = 1.0;
    vec3 color = vec4(1.0);
}`;
    const log = `ERROR: 0:3: 'vec4' : no matching overloaded function found
ERROR: 0:3: '=' : cannot convert from 'const float' to 'vec3'`;

    const formatted = formatShaderError(log, source);
    expect(formatted).toContain('ERROR: 0:3:');
    expect(formatted).toContain('vec3 color = vec4(1.0);');
  });
});
