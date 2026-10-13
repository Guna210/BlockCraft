import { TICK_SECONDS } from '../engine/loop';
import type { Action } from '../engine/input';
import { BlockCollision, EPSILON, type Position } from './physics';

export type GameMode = 'survival' | 'creative';
export interface PlayerSnapshot {
  pos: Position;
  vel: Position;
  yaw: number;
  pitch: number;
  health: number;
  hunger: number;
  saturation: number;
  air: number;
  onGround: boolean;
  inFluid: string | null;
  mode: string;
  dimension: string;
  selectedSlot: number;
}

export class Player {
  public readonly pos: Position = [0, 0, 0];
  public readonly previous: Position = [0, 0, 0];
  public readonly vel: Position = [0, 0, 0];
  public yaw = 0;
  public pitch = 0;
  public health = 20;
  public hunger = 20;
  public saturation = 5;
  public air = 300;
  public dimension = 'overworld';
  public selectedSlot = 0;
  public onGround = false;
  public inFluid: string | null = null;
  public mode: GameMode = 'survival';
  public flying = false;
  public sneaking = false;
  public detached = false;
  public climbing = false;
  public sprintFov = 0;
  public previousSprintFov = 0;
  public walkDistance = 0;
  public previousWalkDistance = 0;
  public walkAmount = 0;
  public previousWalkAmount = 0;
  private waterExitTicks = 0;
  private highest = 0;
  private ticks = 0;
  private lastForward = -Infinity;
  private lastJump = -Infinity;
  private sprinting = false;
  private forwardDown = false;
  private jumpDown = false;
  private forwardPressed = false;
  private jumpPressed = false;
  private readonly actions = new Map<Action, boolean>();
  constructor(
    public readonly collision: BlockCollision,
    private readonly ready: (x: number, z: number) => boolean,
  ) {}
  get height(): number {
    return this.sneaking ? 1.5 : 1.8;
  }
  get eye(): number {
    return this.sneaking ? 1.27 : 1.62;
  }

  input(action: Action, down: boolean): void {
    if (down && !this.actions.get(action)) {
      if (action === 'forward') this.forwardPressed = true;
      if (action === 'jump') this.jumpPressed = true;
    }
    this.actions.set(action, down);
  }
  clearInput(): void {
    this.actions.clear();
    this.forwardPressed = false;
    this.jumpPressed = false;
    this.forwardDown = false;
    this.jumpDown = false;
    this.lastForward = -Infinity;
    this.lastJump = -Infinity;
    this.sprinting = false;
  }
  teleport(x: number, y: number, z: number, yaw = this.yaw, pitch = this.pitch): void {
    this.pos[0] = x;
    this.pos[1] = y;
    this.pos[2] = z;
    this.previous[0] = x;
    this.previous[1] = y;
    this.previous[2] = z;
    this.vel[0] = 0;
    this.vel[1] = 0;
    this.vel[2] = 0;
    this.yaw = yaw;
    this.pitch = pitch;
    this.highest = y;
    this.onGround = false;
    this.inFluid = null;
    this.climbing = false;
    this.waterExitTicks = 0;
    this.sprintFov = this.previousSprintFov = 0;
    this.walkDistance = this.previousWalkDistance = 0;
    this.walkAmount = this.previousWalkAmount = 0;
    this.detached = false;
  }
  setGameMode(mode: GameMode): void {
    this.mode = mode;
    if (mode !== 'creative') this.flying = false;
    this.highest = this.pos[1];
  }
  private down(action: Action): boolean {
    return this.actions.get(action) ?? false;
  }
  private readonly footprintReady = (x: number, z: number) => this.terrainReady(x, z);

