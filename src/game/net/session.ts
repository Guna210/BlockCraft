import { RemoteEntities } from './entities';
import { Prediction } from './prediction';
import { BlockInteraction } from '../../gameplay/block-interaction';
import { BlockActionKind, type Messages, type BLOCK_FACES } from '../../net/protocol';
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
  private entities: RemoteEntities | null = null;
  private prediction: Prediction | null = null;
  private elapsed = 0;
  private actionSequence = 0;
  private breaking = '';
  private connected = true;
  private rttMs = 0;
  private pingId = 0;
  private pingAt = 0;
  private pingTimer = 0;
  private columns = new Map<string, GenResult>();
  private waiting = new Map<string, (result: GenResult) => void>();
  private serial: Promise<void> = Promise.resolve();
  constructor(
    readonly connection: Connection,
    readonly manager: WorldManager,
  ) {
    const controller = manager.playerController!;
    const originalFrame = controller.frame;
    const originalTick = controller.tick;
    const originalAction = controller.input.onAction;
    controller.input.onAction = (action, down) => {
      originalAction?.(action, down);
      // Start a movement tick in the next animation frame, without waiting for a round trip.
      if (down && ['forward', 'back', 'left', 'right', 'jump'].includes(action))
        this.elapsed = 0.05;
    };
    this.pingTimer = window.setInterval(() => {
      this.pingAt = performance.now();
      connection.send({ type: MessageType.Ping, id: ++this.pingId });
    }, 2000);
    installNetDebug(
      () => ({
        connected: this.connected,
        rttMs: this.rttMs,
        playerCount: 0,
        predictionCorrections: this.prediction?.corrections ?? 0,
      }),
      (x, y, z) => this.blockAction(BlockActionKind.FinishBreak, x, y, z, 'top'),
    );

    manager.remoteExit = () => {
      this.entities?.dispose();
      this.connected = false;
      window.clearInterval(this.pingTimer);
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
  private frame(seconds: number): void {
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
    this.elapsed += Math.min(0.25, Math.max(0, seconds));
    while (this.elapsed >= 0.05) {
      this.elapsed -= 0.05;
      this.prediction!.tick();
      const interaction = c.interaction!;
      interaction.updateTarget();
      const t = interaction.target;
      const key = p.down('attack') && t.hit ? `${t.x},${t.y},${t.z}` : '';
      if (this.breaking && key !== this.breaking) {
        const [x, y, z] = this.breaking.split(',').map(Number);
        this.blockAction(BlockActionKind.AbortBreak, x!, y!, z!, 'top');
      }
      if (key && key !== this.breaking)
        this.blockAction(BlockActionKind.StartBreak, t.x, t.y, t.z, t.face);
      this.breaking = key;
      interaction.tick();
    }
    c.render(1);
    this.entities?.frame();
  }
  private async receive(message: Message): Promise<void> {
    const m = this.manager;
    switch (message.type) {
      case MessageType.ServerHello:
        this.entities?.dispose();
        this.columns.clear();
        this.waiting.clear();
        m.beginRemote(message.seed, message.dimension, message.spawn, message.time, (cx, cz) => {
          const key = `${cx},${cz}`;
          const result = this.columns.get(key);
          return result
            ? Promise.resolve(result)
            : new Promise((resolve) => this.waiting.set(key, resolve));
        });
        this.entities = new RemoteEntities(m);
        this.prediction = new Prediction(m.playerController!.player!, (input) =>
          this.connection.send(input),
        );
        this.elapsed = 0;
        this.breaking = '';
        const c = m.playerController!;
        c.interaction = new BlockInteraction(c.player!, (x, y, z) =>
          m.requestInteractionMesh(x, y, z),
        );
        c.interaction.onBreak = (_state, x, y, z) => {
          this.blockAction(BlockActionKind.FinishBreak, x, y, z, c.interaction!.target.face);
          this.breaking = '';
        };
        c.interaction.onUse = (_id, target) => {
          this.blockAction(BlockActionKind.Place, target.x, target.y, target.z, target.face);
          return ['chest', 'kiln', 'workbench'].includes(_id);
        };
        // Replace the entry points only for the lifetime of this session: no single-player hook.
        c.frame = (seconds) => this.frame(seconds);
        c.tick = () => {
          throw new Error('Remote simulation is driven by the server');
        };
        break;
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
        this.waiting.get(key)?.(result);
        this.waiting.delete(key);
        break;
      }
      case MessageType.ChunkUnload:
        if (message.dimension === m.dimension) {
          this.columns.delete(`${message.cx},${message.cz}`);
          m.world?.removeColumn(message.cx, message.cz);
          m.chunkRenderer?.removeColumnMeshes(message.cx, message.cz);
        }
        break;
      case MessageType.BlockUpdate:
        if (message.dimension === m.dimension)
          m.world?.setBlockStateId(message.x, message.y, message.z, message.stateId);
        break;
      case MessageType.PlayerCorrection:
        this.prediction?.correct(message);
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
