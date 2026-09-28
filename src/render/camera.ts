import { mat4, vec3 } from 'gl-matrix';
import type { InputEngine } from '../engine/input';

export class Camera {
  public position: vec3;
  public yaw: number;
  public pitch: number;

  public fov: number;
  public aspect: number;
  public near: number;
  public far: number;

  public projectionMatrix: mat4;
  public viewMatrix: mat4;

  public sensitivity = 0.002;
  public speed = 10.0; // units per second

  constructor(aspect: number) {
    this.position = vec3.fromValues(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.fov = 70 * (Math.PI / 180);
    this.aspect = aspect;
    this.near = 0.1;
    this.far = 1000.0;

    this.projectionMatrix = mat4.create();
    this.viewMatrix = mat4.create();

    this.updateProjection();
    this.updateView();
  }

  setAspect(aspect: number) {
    this.aspect = aspect;
    this.updateProjection();
  }

  updateProjection() {
    mat4.perspective(this.projectionMatrix, this.fov, this.aspect, this.near, this.far);
  }

  updateView() {
    const forward = this.getForward();
    const target = vec3.create();
    vec3.add(target, this.position, forward);
    const up = vec3.fromValues(0, 1, 0);
    mat4.lookAt(this.viewMatrix, this.position, target, up);
  }

  getForward(): vec3 {
    const x = Math.cos(this.yaw) * Math.cos(this.pitch);
    const y = Math.sin(this.pitch);
    const z = Math.sin(this.yaw) * Math.cos(this.pitch);
    const forward = vec3.fromValues(x, y, z);
    vec3.normalize(forward, forward);
    return forward;
  }

  getRight(): vec3 {
    const forward = this.getForward();
    const up = vec3.fromValues(0, 1, 0);
    const right = vec3.create();
    vec3.cross(right, forward, up);
    vec3.normalize(right, right);
    return right;
  }

  update(dt: number, input: InputEngine) {
    // Rotation from mouse
    const mouseMov = input.consumeMouseMovement();
    if (mouseMov.x !== 0 || mouseMov.y !== 0) {
      this.yaw += mouseMov.x * this.sensitivity;
      this.pitch -= mouseMov.y * this.sensitivity;

      // Clamp pitch to avoid flipping
      const limit = Math.PI / 2 - 0.01;
      if (this.pitch > limit) this.pitch = limit;
      if (this.pitch < -limit) this.pitch = -limit;
    }

    // Movement from keys
    const forward = this.getForward();
    const right = this.getRight();
    const up = vec3.fromValues(0, 1, 0);

    const moveVelocity = vec3.create();
    let moveSpeed = this.speed;

    if (input.getAction('sprint')) {
      moveSpeed *= 2.0;
    }

    const dist = moveSpeed * dt;

    if (input.getAction('forward')) vec3.scaleAndAdd(moveVelocity, moveVelocity, forward, dist);
    if (input.getAction('back')) vec3.scaleAndAdd(moveVelocity, moveVelocity, forward, -dist);
    if (input.getAction('right')) vec3.scaleAndAdd(moveVelocity, moveVelocity, right, dist);
    if (input.getAction('left')) vec3.scaleAndAdd(moveVelocity, moveVelocity, right, -dist);
    if (input.getAction('jump')) vec3.scaleAndAdd(moveVelocity, moveVelocity, up, dist);
    if (input.getAction('sneak')) vec3.scaleAndAdd(moveVelocity, moveVelocity, up, -dist);

    vec3.add(this.position, this.position, moveVelocity);

    this.updateView();
  }
}
