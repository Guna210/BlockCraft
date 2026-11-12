import { createServer } from 'node:http';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate as yieldTick } from 'node:timers/promises';
import { WebSocketServer } from 'ws';
import {
  MessageType as T,
  BlockActionKind as B,
  ActionFlag as F,
  rejectIncompatibleVersion,
  createEntityMove,
  entityMove,
  type Message,
  type Messages,
  type EntityPose,
} from '../src/net/protocol';
import { PISTON_LAND_TICK } from '../src/gameplay/mechanics';
import { CREATIVE_REACH, SURVIVAL_REACH } from '../src/gameplay/combat';
import { serializeColumn } from '../src/persist/column-format';
import { serializeEcsEntities } from '../src/persist/entity-format';
import { FORMAT_VERSION } from '../src/persist/version';
import {
  applyPlayerData,
  serializePlayerData,
  deserializePlayerData,
  serializeInventory,
  deserializeInventory,
  serializeBlockEntities,
  serializeItemEntities,
  serializeBlockTicks,
} from '../src/persist/serializers';
import { advance, getWorldTime, setWorldTime } from '../src/world/time';
import { weatherManager, type WeatherState } from '../src/world/weather';
import {
  DIMENSIONS,
  isDimensionId,
  otherDimension,
  scaleCoordinate,
  type DimensionId,
} from '../src/world/dimension';
import {
  PortalTravel,
  findLinkedPortal,
  placeArrivalPortal,
  portalArrivalPoint,
  type PortalRecord,
} from '../src/world/portals';
import { useEmberFlint } from '../src/gameplay/portal-use';
import { TransformC, EntityKindC } from '../src/entity/ecs/components';
import { GenerationPool } from './generation';
import { DiskStorage, atomicWrite, readOptional } from './storage';
import { SimulationDimension, Actor } from './simulation';
import { Transport } from './transport';
import { InventoryState } from './inventory-state';
import { transactInventory } from './inventory';
import { parseOptions, type ServerOptions } from './options';

interface Baseline {
  pose: EntityPose;
  message: Messages[T.EntityMove];
  seen: number;
}
interface StreamCell {
  cx: number;
  cz: number;
  key: string;
}
interface NetEntity {
  id: number;
  kind: string;
  name?: string;
  position: [number, number, number];
  rotation: [number, number];
  pose: EntityPose;
  seen: number;
}
interface Peer {
  transport: Transport;
  name: string;
  id: number;
  actor: Actor | null;
  joining: boolean;
  sequence: number;
  hasSequence: boolean;
  inputs: Array<Messages[T.PlayerInput] | null>;
  inputHead: number;
  inputTail: number;
  receivedInputs: number;
  revision: number;
  inventoryState: InventoryState;
  inventory: Messages[T.InventorySync];
  correction: Messages[T.PlayerCorrection];
  travel: PortalTravel;
  blockSequence: number;
  hasBlockSequence: boolean;
  blockQueue: Array<Messages[T.BlockAction] | null>;
  blockAfter: Uint32Array;
  blockHasAfter: Uint8Array;
  blockHead: number;
  blockTail: number;
  latestInputSequence: number;
  receivedAnyInput: boolean;
  breaking: {
    active: boolean;
    x: number;
    y: number;
    z: number;
    slot: number;
    state: number;
    start: number;
    seconds: number;
  };
  loaded: Map<string, StreamCell>;
  queue: StreamCell[];
  queueCount: number;
  queueIndex: number;
  streaming: boolean;
  centerX: number;
  centerZ: number;
  baselines: Map<number, Baseline>;
  chatAt: number;
  pingAt: number;
  rttMs: number;
  ping: Messages[T.Ping];
  timeSync: Messages[T.TimeSync];
  weatherSync: Messages[T.WeatherSync];
}
const faces = {
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
} as const;
function newer(sequence: number, previous: number): boolean {
  return (sequence - previous) >>> 0 > 0 && (sequence - previous) >>> 0 < 0x80000000;
}

