import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockCollision } from '../../src/entity/physics';
import { Player } from '../../src/entity/player';
import { SaveManager, type SaveReason, type SaveSession } from '../../src/persist/save-manager';
import { World } from '../../src/world/world';
import { createFakeIdb, type FakeIdb } from './helpers/fake-idb';

function makeSession(world: World, name = 'w'): SaveSession {
  const player = new Player(new BlockCollision(world), () => true);
  player.teleport(12, 70, -4);
  return {
    name,
    seedString: 'seed',
    worldType: 'default',
    world,
    player: () => player,
    items: () => null,
  };
}

async function startWorld(
  fake: FakeIdb,
  options: { now?: () => number } = {},
): Promise<SaveManager> {
  const saves = new SaveManager({ env: () => fake.env, ...options });
  saves.attach(makeSession(new World(false)), await saves.create('w'));
  // Let the attach warm-up finish before tests replace the clock.
  await new Promise((resolve) => setTimeout(resolve, 40));
  return saves;
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('M17c — thumbnail capture during saves', () => {
  it.each(['hidden', 'exit'] as const)(
    '%s saves write the world and player before a thumbnail frame or its 500 ms fallback',
    async (reason: SaveReason) => {
      const fake = createFakeIdb();
      const saves = await startWorld(fake);
      vi.useFakeTimers();

      const pending = saves.save(reason);
      // Run timer-turn and IndexedDB work without advancing the 500 ms frame fallback.
      for (let i = 0; i < 20 && fake.rows('worlds').length === 0; i++)
        await vi.advanceTimersByTimeAsync(0);

      expect(saves.thumbnailCaptureRequested).toBe(false);
      expect(fake.rows('worlds')).toHaveLength(1);
      expect(fake.rows('players')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(499);
      expect(fake.rows('worlds')).toHaveLength(1);
      expect(fake.rows('players')).toHaveLength(1);
      void pending.catch(() => undefined);
    },
  );

  it('a visible pause save captures a fresh frame and counts its drawImage stretch', async () => {
    const fake = createFakeIdb();
    let clock = 0;
    const saves = await startWorld(fake, { now: () => clock });
    const drawImage = vi.fn(() => {
      clock += 7;
    });
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}

        getContext() {
          return {
            imageSmoothingEnabled: false,
            clearRect: vi.fn(),
            drawImage,
          };
        }
      },
    );
    const freshThumbnail = new Blob(['fresh'], { type: 'image/png' });
    const saveInternals = saves as unknown as { readThumbnail: () => Promise<Blob> };
    vi.spyOn(saveInternals, 'readThumbnail').mockResolvedValue(freshThumbnail);

    const previousVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    try {
      const pending = saves.save('pause');
      for (let i = 0; i < 500 && !saves.thumbnailCaptureRequested; i++)
        await new Promise((resolve) => setTimeout(resolve, 1));
      expect(saves.thumbnailCaptureRequested).toBe(true);

      saves.captureThumbnailFrame({ width: 320, height: 180 } as HTMLCanvasElement);
      await pending;

      expect(drawImage).toHaveBeenCalledOnce();
      expect(fake.rows<{ thumbnail?: Blob }>('worlds')[0]?.thumbnail).toBeTruthy();
      expect(saves.stats.lastRunSlowestStep).toBe('thumbnail');
      expect(saves.stats.lastRunMaxSliceMs).toBeGreaterThanOrEqual(7);
    } finally {
      if (previousVisibility)
        Object.defineProperty(document, 'visibilityState', previousVisibility);
      else delete (document as unknown as Record<string, unknown>).visibilityState;
    }
  });
});
