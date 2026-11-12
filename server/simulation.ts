import { ServerLighting } from './lighting';
import { snapshotBlocks, type BlockColumnsSnapshot } from '../src/world/block-snapshot';
import type { QueriedEntity } from '../src/entity/query';
import { World } from '../src/world/world';
import { DIMENSIONS, type DimensionId } from '../src/world/dimension';
import { setWorldDimension } from '../src/world/world-dimension';
import { UpdraftField, setUpdraftField } from '../src/world/updrafts';
import { PortalGuard, PortalIndex } from '../src/world/portals';
import { ItemEntityManager } from '../src/entity/item-entity';
import { createEntityWorld, queryEcsEntities } from '../src/entity/ecs/systems';
import { MobRuntime, type MobPlayer } from '../src/entity/ai/runtime';
import { spawnRulesFor } from '../src/entity/spawning';
import { BlastCharges } from '../src/entity/blast-charge';
import { ProjectileRuntime } from '../src/entity/projectiles';
import { Player } from '../src/entity/player';
import { BlockCollision } from '../src/entity/physics';
import { dropDeathInventory } from '../src/gameplay/death-beds';
import { clearPlayerInvulnerability, PlayerCombat, hurtPlayer } from '../src/gameplay/combat';
import { slowPlayer } from '../src/entity/player-slow';
import { BlockInteraction } from '../src/gameplay/block-interaction';
import { BowController } from '../src/gameplay/bow';
import { spillChestContents } from '../src/gameplay/chests';
import { spillKilnContents, registerKilnBlockEntity } from '../src/gameplay/kiln';
import { finishBlockDrops } from '../src/gameplay/block-drops';
import type { ParticleSink } from '../src/gameplay/particle-sink';
import { applyStructureMarkers } from '../src/gameplay/structure-markers';
import { deserializeColumnBinary, serializeColumnBinary } from '../src/persist/column-format';
import { restoreEcsEntities } from '../src/persist/entity-format';
import { weatherManager } from '../src/world/weather';
import type { GenerationPool } from './generation';
import { readOptional, type DiskStorage } from './storage';
import { join } from 'node:path';
import {
  deserializeBlockEntities,
  deserializeBlockTicks,
  deserializeItemEntities,
} from '../src/persist/serializers';
import '../src/entity/mobs';
import '../src/gameplay/spawners';

const noParticles: ParticleSink = { spawn() {}, explosion() {}, ember() {} };
registerKilnBlockEntity();

/** Network-only adapter: the shared physics converts directional inputs with Number(). */
class ServerPlayer extends Player {
  private forwardIntent = 0;
  private rightIntent = 0;
  setMovement(forward: number, right: number): void {
    this.forwardIntent = Math.max(-1, Math.min(1, forward));
    this.rightIntent = Math.max(-1, Math.min(1, right));
    this.input('forward', forward > 0);
    this.input('back', forward < 0);
    this.input('right', right > 0);
    this.input('left', right < 0);
  }
  override down(action: string): boolean {
    let amount: number;
    switch (action) {
      case 'forward':
        amount = Math.max(0, this.forwardIntent);
        break;
      case 'back':
        amount = Math.max(0, -this.forwardIntent);
        break;
      case 'right':
        amount = Math.max(0, this.rightIntent);
        break;
      case 'left':
        amount = Math.max(0, -this.rightIntent);
        break;
      default:
        return super.down(action);
    }
    return amount as unknown as boolean;
  }
  override clearInput(): void {
    this.forwardIntent = 0;
    this.rightIntent = 0;
    super.clearInput();
  }
}

