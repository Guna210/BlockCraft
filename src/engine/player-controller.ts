import { TickLoop } from './loop';
import type { InputEngine, Action } from './input';
import type { Camera } from '../render/camera';
import type { World } from '../world/world';
import { Player, type GameMode } from '../entity/player';
import { BlockCollision } from '../entity/physics';

/** Connects fixed physics to input and an interpolated camera; legacy camera writes detach it. */
export class PlayerController {
  public player: Player | null = null;
  public readonly loop = new TickLoop(() => {
    this.previousEye = this.player?.eye ?? 1.62;
    this.player?.tick();
  });
  private x = 0;
  private y = 0;
  private z = 0;
  private yaw = 0;
  private pitch = 0;
  private previousEye = 1.62;
  private spawnView = false;
  constructor(
    public readonly camera: Camera,
    public readonly input: InputEngine,
    private readonly ready: (x: number, z: number) => boolean,
  ) {
    this.rememberCamera();
    input.onAction = (action, down) => {
      this.attach();
      this.player?.input(action, down);
    };
  }
  spawn(
    world: World,
    x: number,
    y: number,
    z: number,
    mode: GameMode,
    preserveCamera = false,
  ): void {
    this.player = new Player(new BlockCollision(world), this.ready);
    this.player.setGameMode(mode);
    this.input.actionStates.forEach((_, action) => this.input.actionStates.set(action, false));
    this.loop.resume();
    this.player.teleport(x, y, z, this.camera.yaw, this.camera.pitch);
    this.previousEye = this.player.eye;
    this.spawnView = preserveCamera;
    this.player.detached = preserveCamera;
    this.player.onGround = this.player.collision.supported(x, y, z, 1e-5);
    if (preserveCamera) this.rememberCamera();
    else this.render(1);
  }
  reset(): void {
    this.player = null;
    this.spawnView = false;
    this.loop.resume();
    this.rememberCamera();
  }
  private rememberCamera(): void {
    this.x = this.camera.position[0];
    this.y = this.camera.position[1];
    this.z = this.camera.position[2];
    this.yaw = this.camera.yaw;
    this.pitch = this.camera.pitch;
  }
  private detectCamera(): void {
    if (
      this.player &&
      (this.x !== this.camera.position[0] ||
        this.y !== this.camera.position[1] ||
        this.z !== this.camera.position[2] ||
        this.yaw !== this.camera.yaw ||
        this.pitch !== this.camera.pitch)
    ) {
      this.player.detached = true;
      this.spawnView = false;
      this.player.clearInput();
    }
    this.rememberCamera();
  }
  attach(): void {
    this.detectCamera();
    const p = this.player;
    if (p?.detached && this.spawnView) {
      p.detached = false;
      this.spawnView = false;
    } else if (p?.detached) {
      p.teleport(
        this.camera.position[0],
        this.camera.position[1] - p.eye,
        this.camera.position[2],
        this.camera.yaw,
        this.camera.pitch,
      );
      this.previousEye = p.eye;
    }
  }
  teleport(x: number, y: number, z: number, yaw?: number, pitch?: number): void {
    this.spawnView = false;
    this.player?.teleport(x, y, z, yaw, pitch);
    this.previousEye = this.player?.eye ?? 1.62;
    this.render(1);
  }
  look(yaw: number, pitch: number): void {
    this.attach();
    if (this.player) {
      this.player.yaw = yaw;
      this.player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
      this.render(1);
    }
  }
  setInput(action: Action, down: boolean): void {
    this.input.setAction(action, down);
  }
  frame(seconds: number): void {
    this.detectCamera();
    const p = this.player;
    if (!p) {
      this.camera.update(seconds, this.input);
      this.rememberCamera();
      return;
    }
    if (this.input.mouseMovement.x !== 0 || this.input.mouseMovement.y !== 0) {
      this.attach();
      this.look(
        p.yaw + this.input.mouseMovement.x * this.camera.sensitivity,
        p.pitch - this.input.mouseMovement.y * this.camera.sensitivity,
      );
      this.input.mouseMovement.x = 0;
      this.input.mouseMovement.y = 0;
    }
    this.render(this.loop.advance(seconds));
  }
  tick(n: number): void {
    this.detectCamera();
    this.previousEye = this.player?.eye ?? 1.62;
    this.loop.tick(n);
    this.render(1);
  }
  render(alpha: number): void {
    const p = this.player;
    if (!p || p.detached) return;
    for (let axis = 0; axis < 3; axis++)
      this.camera.position[axis] = p.previous[axis]! + (p.pos[axis]! - p.previous[axis]!) * alpha;
    this.camera.position[1] += this.previousEye + (p.eye - this.previousEye) * alpha;
    this.camera.yaw = p.yaw;
    this.camera.pitch = p.pitch;
    this.camera.updateView();
    this.rememberCamera();
  }
}
