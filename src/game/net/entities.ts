import { mat4, vec4 } from 'gl-matrix';
import {
  applyEntityMove,
  MessageType as T,
  type EntityPose,
  type Messages,
} from '../../net/protocol';
import { PoseBuffer } from './interpolation';
import type { WorldManager } from '../world-manager';
import { Player } from '../../entity/player';
import { BlockCollision } from '../../entity/physics';
import type { PlayerController } from '../../engine/player-controller';
import { EntityWorld } from '../../entity/ecs/world';
import { TransformC } from '../../entity/ecs/components';
import { spawnEntity, hasEntityType } from '../../entity/ecs/entity-types';
import { ItemEntityManager } from '../../entity/item-entity';
import { UI } from '../../ui/ui-kit';

type Source = Pick<PlayerController, 'player' | 'camera' | 'perspective' | 'renderAlpha'>;
interface RemoteEntity {
  pose: EntityPose;
  sampled: EntityPose;
  history: PoseBuffer;
  source: Source | null;
  label: HTMLDivElement | null;
  localId: number | null;
  kind: string;
  draws: number;
}
/** Presentation owns ids and poses independently of simulation. Nothing here advances AI. */
export class RemoteEntities {
  readonly entities = new Map<number, RemoteEntity>();
  private readonly vp = mat4.create();
  private readonly head = vec4.create();
  private readonly ecs = new EntityWorld();
  private readonly items: ItemEntityManager;
  private readonly originalRender;
  constructor(private readonly manager: WorldManager) {
    const c = manager.playerController!;
    c.ecs = this.ecs;
    c.itemEntities = this.items = new ItemEntityManager(manager.world!);
    const renderer = manager.playerModelRenderer!;
    this.originalRender = renderer.render;
    const render = this.originalRender.bind(renderer);
    renderer.render = (controller, ...args) => {
      let draws = render(controller, ...args);
      for (const entity of this.entities.values())
        if (entity.source) {
          entity.draws = render(entity.source, ...args);
          draws += entity.draws;
        }
      return draws;
    };
  }
  spawn(message: Messages[T.EntitySpawn]): void {
    this.remove(message.id);
    const pose = {
      x: message.position[0],
      y: message.position[1],
      z: message.position[2],
      yaw: message.rotation[0],
      pitch: message.rotation[1],
    };
    const history = new PoseBuffer();
    history.push(performance.now(), pose);
    let source: Source | null = null,
      label: HTMLDivElement | null = null,
      localId: number | null = null;
    if (message.kind === 'player') {
      const player = new Player(new BlockCollision(this.manager.world!), () => true);
      source = { player, camera: this.manager.camera!, perspective: 1, renderAlpha: 1 };
      label = document.createElement('div');
      label.className = 'remote-name';
      label.textContent = message.name ?? 'Player';
      label.dataset.entityId = String(message.id);
      Object.assign(label.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        pointerEvents: 'none',
        zIndex: '5',
        color: UI.text,
        background: UI.outline,
        borderTop: `2px solid ${UI.light}`,
        borderLeft: `2px solid ${UI.light}`,
        borderRight: `2px solid ${UI.shade}`,
        borderBottom: `2px solid ${UI.shade}`,
        padding: '3px 8px',
        font: '14px monospace',
        willChange: 'transform',
      });
      document.body.append(label);
    } else if (hasEntityType(message.kind) || message.kind.startsWith('item:')) {
      localId = spawnEntity(
        { ecs: this.ecs, items: this.items },
        message.kind,
        ...message.position,
      );
    }
    this.entities.set(message.id, {
      pose,
      sampled: { ...pose },
      history,
      source,
      label,
      localId,
      kind: message.kind,
      draws: 0,
    });
  }
  move(message: Messages[T.EntityMove]): void {
    const entity = this.entities.get(message.id);
    if (!entity) return;
    applyEntityMove(entity.pose, message);
    entity.history.push(performance.now(), entity.pose);
  }
  frame(): void {
    const camera = this.manager.camera!;
    mat4.multiply(this.vp, camera.projectionMatrix, camera.viewMatrix);
    const time = performance.now() - 100;
    for (const entity of this.entities.values()) {
      entity.history.sample(time, entity.sampled);
      const p = entity.sampled;
      const player = entity.source?.player;
      if (player) {
        player.pos[0] = player.previous[0] = p.x;
        player.pos[1] = player.previous[1] = p.y;
        player.pos[2] = player.previous[2] = p.z;
        player.yaw = p.yaw;
        player.pitch = p.pitch;
      } else if (entity.localId !== null) {
        if (entity.kind.startsWith('item:')) {
          const item = this.items.pool.find((item) => item.active && item.id === entity.localId);
          if (item) {
            item.pos[0] = p.x;
            item.pos[1] = p.y;
            item.pos[2] = p.z;
            item.previous[0] = p.x;
            item.previous[1] = p.y;
            item.previous[2] = p.z;
          }
        } else {
          const t = this.ecs.get(entity.localId, TransformC);
          if (t) {
            t.pos[0] = t.previous[0] = p.x;
            t.pos[1] = t.previous[1] = p.y;
            t.pos[2] = t.previous[2] = p.z;
            t.yaw = t.previousYaw = p.yaw;
            t.pitch = t.previousPitch = p.pitch;
          }
        }
      }
      if (entity.label) {
        this.head[0] = p.x;
        this.head[1] = p.y + 2.1;
        this.head[2] = p.z;
        this.head[3] = 1;
        vec4.transformMat4(this.head, this.head, this.vp);
        const w = this.head[3]!;
        // A transform moves hidden labels offscreen; only transforms change on frames.
        const x = w > 0 ? ((this.head[0]! / w + 1) * innerWidth) / 2 : -10000;
        const y = w > 0 ? ((1 - this.head[1]! / w) * innerHeight) / 2 : -10000;
        entity.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      }
    }
  }
  remove(id: number): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    entity.label?.remove();
    if (entity.localId !== null) {
      if (entity.kind.startsWith('item:')) {
        const item = this.items.pool.find((item) => item.id === entity.localId);
        if (item) item.active = false;
      } else this.ecs.destroy(entity.localId);
    }
    this.entities.delete(id);
  }
  dispose(): void {
    for (const id of this.entities.keys()) this.remove(id);
    this.manager.playerModelRenderer!.render = this.originalRender;
  }
}
