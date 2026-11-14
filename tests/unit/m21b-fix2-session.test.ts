import { expect, it, vi } from 'vitest';
import { RemoteSession } from '../../src/game/net/session';
import { activeUi, type UiManager } from '../../src/ui/ui-manager';
import { Player } from '../../src/entity/player';
import { World } from '../../src/world/world';
import { BlockCollision } from '../../src/entity/physics';
import { Prediction } from '../../src/game/net/prediction';
import { MessageType as T, type Message } from '../../src/net/protocol';

it('shows server death, sends a request instead of local respawn, and restores the original handler', async () => {
  const previousUi = activeUi.manager;
  const localRespawn = vi.fn(),
    showDeath = vi.fn(),
    closeDeath = vi.fn();
  const ui = { onRespawn: localRespawn, showDeath, closeDeath };
  activeUi.manager = ui as unknown as UiManager;
  try {
    const w = new World(false);
    w.fill(-2, 64, -2, 8, 64, 8, 'stone');
    const player = new Player(new BlockCollision(w), () => true);
    player.teleport(0.5, 65, 0.5);
    const send = vi.fn(),
      hurt = vi.fn();
    const prediction = new Prediction(player, send);
    const session = Object.assign(
      Object.create(RemoteSession.prototype) as {
        installRespawn(): void;
        restoreRespawn(): void;
        receive(message: Message): Promise<void>;
      },
      {
        originalRespawn: localRespawn,
        manager: {
          dimension: 'overworld',
          playerController: {
            player,
            interaction: { clear: vi.fn() },
            input: { actionStates: new Map() },
            camera: { roll: 0 },
          },
        },
        prediction,
        connection: { send, threaded: false },
        connected: true,
        dead: false,
        serverHealth: 20,
        hurt,
        scheduleTick: vi.fn(),
        disposed: false,
      },
    );
    session.installRespawn();
    await session.receive({
      type: T.PlayerVitals,
      health: 0,
      hunger: 2,
      saturation: 0,
      air: 0,
      burning: false,
      mode: 'survival',
      dead: true,
      deathCause: 'Drowned',
      xpLevel: 0,
      xpProgress: 0,
    });
    expect(showDeath).toHaveBeenCalledExactlyOnceWith('Drowned');
    expect(hurt).toHaveBeenCalledOnce();
    ui.onRespawn();
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: T.RespawnRequest });
    expect(localRespawn).not.toHaveBeenCalled();
    expect(player.dead).toBe(true);
    await session.receive({
      type: T.PlayerRespawn,
      dimension: 'overworld',
      position: [4.5, 65, 4.5],
    });
    expect(closeDeath).toHaveBeenCalledOnce();
    expect(player.pos).toEqual([4.5, 65, 4.5]);
    expect(player.health).toBe(20);
    expect(player.dead).toBe(false);
    expect(prediction.corrections).toBe(0);
    session.restoreRespawn();
    expect(ui.onRespawn).toBe(localRespawn);
  } finally {
    activeUi.manager = previousUi;
  }
});
