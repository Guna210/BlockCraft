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
  private columns = new Map<string, GenResult>();
  private waiting = new Map<string, (result: GenResult) => void>();
  private serial: Promise<void> = Promise.resolve();
  constructor(
    readonly connection: Connection,
    readonly manager: WorldManager,
  ) {
    const controller = manager.playerController!;
    const originalFrame = controller.frame;
    manager.remoteExit = () => {
      connection.onClose = () => {};
      connection.close();
      controller.frame = originalFrame;
      manager.remoteExit = null;
    };
    connection.listen((message) => {
      this.serial = this.serial.then(() => this.receive(message)).catch(() => connection.close());
    });
  }
  private async receive(message: Message): Promise<void> {
    const m = this.manager;
    switch (message.type) {
      case MessageType.ServerHello:
        this.columns.clear();
        this.waiting.clear();
        m.beginRemote(message.seed, message.dimension, message.spawn, message.time, (cx, cz) => {
          const key = `${cx},${cz}`;
          const result = this.columns.get(key);
          return result
            ? Promise.resolve(result)
            : new Promise((resolve) => this.waiting.set(key, resolve));
        });
        // Local world/AI ticks are never advanced in a remote world.
        m.playerController!.frame = () => m.playerController!.render(1);
        break;
      case MessageType.ChunkData: {
        if (message.dimension !== m.dimension) break;
        const column = await deserializeColumn(message.payload);
        column.setBiomeIndices(column.biomeIndices, DIMENSIONS[message.dimension].biomeIds);
        const result = {
          cx: message.cx,
          cz: message.cz,
          sections: [],
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
          m.world?.setBlock(message.x, message.y, message.z, message.stateId);
        break;
      case MessageType.PlayerCorrection:
        m.playerController?.teleport(...message.position);
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