export class Actor {
  /** Physics advances once per newly consumed input, matching the acknowledged sequence. */
  inputReady = false;
  onInteraction: (() => void) | null = null;
  readonly player: ServerPlayer;
  readonly interaction: BlockInteraction;
  readonly combat: PlayerCombat;
  readonly bow: BowController;
  readonly mob: MobPlayer;
  readonly bounds: QueriedEntity = {
    id: '',
    type: 'player',
    minX: 0,
    minY: 0,
    minZ: 0,
    maxX: 0,
    maxY: 0,
    maxZ: 0,
  };
  constructor(
    readonly dimension: SimulationDimension,
    id: number,
  ) {
    this.bounds.id = `player:${id}`;
    const world = dimension.world;
    const player = (this.player = new ServerPlayer(new BlockCollision(world), (x, z) =>
      world.hasColumn(Math.floor(x / 16), Math.floor(z / 16)),
    ));
    player.dimension = dimension.id;
    this.interaction = new BlockInteraction(player, () => {});
    this.combat = new PlayerCombat(player, dimension.ecs, this.interaction);
    this.bow = new BowController(player, dimension.ecs);
    player.survival.onDeath = () => {
      clearPlayerInvulnerability(player);
      player.clearInput();
      this.bow.clear();
      this.combat.clear();
      this.interaction.clear();
      dropDeathInventory(player, dimension.items);
    };
    this.interaction.onBreakBeforeRemove = (_state, x, y, z) => {
      const id = world.getBlock(x, y, z).id;
      return id === 'chest'
        ? spillChestContents(world, dimension.items, x, y, z)
        : id === 'kiln'
          ? spillKilnContents(world, dimension.items, x, y, z)
          : true;
    };
    this.interaction.onBreak = (state, x, y, z, tool) =>
      finishBlockDrops(player, dimension.items, state, x, y, z, tool);
    const gaze = {
      origin: [0, 0, 0] as [number, number, number],
      direction: [0, 0, 0] as [number, number, number],
    };
    this.mob = {
      pos: player.pos,
      get height() {
        return player.height;
      },
      heldItemId: () => player.inventory.held?.id ?? null,
      targetable: () => player.mode === 'survival' && !player.dead && !player.detached,
      hurt: (amount, source, from) => hurtPlayer(player, amount, source, from),
      impulse: (velocity) => {
        for (let i = 0; i < 3; i++) player.vel[i]! += velocity[i]! * 20;
      },
      slow: (factor, ticks) => slowPlayer(player, factor, ticks),
      ignite: (ticks) => {
        if (player.mode === 'survival' && !player.dead && !player.detached)
          player.survival.burningTicks = Math.max(player.survival.burningTicks, ticks);
      },
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
    };
  }
}

