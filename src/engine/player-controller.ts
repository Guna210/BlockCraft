import { BlockInteraction } from '../gameplay/block-interaction';
import { settings } from './settings';
import { TickLoop } from './loop';
import type { InputEngine, Action } from './input';
import type { Camera } from '../render/camera';
import type { World } from '../world/world';
import { Player, type GameMode } from '../entity/player';
import { BlockCollision } from '../entity/physics';
import { ItemEntityManager } from '../entity/item-entity';
import { BreakParticles } from '../render/particles';
import { canHarvest } from '../gameplay/mining';
import { rollBlockLoot } from '../gameplay/loot';
import { BlockRegistry } from '../world/blocks/registry';

/** Connects fixed physics to input and an interpolated camera; legacy camera writes detach it. */
export class PlayerController {
  public player: Player | null = null;
  public interaction: BlockInteraction | null = null;
  public itemEntities: ItemEntityManager | null = null;
  public particles: BreakParticles | null = null;
  public onInteractionEdit: (x: number, y: number, z: number) => void = () => {};
  public perspective: 0 | 1 | 2 = 0;
  public renderAlpha = 1;
  private perspectiveDown = false;
  private world: World | null = null;
  public readonly loop = new TickLoop(() => {
    this.world?.tick();
    this.previousEye = this.player?.eye ?? 1.62;
    this.player?.tick();
    if (this.player) this.itemEntities?.tick(this.player);
    this.particles?.tick();
    this.interaction?.tick();
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
      if (action === 'perspective') {
        if (down && !this.perspectiveDown) {
          this.perspective = ((this.perspective + 1) % 3) as 0 | 1 | 2;
          this.render(1);
        }
        this.perspectiveDown = down;
      } else {
        this.player?.input(action, down);
        this.interaction?.input(action, down);
      }
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
    this.perspective = 0;
    this.perspectiveDown = false;
    this.camera.roll = 0;
    this.camera.fov = (settings.fov * Math.PI) / 180;
    this.camera.updateProjection();
    this.world = world;
    this.player = new Player(new BlockCollision(world), this.ready);
    this.itemEntities = new ItemEntityManager(world);
    this.particles = new BreakParticles(world);
    this.interaction = new BlockInteraction(this.player, (x, y, z) =>
      this.onInteractionEdit(x, y, z),
    );
    this.interaction.onBreak = (state, x, y, z, tool) => {
      this.particles!.spawn(state, x, y, z);
      const block = BlockRegistry.getInstance().getResolvedState(state)!;
      if (this.player!.mode === 'creative' || !canHarvest(block.definition, tool)) return;
      const loot = rollBlockLoot(block.blockId, world.worldSeed, x, y, z);
      for (let n = 0; n < loot.length; n++) {
        const entry = loot[n]!;
        this.itemEntities!.spawn(entry.id, entry.count, x + 0.5, y + 0.5, z + 0.5);
      }
    };
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
    this.world = null;
    this.player = null;
    this.interaction = null;
    this.itemEntities = null;
    this.particles = null;
    this.perspective = 0;
    this.perspectiveDown = false;
    this.camera.roll = 0;
    this.camera.fov = (settings.fov * Math.PI) / 180;
    this.camera.updateProjection();
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
      this.interaction?.clear();
      this.perspective = 0;
      this.camera.roll = 0;
      this.camera.fov = (settings.fov * Math.PI) / 180;
      this.camera.updateProjection();
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
    this.interaction?.reset();
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
    this.renderAlpha = alpha;
    if (!p || p.detached) return;
    for (let axis = 0; axis < 3; axis++)
      this.camera.position[axis] = p.previous[axis]! + (p.pos[axis]! - p.previous[axis]!) * alpha;
    this.camera.position[1] += this.previousEye + (p.eye - this.previousEye) * alpha;
    this.camera.yaw = p.yaw;
    this.camera.pitch = p.pitch;
    const fov =
      ((settings.fov * Math.PI) / 180) *
      (1 + 0.1 * (p.previousSprintFov + (p.sprintFov - p.previousSprintFov) * alpha));
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjection();
    }
    this.camera.roll = 0;
    if (this.perspective !== 0) {
      const sign = this.perspective === 1 ? -1 : 1;
      const dx = Math.cos(p.yaw) * Math.cos(p.pitch) * sign;
      const dy = Math.sin(p.pitch) * sign;
      const dz = Math.sin(p.yaw) * Math.cos(p.pitch) * sign;
      const distance = p.collision.cameraDistance(
        this.camera.position[0],
        this.camera.position[1],
        this.camera.position[2],
        dx,
        dy,
        dz,
      );
      this.camera.position[0] += dx * distance;
      this.camera.position[1] += dy * distance;
      this.camera.position[2] += dz * distance;
      if (this.perspective === 2) {
        this.camera.yaw += Math.PI;
        this.camera.pitch = -p.pitch;
      }
    } else if (settings.viewBobbing && !p.inFluid && !p.climbing && !p.flying) {
      const distance = p.previousWalkDistance + (p.walkDistance - p.previousWalkDistance) * alpha;
      const amount = p.previousWalkAmount + (p.walkAmount - p.previousWalkAmount) * alpha;
      this.camera.position[1] += Math.sin(distance * Math.PI) * 0.02 * amount;
      this.camera.roll = Math.sin(distance * Math.PI * 0.5) * 0.008 * amount;
    }
    this.camera.updateView();
    this.rememberCamera();
  }
}
