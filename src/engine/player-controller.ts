import { BlockInteraction } from '../gameplay/block-interaction';
import { settings } from './settings';
import { TickLoop } from './loop';
import type { InputEngine, Action } from './input';
import type { Camera } from '../render/camera';
import type { World } from '../world/world';
import { Player, type GameMode } from '../entity/player';
import { BlockCollision } from '../entity/physics';
import { ItemEntityManager } from '../entity/item-entity';
import type { EntityWorld } from '../entity/ecs/world';
import { createEntityWorld, queryEcsEntities } from '../entity/ecs/systems';
import { BreakParticles } from '../render/particles';
import { canHarvest } from '../gameplay/mining';
import { rollBlockLoot } from '../gameplay/loot';
import { BlockRegistry } from '../world/blocks/registry';
import type { RayHit } from '../world/raycast';
import { spillChestContents } from '../gameplay/chests';
import { spillKilnContents } from '../gameplay/kiln';
import { getToolDurability } from '../gameplay/tools';
import type { QueriedEntity } from '../entity/query';
import type { DamageEvent } from '../gameplay/survival';
import { deathCauseForDamageSource, resolveBedRespawn } from '../gameplay/death-beds';
import { clearPlayerInvulnerability, PlayerCombat, hurtPlayer } from '../gameplay/combat';
import { MobRuntime, type MobPlayer } from '../entity/ai/runtime';
import '../entity/mobs';
import { slowPlayer } from '../entity/player-slow';
import { ProjectileRuntime } from '../entity/projectiles';
import { BowController } from '../gameplay/bow';
import { BlastCharges } from '../entity/blast-charge';
import { blockSoundMaterial, sound } from '../audio/service';