export class SimulationDimension {
  readonly world = new World();
  readonly ecs = createEntityWorld();
  readonly items: ItemEntityManager;
  readonly portals = new PortalIndex();
  pendingArrivals = 0;
  readonly actors: Actor[] = [];
  readonly players: Player[] = [];
  readonly mobPlayers: MobPlayer[] = [];
  private readonly playerBounds: QueriedEntity[] = [];
  private readonly activeItemBounds: QueriedEntity[] = [];
  private readonly itemBounds: QueriedEntity[] = Array.from({ length: 256 }, () => ({
    id: 0,
    type: 'item',
    minX: 0,
    minY: 0,
    minZ: 0,
    maxX: 0,
    maxY: 0,
    maxZ: 0,
  }));
  readonly mobs: MobRuntime;
  readonly charges: BlastCharges;
  readonly projectiles: ProjectileRuntime;
  readonly loading = new Map<string, Promise<void>>();
  readonly ready = new Set<string>();
  readonly versions = new Map<string, number>();
  readonly coordinates = new Map<string, { cx: number; cz: number }>();
  readonly unloading = new Set<string>();
  private readonly dirtyLight = new Set<string>();
  private lightingBusy = false;
  private disposed = false;
  private restoring: Promise<void> | null = null;
  constructor(
    readonly id: DimensionId,
    seed: number,
    private readonly pool: GenerationPool,
    private readonly storage: DiskStorage,
  ) {
    const world = this.world;
    world.worldSeed = seed;
    world.lightEngine = new ServerLighting((cx, cz) => this.markLight(cx, cz));
    setWorldDimension(world, id);
    if (id === 'hollowdeep') {
      world.fluids.lavaTickDelay = 10;
      setUpdraftField(world, new UpdraftField(seed));
    }
    world.listeners.add(new PortalGuard(world, this.portals));
    this.items = new ItemEntityManager(world);
    world.itemSpawner = (item, count, x, y, z, velocity, pickupDelay) => {
      this.items.spawn(item, count, x, y, z, { velocity, pickupDelay });
    };
    world.entityQuery.addProvider('player', () => {
      for (const actor of this.actors) {
        const b = actor.bounds,
          p = actor.player;
        b.minX = p.pos[0] - 0.3;
        b.minY = p.pos[1];
        b.minZ = p.pos[2] - 0.3;
        b.maxX = p.pos[0] + 0.3;
        b.maxY = p.pos[1] + p.height;
        b.maxZ = p.pos[2] + 0.3;
      }
      return this.playerBounds;
    });
    world.entityQuery.addProvider('items', () => {
      this.activeItemBounds.length = 0;
      for (let i = 0; i < this.items.pool.length; i++) {
        const item = this.items.pool[i]!;
        if (!item.active) continue;
        const b = this.itemBounds[i]!;
        b.id = item.id;
        b.minX = item.pos[0] - 0.125;
        b.minY = item.pos[1] - 0.125;
        b.minZ = item.pos[2] - 0.125;
        b.maxX = item.pos[0] + 0.125;
        b.maxY = item.pos[1] + 0.125;
        b.maxZ = item.pos[2] + 0.125;
        this.activeItemBounds.push(b);
      }
      return this.activeItemBounds;
    });
    world.entityQuery.addProvider('ecs', () => queryEcsEntities(this.ecs));
    this.mobs = new MobRuntime(world, this.ecs, {
      player: () => this.actors[0]?.mob ?? null,
      players: () => this.mobPlayers,
      spawnContext: { ecs: this.ecs, items: this.items },
      spawnRules: spawnRulesFor(id),
    });
    this.charges = new BlastCharges(
      world,
      this.ecs,
      {
        ecs: this.ecs,
        world,
        player: () => this.actors[0]?.mob ?? null,
        players: () => this.mobPlayers,
      },
      noParticles,
      () => {},
      true,
    );
    this.projectiles = new ProjectileRuntime(
      world,
      this.ecs,
      () => this.actors[0]?.player ?? null,
      () => this.items,
      () => this.players,
    );
  }
  async ensureColumn(cx: number, cz: number): Promise<void> {
    const key = `${cx},${cz}`;
    if (this.ready.has(key)) return;
    const existing = this.loading.get(key);
    if (existing) return existing;
    const promise = this.loadColumn(cx, cz, key);
    this.loading.set(key, promise);
    try {
      await promise;
    } finally {
      this.loading.delete(key);
    }
  }
  private async loadColumn(cx: number, cz: number, key: string): Promise<void> {
    this.restoring ??= this.restoreEntities();
    await this.restoring;
    const saved = await this.storage.loadColumn(this.id, cx, cz);
    const result = await this.pool.generate(
      this.world.worldSeed,
      this.id,
      cx,
      cz,
      saved ? serializeColumnBinary(saved) : undefined,
    );
    const column = saved ?? deserializeColumnBinary(result.bytes);
    column.setBiomeIndices(column.biomeIndices, DIMENSIONS[this.id].biomeIds);
    this.world.setColumn(column);
    for (const light of result.lights) {
      this.world.lightEngine.storage.setRawData(cx, light.sy, cz, light.data);
      for (let i = 0; i < light.rgb.length; i++)
        this.world.lightEngine.rgbChannels[i]?.storage.setRawData(cx, light.sy, cz, light.rgb[i]!);
    }
    this.world.lightEngine.markLit(cx, cz);
    const bytes = await readOptional(join(this.storage.root, this.id, `c.${cx}.${cz}.state.bin`));
    if (bytes) {
      const state = JSON.parse(new TextDecoder().decode(bytes));
      const ticks = deserializeBlockTicks(Uint8Array.from(state.ticks));
      this.world.ticks.addRebased(ticks.ticks, ticks.time);
      for (const entity of deserializeBlockEntities(Uint8Array.from(state.blockEntities)))
        this.world.blockEntities.restore(entity);
      this.world.current.restoreColumn(column);
      this.world.current.mechanics.restorePoweredOpenables(state.doors);
      this.world.current.settleRestored();
    } else if (!saved) applyStructureMarkers(this.world, result.markers);
    this.world.notifyColumnLoaded(cx, cz, !saved);
    this.versions.set(key, 0);
    if (this.id === 'overworld') weatherManager.heightmap.updateColumn(this.world, cx, cz);
    this.ready.add(key);
    this.coordinates.set(key, { cx, cz });
    this.markLight(cx, cz);
  }
  private markLight(cx: number, cz: number): void {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const key = `${cx + dx},${cz + dz}`;
        if (this.coordinates.has(key)) this.dirtyLight.add(key);
      }
  }
  private pumpLighting(): void {
    if (this.lightingBusy || this.dirtyLight.size === 0 || this.disposed) return;
    const key = this.dirtyLight.values().next().value!;
    this.dirtyLight.delete(key);
    const cell = this.coordinates.get(key);
    if (!cell) return;
    this.lightingBusy = true;
    void this.relight(cell.cx, cell.cz)
      .catch((error) => {
        if (!this.disposed) console.error(error);
      })
      .finally(() => {
        this.lightingBusy = false;
      });
  }
  private async relight(cx: number, cz: number): Promise<void> {
    const columns: BlockColumnsSnapshot = {},
      revisions = new Map<string, number>();
    for (let z = cz - 1; z <= cz + 1; z++)
      for (let x = cx - 1; x <= cx + 1; x++) {
        const key = `${x},${z}`,
          column = this.world.getColumn(x, z, false);
        revisions.set(key, this.versions.get(key) ?? -1);
        columns[key] = Array.from({ length: 20 }, (_, sy) =>
          snapshotBlocks(column?.getSection(sy)),
        );
      }
    const result = await this.pool.generate(this.world.worldSeed, this.id, cx, cz, undefined, {
      bounds: { minCX: cx - 1, maxCX: cx + 1, minCZ: cz - 1, maxCZ: cz + 1 },
      interior: { minCX: cx, maxCX: cx, minCZ: cz, maxCZ: cz },
      columns,
    });
    if (this.disposed || !this.coordinates.has(`${cx},${cz}`)) return;
    for (const [key, revision] of revisions)
      if ((this.versions.get(key) ?? -1) !== revision) {
        this.dirtyLight.add(`${cx},${cz}`);
        return;
      }
    for (const column of result.relit ?? [])
      (this.world.lightEngine as ServerLighting).adopt(column);
  }
  attach(actor: Actor): void {
    this.actors.push(actor);
    this.players.push(actor.player);
    this.mobPlayers.push(actor.mob);
    this.playerBounds.push(actor.bounds);
  }
  detach(actor: Actor): void {
    const index = this.actors.indexOf(actor);
    if (index >= 0) {
      this.actors.splice(index, 1);
      this.players.splice(index, 1);
      this.mobPlayers.splice(index, 1);
      this.playerBounds.splice(index, 1);
    }
  }
  private async restoreEntities(): Promise<void> {
    const bytes = await readOptional(join(this.storage.root, this.id, 'entities.bin'));
    if (!bytes) return;
    const state = JSON.parse(new TextDecoder().decode(bytes));
    this.portals.load(state.portals);
    if (state.ecs)
      restoreEcsEntities(
        { ecs: this.ecs, items: this.items },
        this.charges,
        Uint8Array.from(state.ecs),
      );
    for (const item of deserializeItemEntities(Uint8Array.from(state.items))) {
      const entity = this.items.spawn(
        item.id,
        item.count,
        ...item.position,
        { velocity: item.velocity, pickupDelay: item.pickupDelay },
        item,
      );
      if (entity) entity.age = item.age;
    }
  }
  tick(): void {
    this.charges.beginFrame();
    this.world.tick();
    for (const actor of this.actors) {
      if (actor.inputReady) {
        actor.player.tick();
        actor.inputReady = false;
      }
      actor.bow.tick();
      if (!actor.player.dead) {
        actor.combat.tick();
        actor.interaction.tick();
        actor.onInteraction?.();
      }
      actor.player.survival.tick(this.world, actor.player);
    }
    this.items.tick(this.actors[0]?.player ?? null, this.players);
    this.ecs.tick();
    this.charges.endFrame();
    this.pumpLighting();
  }
  dispose(): void {
    this.disposed = true;
    if (this.id === 'hollowdeep') setUpdraftField(this.world, null);
    this.mobs.dispose();
    this.charges.dispose();
  }
}
