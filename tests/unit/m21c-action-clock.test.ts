import { it, expect, vi } from 'vitest';
import { RemoteSession } from '../../src/game/net/session';
import { BlockInteraction } from '../../src/gameplay/block-interaction';
import { World } from '../../src/world/world';
import { Player } from '../../src/entity/player';
import { BlockCollision } from '../../src/entity/physics';
import { BlockActionKind } from '../../src/net/protocol';

it('does not mine from a raw attack press while replaying older worker inputs', () => {
  const world = new World(false);
  world.fill(-2, 64, -2, 2, 64, 2, 'stone');
  const player = new Player(new BlockCollision(world), () => true);
  player.teleport(0.5, 65, 0.5, 0, -Math.PI / 2 + 0.011);
  player.onGround = true;
  const interaction = new BlockInteraction(player, () => {});
  const blockAction = vi.fn();
  const session = Object.assign(
    Object.create(RemoteSession.prototype) as {
      interact(): void;
    },
    {
      manager: { playerController: { player, interaction } },
      breaking: false,
      blockAction,
    },
  );
  // The raw UI press arrives before already-queued, non-attacking worker steps.
  interaction.input('attack', true);
  for (let i = 0; i < 160; i++) session.interact();
  expect(interaction.progress).toBe(0);
  expect(world.getBlock(0, 64, 0).id).toBe('stone');
  expect(blockAction).not.toHaveBeenCalled();
  // Once the sequenced attack arrives, StartBreak precedes any local mining progress.
  player.input('attack', true);
  session.interact();
  expect(blockAction).toHaveBeenCalledWith(BlockActionKind.StartBreak, 0, 64, 0, 'top');
  expect(interaction.progress).toBeGreaterThan(0);
});