/** One authoritative world process; startServer accepts port 0 for isolated headless clients. */
export class AuthoritativeServer {
  readonly http = createServer((request, response) => {
    response.statusCode = request.method === 'GET' && request.url === '/health' ? 200 : 404;
    response.end(
      response.statusCode === 200
        ? JSON.stringify({ status: 'ok', ...this.metrics() })
        : 'not found',
    );
  });
  private readonly sockets = new WebSocketServer({
    server: this.http,
    maxPayload: 1024 * 1024 + 64,
    perMessageDeflate: false,
  });
  readonly dimensions = new Map<DimensionId, SimulationDimension>();
  private readonly peers = new Set<Peer>();
  private readonly pendingUnloads = new Set<Promise<void>>();
  private readonly playerSaves = new Set<Promise<void>>();
  private readonly names = new Set<string>();
  private pool!: GenerationPool;
  private readonly storage: DiskStorage;
  private readonly entities = new Map<number, NetEntity>();
  private readonly offsets: Array<readonly [number, number]> = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextId = 1;
  private ticks = 0;
  private stopped = false;
  private stopping: Promise<void> | null = null;
  private saving: Promise<void> | null = null;
  private saveRequested = false;
  private readonly tickTimes = new Float64Array(1200);
  private tickIndex = 0;
  private lastWeather: WeatherState = 'clear';
  private seed: number;
  private savedDimensions: Partial<Record<DimensionId, { breakCount: number; ticksTime: number }>> =
    {};
  constructor(
    readonly options: ServerOptions,
    private readonly workerEntry?: URL,
  ) {
    this.seed = options.seed;
    this.storage = new DiskStorage(options.world);
    for (let z = -options.viewDistance; z <= options.viewDistance; z++)
      for (let x = -options.viewDistance; x <= options.viewDistance; x++) this.offsets.push([x, z]);
    this.offsets.sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2);
    this.sockets.on('connection', (socket) => {
      if (this.stopped) {
        socket.close();
        return;
      }
      const peer: Peer = {
        transport: null!,
        name: '',
        id: this.nextId++,
        actor: null,
        joining: false,
        sequence: 0,
        hasSequence: false,
        inputs: new Array(8).fill(null),
        inputHead: 0,
        inputTail: 0,
        receivedInputs: 0,
        revision: 0,
        inventoryState: new InventoryState(),
        inventory: { type: T.InventorySync, windowId: 0, revision: 0, slots: [], cursor: null },
        correction: {
          type: T.PlayerCorrection,
          acknowledged: 0,
          position: [0, 0, 0],
          velocity: [0, 0, 0],
        },
        travel: new PortalTravel(),
        blockSequence: 0,
        hasBlockSequence: false,
        blockQueue: new Array(16).fill(null),
        blockAfter: new Uint32Array(16),
        blockHasAfter: new Uint8Array(16),
        blockHead: 0,
        blockTail: 0,
        latestInputSequence: 0,
        receivedAnyInput: false,
        breaking: { active: false, x: 0, y: 0, z: 0, slot: 0, state: 0, start: 0, seconds: 0 },
        loaded: new Map(),
        queue: this.offsets.map(() => ({ cx: 0, cz: 0, key: '' })),
        queueCount: 0,
        queueIndex: 0,
        streaming: false,
        centerX: Infinity,
        centerZ: Infinity,
        baselines: new Map(),
        chatAt: -Infinity,
        rttMs: 0,
        pingAt: performance.now(),
        ping: { type: T.Ping, id: 0 },
        timeSync: { type: T.TimeSync, dimension: 'overworld', time: 0 },
        weatherSync: {
          type: T.WeatherSync,
          dimension: 'overworld',
          weather: 'clear',
          remainingTicks: 0,
        },
      };
      peer.transport = new Transport(socket, options.delayMs, (message) =>
        this.receive(peer, message),
      );
      peer.travel.onTravel = (portal) => {
        void this.travel(peer, portal).catch((error) => {
          if (this.stopped) return;
          console.error(error);
          this.disconnect(peer, 'Portal travel failed');
        });
      };
      socket.on('close', () => this.leave(peer));
      this.peers.add(peer);
    });
  }
  async start(): Promise<this> {
    if (this.options.resetWorld) await rm(this.options.world, { recursive: true, force: true });
    await mkdir(this.options.world, { recursive: true });
    const level = await readOptional(join(this.options.world, 'level.json'));
    weatherManager.reset();
    setWorldTime(6000);
    if (level) {
      const data = JSON.parse(new TextDecoder().decode(level));
      if (data.format !== FORMAT_VERSION || !Number.isInteger(data.seed))
        throw new Error('Unsupported level format');
      this.seed = data.seed;
      this.savedDimensions = data.dimensions ?? {};
      setWorldTime(data.time);
      weatherManager.setState(data.weather);
    }
    if (!level)
      await atomicWrite(
        join(this.options.world, 'level.json'),
        JSON.stringify({
          format: FORMAT_VERSION,
          seed: this.seed,
          time: getWorldTime(),
          weather: weatherManager.getState(),
          dimensions: {},
        }),
      );
    this.lastWeather = weatherManager.weather;
    this.pool = new GenerationPool(2, this.workerEntry);
    try {
      await new Promise<void>((resolve, reject) => {
        this.http.once('error', reject);
        this.http.listen(this.options.port, resolve);
      });
    } catch (error) {
      await this.pool.close();
      throw error;
    }
    this.timer = setInterval(this.tick, 50);
    return this;
  }
  get port(): number {
    const address = this.http.address();
    return typeof address === 'object' && address ? address.port : 0;
  }
  private dimension(id: DimensionId): SimulationDimension {
    let dimension = this.dimensions.get(id);
    if (!dimension) {
      dimension = new SimulationDimension(id, this.seed, this.pool, this.storage);
      const saved = this.savedDimensions[id];
      if (saved) {
        dimension.world.breakCount = saved.breakCount;
        dimension.world.ticks.time = saved.ticksTime;
      }
      const attached = dimension;
      dimension.world.listeners.add({
        blockEdited: (x, y, z, stateId) => {
          const key = `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
          attached.versions.set(key, (attached.versions.get(key) ?? 0) + 1);
          if (id === 'overworld') weatherManager.heightmap.updateBlock(attached.world, x, y, z);
          const message: Messages[T.BlockUpdate] = {
            type: T.BlockUpdate,
            dimension: id,
            x,
            y,
            z,
            stateId,
          };
          for (const peer of this.peers)
            if (peer.actor?.dimension === attached && peer.loaded.has(key))
              peer.transport.send(message);
        },
      });
      this.dimensions.set(id, dimension);
    }
    return dimension;
  }
  private receive(peer: Peer, message: Message): void {
    if (this.stopped) return;
    if (message.type === T.Ping) {
      peer.transport.send({ type: T.Pong, id: message.id });
      return;
    }
    if (message.type === T.Pong) {
      if (message.id === peer.ping.id)
        peer.rttMs = Math.max(0, Math.round(performance.now() - peer.pingAt));
      return;
    }
    if (message.type === T.Disconnect) {
      peer.transport.close();
      return;
    }
    if (!peer.actor) {
      if (message.type !== T.ClientHello || peer.joining) {
        this.reject(peer, 'Send ClientHello before gameplay');
        return;
      }
      const rejection = rejectIncompatibleVersion(message.version);
      if (rejection) {
        peer.transport.send(rejection);
        peer.transport.close();
        return;
      }
      const name = message.name.trim();
      if (
        !name ||
        /[/\\]/.test(name) ||
        [...name].some((character) => character.charCodeAt(0) < 32)
      ) {
        this.reject(peer, 'Name must be nonempty and contain no control or path characters');
        return;
      }
      if (this.names.has(name.toLowerCase())) {
        this.reject(peer, 'Name is already connected');
        return;
      }
      if (this.names.size >= this.options.maxPlayers) {
        this.reject(peer, 'Server is full');
        return;
      }
      peer.name = name;
      peer.joining = true;
      this.names.add(name.toLowerCase());
      void this.join(peer).catch((error) => {
        if (this.stopped) return;
        console.error(error);
        this.reject(peer, 'Could not load player');
      });
      return;
    }
    switch (message.type) {
      case T.PlayerInput: {
        if (++peer.receivedInputs > 4) {
          if (peer.receivedInputs === 5) console.warn(`Input rate exceeded: ${peer.name}`);
          return;
        }
        if (peer.hasSequence && !newer(message.sequence, peer.sequence)) return;
        const latest = peer.inputs[(peer.inputTail + 7) % 8];
        if (
          peer.inputHead !== peer.inputTail &&
          latest &&
          !newer(message.sequence, latest.sequence)
        )
          return;
        if ((peer.inputTail + 1) % 8 === peer.inputHead) {
          console.warn(`Input queue full: ${peer.name}`);
          return;
        }
        if (Math.abs(message.movement[0]) > 1 || Math.abs(message.movement[1]) > 1)
          console.warn(`Movement clamped: ${peer.name}`);
        peer.latestInputSequence = message.sequence;
        peer.receivedAnyInput = true;
        peer.inputs[peer.inputTail] = message;
        peer.inputTail = (peer.inputTail + 1) % 8;
        break;
      }
      case T.BlockAction: {
        const next = (peer.blockTail + 1) % 16;
        if (next === peer.blockHead) {
          console.warn(`Block action queue full: ${peer.name}`);
          break;
        }
        peer.blockQueue[peer.blockTail] = message;
        peer.blockAfter[peer.blockTail] = peer.latestInputSequence;
        peer.blockHasAfter[peer.blockTail] = Number(peer.receivedAnyInput);
        peer.blockTail = next;
        break;
      }
      case T.InventoryTransaction: {
        const reason = transactInventory(
          peer.actor.player,
          peer.actor.dimension.items,
          peer.revision,
          message,
        );
        if (!reason) peer.revision = (peer.revision + 1) >>> 0;
        peer.transport.send({
          type: T.InventoryResult,
          requestId: message.requestId,
          revision: peer.revision,
          accepted: reason === null,
          reason: reason ?? '',
        });
        this.syncInventory(peer, false);
        break;
      }
      case T.ChatSend: {
        const text = [...message.text]
          .filter((character) => {
            const code = character.codePointAt(0)!;
            return code >= 32 && !(code >= 127 && code <= 159);
          })
          .join('');
        if (performance.now() - peer.chatAt < 1000 || !text.trim()) break;
        peer.chatAt = performance.now();
        for (const recipient of this.peers)
          if (recipient.actor)
            recipient.transport.send({
              type: T.ChatBroadcast,
              senderId: peer.id,
              name: peer.name,
              text,
            });
        break;
      }
      default:
        this.disconnect(peer, 'Message is not valid from a client');
    }
  }
  private async join(peer: Peer): Promise<void> {
    await Promise.all(this.playerSaves);
    const bytes = await readOptional(
      join(this.options.world, 'players', `${encodeURIComponent(peer.name)}.bin`),
    );
    const saved = bytes
      ? (JSON.parse(new TextDecoder().decode(bytes)) as { player: number[]; inventory: number[] })
      : null;
    const data = saved ? deserializePlayerData(Uint8Array.from(saved.player)) : null;
    const dimension = this.dimension(
      data && isDimensionId(data.dimension) ? data.dimension : 'overworld',
    );
    dimension.pendingArrivals++;
    try {
      const px = data?.position[0] ?? 0.5,
        pz = data?.position[2] ?? 0.5;
      await dimension.ensureColumn(Math.floor(px / 16), Math.floor(pz / 16));
      if (peer.transport.socket.readyState !== 1 || this.stopped) return;
      const actor = new Actor(dimension, peer.id);
      if (data && saved) {
        applyPlayerData(actor.player, data);
        deserializeInventory(Uint8Array.from(saved.inventory), actor.player.inventory);
      } else
        actor.player.teleport(
          px,
          dimension.world.getHeight(Math.floor(px), Math.floor(pz)) + 1,
          pz,
        );
      peer.actor = actor;
      dimension.attach(actor);
      this.configureActor(peer);
      peer.transport.send({
        type: T.ServerHello,
        entityId: peer.id,
        seed: this.seed,
        spawn: actor.player.pos,
        dimension: dimension.id,
        time: getWorldTime(),
      });
      this.syncInventory(peer, false);
      this.syncTimeWeather(peer);
      this.broadcastPlayerList();
    } finally {
      dimension.pendingArrivals--;
    }
  }
  private configureActor(peer: Peer): void {
    const actor = peer.actor!;
    actor.onInteraction = () => this.processBlockActions(peer);
    peer.correction.position = actor.player.pos;
    peer.correction.velocity = actor.player.vel;
    peer.inventory.slots = actor.player.inventory.slots;
    actor.interaction.onUse = (_id, target) => {
      const world = actor.dimension.world;
      if (world.current.useBlock(target.x, target.y, target.z)) return true;
      const held = actor.player.inventory.held;
      if (held?.id !== 'ember_flint') return false;
      return useEmberFlint(world, actor.dimension.portals, target, actor.player);
    };
  }
  private reject(peer: Peer, reason: string): void {
    peer.transport.send({ type: T.LoginReject, reason });
    peer.transport.close();
  }
  private disconnect(peer: Peer, reason: string): void {
    peer.transport.send({ type: T.Disconnect, reason });
    peer.transport.close();
  }
  private leave(peer: Peer): void {
    if (!this.peers.delete(peer)) return;
    this.names.delete(peer.name.toLowerCase());
    if (peer.actor) {
      const save = this.savePlayer(peer).finally(() => this.playerSaves.delete(save));
      this.playerSaves.add(save);
      void save.catch(console.error);
      peer.actor.dimension.detach(peer.actor);
      peer.actor = null;
      this.broadcastPlayerList();
    }
  }
  private broadcastPlayerList(): void {
    const players: { name: string; pingMs: number }[] = [];
    for (const peer of this.peers)
      if (peer.actor) players.push({ name: peer.name, pingMs: peer.rttMs });
    const message: Messages[T.PlayerList] = { type: T.PlayerList, players };
    for (const peer of this.peers) if (peer.actor) peer.transport.send(message);
  }
  private syncInventory(peer: Peer, detect = true): void {
    const player = peer.actor?.player;
    if (!player) return;
    const changed = peer.inventoryState.capture(player.inventory);
    if (detect && !changed) return;
    if (detect) peer.revision = (peer.revision + 1) >>> 0;
    peer.inventory.revision = peer.revision;
    peer.inventory.cursor = player.inventory.cursor;
    peer.transport.send(peer.inventory);
  }
  private syncTimeWeather(peer: Peer): void {
    const id = peer.actor!.dimension.id;
    peer.timeSync.dimension = id;
    peer.timeSync.time = getWorldTime();
    peer.weatherSync.dimension = id;
    peer.weatherSync.weather = id === 'hollowdeep' ? 'clear' : weatherManager.weather;
    peer.weatherSync.remainingTicks = 6000 - (weatherManager.elapsed % 6000);
    peer.transport.send(peer.timeSync);
    peer.transport.send(peer.weatherSync);
  }
  private processBlockActions(peer: Peer): void {
    for (let count = 0; count < 4 && peer.blockHead !== peer.blockTail; count++) {
      const head = peer.blockHead;
      if (
        peer.blockHasAfter[head] &&
        (!peer.hasSequence || newer(peer.blockAfter[head]!, peer.sequence))
      )
        return;
      const action = peer.blockQueue[head]!;
      peer.blockQueue[head] = null;
      peer.blockHead = (head + 1) % 16;
      this.blockAction(peer, action);
    }
  }
  private blockAction(peer: Peer, action: Messages[T.BlockAction]): void {
    const actor = peer.actor!,
      player = actor.player,
      world = actor.dimension.world;
    const reject = (): void => {
      peer.transport.send({
        type: T.BlockUpdate,
        dimension: actor.dimension.id,
        x: action.x,
        y: action.y,
        z: action.z,
        stateId: world.getBlockStateId(action.x, action.y, action.z),
      });
      if (action.action === B.Place) {
        const offset = faces[action.face],
          x = action.x + offset[0],
          y = action.y + offset[1],
          z = action.z + offset[2];
        if (
          y >= 0 &&
          y < 320 &&
          x >= -2147483648 &&
          x <= 2147483647 &&
          z >= -2147483648 &&
          z <= 2147483647
        )
          peer.transport.send({
            type: T.BlockUpdate,
            dimension: actor.dimension.id,
            x,
            y,
            z,
            stateId: world.getBlockStateId(x, y, z),
          });
      }
    };
    if (peer.hasBlockSequence && !newer(action.sequence, peer.blockSequence)) {
      reject();
      return;
    }
    peer.hasBlockSequence = true;
    peer.blockSequence = action.sequence;
    if (action.action === B.AbortBreak) {
      peer.breaking.active = false;
      return;
    }
    const reach = (player.mode === 'creative' ? CREATIVE_REACH : SURVIVAL_REACH) + 1;
    if (
      player.dead ||
      peer.travel.travelling ||
      action.heldSlot !== player.selectedSlot ||
      Math.hypot(
        action.x + 0.5 - player.pos[0],
        action.y + 0.5 - player.pos[1] - player.eye,
        action.z + 0.5 - player.pos[2],
      ) > reach
    ) {
      peer.breaking.active = false;
      reject();
      return;
    }
    const interaction = actor.interaction;
    interaction.updateTarget(reach);
    const target = interaction.target;
    if (
      !target.hit ||
      target.x !== action.x ||
      target.y !== action.y ||
      target.z !== action.z ||
      target.face !== action.face
    ) {
      reject();
      return;
    }
    const seconds = interaction.miningSeconds(target.stateId);
    if (action.action === B.StartBreak) {
      if (
        peer.breaking.active &&
        peer.breaking.x === action.x &&
        peer.breaking.y === action.y &&
        peer.breaking.z === action.z
      )
        return;
      Object.assign(peer.breaking, {
        active: true,
        x: action.x,
        y: action.y,
        z: action.z,
        slot: action.heldSlot,
        state: target.stateId,
        start: performance.now(),
        seconds,
      });
    } else if (action.action === B.FinishBreak) {
      const start = peer.breaking;
      if (
        !start.active ||
        start.x !== action.x ||
        start.y !== action.y ||
        start.z !== action.z ||
        start.state !== target.stateId ||
        start.slot !== action.heldSlot ||
        !Number.isFinite(seconds) ||
        performance.now() - start.start + 100 < Math.max(seconds, start.seconds) * 1000
      ) {
        start.active = false;
        reject();
        return;
      }
      start.active = false;
      interaction.finishBreak();
    } else if (action.action === B.Place) {
      peer.breaking.active = false;
      if (!interaction.useTarget()) reject();
    }
    this.syncInventory(peer);
  }
  private readonly tick = (): void => {
    if (this.stopped) return;
    const start = performance.now();
    this.ticks++;
    for (const peer of this.peers) {
      if (start - peer.transport.lastHeard > 15000) {
        this.disconnect(peer, 'Keep-alive timeout: 15 seconds of silence');
        continue;
      }
      if (start - peer.pingAt >= 2000) {
        peer.pingAt = start;
        peer.ping.id = (peer.ping.id + 1) >>> 0;
        peer.transport.send(peer.ping);
      }
      peer.receivedInputs = 0;
      if (!peer.actor || peer.travel.travelling) continue;
      const input = peer.inputHead !== peer.inputTail ? peer.inputs[peer.inputHead] : null;
      if (input) {
        const player = peer.actor.player;
        player.yaw = input.look[0] % (2 * Math.PI);
        player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, input.look[1]));
        player.setMovement(input.movement[0], input.movement[1]);
        player.input('jump', !!(input.actions & F.Jump));
        player.input('sneak', !!(input.actions & F.Sneak));
        player.input('sprint', !!(input.actions & F.Sprint));
        player.input('use', !!(input.actions & F.Use));
        peer.actor.combat.input('attack', !!(input.actions & F.Attack));
        peer.actor.combat.input('use', !!(input.actions & F.Use));
        peer.actor.bow.input('use', !!(input.actions & F.Use));
        peer.sequence = input.sequence;
        peer.hasSequence = true;
        peer.inputs[peer.inputHead] = null;
        peer.inputHead = (peer.inputHead + 1) % 8;
      }
    }
    for (const dimension of this.dimensions.values()) dimension.tick();
    advance();
    const overworld = this.dimensions.get('overworld');
    if (overworld)
      weatherManager.tick(overworld.world, getWorldTime(), overworld.actors[0]?.player.pos);
    const weatherChanged = this.lastWeather !== weatherManager.weather;
    this.lastWeather = weatherManager.weather;
    this.refreshEntities();
    for (const peer of this.peers) {
      if (!peer.actor) continue;
      peer.correction.acknowledged = peer.sequence;
      peer.transport.send(peer.correction);
      peer.travel.tick(
        peer.actor.dimension.world,
        peer.actor.dimension.portals,
        ...peer.actor.player.pos,
      );
      this.stream(peer);
      this.sendEntities(peer);
      if (this.ticks % 100 === 0 || weatherChanged) this.syncTimeWeather(peer);
      this.syncInventory(peer);
    }
    if (this.ticks % 40 === 0) this.broadcastPlayerList();
    this.unloadDistantColumns();
    if (this.ticks % 1200 === 0) this.saveRequested = true;
    if (this.saveRequested && !this.saving) {
      this.saveRequested = false;
      void this.save().catch(console.error);
    }
    this.tickTimes[this.tickIndex++ % this.tickTimes.length] = performance.now() - start;
  };
  private stream(peer: Peer): void {
    const actor = peer.actor!,
      player = actor.player,
      dimension = actor.dimension;
    const cx = Math.floor(player.pos[0] / 16),
      cz = Math.floor(player.pos[2] / 16);
    if (cx !== peer.centerX || cz !== peer.centerZ) {
      peer.centerX = cx;
      peer.centerZ = cz;
      for (const [key, cell] of peer.loaded) {
        if (
          Math.abs(cell.cx - cx) <= this.options.viewDistance &&
          Math.abs(cell.cz - cz) <= this.options.viewDistance
        )
          continue;
        peer.transport.send({
          type: T.ChunkUnload,
          dimension: dimension.id,
          cx: cell.cx,
          cz: cell.cz,
        });
        peer.loaded.delete(key);
      }
      peer.queueIndex = 0;
      peer.queueCount = 0;
      for (const offset of this.offsets) {
        const x = cx + offset[0],
          z = cz + offset[1],
          key = `${x},${z}`;
        if (peer.loaded.has(key)) continue;
        const cell = peer.queue[peer.queueCount++]!;
        cell.cx = x;
        cell.cz = z;
        cell.key = key;
      }
    }
    if (peer.streaming || peer.queueIndex >= peer.queueCount || peer.travel.travelling) return;
    const cell = peer.queue[peer.queueIndex++]!;
    // Capture coordinates before an await: the queue's storage is reused when the player crosses a column.
    peer.streaming = true;
    void this.sendColumn(peer, dimension, cell.cx, cell.cz, cell.key)
      .catch((error) => {
        if (!this.stopped) {
          console.error(error);
          this.disconnect(peer, 'Chunk streaming failed');
        }
      })
      .finally(() => {
        peer.streaming = false;
      });
  }
  private async sendColumn(
    peer: Peer,
    dimension: SimulationDimension,
    cx: number,
    cz: number,
    key: string,
  ): Promise<void> {
    await dimension.ensureColumn(cx, cz);
    if (
      this.stopped ||
      peer.actor?.dimension !== dimension ||
      Math.abs(cx - peer.centerX) > this.options.viewDistance ||
      Math.abs(cz - peer.centerZ) > this.options.viewDistance
    )
      return;
    const column = dimension.world.getColumn(cx, cz, false)!;
    let revision: number, payload: Uint8Array;
    do {
      revision = dimension.versions.get(key) ?? 0;
      payload = await serializeColumn(column);
    } while (!this.stopped && revision !== dimension.versions.get(key));
    if (payload.length > 1024 * 1024) throw new Error('Compressed column exceeds protocol limit');
    if (this.stopped || peer.actor?.dimension !== dimension) return;
    peer.transport.send({ type: T.ChunkData, dimension: dimension.id, cx, cz, payload });
    peer.loaded.set(key, { cx, cz, key });
  }
  private refreshEntities(): void {
    for (const peer of this.peers) {
      const actor = peer.actor;
      if (!actor) continue;
      this.updateEntity(
        peer.id,
        'player',
        actor.player.pos,
        actor.player.yaw,
        actor.player.pitch,
        peer.name,
      );
    }
    for (const dimension of this.dimensions.values()) {
      const base = dimension.id === 'overworld' ? 0 : 100000000;
      for (const id of dimension.ecs.query(TransformC, EntityKindC)) {
        const transform = dimension.ecs.get(id, TransformC)!;
        this.updateEntity(
          base + id,
          dimension.ecs.get(id, EntityKindC)!.type,
          transform.pos,
          transform.yaw,
          transform.pitch ?? 0,
        );
      }
      for (const item of dimension.items.pool)
        if (item.active)
          this.updateEntity(base + 200000000 + item.id, `item:${item.item.id}`, item.pos, 0, 0);
    }
    for (const [id, entity] of this.entities)
      if (entity.seen !== this.ticks) this.entities.delete(id);
  }
  private updateEntity(
    id: number,
    kind: string,
    position: readonly [number, number, number],
    yaw: number,
    pitch: number,
    name?: string,
  ): void {
    let entity = this.entities.get(id);
    if (!entity) {
      entity = {
        id,
        kind,
        name,
        position: [0, 0, 0],
        rotation: [0, 0],
        pose: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
        seen: 0,
      };
      this.entities.set(id, entity);
    }
    entity.seen = this.ticks;
    entity.position[0] = entity.pose.x = position[0];
    entity.position[1] = entity.pose.y = position[1];
    entity.position[2] = entity.pose.z = position[2];
    entity.rotation[0] = entity.pose.yaw = yaw;
    entity.rotation[1] = entity.pose.pitch = pitch;
  }
  private sendEntities(peer: Peer): void {
    const actor = peer.actor!,
      player = actor.player;
    for (const entity of this.entities.values()) {
      if (entity.id === peer.id) continue;
      if (entity.kind === 'player') {
        let same = false;
        for (const other of this.peers)
          if (other.id === entity.id && other.actor?.dimension === actor.dimension) same = true;
        if (!same) continue;
      } else if (entity.id % 200000000 >= 100000000 !== (actor.dimension.id === 'hollowdeep'))
        continue;
      if (
        Math.max(
          Math.abs(entity.position[0] - player.pos[0]),
          Math.abs(entity.position[2] - player.pos[2]),
        ) >
        this.options.viewDistance * 16
      )
        continue;
      let baseline = peer.baselines.get(entity.id);
      if (!baseline) {
        peer.transport.send({
          type: T.EntitySpawn,
          id: entity.id,
          kind: entity.kind,
          position: entity.position,
          rotation: entity.rotation,
          name: entity.name,
        });
        baseline = {
          pose: { ...entity.pose },
          message: createEntityMove(entity.id),
          seen: this.ticks,
        };
        peer.baselines.set(entity.id, baseline);
      } else {
        baseline.seen = this.ticks;
        entityMove(entity.id, baseline.pose, entity.pose, baseline.message);
        const changes = baseline.message.changes;
        if (changes.x || changes.y || changes.z || changes.yaw || changes.pitch)
          peer.transport.send(baseline.message);
      }
    }
    for (const [id, baseline] of peer.baselines)
      if (baseline.seen !== this.ticks) {
        peer.transport.send({ type: T.EntityRemove, id });
        peer.baselines.delete(id);
      }
  }
  private keepColumn(dimension: SimulationDimension, cx: number, cz: number): boolean {
    for (const actor of dimension.actors) {
      const distance = this.options.viewDistance + 2;
      if (
        Math.abs(Math.floor(actor.player.pos[0] / 16) - cx) <= distance &&
        Math.abs(Math.floor(actor.player.pos[2] / 16) - cz) <= distance
      )
        return true;
    }
    return false;
  }
  private unloadDistantColumns(): void {
    let started = 0;
    const start = performance.now();
    for (const dimension of this.dimensions.values())
      for (const [key, cell] of dimension.coordinates) {
        if (
          dimension.pendingArrivals > 0 ||
          this.keepColumn(dimension, cell.cx, cell.cz) ||
          dimension.unloading.has(key)
        )
          continue;
        dimension.unloading.add(key);
        const operation = this.unloadColumn(dimension, key, cell.cx, cell.cz).finally(() =>
          this.pendingUnloads.delete(operation),
        );
        this.pendingUnloads.add(operation);
        void operation.catch(console.error);
        if (++started >= this.options.maxPlayers || performance.now() - start >= 3) return;
      }
  }
  private async saveColumnState(
    dimension: SimulationDimension,
    cx: number,
    cz: number,
  ): Promise<void> {
    const world = dimension.world;
    const entities = world.blockEntities.getInColumn(cx, cz);
    const ticks = world.ticks
      .getPendingTicksForColumn(cx, cz)
      .filter((tick) => tick.type !== PISTON_LAND_TICK);
    await atomicWrite(
      join(this.options.world, dimension.id, `c.${cx}.${cz}.state.bin`),
      JSON.stringify({
        blockEntities: [...serializeBlockEntities(entities)],
        ticks: [...serializeBlockTicks({ time: world.ticks.time, ticks })],
        doors: world.current.mechanics.poweredOpenables(cx, cz),
      }),
    );
  }
  private async unloadColumn(
    dimension: SimulationDimension,
    key: string,
    cx: number,
    cz: number,
  ): Promise<void> {
    const world = dimension.world,
      column = world.getColumn(cx, cz, false);
    try {
      if (!column) return;
      world.current.mechanics.landAll();
      if (world.modifiedColumns.has(column)) {
        world.clearModified(column);
        try {
          await this.storage.saveColumns(dimension.id, [column]);
        } catch (error) {
          world.modifiedColumns.add(column);
          throw error;
        }
      }
      if (
        world.blockEntities.getInColumn(cx, cz).length ||
        world.ticks.getPendingTicksForColumn(cx, cz).length
      )
        await this.saveColumnState(dimension, cx, cz);
      if (this.stopped || this.keepColumn(dimension, cx, cz) || world.modifiedColumns.has(column))
        return;
      world.removeColumn(cx, cz);
      dimension.ready.delete(key);
      dimension.versions.delete(key);
      dimension.coordinates.delete(key);
      if (dimension.id === 'overworld') weatherManager.heightmap.removeColumn(cx, cz);
    } finally {
      dimension.unloading.delete(key);
    }
  }
  private async travel(peer: Peer, portal: PortalRecord): Promise<void> {
    const actor = peer.actor!;
    actor.player.detached = true;
    const to = otherDimension(actor.dimension.id),
      dimension = this.dimension(to);
    dimension.pendingArrivals++;
    try {
      const x = scaleCoordinate(portal.x, actor.dimension.id, to),
        z = scaleCoordinate(portal.z, actor.dimension.id, to);
      const cx = Math.floor(x / 16),
        cz = Math.floor(z / 16);
      const pending: Promise<void>[] = [];
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          pending.push(dimension.ensureColumn(cx + dx, cz + dz));
          if (pending.length === 4) {
            await Promise.all(pending);
            pending.length = 0;
          }
        }
      await Promise.all(pending);
      const destination =
        findLinkedPortal(dimension.world, dimension.portals, x, portal.y, z) ??
        (await placeArrivalPortal(
          dimension.world,
          dimension.portals,
          DIMENSIONS[to],
          portal.axis,
          x,
          portal.y,
          z,
          this.seed,
          yieldTick,
        ));
      if (this.stopped || !this.peers.has(peer)) return;
      const replacement = new Actor(dimension, peer.id);
      applyPlayerData(replacement.player, deserializePlayerData(serializePlayerData(actor.player)));
      deserializeInventory(
        serializeInventory(actor.player.inventory),
        replacement.player.inventory,
      );
      replacement.player.dimension = to;
      replacement.player.teleport(...portalArrivalPoint(destination));
      actor.dimension.detach(actor);
      dimension.attach(replacement);
      for (const cell of peer.loaded.values())
        peer.transport.send({
          type: T.ChunkUnload,
          dimension: actor.dimension.id,
          cx: cell.cx,
          cz: cell.cz,
        });
      peer.loaded.clear();
      peer.baselines.clear();
      peer.centerX = Infinity;
      peer.centerZ = Infinity;
      peer.actor = replacement;
      peer.blockHead = peer.blockTail = 0;
      peer.blockQueue.fill(null);
      peer.breaking.active = false;
      this.configureActor(peer);
      peer.travel.arrived();
      peer.transport.send({
        type: T.ServerHello,
        entityId: peer.id,
        seed: this.seed,
        spawn: replacement.player.pos,
        dimension: to,
        time: getWorldTime(),
      });
      this.syncTimeWeather(peer);
      this.syncInventory(peer, false);
    } finally {
      dimension.pendingArrivals--;
    }
  }
  private async savePlayer(peer: Peer): Promise<void> {
    if (!peer.actor) return;
    await atomicWrite(
      join(this.options.world, 'players', `${encodeURIComponent(peer.name)}.bin`),
      JSON.stringify({
        player: [...serializePlayerData(peer.actor.player)],
        inventory: [...serializeInventory(peer.actor.player.inventory)],
      }),
    );
  }
  save(): Promise<void> {
    if (this.saving) return this.saving;
    this.saving = this.saveAll().finally(() => {
      this.saving = null;
    });
    return this.saving;
  }
  private async saveAll(): Promise<void> {
    for (const dimension of this.dimensions.values()) {
      dimension.world.current.mechanics.landAll();
      const columns = [...dimension.world.modifiedColumns];
      // Clear at capture; edits arriving while I/O is pending mark the column for the next save.
      for (const column of columns) dimension.world.clearModified(column);
      try {
        await this.storage.saveColumns(dimension.id, columns);
      } catch (error) {
        for (const column of columns) dimension.world.modifiedColumns.add(column);
        throw error;
      }
      for (const [cx, cz] of dimension.world.loadedColumns()) {
        const entities = dimension.world.blockEntities.getInColumn(cx, cz);
        if (!entities.length && !columns.some((column) => column.cx === cx && column.cz === cz))
          continue;
        await this.saveColumnState(dimension, cx, cz);
        await yieldTick();
      }
      await atomicWrite(
        join(this.options.world, dimension.id, 'entities.bin'),
        JSON.stringify({
          items: [...serializeItemEntities(dimension.items.pool.filter((item) => item.active))],
          portals: [...dimension.portals.serialize()],
          ecs: [...serializeEcsEntities(dimension.ecs)],
        }),
      );
    }
    for (const peer of this.peers) {
      await this.savePlayer(peer);
      await yieldTick();
    }
    await atomicWrite(
      join(this.options.world, 'level.json'),
      JSON.stringify({
        format: FORMAT_VERSION,
        seed: this.seed,
        time: getWorldTime(),
        weather: weatherManager.getState(),
        dimensions: Object.fromEntries(
          [...this.dimensions].map(([id, dimension]) => [
            id,
            { breakCount: dimension.world.breakCount, ticksTime: dimension.world.ticks.time },
          ]),
        ),
      }),
    );
  }
  metrics(): { rss: number; tickP95: number; tickMax: number } {
    const samples = [
      ...this.tickTimes.subarray(0, Math.min(this.tickIndex, this.tickTimes.length)),
    ].sort((a, b) => a - b);
    return {
      rss: process.memoryUsage().rss,
      tickP95: samples[Math.floor(samples.length * 0.95)] ?? 0,
      tickMax: samples.at(-1) ?? 0,
    };
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.shutdown();
    return this.stopping;
  }
  private async shutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.all(this.pendingUnloads);
    if (this.saving) await this.saving;
    await this.save();
    for (const peer of this.peers) this.disconnect(peer, 'Server shutting down');
    await new Promise<void>((resolve) => setTimeout(resolve, this.options.delayMs / 2 + 20));
    for (const peer of this.peers) peer.transport.dispose();
    for (const dimension of this.dimensions.values()) dimension.dispose();
    await this.pool.close();
    await new Promise<void>((resolve) => this.sockets.close(() => resolve()));
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
    await Promise.all(this.playerSaves);
  }
}
export async function startServer(
  options: Partial<ServerOptions> = {},
  workerEntry?: URL,
): Promise<AuthoritativeServer> {
  return new AuthoritativeServer({ ...parseOptions([]), ...options }, workerEntry).start();
}
