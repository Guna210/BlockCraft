import type { Page } from '@playwright/test';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface FlyOptions {
  from: Vec3;
  to: Vec3;
  /** Blocks per second. */
  speed: number;
  /** Camera pitch in radians while flying; default 0 (level). */
  pitch?: number;
}

/**
 * Moves the camera in a straight line from `from` to `to` at `speed` blocks per second and resolves
 * when it arrived and two frames have drawn there. The pose is set from wall-clock time in a page-side requestAnimationFrame loop,
 * so a slow frame makes a longer step, not a slower flight. Everything that touches the camera is in
 * this function: M06a switches it to teleporting the player instead.
 */
export async function fly(page: Page, opts: FlyOptions): Promise<void> {
  await page.evaluate(
    ({ from, to, speed, pitch }) =>
      new Promise<void>((resolve) => {
        const host = window as unknown as {
          WorldManager: {
            getInstance(): {
              camera: {
                position: Float32Array;
                yaw: number;
                pitch: number;
                updateView(): void;
              };
            };
          };
        };
        const camera = host.WorldManager.getInstance().camera;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dz = to.z - from.z;
        const length = Math.hypot(dx, dy, dz);
        const duration = length / speed;
        const yaw = Math.atan2(dz, dx);
        const start = performance.now();
        const setPose = (t: number) => {
          camera.position[0] = from.x + dx * t;
          camera.position[1] = from.y + dy * t;
          camera.position[2] = from.z + dz * t;
          camera.yaw = yaw;
          camera.pitch = pitch;
          camera.updateView();
        };
        const step = () => {
          const t = duration > 0 ? Math.min(1, (performance.now() - start) / 1000 / duration) : 1;
          setPose(t);
          if (t >= 1) {
            // The game reads the camera once per frame: let two frames see the final pose, so the
            // streaming that follows is planned for where the flight ended.
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          } else {
            requestAnimationFrame(step);
          }
        };
        step();
      }),
    { from: opts.from, to: opts.to, speed: opts.speed, pitch: opts.pitch ?? 0 },
  );
}

/**
 * Resolves when streaming has nothing left to do (no queued or running generation or meshing, no
 * deferred uploads) on two polls in a row, and throws when that takes longer than `timeoutMs`.
 */
export async function waitForStreamingIdle(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let quiet = 0;
  let last = '';
  while (Date.now() < deadline) {
    const stats = await page.evaluate(() => window.__blockcraft!.getStreamingStats!());
    const busy =
      stats.genQueued +
      stats.genRunning +
      stats.meshQueued +
      stats.meshRunning +
      stats.uploadsDeferred;
    last = JSON.stringify(stats);
    quiet = busy === 0 ? quiet + 1 : 0;
    if (quiet >= 2) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`streaming did not become idle within ${timeoutMs} ms: ${last}`);
}
