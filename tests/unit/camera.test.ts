import { describe, it, expect, beforeEach } from 'vitest';
import { Camera } from '../../src/render/camera';
import { mat4 } from 'gl-matrix';

describe('Camera', () => {
  let camera: Camera;

  beforeEach(() => {
    camera = new Camera(16 / 9);
  });

  it('projection uses FOV 70 and the correct aspect ratio', () => {
    const fovY = 70 * (Math.PI / 180);
    const aspect = 16 / 9;

    const expected = mat4.create();
    mat4.perspective(expected, fovY, aspect, 0.1, 1000.0);

    // Check elements are roughly equal due to float precision
    for (let i = 0; i < 16; i++) {
      expect(camera.projectionMatrix[i]).toBeCloseTo(expected[i] as number, 5);
    }
  });

  it('forward and strafe directions follow yaw and pitch', () => {
    // Look straight along X-axis
    camera.yaw = 0;
    camera.pitch = 0;
    camera.updateView();

    let forward = camera.getForward();
    expect(forward[0]).toBeCloseTo(1, 5);
    expect(forward[1]).toBeCloseTo(0, 5);
    expect(forward[2]).toBeCloseTo(0, 5);

    let right = camera.getRight();
    expect(right[0]).toBeCloseTo(0, 5);
    expect(right[1]).toBeCloseTo(0, 5);
    expect(right[2]).toBeCloseTo(1, 5); // Z is right when looking along +X

    // Look straight along Z-axis
    camera.yaw = Math.PI / 2;
    camera.pitch = 0;
    camera.updateView();

    forward = camera.getForward();
    expect(forward[0]).toBeCloseTo(0, 5);
    expect(forward[1]).toBeCloseTo(0, 5);
    expect(forward[2]).toBeCloseTo(1, 5);

    right = camera.getRight();
    expect(right[0]).toBeCloseTo(-1, 5);
    expect(right[1]).toBeCloseTo(0, 5);
    expect(right[2]).toBeCloseTo(0, 5); // -X is right when looking along +Z

    // Look straight UP
    camera.yaw = 0;
    camera.pitch = Math.PI / 2;
    camera.updateView();

    forward = camera.getForward();
    expect(forward[0]).toBeCloseTo(0, 5);
    expect(forward[1]).toBeCloseTo(1, 5);
    expect(forward[2]).toBeCloseTo(0, 5);
  });
});
