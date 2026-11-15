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
  type WindowKind,
  type WireStack,
  InventoryAction as A,
  CURSOR_SLOT,
} from '../src/net/protocol';
import { clearPlayerInvulnerability } from '../src/gameplay/combat';
import { deathCauseForDamageSource, resolveBedRespawn } from '../src/gameplay/death-beds';
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
import { MovementClock, MAX_INPUT_STEPS } from '../src/net/movement-clock';
import { transactInventory } from './inventory';
import { chestStorageAt, type ChestEntityState, type ChestStorage } from '../src/gameplay/chests';
import type { KilnState } from '../src/gameplay/kiln';
import { crafting } from '../src/gameplay/crafting';
import {
  fillRecipe,
  takeCraftingOutput,
  type CraftingSlot,
} from '../src/gameplay/crafting-session';
import {
  clickCraftGrid,
  clickKilnSlot,
  clickWindowSlot,
  dragWindowSlots,
  quickMoveInventoryToWindow,
  quickMoveWindowToInventory,
  type WindowSlotAccess,
} from '../src/gameplay/inventory-window';
import { dropInventoryStack } from '../src/gameplay/inventory-drop';
import { BlockRegistry } from '../src/world/blocks/registry';
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
interface PeerWindow {
  id: number;
  nextId: number;
  kind: WindowKind | null;
  x: number;
  y: number;
  z: number;
  revision: number;
  grid: CraftingSlot[];
  chest: ChestStorage | null;
  kiln: KilnState | null;
  slotCount: number;
  slots: Array<WireStack | null>;
  sync: Messages[T.InventorySync];
  slotMessage: Messages[T.InventorySlot];
  slotStack: WireStack;
  lastIds: Array<string | undefined>;
  lastCounts: Uint16Array;
  lastDamage: Float64Array;
  lastAffixes: Array<string | undefined>;
  changed: Uint8Array;
  lastCursorId: string | undefined;
  lastCursorCount: number;
  lastCursorDamage: number;
  lastCursorAffix: string | undefined;
  properties: Array<Messages[T.WindowProperty]>;
  lastPropertyValues: Float64Array;
  closePending: boolean;
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
  movementClock: MovementClock;
  revision: number;
  inventoryState: InventoryState;
  inventory: Messages[T.InventorySync];
  inventorySlots: Array<WireStack | null>;
  inventoryGrid: CraftingSlot[];
  inventoryClosePending: boolean;
  window: PeerWindow;
  correction: Messages[T.PlayerCorrection];
  vitals: Messages[T.PlayerVitals];
  respawning: boolean;
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

function createPeerWindow(): PeerWindow {
  const slots = new Array<WireStack | null>(95).fill(null);
  return {
    id: 0,
    nextId: 0,
    kind: null,
    x: 0,
    y: 0,
    z: 0,
    revision: 0,
    grid: new Array<CraftingSlot>(9).fill(null),
    chest: null,
    kiln: null,
    slotCount: 0,
    slots,
    sync: { type: T.InventorySync, windowId: 0, revision: 0, slots, cursor: null },
    slotMessage: {
      type: T.InventorySlot,
      windowId: 0,
      revision: 0,
      slot: 0,
      stack: null,
    },
    slotStack: { id: '', count: 1 },
    lastIds: new Array<string | undefined>(95).fill(undefined),
    lastCounts: new Uint16Array(95),
    lastDamage: new Float64Array(95).fill(-2),
    lastAffixes: new Array<string | undefined>(95).fill(undefined),
    changed: new Uint8Array(95),
    lastCursorId: undefined,
    lastCursorCount: 0,
    lastCursorDamage: -2,
    lastCursorAffix: undefined,
    properties: [
      { type: T.WindowProperty, windowId: 0, property: 'burnRemaining', value: 0 },
      { type: T.WindowProperty, windowId: 0, property: 'burnTotal', value: 0 },
      { type: T.WindowProperty, windowId: 0, property: 'cookProgress', value: 0 },
    ],
    lastPropertyValues: new Float64Array(3).fill(Number.NaN),
    closePending: false,
  };
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
      const inventorySlots = new Array<WireStack | null>(46).fill(null);
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
        movementClock: new MovementClock(true),
        revision: 0,
        inventoryState: new InventoryState(),
        inventory: {
          type: T.InventorySync,
          windowId: 0,
          revision: 0,
          slots: inventorySlots,
          cursor: null,
        },
        inventorySlots,
        inventoryGrid: new Array<CraftingSlot>(4).fill(null),
        inventoryClosePending: false,
        window: createPeerWindow(),
        correction: {
          type: T.PlayerCorrection,
          acknowledged: 0,
          position: [0, 0, 0],
          velocity: [0, 0, 0],
        },
        vitals: {
          type: T.PlayerVitals,
          health: 20,
          hunger: 20,
          saturation: 0,
          air: 300,
          burning: false,
          mode: 'survival',
          dead: false,
          deathCause: '',
          xpLevel: 0,
          xpProgress: 0,
        },
        respawning: false,
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
          this.closeWindowsAt(attached, x, y, z);
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
      case T.RespawnRequest:
        if (peer.actor.player.dead && !peer.respawning) {
          peer.respawning = true;
          void this.respawn(peer)
            .catch((error) => {
              console.error(error);
              this.disconnect(peer, 'Respawn failed');
            })
            .finally(() => {
              peer.respawning = false;
            });
        }
        break;
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
      case T.ContainerOpenRequest:
        this.openWindow(peer, message.x, message.y, message.z);
        break;
      case T.WindowClose:
        this.requestWindowClose(peer, message.windowId);
        break;
      case T.InventoryTransaction: {
        this.inventoryTransaction(peer, message);
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
  private inWindowReach(peer: Peer, x: number, y: number, z: number): boolean {
    const player = peer.actor!.player;
    const reach = (player.mode === 'creative' ? CREATIVE_REACH : SURVIVAL_REACH) + 1;
    return (
      Math.hypot(
        x + 0.5 - player.pos[0],
        y + 0.5 - player.pos[1] - player.eye,
        z + 0.5 - player.pos[2],
      ) <= reach
    );
  }
  private openWindow(peer: Peer, x: number, y: number, z: number): void {
    const actor = peer.actor;
    if (!actor || actor.player.dead || peer.travel.travelling || y < 0 || y >= 320) return;
    if (!this.inWindowReach(peer, x, y, z)) return;
    if (peer.window.id && !this.closeWindow(peer, peer.window.id, true)) return;
    const world = actor.dimension.world;
    const block = world.getBlock(x, y, z);
    const window = peer.window;
    window.chest = null;
    window.kiln = null;
    window.grid.fill(null);
    if (block.id === 'chest') {
      const chest = chestStorageAt(world, x, y, z);
      if (!chest) return;
      window.kind = chest.double ? 'large_chest' : 'chest';
      window.chest = chest;
      window.slotCount = chest.halves.length * 27 + 41;
    } else if (block.id === 'kiln') {
      const kiln = world.getBlockEntity<KilnState>(x, y, z);
      if (!kiln) return;
      window.kind = 'kiln';
      window.kiln = kiln;
      window.slotCount = 39;
    } else if (block.id === 'workbench') {
      window.kind = 'crafting';
      window.slotCount = 51;
    } else return;
    window.nextId = (window.nextId % 255) + 1;
    window.id = window.nextId;
    window.x = x;
    window.y = y;
    window.z = z;
    window.revision = (window.revision + 1) >>> 0;
    window.closePending = false;
    this.fillWindowSlots(peer);
    this.captureWindowSlots(peer);
    window.sync.type = T.InventorySync;
    window.sync.windowId = window.id;
    window.sync.revision = window.revision;
    window.sync.slots = window.slots;
    window.sync.cursor = actor.player.inventory.cursor;
    window.lastCursorId = window.sync.cursor?.id;
    window.lastCursorCount = window.sync.cursor?.count ?? 0;
    window.lastCursorDamage = this.damageValue(window.sync.cursor);
    window.lastCursorAffix = window.sync.cursor?.affix;
    peer.transport.send({ type: T.WindowOpen, windowId: window.id, kind: window.kind, x, y, z });
    peer.transport.send(window.sync);
    this.syncWindowProperties(peer, true);
  }
  private requestWindowClose(peer: Peer, windowId: number): void {
    if (windowId === 0) {
      if (peer.window.id) return;
      this.closeInventoryWindow(peer, true);
    } else if (peer.window.id === windowId) this.closeWindow(peer, windowId, true);
  }
  private returnCraftGrid(peer: Peer, grid: CraftingSlot[]): boolean {
    const inventory = peer.actor!.player.inventory;
    for (let slot = 0; slot < grid.length; slot++) {
      const stack = grid[slot];
      if (!stack) continue;
      const moved = Math.min(stack.count, inventory.capacity(stack.id, stack));
      if (moved > 0) {
        inventory.insert(stack.id, moved, stack);
        stack.count -= moved;
      }
      if (stack.count > 0) {
        const p = peer.actor!.player.pos;
        if (!peer.actor!.dimension.items.spawn(stack.id, stack.count, p[0], p[1] + 0.5, p[2]))
          return false;
      }
      grid[slot] = null;
    }
    return true;
  }
  private returnCursor(peer: Peer): boolean {
    const player = peer.actor!.player;
    const inventory = player.inventory;
    inventory.returnCursor();
    if (!inventory.cursor) return true;
    const cos = Math.cos(player.pitch);
    const dir = [
      Math.cos(player.yaw) * cos,
      Math.sin(player.pitch),
      Math.sin(player.yaw) * cos,
    ] as const;
    const eye = player.pos[1] + player.eye - 0.3;
    return (
      dropInventoryStack(
        inventory,
        peer.actor!.dimension.items,
        [player.pos[0] + dir[0] * 0.3, eye + dir[1] * 0.3, player.pos[2] + dir[2] * 0.3],
        'cursor',
        true,
        {
          velocity: [dir[0] * 4, dir[1] * 4 + 1, dir[2] * 4],
          pickupDelay: 40,
        },
      ) !== null
    );
  }
  private closeInventoryWindow(peer: Peer, notify: boolean): boolean {
    if (!this.returnCraftGrid(peer, peer.inventoryGrid) || !this.returnCursor(peer)) {
      peer.inventoryClosePending = true;
      return false;
    }
    peer.inventoryClosePending = false;
    if (notify) peer.transport.send({ type: T.WindowClose, windowId: 0 });
    this.syncInventory(peer, false);
    return true;
  }
  private closeWindow(peer: Peer, windowId: number, notify: boolean): boolean {
    const window = peer.window;
    if (!window.id || window.id !== windowId) return false;
    if (window.kind === 'crafting' && !this.returnCraftGrid(peer, window.grid)) {
      window.closePending = true;
      return false;
    }
    if (!this.returnCursor(peer)) {
      window.closePending = true;
      return false;
    }
    window.id = 0;
    window.kind = null;
    window.chest = null;
    window.kiln = null;
    window.slotCount = 0;
    window.closePending = false;
    if (notify) peer.transport.send({ type: T.WindowClose, windowId });
    this.syncInventory(peer, false);
    return true;
  }
  private damageValue(stack: WireStack | null | undefined): number {
    return !stack
      ? -2
      : stack.damage === undefined
        ? -2
        : stack.damage === null
          ? -1
          : stack.damage;
  }
  private windowStack(peer: Peer, slot: number): WireStack | null {
    const window = peer.window;
    const player = peer.actor!.player;
    if (!window.kind || slot < 0 || slot >= window.slotCount) return null;
    if (window.kind === 'chest' || window.kind === 'large_chest') {
      const chestCount = window.chest!.halves.length * 27;
      if (slot < chestCount)
        return (
          (window.chest!.halves[Math.floor(slot / 27)]!.slots[slot % 27] as WireStack | null) ??
          null
        );
      return (player.inventory.slots[slot - chestCount] as WireStack | null) ?? null;
    }
    if (window.kind === 'kiln') {
      const kiln = window.kiln!;
      if (slot === 0) return kiln.input as WireStack | null;
      if (slot === 1) return kiln.fuel as WireStack | null;
      if (slot === 2) return kiln.output as WireStack | null;
      const inventorySlot = slot <= 11 ? slot - 3 : slot - 12 + 9;
      return (player.inventory.slots[inventorySlot] as WireStack | null) ?? null;
    }
    if (slot < 9) return window.grid[slot] as WireStack | null;
    if (slot === 9) return null;
    return (player.inventory.slots[slot - 10] as WireStack | null) ?? null;
  }
  private fillWindowSlots(peer: Peer): void {
    const window = peer.window;
    for (let slot = 0; slot < window.slotCount; slot++)
      window.slots[slot] = this.windowStack(peer, slot);
    window.slots.length = window.slotCount;
  }
  private captureWindowSlots(peer: Peer): void {
    const window = peer.window;
    for (let slot = 0; slot < window.slotCount; slot++) {
      const stack = this.windowStack(peer, slot);
      window.lastIds[slot] = stack?.id;
      window.lastCounts[slot] = stack?.count ?? 0;
      window.lastDamage[slot] = this.damageValue(stack);
      window.lastAffixes[slot] = stack?.affix;
    }
  }
  private syncWindow(peer: Peer, forceRevision = false): void {
    const window = peer.window;
    if (!window.id || !window.kind) return;
    window.changed.fill(0);
    let changed = false;
    for (let slot = 0; slot < window.slotCount; slot++) {
      const stack = this.windowStack(peer, slot);
      if (
        window.lastIds[slot] !== stack?.id ||
        window.lastCounts[slot] !== (stack?.count ?? 0) ||
        window.lastDamage[slot] !== this.damageValue(stack) ||
        window.lastAffixes[slot] !== stack?.affix
      ) {
        changed = true;
        window.changed[slot] = 1;
        window.lastIds[slot] = stack?.id;
        window.lastCounts[slot] = stack?.count ?? 0;
        window.lastDamage[slot] = this.damageValue(stack);
        window.lastAffixes[slot] = stack?.affix;
      }
    }
    const cursor = peer.actor!.player.inventory.cursor;
    const cursorChanged =
      window.lastCursorId !== cursor?.id ||
      window.lastCursorCount !== (cursor?.count ?? 0) ||
      window.lastCursorDamage !== this.damageValue(cursor) ||
      window.lastCursorAffix !== cursor?.affix;
    if (!changed && !cursorChanged && !forceRevision) return;
    window.revision = (window.revision + 1) >>> 0;
    window.slotMessage.windowId = window.id;
    window.slotMessage.revision = window.revision;
    for (let slot = 0; slot < window.slotCount; slot++) {
      if (!window.changed[slot]) continue;
      const stack = this.windowStack(peer, slot);
      window.slotMessage.slot = slot;
      window.slotMessage.stack = stack ? this.copyWindowStack(window.slotStack, stack) : null;
      peer.transport.send(window.slotMessage);
    }
    if (cursorChanged) {
      window.lastCursorId = cursor?.id;
      window.lastCursorCount = cursor?.count ?? 0;
      window.lastCursorDamage = this.damageValue(cursor);
      window.lastCursorAffix = cursor?.affix;
      window.slotMessage.slot = CURSOR_SLOT;
      window.slotMessage.stack = cursor ? this.copyWindowStack(window.slotStack, cursor) : null;
      peer.transport.send(window.slotMessage);
    }
  }
  private copyWindowStack(target: WireStack, stack: WireStack): WireStack {
    target.id = stack.id;
    target.count = stack.count;
    if (stack.damage === undefined) delete target.damage;
    else target.damage = stack.damage;
    if (stack.affix === undefined) delete target.affix;
    else target.affix = stack.affix;
    return target;
  }
  private syncWindowProperties(peer: Peer, force = false): void {
    const window = peer.window;
    const kiln = window.kiln;
    if (!window.id || window.kind !== 'kiln' || !kiln) return;
    for (let i = 0; i < 3; i++) {
      const value = i === 0 ? kiln.burnRemaining : i === 1 ? kiln.burnTotal : kiln.cookProgress;
      if (!force && window.lastPropertyValues[i] === value) continue;
      window.lastPropertyValues[i] = value;
      const message = window.properties[i]!;
      message.windowId = window.id;
      message.value = value;
      peer.transport.send(message);
    }
  }
  private windowBlockUnchanged(peer: Peer): boolean {
    const window = peer.window;
    const actor = peer.actor;
    if (!actor || !window.id || !window.kind || actor.player.dead || peer.travel.travelling)
      return false;
    if (!this.inWindowReach(peer, window.x, window.y, window.z)) return false;
    const world = actor.dimension.world;
    const state = BlockRegistry.getInstance().getResolvedState(
      world.getBlockStateId(window.x, window.y, window.z),
    );
    if (!state) return false;
    if (window.kind === 'chest' || window.kind === 'large_chest') {
      if (state.blockId !== 'chest' || !world.getBlockEntity(window.x, window.y, window.z))
        return false;
      return window.kind === 'large_chest'
        ? String(state.properties.pair) !== 'single'
        : String(state.properties.pair ?? 'single') === 'single';
    }
    if (window.kind === 'kiln')
      return state.blockId === 'kiln' && !!world.getBlockEntity(window.x, window.y, window.z);
    return state.blockId === 'workbench';
  }
  private sameSharedWindow(a: PeerWindow, b: PeerWindow): boolean {
    if (!a.id || !b.id || !a.kind || a.kind !== b.kind) return false;
    if (a.kind === 'kiln') return a.x === b.x && a.y === b.y && a.z === b.z;
    if (a.kind !== 'chest' && a.kind !== 'large_chest') return false;
    const as = a.chest?.halves;
    const bs = b.chest?.halves;
    if (!as || !bs) return false;
    for (const left of as) for (const right of bs) if (left.slots === right.slots) return true;
    return false;
  }
  private closeWindowsAt(
    dimension: SimulationDimension,
    x: number,
    y: number,
    z: number,
    force = false,
  ): void {
    const brokenState = dimension.world.getBlockEntity<ChestEntityState>(x, y, z);
    for (const peer of this.peers) {
      const window = peer.window;
      if (peer.actor?.dimension !== dimension || !window.id || !window.kind) continue;
      let affected = window.x === x && window.y === y && window.z === z;
      if (
        !affected &&
        (window.kind === 'chest' || window.kind === 'large_chest') &&
        brokenState?.slots
      )
        affected = window.chest?.halves.some((half) => half === brokenState) ?? false;
      if (
        !affected &&
        window.kind === 'large_chest' &&
        window.y === y &&
        Math.abs(window.x - x) + Math.abs(window.z - z) === 1
      )
        affected = true;
      if (!affected) continue;
      if (!force) {
        const world = dimension.world;
        let stillBound: boolean;
        if (window.kind === 'chest' || window.kind === 'large_chest') {
          const current = chestStorageAt(world, window.x, window.y, window.z);
          stillBound = Boolean(
            current &&
            current.double === (window.kind === 'large_chest') &&
            current.halves.length === window.chest?.halves.length &&
            current.halves.every((half, index) => half === window.chest?.halves[index]),
          );
        } else if (window.kind === 'kiln') {
          stillBound =
            world.getBlock(window.x, window.y, window.z).id === 'kiln' &&
            world.getBlockEntity(window.x, window.y, window.z) === window.kiln;
        } else stillBound = world.getBlock(window.x, window.y, window.z).id === 'workbench';
        if (stillBound) continue;
      }
      this.closeWindow(peer, window.id, true);
    }
  }
  private syncContainerWindows(forcePeer?: Peer): void {
    for (const peer of this.peers) {
      if (!peer.window.id) continue;
      if (peer.window.closePending) {
        this.closeWindow(peer, peer.window.id, true);
        if (!peer.window.id) continue;
      }
      if (!this.windowBlockUnchanged(peer)) {
        this.closeWindow(peer, peer.window.id, true);
        continue;
      }
      this.syncWindow(peer, peer === forcePeer);
      this.syncWindowProperties(peer);
    }
  }
  private windowAccess(peer: Peer): WindowSlotAccess {
    const window = peer.window;
    return {
      length: window.slotCount,
      get: (slot) => this.windowStack(peer, slot),
      set: (slot, stack) => this.setWindowStack(peer, slot, stack),
    };
  }
  private inventoryGridAccess(peer: Peer): WindowSlotAccess {
    return {
      length: 45,
      get: (slot) =>
        slot < 41
          ? ((peer.actor!.player.inventory.slots[slot] as WireStack | null) ?? null)
          : ((peer.inventoryGrid[slot - 41] as WireStack | null) ?? null),
      set: (slot, stack) => {
        if (slot < 41) peer.actor!.player.inventory.slots[slot] = stack ? { ...stack, slot } : null;
        else peer.inventoryGrid[slot - 41] = stack;
      },
    };
  }
  private setWindowStack(peer: Peer, slot: number, stack: WireStack | null): void {
    const window = peer.window;
    const player = peer.actor!.player;
    if (!window.kind || slot < 0 || slot >= window.slotCount) return;
    if (window.kind === 'chest' || window.kind === 'large_chest') {
      const chestCount = window.chest!.halves.length * 27;
      if (slot < chestCount) {
        const half = window.chest!.halves[Math.floor(slot / 27)]!;
        half.slots[slot % 27] = stack ? ({ ...stack } as (typeof half.slots)[number]) : null;
      } else
        player.inventory.slots[slot - chestCount] = stack
          ? { ...stack, slot: slot - chestCount }
          : null;
    } else if (window.kind === 'kiln') {
      const kiln = window.kiln!;
      if (slot < 2) {
        const value = stack
          ? ({ ...stack, damage: stack.damage ?? null } as KilnState['input'])
          : null;
        if (slot === 0) kiln.input = value;
        else kiln.fuel = value;
      } else if (slot > 2) {
        const inventorySlot = slot <= 11 ? slot - 3 : slot - 12 + 9;
        player.inventory.slots[inventorySlot] = stack ? { ...stack, slot: inventorySlot } : null;
      }
    } else if (slot < 9) window.grid[slot] = stack;
    else if (slot > 9)
      player.inventory.slots[slot - 10] = stack ? { ...stack, slot: slot - 10 } : null;
  }
  private proxyInventoryRequest(
    request: Messages[T.InventoryTransaction],
    revision: number,
    slot: number,
    slots: readonly number[] = [],
  ): Messages[T.InventoryTransaction] {
    return { ...request, windowId: 0, revision, slot, slots };
  }
  private recipeAt(index: number) {
    if (!Number.isInteger(index) || index < 0) return null;
    let current = 0;
    for (const recipe of crafting.recipes.values()) if (current++ === index) return recipe;
    return null;
  }
  private fillServerRecipe(
    peer: Peer,
    grid: CraftingSlot[],
    dimension: 2 | 3,
    recipeIndex: number,
  ): boolean {
    const recipe = this.recipeAt(recipeIndex);
    if (!recipe) return false;
    const filled = fillRecipe(recipe, dimension, grid, peer.actor!.player.inventory.slots);
    if (!filled) return false;
    grid.fill(null);
    for (let i = 0; i < filled.grid.length; i++) grid[i] = filled.grid[i] ?? null;
    for (let i = 0; i < peer.actor!.player.inventory.slots.length; i++)
      peer.actor!.player.inventory.slots[i] = filled.inventory[i] ?? null;
    return true;
  }
  private inventoryTransaction(peer: Peer, request: Messages[T.InventoryTransaction]): void {
    const actor = peer.actor!;
    let reason: string | null;
    let revision: number;
    if (request.windowId === 0) {
      if (peer.window.id) reason = 'Window is not open';
      else if (request.revision !== peer.revision) reason = 'Inventory revision mismatch';
      else if (actor.player.dead) reason = 'Player is dead';
      else reason = this.transactInventoryGrid(peer, request);
      if (!reason) {
        peer.revision = (peer.revision + 1) >>> 0;
        this.syncInventory(peer, false);
      } else this.syncInventory(peer, false);
      revision = peer.revision;
    } else {
      const window = peer.window;
      if (request.windowId !== window.id || !window.id || !window.kind)
        reason = 'Window is not open';
      else if (request.revision !== window.revision) reason = 'Window revision mismatch';
      else if (actor.player.dead) reason = 'Player is dead';
      else if (!this.windowBlockUnchanged(peer)) {
        this.closeWindow(peer, window.id, true);
        reason = 'Window block is unavailable';
      } else reason = this.transactContainer(peer, request);
      if (!reason) {
        this.syncInventory(peer);
        this.syncContainerWindows(peer);
      } else if (window.id) this.sendWindowSync(peer);
      revision = peer.window.revision;
    }
    peer.transport.send({
      type: T.InventoryResult,
      requestId: request.requestId,
      revision,
      accepted: reason === null,
      reason: reason ?? '',
    });
  }
  private transactInventoryGrid(
    peer: Peer,
    request: Messages[T.InventoryTransaction],
  ): string | null {
    const player = peer.actor!.player;
    if (request.action === A.FillRecipe) {
      if (request.slots.length) return 'Unexpected recipe slots';
      if (!this.recipeAt(request.slot)) return 'Unknown recipe';
      this.fillServerRecipe(peer, peer.inventoryGrid, 2, request.slot);
      return null;
    }
    if (request.slot === 45) {
      if (request.slots.length) return 'Unexpected output slots';
      if (
        request.action !== A.LeftClick &&
        request.action !== A.RightClick &&
        request.action !== A.QuickMove
      )
        return 'Invalid crafting output action';
      takeCraftingOutput(peer.inventoryGrid, player.inventory, request.action === A.QuickMove);
      return null;
    }
    if (request.action === A.DragEven || request.action === A.DragOne) {
      if (!request.slots.length || request.slots.length > 45) return 'Invalid drag';
      for (let i = 0; i < request.slots.length; i++) {
        const slot = request.slots[i]!;
        if (slot >= 45) return 'Slot is not owned';
        for (let j = 0; j < i; j++) if (request.slots[j] === slot) return 'Duplicate drag slot';
      }
      dragWindowSlots(
        player.inventory,
        request.slots,
        request.action === A.DragEven ? 'left' : 'right',
        this.inventoryGridAccess(peer),
      );
      return null;
    }
    if (request.slot >= 41 && request.slot < 45) {
      if (request.slots.length) return 'Unexpected grid slots';
      if (
        request.action === A.LeftClick ||
        request.action === A.RightClick ||
        request.action === A.QuickMove
      ) {
        clickCraftGrid(
          player.inventory,
          peer.inventoryGrid,
          request.slot - 41,
          request.action === A.RightClick ? 'right' : 'left',
          request.action === A.QuickMove,
        );
        return null;
      }
      return 'Invalid crafting grid action';
    }
    return transactInventory(player, peer.actor!.dimension.items, peer.revision, request);
  }
  private transactContainer(peer: Peer, request: Messages[T.InventoryTransaction]): string | null {
    const window = peer.window;
    const inventory = peer.actor!.player.inventory;
    if (request.action === A.SelectSlot)
      return request.slots.length
        ? 'Unexpected selection slots'
        : this.transactMappedInventory(peer, request, request.slot);
    if (request.action === A.FillRecipe) {
      if (window.kind !== 'crafting' || request.slots.length) return 'Invalid recipe fill';
      if (!this.recipeAt(request.slot)) return 'Unknown recipe';
      this.fillServerRecipe(peer, window.grid, 3, request.slot);
      return null;
    }
    if (request.action === A.DragEven || request.action === A.DragOne) {
      if (!request.slots.length || request.slots.length > window.slotCount) return 'Invalid drag';
      for (let i = 0; i < request.slots.length; i++) {
        const slot = request.slots[i]!;
        if (
          slot >= window.slotCount ||
          (window.kind === 'crafting' && slot === 9) ||
          (window.kind === 'kiln' && slot === 2)
        )
          return 'Slot is not owned';
        for (let j = 0; j < i; j++) if (request.slots[j] === slot) return 'Duplicate drag slot';
      }
      dragWindowSlots(
        inventory,
        request.slots,
        request.action === A.DragEven ? 'left' : 'right',
        this.windowAccess(peer),
      );
      return null;
    }
    if (window.kind === 'kiln') {
      if (request.slots.length) return 'Unexpected kiln slots';
      if (request.slot >= 39) return 'Slot is not owned';
      if (
        request.action === A.LeftClick ||
        request.action === A.RightClick ||
        request.action === A.QuickMove
      ) {
        clickKilnSlot(
          peer.actor!.player,
          window.kiln!,
          request.slot,
          request.action === A.RightClick ? 'right' : 'left',
          request.action === A.QuickMove,
        );
        return null;
      }
      return this.transactMappedInventory(peer, request, this.kilnInventorySlot(request.slot));
    }
    if (window.kind === 'crafting') {
      if (request.slots.length) return 'Unexpected crafting slots';
      if (request.slot < 9) {
        if (
          request.action !== A.LeftClick &&
          request.action !== A.RightClick &&
          request.action !== A.QuickMove
        )
          return 'Invalid crafting grid action';
        clickCraftGrid(
          inventory,
          window.grid,
          request.slot,
          request.action === A.RightClick ? 'right' : 'left',
          request.action === A.QuickMove,
        );
        return null;
      }
      if (request.slot === 9) {
        if (
          request.action !== A.LeftClick &&
          request.action !== A.RightClick &&
          request.action !== A.QuickMove
        )
          return 'Invalid crafting output action';
        takeCraftingOutput(window.grid, inventory, request.action === A.QuickMove);
        return null;
      }
      return this.transactMappedInventory(peer, request, request.slot - 10);
    }
    const chestCount = window.chest!.halves.length * 27;
    if (
      request.action === A.CollectAll ||
      request.action === A.DropOne ||
      request.action === A.DropStack
    ) {
      if (request.slots.length) return 'Unexpected slots';
      const mapped =
        request.slot === CURSOR_SLOT
          ? CURSOR_SLOT
          : request.slot < chestCount
            ? -1
            : request.slot - chestCount;
      if (mapped < 0) return 'Slot is not owned';
      return this.transactMappedInventory(peer, request, mapped);
    }
    if (request.slots.length) return 'Unexpected slots';
    if (request.slot < chestCount) {
      const access = this.chestAccess(peer);
      if (request.action === A.QuickMove)
        quickMoveWindowToInventory(inventory, access, request.slot);
      else if (request.action === A.LeftClick || request.action === A.RightClick)
        clickWindowSlot(
          inventory,
          access,
          request.slot,
          request.action === A.RightClick ? 'right' : 'left',
        );
      else return 'Invalid chest action';
      return null;
    }
    const inventorySlot = request.slot - chestCount;
    if (request.action === A.QuickMove)
      quickMoveInventoryToWindow(inventory, this.chestAccess(peer), inventorySlot);
    else return this.transactMappedInventory(peer, request, inventorySlot);
    return null;
  }
  private transactMappedInventory(
    peer: Peer,
    request: Messages[T.InventoryTransaction],
    mappedSlot: number,
  ): string | null {
    if (mappedSlot < 0) return 'Slot is not owned';
    return transactInventory(
      peer.actor!.player,
      peer.actor!.dimension.items,
      peer.window.revision,
      this.proxyInventoryRequest(request, peer.window.revision, mappedSlot),
    );
  }
  private kilnInventorySlot(slot: number): number {
    return slot >= 3 && slot < 39 ? (slot <= 11 ? slot - 3 : slot - 12 + 9) : -1;
  }
  private chestAccess(peer: Peer): WindowSlotAccess {
    const chest = peer.window.chest!;
    const length = chest.halves.length * 27;
    return {
      length,
      get: (slot) =>
        (chest.halves[Math.floor(slot / 27)]!.slots[slot % 27] as WireStack | null) ?? null,
      set: (slot, stack) => {
        chest.halves[Math.floor(slot / 27)]!.slots[slot % 27] = stack
          ? ({ ...stack } as (typeof chest.halves)[number]['slots'][number])
          : null;
      },
    };
  }
  private sendWindowSync(peer: Peer): void {
    if (!peer.window.id || !peer.window.kind) return;
    this.fillWindowSlots(peer);
    this.captureWindowSlots(peer);
    peer.window.sync.windowId = peer.window.id;
    peer.window.sync.revision = peer.window.revision;
    peer.window.sync.slots = peer.window.slots;
    peer.window.sync.cursor = peer.actor!.player.inventory.cursor;
    peer.transport.send(peer.window.sync);
  }
  private async join(peer: Peer): Promise<void> {
    await Promise.all(this.playerSaves);
    const bytes = await readOptional(
      join(this.options.world, 'players', `${encodeURIComponent(peer.name)}.bin`),
    );
    const saved = bytes
      ? (JSON.parse(new TextDecoder().decode(bytes)) as {
          player: number[];
          inventory: number[];
          deathCause?: string;
        })
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
      peer.vitals.deathCause = saved?.deathCause ?? (actor.player.dead ? 'Killed' : '');
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
      this.syncVitals(peer, true);
      this.syncInventory(peer, false);
      this.syncTimeWeather(peer);
      this.broadcastPlayerList();
    } finally {
      dimension.pendingArrivals--;
    }
  }
  private configureActor(peer: Peer): void {
    const actor = peer.actor!;
    peer.movementClock.reset();
    const onDeath = actor.player.survival.onDeath;
    actor.player.survival.onDeath = (source) => {
      if (peer.window.id) this.closeWindow(peer, peer.window.id, true);
      this.closeInventoryWindow(peer, true);
      onDeath(source);
      peer.breaking.active = false;
      peer.vitals.deathCause = deathCauseForDamageSource(source);
      this.syncVitals(peer, true);
    };
    // Held combat input must not also mine/place locally: BlockAction owns validated edits.
    actor.interaction.input = () => actor.interaction.clear();
    actor.onInteraction = () => this.processBlockActions(peer);
    peer.correction.position = actor.player.pos;
    peer.correction.velocity = actor.player.vel;
    const beforeBreak = actor.interaction.onBreakBeforeRemove;
    actor.interaction.onBreakBeforeRemove = (state, x, y, z) => {
      this.closeWindowsAt(actor.dimension, x, y, z, true);
      return beforeBreak ? beforeBreak(state, x, y, z) : true;
    };
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
      if (peer.window.id) this.closeWindow(peer, peer.window.id, false);
      this.closeInventoryWindow(peer, false);
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
  private syncVitals(peer: Peer, force = false): void {
    const p = peer.actor!.player,
      v = peer.vitals;
    const changed =
      v.health !== p.health ||
      v.hunger !== p.hunger ||
      v.saturation !== p.saturation ||
      v.air !== p.air ||
      v.burning !== p.burning ||
      v.mode !== p.mode ||
      v.dead !== p.dead ||
      v.xpLevel !== p.xpLevel ||
      v.xpProgress !== p.xpProgress;
    v.health = p.health;
    v.hunger = p.hunger;
    v.saturation = p.saturation;
    v.air = p.air;
    v.burning = p.burning;
    v.mode = p.mode;
    v.dead = p.dead;
    v.xpLevel = p.xpLevel;
    v.xpProgress = p.xpProgress;
    if (!p.dead) v.deathCause = '';
    if (force || changed) peer.transport.send(v);
  }
  private async respawn(peer: Peer): Promise<void> {
    const actor = peer.actor!,
      p = actor.player;
    if (peer.window.id) this.closeWindow(peer, peer.window.id, true);
    this.closeInventoryWindow(peer, true);
    const overworld = this.dimension('overworld');
    overworld.pendingArrivals++;
    actor.dimension.pendingArrivals++;
    try {
      await overworld.ensureColumn(0, 0);
      if (p.spawnPoint) {
        const cx = Math.floor(p.spawnPoint[0] / 16),
          cz = Math.floor(p.spawnPoint[2] / 16);
        for (let z = -1; z <= 1; z++)
          for (let x = -1; x <= 1; x++) await actor.dimension.ensureColumn(cx + x, cz + z);
      }
      if (this.stopped || !this.peers.has(peer)) return;
      const fallback: [number, number, number] = [0.5, overworld.world.getHeight(0, 0) + 1, 0.5];
      const position = resolveBedRespawn(
        actor.dimension.world,
        p.spawnPoint,
        fallback,
        (x, y, z, height) => p.collision.free(x, y, z, height),
      );
      const to =
        position[0] === fallback[0] && position[1] === fallback[1] && position[2] === fallback[2]
          ? overworld
          : actor.dimension;
      clearPlayerInvulnerability(p);
      p.survival.reset();
      p.clearInput();
      p.detached = false;
      actor.bow.clear();
      actor.combat.clear();
      actor.interaction.clear();
      peer.breaking.active = false;
      peer.blockHead = peer.blockTail = 0;
      peer.blockQueue.fill(null);
      // Acknowledge queued pre-death inputs without applying them after respawn.
      if (peer.inputHead !== peer.inputTail) {
        peer.sequence = peer.inputs[(peer.inputTail + 7) % 8]!.sequence;
        peer.hasSequence = true;
      }
      peer.inputs.fill(null);
      peer.inputHead = peer.inputTail = 0;
      peer.movementClock.reset();
      if (to !== actor.dimension) {
        this.replaceActor(peer, to, position);
      } else {
        p.teleport(...position);
        p.onGround = p.collision.supported(...position, 1e-5);
        peer.transport.send({ type: T.PlayerRespawn, dimension: to.id, position: p.pos });
        this.syncVitals(peer, true);
      }
    } finally {
      actor.dimension.pendingArrivals--;
      overworld.pendingArrivals--;
    }
  }
  private syncInventory(peer: Peer, detect = true): void {
    const player = peer.actor?.player;
    if (!player) return;
    const inventoryChanged = peer.inventoryState.capture(player.inventory);
    const gridChanged = peer.inventoryState.captureCrafting(peer.inventoryGrid);
    const changed = inventoryChanged || gridChanged;
    if (detect && !changed) return;
    if (detect) peer.revision = (peer.revision + 1) >>> 0;
    for (let slot = 0; slot < 41; slot++)
      peer.inventorySlots[slot] = player.inventory.slots[slot] ?? null;
    for (let slot = 0; slot < 4; slot++)
      peer.inventorySlots[41 + slot] = peer.inventoryGrid[slot] ?? null;
    peer.inventorySlots[45] = null;
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
      peer.movementClock.beginTick(start);
      if (!peer.actor || peer.travel.travelling) continue;
      let appliedInputs = 0;
      while (
        peer.inputHead !== peer.inputTail &&
        appliedInputs < MAX_INPUT_STEPS &&
        peer.movementClock.canStep
      ) {
        const input = peer.inputs[peer.inputHead]!;
        const player = peer.actor.player;
        if (!player.dead) {
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
        }
        peer.movementClock.input(player);
        appliedInputs++;
        peer.sequence = input.sequence;
        peer.hasSequence = true;
        peer.inputs[peer.inputHead] = null;
        peer.inputHead = (peer.inputHead + 1) % 8;
      }
      peer.movementClock.finishTick(
        peer.actor.player,
        appliedInputs,
        peer.inputHead === peer.inputTail,
      );
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
      this.syncVitals(peer, this.ticks % 20 === 0);
      peer.correction.acknowledged = peer.sequence;
      peer.transport.send(peer.correction);
      if (!peer.actor.player.dead && !peer.respawning)
        peer.travel.tick(
          peer.actor.dimension.world,
          peer.actor.dimension.portals,
          ...peer.actor.player.pos,
        );
      this.stream(peer);
      this.sendEntities(peer);
      if (this.ticks % 100 === 0 || weatherChanged) this.syncTimeWeather(peer);
      if (peer.inventoryClosePending) this.closeInventoryWindow(peer, true);
      this.syncInventory(peer);
    }
    this.syncContainerWindows();
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
      if (!actor || actor.player.dead) continue;
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
    if (peer.window.id) this.closeWindow(peer, peer.window.id, true);
    this.closeInventoryWindow(peer, true);
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
      this.replaceActor(peer, dimension, portalArrivalPoint(destination));
    } finally {
      dimension.pendingArrivals--;
    }
  }
  private replaceActor(
    peer: Peer,
    dimension: SimulationDimension,
    position: [number, number, number],
  ): void {
    if (peer.window.id) this.closeWindow(peer, peer.window.id, true);
    this.closeInventoryWindow(peer, true);
    const actor = peer.actor!;
    const replacement = new Actor(dimension, peer.id);
    applyPlayerData(replacement.player, deserializePlayerData(serializePlayerData(actor.player)));
    deserializeInventory(serializeInventory(actor.player.inventory), replacement.player.inventory);
    replacement.player.dimension = dimension.id;
    replacement.player.teleport(...position);
    replacement.player.onGround = replacement.player.collision.supported(...position, 1e-5);
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
      dimension: dimension.id,
      time: getWorldTime(),
    });
    this.syncVitals(peer, true);
    this.syncTimeWeather(peer);
    this.syncInventory(peer, false);
  }
  private async savePlayer(peer: Peer): Promise<void> {
    if (!peer.actor) return;
    await atomicWrite(
      join(this.options.world, 'players', `${encodeURIComponent(peer.name)}.bin`),
      JSON.stringify({
        deathCause: peer.vitals.deathCause,
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