  private terrainReady(x: number, z: number): boolean {
    // Check all columns the footprint overlaps, including a boundary ahead of the centre.
    return (
      this.ready(x - 0.3 + EPSILON, z - 0.3 + EPSILON) &&
      this.ready(x + 0.3 - EPSILON, z - 0.3 + EPSILON) &&
      this.ready(x - 0.3 + EPSILON, z + 0.3 - EPSILON) &&
      this.ready(x + 0.3 - EPSILON, z + 0.3 - EPSILON)
    );
  }
  tick(): void {
    if (this.detached) return;
    this.ticks++;
    this.previousSprintFov = this.sprintFov;
    this.previousWalkDistance = this.walkDistance;
    this.previousWalkAmount = this.walkAmount;
    const forward = this.down('forward'),
      jump = this.down('jump');
    if (this.forwardPressed || (forward && !this.forwardDown)) {
      if (this.ticks - this.lastForward <= 7) this.sprinting = true;
      this.lastForward = this.ticks;
    }
    if (this.jumpPressed || (jump && !this.jumpDown)) {
      if (this.mode === 'creative' && this.ticks - this.lastJump <= 7) {
        this.flying = !this.flying;
        this.vel[1] = 0;
        this.lastJump = -Infinity;
      } else this.lastJump = this.ticks;
    }
    this.forwardPressed = false;
    this.jumpPressed = false;
    this.forwardDown = forward;
    this.jumpDown = jump;
    if (!forward) this.sprinting = false;
    this.previous[0] = this.pos[0];
    this.previous[1] = this.pos[1];
    this.previous[2] = this.pos[2];
    if (!this.terrainReady(this.pos[0], this.pos[2])) return;
    this.sneaking =
      this.down('sneak') ||
      (this.sneaking && !this.collision.free(this.pos[0], this.pos[1], this.pos[2], 1.8));
    this.collision.eject(this.pos, this.height, this.footprintReady);
    this.onGround = this.collision.supported(this.pos[0], this.pos[1], this.pos[2], 1e-5);
    const wasGrounded = this.onGround;
    this.inFluid = this.collision.inWater(this.pos, this.height) ? 'water' : null;
    this.climbing = !this.flying && this.collision.climbing(this.pos, this.height);
    if (this.inFluid || this.climbing || this.flying || this.onGround) this.highest = this.pos[1];
    const sprint = !this.sneaking && (this.down('sprint') || this.sprinting);
    let speed = this.flying ? 10.9 : this.sneaking ? 1.3 : sprint ? 5.6 : 4.3;
    if (this.inFluid && !this.flying) speed = sprint ? 3 : 2;
    if (this.onGround && !this.flying && this.collision.onMire(this.pos)) speed *= 0.4;
    const f = Number(forward) - Number(this.down('back'));
    const r = Number(this.down('right')) - Number(this.down('left'));
    const scale = speed / Math.max(1, Math.hypot(f, r));
    const tx = (Math.cos(this.yaw) * f - Math.sin(this.yaw) * r) * scale;
    const tz = (Math.sin(this.yaw) * f + Math.cos(this.yaw) * r) * scale;
    const accel = (this.flying ? 60 : this.inFluid ? 32 : this.onGround ? 40 : 8) * TICK_SECONDS;
    this.vel[0] += Math.max(-accel, Math.min(accel, tx - this.vel[0]));
    this.vel[2] += Math.max(-accel, Math.min(accel, tz - this.vel[2]));
    if (this.flying) this.vel[1] = (Number(jump) - Number(this.down('sneak'))) * 10.9;
    else if (this.climbing) {
      this.vel[1] = this.sneaking
        ? 0
        : jump || this.collision.climbing(this.pos, this.height, tx, tz, true)
          ? 2.35
          : Math.max(-2.35, this.vel[1] - 32 * TICK_SECONDS);
    } else if (this.inFluid && this.waterExitTicks === 0) {
      this.vel[1] = Math.max(-2, Math.min(3, this.vel[1] * 0.8 + (jump ? 20 : -8) * TICK_SECONDS));
    } else {
      if (jump && this.onGround) {
        this.vel[1] = 8.9;
        this.onGround = false;
      }
      // Exact constant-acceleration displacement gives the specified jump apex (~1.24 blocks).
    }
    let dx = this.vel[0] * TICK_SECONDS,
      dz = this.vel[2] * TICK_SECONDS;
    let dy =
      this.flying || this.climbing || (this.inFluid && this.waterExitTicks === 0)
        ? this.vel[1] * TICK_SECONDS
        : Math.max(
            -60 * TICK_SECONDS,
            this.vel[1] * TICK_SECONDS - 0.5 * 32 * TICK_SECONDS * TICK_SECONDS,
          );
    const surface = this.inFluid ? this.collision.waterSurface(this.pos, this.height) : NaN;
    if (this.inFluid && jump && this.waterExitTicks === 0 && Number.isFinite(surface)) {
      // Fixed-tick buoyancy bobs gently around half a block below the waterline.
      const waterline = surface - 0.5 + Math.sin((this.ticks * Math.PI) / 5) * 0.04;
      dy = Math.min(dy, waterline - this.pos[1]);
      this.vel[1] = dy / TICK_SECONDS;
      if (this.pos[1] >= surface - 0.65 && (Math.abs(dx) > EPSILON || Math.abs(dz) > EPSILON)) {
        const blocked =
          Math.abs(this.collision.sweep(this.pos, this.height, 0, dx) - dx) > EPSILON ||
          Math.abs(this.collision.sweep(this.pos, this.height, 2, dz) - dz) > EPSILON;
        const rise = surface + 1 - this.pos[1] + EPSILON;
        if (
          blocked &&
          rise > 0 &&
          rise <= 1.7 &&
          this.collision.free(
            this.pos[0] + dx,
            this.pos[1] + rise,
            this.pos[2] + dz,
            this.height,
          ) &&
          this.collision.sweep(this.pos, this.height, 1, rise) >= rise - EPSILON
        ) {
          this.vel[1] = 12;
          this.waterExitTicks = 12;
          dy = this.vel[1] * TICK_SECONDS - 0.5 * 32 * TICK_SECONDS * TICK_SECONDS;
        }
      }
    }
    if (!this.terrainReady(this.pos[0] + dx, this.pos[2] + dz)) {
      // Freeze all physics, including gravity, until the destination is ready.
      this.vel[0] = 0;
      this.vel[2] = 0;
      return;
    }
    if (!this.flying && !this.climbing && (!this.inFluid || this.waterExitTicks > 0))
      this.vel[1] = Math.max(-60, this.vel[1] - 32 * TICK_SECONDS);
    if (this.waterExitTicks > 0) this.waterExitTicks--;
    if (this.sneaking && wasGrounded && !this.flying) {
      dx = this.clipEdge(dx, 0);
      dz = this.clipEdge(dz, 2);
      while (
        (Math.abs(dx) > EPSILON || Math.abs(dz) > EPSILON) &&
        !this.collision.supported(this.pos[0] + dx, this.pos[1], this.pos[2] + dz)
      ) {
        dx = this.reduce(dx);
        dz = this.reduce(dz);
      }
    }
    const movedY = this.collision.sweep(this.pos, this.height, 1, dy);
    const waterReset =
      dy < 0 ? this.collision.waterResetHeight(this.pos, this.height, movedY) : NaN;
    this.pos[1] += movedY;
    if (Number.isFinite(waterReset)) this.highest = waterReset;
    this.onGround =
      dy < 0 &&
      (movedY > dy + EPSILON ||
        this.collision.supported(this.pos[0], this.pos[1], this.pos[2], EPSILON * 2));
    if (this.onGround || Math.abs(movedY - dy) > EPSILON) this.vel[1] = 0;
    const first = Math.abs(this.vel[0]) >= Math.abs(this.vel[2]) ? 0 : 2;
    this.moveHorizontal(first, first === 0 ? dx : dz, wasGrounded && dy <= 0);
    this.moveHorizontal(first === 0 ? 2 : 0, first === 0 ? dz : dx, wasGrounded && dy <= 0);
    this.highest = Math.max(this.highest, this.pos[1]);
    this.inFluid = this.collision.inWater(this.pos, this.height) ? 'water' : null;
    this.climbing = !this.flying && this.collision.climbing(this.pos, this.height);
    if (this.inFluid || this.climbing) {
      this.highest = this.pos[1];
    }
    if (this.onGround) {
      if (
        this.mode === 'survival' &&
        !this.inFluid &&
        !this.climbing &&
        !this.collision.onHay(this.pos)
      )
        this.health = Math.max(0, this.health - Math.max(0, this.highest - this.pos[1] - 3));
      this.highest = this.pos[1];
    }
    this.onGround =
      !this.flying &&
      this.vel[1] <= 0 &&
      this.collision.supported(this.pos[0], this.pos[1], this.pos[2], 1e-5);
    const walked = Math.hypot(this.pos[0] - this.previous[0], this.pos[2] - this.previous[2]);
    this.walkAmount =
      this.onGround && !this.inFluid && !this.climbing && !this.flying
        ? Math.min(1, walked / (4.3 * TICK_SECONDS))
        : 0;
    if (this.walkAmount > 0) this.walkDistance += walked;
    const fovTarget = sprint && walked > EPSILON && !this.flying && !this.climbing ? 1 : 0;
    this.sprintFov += Math.max(-0.2, Math.min(0.2, fovTarget - this.sprintFov));
  }
  private reduce(d: number): number {
    return Math.sign(d) * Math.max(0, Math.abs(d) - 0.01);
  }
  private clipEdge(d: number, axis: number): number {
    while (
      Math.abs(d) > EPSILON &&
      !this.collision.supported(
        this.pos[0] + (axis === 0 ? d : 0),
        this.pos[1],
        this.pos[2] + (axis === 2 ? d : 0),
      )
    )
      d = this.reduce(d);
    return d;
  }
  private moveHorizontal(axis: number, distance: number, grounded: boolean): void {
    let moved = this.collision.sweep(this.pos, this.height, axis, distance);
    if (Math.abs(moved - distance) > EPSILON && grounded && !this.flying) {
      const up = this.collision.sweep(this.pos, this.height, 1, 0.6);
      if (up > EPSILON) {
        this.pos[1] += up;
        const step = this.collision.sweep(this.pos, this.height, axis, distance);
        if (Math.abs(step) > Math.abs(moved) + EPSILON) {
          this.pos[axis]! += step;
          const down = this.collision.sweep(this.pos, this.height, 1, -up);
          this.pos[1] += down;
          this.onGround = down > -up + EPSILON;
          moved = step;
          if (Math.abs(moved - distance) > EPSILON) this.vel[axis] = 0;
          return;
        }
        this.pos[1] -= up;
      }
    }
    this.pos[axis]! += moved;
    if (Math.abs(moved - distance) > EPSILON) this.vel[axis] = 0;
  }
  snapshot(): PlayerSnapshot {
    return {
      pos: [...this.pos],
      vel: [...this.vel],
      yaw: this.yaw,
      pitch: this.pitch,
      health: this.health,
      hunger: this.hunger,
      saturation: this.saturation,
      air: this.air,
      onGround: this.onGround,
      inFluid: this.inFluid,
      mode: this.mode,
      dimension: this.dimension,
      selectedSlot: this.selectedSlot,
    };
  }
}