/** Connects fixed physics to input and an interpolated camera; legacy camera writes detach it. */
export class PlayerController {
  public player: Player | null = null;
  public interaction: BlockInteraction | null = null;
  public itemEntities: ItemEntityManager | null = null;
  /** Creatures and other ECS entities of the current world. */
  public ecs: EntityWorld | null = null;
  /** AI, pathfinding, mob movement and natural spawning for `ecs`. */
  public mobs: MobRuntime | null = null;
  /** Melee attacks, the attack meter and feeding mobs. */
  public combat: PlayerCombat | null = null;
  /** Bow charge state and shot input for the current player. */
  public bow: BowController | null = null;
  /** Shared block/entity collision and movement for projectiles in the current world. */
  public projectiles: ProjectileRuntime | null = null;
  public particles: BreakParticles | null = null;
  public charges: BlastCharges | null = null;
  private shake = 0;
  private shakeUntil = 0;
  public onInteractionEdit: (x: number, y: number, z: number) => void = () => {};
  public onUseBlock: (blockId: string, target: RayHit) => boolean = () => false;
  public onDamage: (event: DamageEvent) => void = () => {};
  public onDeath: (cause: string) => void = () => {};
  public perspective: 0 | 1 | 2 = 0;
  public renderAlpha = 1;
  private perspectiveDown = false;
  private world: World | null = null;
  private worldSpawnPoint: [number, number, number] | null = null;
  private readonly mechanicsUnsubscribes: Array<() => void> = [];
  private hitRoll = 0;
  private hitRollUntil = 0;
  public readonly loop = new TickLoop(() => {
    this.world?.tick();
    this.previousEye = this.player?.eye ?? 1.62;
    this.player?.tick();
    this.bow?.tick();
    if (this.player && !this.player.dead) {
      this.combat?.tick();
      this.interaction?.tick();
    }
    if (this.world && this.player)
      this.player.survival.tick(this.world, this.player, this.particles);
    if (this.player) this.itemEntities?.tick(this.player);
    this.ecs?.tick();
    this.particles?.tick();
    if (this.world && this.player && this.ecs) {
      sound.tick(this.world, this.player, this.ecs);
    }
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
      if (this.player?.dead) {
        this.player.clearInput();
        this.bow?.clear();
        this.interaction?.clear();
        this.combat?.clear();
        return;
      }
      this.attach();
      if (action === 'perspective') {
        if (down && !this.perspectiveDown) {
          this.perspective = ((this.perspective + 1) % 3) as 0 | 1 | 2;
          this.render(1);
        }
        this.perspectiveDown = down;
      } else {
        this.player?.input(action, down);
        if (!this.bow?.input(action, down)) {
          this.combat?.input(action, down);
          this.interaction?.input(action, down);
        }
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
    spawning = true,
  ): void {
    this.clearMechanicsListeners();
    this.perspective = 0;
    this.perspectiveDown = false;
    this.camera.roll = 0;
    this.camera.fov = (settings.fov * Math.PI) / 180;
    this.camera.updateProjection();
    this.world = world;
    this.player = new Player(new BlockCollision(world), this.ready);
    this.worldSpawnPoint = [x, y, z];
    this.hitRoll = 0;
    this.hitRollUntil = 0;
    this.player.survival.onDeath = (source) => this.handleDeath(source);
    this.player.survival.onDamage = (event) => {
      this.hitRoll = this.damageRoll(event.source);
      this.hitRollUntil = performance.now() + 260;
      sound.play('player.hurt', {
        x: this.player!.pos[0],
        y: this.player!.pos[1] + this.player!.eye,
        z: this.player!.pos[2],
        priority: 1.3,
      });
      this.onDamage(event);
    };
    const itemEntities = new ItemEntityManager(world);
    itemEntities.onPickup = (item) => {
      sound.play('item.pickup', {
        x: item.pos[0],
        y: item.pos[1],
        z: item.pos[2],
        priority: 0.7,
      });
    };
    this.itemEntities = itemEntities;
    world.itemSpawner = (id, count, x, y, z, velocity, pickupDelay) => {
      itemEntities.spawn(id, count, x, y, z, { velocity, pickupDelay });
    };
    world.entityQuery.addProvider('player', () => {
      const player = this.player;
      if (!player || this.world !== world) return [];
      return [
        {
          id: 'player',
          type: 'player',
          minX: player.pos[0] - 0.3,
          minY: player.pos[1],
          minZ: player.pos[2] - 0.3,
          maxX: player.pos[0] + 0.3,
          maxY: player.pos[1] + player.height,
          maxZ: player.pos[2] + 0.3,
        },
      ] satisfies QueriedEntity[];
    });
    world.entityQuery.addProvider('items', () =>
      (this.itemEntities?.pool ?? [])
        .filter((entity) => entity.active)
        .map((entity) => ({
          id: entity.id,
          type: 'item',
          minX: entity.pos[0] - 0.125,
          minY: entity.pos[1] - 0.125,
          minZ: entity.pos[2] - 0.125,
          maxX: entity.pos[0] + 0.125,
          maxY: entity.pos[1] + 0.125,
          maxZ: entity.pos[2] + 0.125,
        })),
    );
    const ecs = createEntityWorld();
    this.ecs = ecs;
    world.entityQuery.addProvider('ecs', () => (this.ecs === ecs ? queryEcsEntities(ecs) : []));
    this.particles = new BreakParticles(world);
    this.interaction = new BlockInteraction(this.player, (x, y, z) =>
      this.onInteractionEdit(x, y, z),
    );
    const player = this.player;
    this.combat = new PlayerCombat(player, ecs, this.interaction);
    this.bow = new BowController(player, ecs);
    this.bow.onDraw = () =>
      sound.play('weapon.bow_draw', {
        x: player.pos[0],
        y: player.pos[1] + player.eye,
        z: player.pos[2],
        priority: 0.8,
      });
    this.bow.onRelease = () =>
      sound.play('weapon.bow_release', {
        x: player.pos[0],
        y: player.pos[1] + player.eye,
        z: player.pos[2],
        priority: 1,
      });
    const gaze: ReturnType<NonNullable<MobPlayer['gaze']>> = {
      origin: [0, 0, 0],
      direction: [0, 0, 0],
    };
    const mobPlayer: MobPlayer = {
      get pos() {
        return player.pos;
      },
      get height() {
        return player.height;
      },
      heldItemId: () => player.inventory.held?.id ?? null,
      gaze: () => {
        gaze.origin[0] = player.pos[0];
        gaze.origin[1] = player.pos[1] + player.eye;
        gaze.origin[2] = player.pos[2];
        const horizontal = Math.cos(player.pitch);
        gaze.direction[0] = Math.cos(player.yaw) * horizontal;
        gaze.direction[1] = Math.sin(player.pitch);
        gaze.direction[2] = Math.sin(player.yaw) * horizontal;
        return gaze;
      },
      targetable: () => player.mode === 'survival' && !player.dead,
      hurt: (amount, source, from) => hurtPlayer(player, amount, source, from),
      impulse: (velocity) => {
        for (let a = 0; a < 3; a++) player.vel[a]! += velocity[a]! * 20;
      },
      slow: (factor, ticks) => slowPlayer(player, factor, ticks),
    };
    this.mobs?.dispose();
    this.mobs = new MobRuntime(world, ecs, {
      player: () => (this.player === player ? mobPlayer : null),
      spawnContext: { ecs, items: itemEntities, particles: this.particles },
      spawnRules: 'default',
      spawning,
    });
    this.charges?.dispose();
    this.charges = new BlastCharges(
      world,
      ecs,
      { ecs, world, player: () => mobPlayer },
      this.particles,
      (center, power) => {
        const distance = Math.hypot(
          player.pos[0] - center[0],
          player.pos[1] + player.eye - center[1],
          player.pos[2] - center[2],
        );
        if (distance < 32) {
          this.shake = Math.max(this.shake, (1 - distance / 32) * power * 0.012);
          this.shakeUntil = performance.now() + 350;
        }
      },
    );
    this.projectiles = new ProjectileRuntime(
      world,
      ecs,
      () => (this.player === player ? player : null),
      () => (this.itemEntities === itemEntities ? itemEntities : null),
    );
    this.projectiles.onArrowHit = (position) =>
      sound.play('weapon.arrow_hit', { pos: position, priority: 0.85 });
    this.mechanicsUnsubscribes.push(
      world.current.mechanics.onPiston((position) =>
        sound.play('mechanism.piston', {
          x: position.x + 0.5,
          y: position.y + 0.5,
          z: position.z + 0.5,
          priority: 0.75,
        }),
      ),
    );
    this.interaction.onUse = (blockId, target) => {
      const used =
        world.current.useBlock(target.x, target.y, target.z) || this.onUseBlock(blockId, target);
      if (used && blockId === 'lever')
        sound.play('mechanism.lever', { x: target.x + 0.5, y: target.y + 0.5, z: target.z + 0.5 });
      else if (used && blockId.endsWith('button'))
        sound.play('mechanism.button', {
          x: target.x + 0.5,
          y: target.y + 0.5,
          z: target.z + 0.5,
        });
      return used;
    };
    this.mechanicsUnsubscribes.push(
      world.current.mechanics.onTone((event) => {
        sound.play('mechanism.note', {
          x: event.x + 0.5,
          y: event.y + 0.5,
          z: event.z + 0.5,
          pitch: event.pitch,
          priority: 0.9,
        });
      }),
    );
    this.interaction.onBreakBeforeRemove = (_state, x, y, z) => {
      const id = world.getBlock(x, y, z).id;
      if (id !== 'chest' && id !== 'kiln') return true;
      if (!this.itemEntities) return false;
      return id === 'chest'
        ? spillChestContents(world, this.itemEntities, x, y, z)
        : spillKilnContents(world, this.itemEntities, x, y, z);
    };
    this.interaction.onBreak = (state, x, y, z, tool) => {
      this.particles!.spawn(state, x, y, z);
      const block = BlockRegistry.getInstance().getResolvedState(state)!;
      sound.play(`break.${blockSoundMaterial(block.blockId)}`, {
        x: x + 0.5,
        y: y + 0.5,
        z: z + 0.5,
        priority: 1,
      });

      if (this.player!.mode === 'survival') {
        this.player!.survival.addExhaustion(0.005);
        const held = this.player!.inventory.held;
        if (held) {
          const durability = getToolDurability(held);
          if (durability !== null && durability > 0) {
            held.damage = (held.damage ?? 0) + 1;
            if (held.damage >= durability) {
              this.particles!.spawn(
                state,
                this.player!.pos[0],
                this.player!.pos[1] + this.player!.eye,
                this.player!.pos[2],
              );
              this.player!.inventory.slots[this.player!.inventory.selectedSlot] = null;
            }
          }
        }
      }

      if (this.player!.mode === 'creative' || !canHarvest(block.definition, tool)) return;
      const breakCount = world.breakCount++;
      const loot = rollBlockLoot(block.blockId, world.worldSeed, x, y, z, breakCount);
      for (let n = 0; n < loot.length; n++) {
        const entry = loot[n]!;
        this.itemEntities!.spawn(entry.id, entry.count, x + 0.5, y + 0.5, z + 0.5);
      }
    };
    this.interaction.onPlace = (state, x, y, z) => {
      const block = BlockRegistry.getInstance().getResolvedState(state)!;
      sound.play(`place.${blockSoundMaterial(block.blockId)}`, {
        x: x + 0.5,
        y: y + 0.5,
        z: z + 0.5,
        priority: 0.85,
      });
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
    this.clearMechanicsListeners();
    this.charges?.dispose();
    this.charges = null;
    this.shake = this.shakeUntil = 0;
    this.world?.entityQuery.removeProvider('player');
    this.world?.entityQuery.removeProvider('items');
    this.world?.entityQuery.removeProvider('ecs');
    if (this.world) this.world.itemSpawner = null;
    this.world = null;
    this.worldSpawnPoint = null;
    this.player = null;
    this.bow?.clear();
    this.bow = null;
    this.projectiles = null;
    this.interaction = null;
    this.itemEntities = null;
    this.ecs = null;
    this.mobs?.dispose();
    this.mobs = null;
    this.combat = null;
    this.particles = null;
    this.perspective = 0;
    this.perspectiveDown = false;
    this.camera.roll = 0;
    this.camera.fov = (settings.fov * Math.PI) / 180;
    this.camera.updateProjection();
    this.spawnView = false;
    this.hitRoll = 0;
    this.hitRollUntil = 0;
    this.loop.resume();
    this.rememberCamera();
  }
  private clearMechanicsListeners(): void {
    for (let i = 0; i < this.mechanicsUnsubscribes.length; i++) this.mechanicsUnsubscribes[i]!();
    this.mechanicsUnsubscribes.length = 0;
  }
  /** Turns natural spawning off or on for the attached world's mob runtime. */
  setSpawning(enabled: boolean): void {
    this.mobs?.setSpawning(enabled);
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
      this.bow?.clear();
      this.interaction?.clear();
      this.combat?.clear();
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
  private handleDeath(source: string): void {
    const player = this.player;
    if (!player || player.dead !== true) return;
    clearPlayerInvulnerability(player);
    sound.play('player.death', {
      x: player.pos[0],
      y: player.pos[1] + player.eye,
      z: player.pos[2],
      priority: 2,
    });
    player.clearInput();
    this.bow?.clear();
    this.interaction?.clear();
    this.combat?.clear();
    this.spawnView = false;
    this.onDeath(deathCauseForDamageSource(source));
    const [x, y, z] = player.pos;
    const drops = this.itemEntities;
    for (let slot = 0; slot < player.inventory.slots.length; slot++) {
      const stack = player.inventory.slots[slot];
      if (!stack || !drops) continue;
      const entity = drops.spawn(
        stack.id,
        stack.count,
        x + (Math.random() - 0.5) * 0.7,
        y + Math.random() * 0.25,
        z + (Math.random() - 0.5) * 0.7,
        {
          velocity: [(Math.random() - 0.5) * 1.2, 1.6 + Math.random(), (Math.random() - 0.5) * 1.2],
          pickupDelay: 40,
        },
      );
      if (entity) player.inventory.slots[slot] = null;
    }
    player.xpLevel = 0;
    player.xpProgress = 0;
  }

  /** Derive the roll side from the nearby hazard block when the damage event has one. */
  private damageRoll(source: string): number {
    const player = this.player;
    const world = this.world;
    if (!player || !world) return 0.12;
    const candidates: string[] =
      source === 'lava'
        ? ['lava']
        : source === 'fire'
          ? ['fire']
          : source === 'burning'
            ? ['fire', 'lava']
            : source === 'cactus'
              ? ['cactus']
              : source === 'drowning'
                ? ['water']
                : source === 'suffocation'
                  ? [
                      world.getBlock(
                        Math.floor(player.pos[0]),
                        Math.floor(player.pos[1] + player.eye),
                        Math.floor(player.pos[2]),
                      ).id,
                    ]
                  : [];
    let nearest: [number, number, number] | null = null;
    let nearestDistance = Infinity;
    const [px, py, pz] = player.pos;
    for (const blockId of candidates) {
      for (let y = Math.floor(py - 0.2); y <= Math.floor(py + player.height); y++)
        for (let z = Math.floor(pz - 0.8); z <= Math.floor(pz + 0.8); z++)
          for (let x = Math.floor(px - 0.8); x <= Math.floor(px + 0.8); x++) {
            if (world.getBlock(x, y, z).id !== blockId) continue;
            const dx = x + 0.5 - px;
            const dy = y + 0.5 - (py + player.eye);
            const dz = z + 0.5 - pz;
            const distance = dx * dx + dy * dy + dz * dz;
            if (distance < nearestDistance) {
              nearestDistance = distance;
              nearest = [dx, dy, dz];
            }
          }
    }
    if (nearest) {
      const side = -Math.sin(player.yaw) * nearest[0] + Math.cos(player.yaw) * nearest[2];
      if (Math.abs(side) > 0.05) return Math.sign(side) * 0.12;
    }
    // Directionless sources such as falling and starvation still get a brief event-driven kick.
    return source.length % 2 === 0 ? -0.12 : 0.12;
  }

  respawn(): void {
    const player = this.player;
    const world = this.world;
    if (!player || !world || !player.dead) return;
    clearPlayerInvulnerability(player);
    const fallback = this.worldSpawnPoint ?? [0.5, 65, 0.5];
    const position = resolveBedRespawn(world, player.spawnPoint, fallback, (x, y, z, height) =>
      player.collision.free(x, y, z, height),
    );
    player.survival.reset();
    player.clearInput();
    player.detached = false;
    this.spawnView = false;
    this.interaction?.clear();
    this.input.actionStates.forEach((_, action) => this.input.actionStates.set(action, false));
    player.teleport(position[0], position[1], position[2]);
    player.onGround = player.collision.supported(position[0], position[1], position[2], 1e-5);
    this.previousEye = player.eye;
    this.camera.roll = 0;
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
      const sensitivity = this.camera.sensitivity * settings.mouseSensitivity;
      this.look(
        p.yaw + this.input.mouseMovement.x * sensitivity,
        p.pitch + this.input.mouseMovement.y * sensitivity * (settings.invertY ? 1 : -1),
      );
      this.input.mouseMovement.x = 0;
      this.input.mouseMovement.y = 0;
    }
    this.charges?.beginFrame();
    const alpha = this.loop.advance(seconds);
    this.charges?.endFrame();
    this.render(alpha);
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
    const hitTimeLeft = this.hitRollUntil - performance.now();
    this.camera.roll = hitTimeLeft > 0 ? this.hitRoll * Math.min(1, hitTimeLeft / 260) : 0;
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
    const shakeLeft = this.shakeUntil - performance.now();
    if (shakeLeft > 0) {
      const now = performance.now();
      const amount = (this.shake * shakeLeft) / 350;
      this.camera.roll += Math.sin(now * 0.09) * amount;
      this.camera.position[1] += Math.sin(now * 0.12) * amount;
    } else this.shake = 0;
    this.camera.updateView();
    this.rememberCamera();
  }
}
