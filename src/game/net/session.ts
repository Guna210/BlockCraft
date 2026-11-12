import { activeUi } from '../../ui/ui-manager';
import { RemotePortals } from './portals';
import { api } from '../../debug/api/core';
import type { Chat } from '../../ui/chat';
import { DisconnectScreen } from './disconnect-screen';
import { networkText } from './text';
import { RemoteInventory } from './inventory';
import { PlayerList } from './player-list';
import { RemoteEntities } from './entities';
import { Prediction } from './prediction';
import { BlockInteraction } from '../../gameplay/block-interaction';
import { BlockActionKind, type BLOCK_FACES } from '../../net/protocol';
import { installNetDebug } from '../../debug/api/net';
import { settings } from '../../engine/settings';
import type { Connection } from './connection';
import type { WorldManager } from '../world-manager';
import { MessageType, type Message } from '../../net/protocol';
import { deserializeColumn } from '../../persist/column-format';
import { DIMENSIONS } from '../../world/dimension';
import type { GenResult } from '../../workers/gen-worker-pool';
import { setWorldTime } from '../../world/time';
import { setWeather } from '../../world/weather';

/** One ordered stream owns one presentation world. It never attaches a save session. */
export class RemoteSession {
  private readonly updates: Array<{
    x: number;
    y: number;
    z: number;
    stateId: number;
  }> = [];
  private disconnectScreen: DisconnectScreen | null = null;
  private inventory: RemoteInventory | null = null;
  private disposed = false;
  private previousCorrections = 0;
  private playerCount = 0;
  private readonly playerList: PlayerList;
  private portals: RemotePortals | null = null;
  private entities: RemoteEntities | null = null;
  private prediction: Prediction | null = null;
  private tickTimer = 0;
  private nextTickAt = 0;
  private immediateTick = false;
  private actionSequence = 0;
  private breaking = false;
  private breakX = 0;
  private breakY = 0;
  private breakZ = 0;
  private connected = true;
  private rttMs = 0;
  private pingId = 0;
  private pingAt = 0;
  private pingTimer = 0;
  private columns = new Map<string, GenResult>();
  private waiting = new Map<
    string,
    { promise: Promise<GenResult>; resolve: (result: GenResult) => void }
  >();
  private serial: Promise<void> = Promise.resolve();
  constructor(
    readonly connection: Connection,
    readonly manager: WorldManager,
    readonly chat: Chat,
    readonly leave: () => Promise<void>,
  ) {
    const controller = manager.playerController!;
    if (activeUi.manager) activeUi.manager.inventoryOnly = true;
    api.getRemoteEntities = () =>
      Array.from(this.entities?.entities ?? [], ([id, entity]) => ({
        id,
        kind: entity.kind,
        pos: [entity.sampled.x, entity.sampled.y, entity.sampled.z] as [number, number, number],
        draws: entity.draws,
      }));
    api.getNetPredictionTrace = () => this.prediction?.trace.map((entry) => ({ ...entry })) ?? [];
    api.getNetBlockUpdates = () => this.updates.map((update) => ({ ...update }));
    chat.multiplayerSubmit = (line) => {
      if (line.startsWith('/')) {
        chat.message('Commands are unavailable in multiplayer');
        return;
      }
      if (new TextEncoder().encode(line).length > 256) {
        chat.message('Chat is limited to 256 bytes', true);
        return;
      }
      connection.send({ type: MessageType.ChatSend, text: line });
    };
    connection.onClose = (reason) => {
      if (!this.connected) return;
      this.connected = false;
      window.clearInterval(this.pingTimer);
      window.clearTimeout(this.tickTimer);
      chat.close();
      controller.player?.clearInput();
      controller.input.setCapture(true);
      if (document.pointerLockElement) document.exitPointerLock();
      this.disconnectScreen = new DisconnectScreen(reason, leave);
    };
    this.playerList = new PlayerList(() => controller.input.captured);
    const originalFrame = controller.frame;
    const originalTick = controller.tick;
    const originalAction = controller.input.onAction;
    controller.input.onAction = (action, down) => {
      if (action === 'perspective') originalAction?.(action, down);
      else controller.interaction?.input(action, down);
      // Start a movement tick in the next animation frame, without waiting for a round trip.
      if (down && ['forward', 'back', 'left', 'right', 'jump'].includes(action))
        this.immediateTick = true;
    };
    this.pingTimer = window.setInterval(() => {
      this.pingAt = performance.now();
      connection.send({ type: MessageType.Ping, id: ++this.pingId });
    }, 2000);
    installNetDebug(
      () => ({
        connected: this.connected,
        rttMs: this.rttMs,
        playerCount: this.playerCount,
        predictionCorrections: this.previousCorrections + (this.prediction?.corrections ?? 0),
      }),
      (x, y, z) => this.blockAction(BlockActionKind.FinishBreak, x, y, z, 'top'),
    );

    manager.remoteExit = () => {
      this.disposed = true;
      if (activeUi.manager) activeUi.manager.inventoryOnly = false;
      api.getRemoteEntities = () => [];
      api.getNetPredictionTrace = () => [];
      api.getNetBlockUpdates = () => [];
      this.disconnectScreen?.dispose();
      chat.multiplayerSubmit = null;
      chat.close();
      controller.input.setCapture(false);
      this.playerList.dispose();
      this.entities?.dispose();
      this.connected = false;
      window.clearInterval(this.pingTimer);
      window.clearTimeout(this.tickTimer);
      installNetDebug(null, null);
      controller.tick = originalTick;
      controller.input.onAction = originalAction;
      connection.onClose = () => {};
      connection.close();
      controller.frame = originalFrame;
      manager.remoteExit = null;
    };
    connection.listen((message) => {
      this.serial = this.serial.then(() => this.receive(message)).catch(() => connection.close());
    });
  }
  private blockAction(
    action: BlockActionKind,
    x: number,
    y: number,
    z: number,
    face: (typeof BLOCK_FACES)[number],
  ): void {
    if (!this.connected) return;
    this.connection.send({
      type: MessageType.BlockAction,
      action,
      x,
      y,
      z,
      face,
      heldSlot: this.manager.playerController!.player!.selectedSlot,
      sequence: (this.actionSequence = (this.actionSequence + 1) >>> 0),
    });
  }
  private frame(): void {
    const c = this.manager.playerController!,
      p = c.player!,
      input = c.input;
    if (!this.connected) return;
    if (input.mouseMovement.x || input.mouseMovement.y) {
      c.look(
        p.yaw + input.mouseMovement.x * c.camera.sensitivity * settings.mouseSensitivity,
        p.pitch +
          input.mouseMovement.y *
            c.camera.sensitivity *
            settings.mouseSensitivity *
            (settings.invertY ? 1 : -1),
      );
      input.mouseMovement.x = input.mouseMovement.y = 0;
    }
    if (this.immediateTick) {
      this.simulate();
      this.nextTickAt = performance.now() + 50;
      this.scheduleTick();
    }
    c.render(1);
    this.entities?.frame();
  }
  private scheduleTick(): void {
    window.clearTimeout(this.tickTimer);
    if (!this.connected || this.disposed) return;
    this.tickTimer = window.setTimeout(
      () => {
        this.simulate();
        this.nextTickAt += 50;
        if (this.nextTickAt < performance.now() - 150) this.nextTickAt = performance.now() + 50;
        this.scheduleTick();
      },
      Math.max(1, this.nextTickAt - performance.now()),
    );
  }
  /** Fixed networking clock continues when a browser puts the other player's tab in the background. */
  private simulate(): void {
    const c = this.manager.playerController!,
      p = c.player;
    if (!this.connected || !p || !this.prediction) return;
    this.immediateTick = false;
    this.prediction!.tick();
    const interaction = c.interaction!;
    interaction.updateTarget();
    const t = interaction.target;
    const attacking = p.down('attack') && t.hit;
    const same = this.breaking && t.x === this.breakX && t.y === this.breakY && t.z === this.breakZ;
    if (this.breaking && (!attacking || !same))
      this.blockAction(BlockActionKind.AbortBreak, this.breakX, this.breakY, this.breakZ, 'top');
    if (attacking && !same) this.blockAction(BlockActionKind.StartBreak, t.x, t.y, t.z, t.face);
    this.breaking = attacking;
    this.breakX = t.x;
    this.breakY = t.y;
    this.breakZ = t.z;
    interaction.tick();
  }
  private async receive(message: Message): Promise<void> {
    if (this.disposed) return;
    const m = this.manager;
    switch (message.type) {
      case MessageType.ServerHello: {
        const selectedSlot = this.prediction ? (m.playerController?.player?.selectedSlot ?? 0) : 0;
        this.entities?.dispose();
        this.columns.clear();
        this.waiting.clear();
        m.beginRemote(message.seed, message.dimension, message.spawn, message.time, (cx, cz) => {
          const key = `${cx},${cz}`;
          const result = this.columns.get(key);
          if (result) return Promise.resolve(result);
          let pending = this.waiting.get(key);
          if (!pending) {
            let resolve!: (result: GenResult) => void;
            const promise = new Promise<GenResult>((done) => {
              resolve = done;
            });
            pending = { promise, resolve };
            this.waiting.set(key, pending);
          }
          return pending.promise;
        });
        this.entities = new RemoteEntities(m);
        this.portals = new RemotePortals(m.world!, m.portalIndices[m.dimension]);
        m.playerController!.player!.selectedSlot = selectedSlot;
        this.inventory = new RemoteInventory(
          m.playerController!.player!.inventory,
          this.connection,
        );
        const sequence = this.prediction?.lastSequence ?? 0;
        this.previousCorrections += this.prediction?.corrections ?? 0;
        this.prediction = new Prediction(
          m.playerController!.player!,
          (input) => this.connection.send(input),
          sequence,
          (action) =>
            m.playerController!.input.actionStates.get(
              action as import('../../engine/input').Action,
            ) ?? false,
        );
        this.immediateTick = false;
        this.breaking = false;
        const c = m.playerController!;
        c.interaction = new BlockInteraction(c.player!, (x, y, z) =>
          m.requestInteractionMesh(x, y, z),
        );
        c.interaction.onBreak = (_state, x, y, z) => {
          this.blockAction(BlockActionKind.FinishBreak, x, y, z, c.interaction!.target.face);
          this.breaking = false;
        };
        c.interaction.onUse = (_id, target) => {
          this.blockAction(BlockActionKind.Place, target.x, target.y, target.z, target.face);
          return ['chest', 'kiln', 'workbench'].includes(_id);
        };
        // Replace the entry points only for the lifetime of this session: no single-player hook.
        c.frame = () => this.frame();
        this.nextTickAt = performance.now() + 50;
        this.scheduleTick();
        c.tick = () => {
          throw new Error('Remote simulation is driven by the server');
        };
        break;
      }
      case MessageType.ChunkData: {
        if (message.dimension !== m.dimension) break;
        const column = await deserializeColumn(message.payload);
        column.setBiomeIndices(column.biomeIndices, DIMENSIONS[message.dimension].biomeIds);
        const result = {
          cx: message.cx,
          cz: message.cz,
          sections: [],
          biomes: column.biomeIndices,
          grassTints: column.grassTints,
          foliageTints: column.foliageTints,
          columnMs: 0,
          sectionCount: 0,
          perSectionMs: 0,
          restored: { column, ticks: null, blockEntities: [], doors: [] },
        };
        const key = `${message.cx},${message.cz}`;
        this.columns.set(key, result);
        // Adopt immediately so edits following this frame can never be overwritten by a delayed generation job.
        m.world!.setColumn(column);
        m.streamer.adoptColumn(message.cx, message.cz);
        this.portals?.column(message.cx, message.cz);
        this.waiting.get(key)?.resolve(result);
        this.waiting.delete(key);
        break;
      }
      case MessageType.ChunkUnload:
        if (message.dimension === m.dimension) {
          this.columns.delete(`${message.cx},${message.cz}`);
          this.portals?.unload(message.cx, message.cz);
          m.streamer.evictColumn(message.cx, message.cz);
        }
        break;
      case MessageType.BlockUpdate:
        if (message.dimension === m.dimension) {
          m.world?.setBlockStateId(message.x, message.y, message.z, message.stateId);
          this.portals?.edit(message.x, message.y, message.z);
          this.updates.push({
            x: message.x,
            y: message.y,
            z: message.z,
            stateId: message.stateId,
          });
          if (this.updates.length > 64) this.updates.shift();
        }
        break;
      case MessageType.PlayerCorrection:
        this.prediction?.correct(message);
        break;
      case MessageType.PlayerList:
        this.playerCount = message.players.length;
        this.playerList.update(message.players);
        break;
      case MessageType.ChatBroadcast:
        this.chat.message(`${networkText(message.name)}: ${networkText(message.text)}`);
        break;
      case MessageType.InventorySync:
      case MessageType.InventorySlot:
        this.inventory?.sync(message);
        this.inventory?.resume();
        break;
      case MessageType.InventoryResult:
        this.inventory?.result(message);
        break;
      case MessageType.EntitySpawn:
        this.entities?.spawn(message);
        break;
      case MessageType.EntityMove:
        this.entities?.move(message);
        break;
      case MessageType.EntityRemove:
        this.entities?.remove(message.id);
        break;
      case MessageType.Pong:
        if (message.id === this.pingId) this.rttMs = performance.now() - this.pingAt;
        break;
      case MessageType.TimeSync:
        if (message.dimension === m.dimension) setWorldTime(message.time);
        break;
      case MessageType.WeatherSync:
        if (message.dimension === m.dimension) setWeather(message.weather);
        break;
    }
  }
}
