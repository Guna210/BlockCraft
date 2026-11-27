import type { Page } from '@playwright/test';
import type { EcsEntitySnapshot as Target } from '../../src/entity/ecs/systems';
import { expect, test } from '../harness/fixture';
import { assertNoMissingTexture, assertNotBlank } from '../harness/pixels';

type Position = [number, number, number];
type Rect = { x: number; y: number; w: number; h: number };

const poll = { timeout: 30_000, intervals: [100, 200, 400] };
const seed = 'blockcraft-test-seed-42';
const worldName = 'M23 Survival';
const center = ([x, y, z]: Position): Position => [x + 0.5, y + 0.5, z + 0.5];
const offset = ([x, y, z]: Position, dx: number, dy: number, dz: number): Position => [
  x + dx,
  y + dy,
  z + dz,
];

class Survival {
  constructor(readonly page: Page) {}

  player() {
    return this.page.evaluate(() => window.__blockcraft!.getPlayer!());
  }

  screen() {
    return this.page.evaluate(() => window.__blockcraft!.getScreen!());
  }

  inventory() {
    return this.page.evaluate(() => window.__blockcraft!.getInventory!());
  }

  async count(id: string) {
    return (await this.inventory()).reduce(
      (total, stack) => total + (stack?.id === id ? stack.count : 0),
      0,
    );
  }

  block(at: Position) {
    return this.page.evaluate((p) => window.__blockcraft!.getBlock!(...p), at);
  }

  locate(kind: 'biome' | 'ore', id: string, near: Position) {
    return this.page.evaluate(
      ({ kind, id, near }) => window.__blockcraft!.locate!(kind, id, near),
      { kind, id, near },
    );
  }

  teleport(at: Position) {
    return this.page.evaluate((p) => window.__blockcraft!.teleport!(...p), at);
  }

  async ground(at: Position) {
    await this.teleport(at);
    await expect.poll(async () => (await this.player()).onGround, poll).toBe(true);
  }

  look(at: Position) {
    return this.page.evaluate(([x, y, z]) => {
      const api = window.__blockcraft!;
      const [px, py, pz] = api.getPlayer!().pos;
      api.look!(Math.atan2(z - pz, x - px), Math.atan2(y - py - 1.62, Math.hypot(x - px, z - pz)));
    }, at);
  }

  input(action: string, down: boolean) {
    return this.page.evaluate(({ action, down }) => window.__blockcraft!.input!(action, down), {
      action,
      down,
    });
  }

  target(at: Position, height = 0.5) {
    return this.page.evaluate(
      ({ at: [x, y, z], height }) => {
        const api = window.__blockcraft!;
        const [px, py, pz] = api.getPlayer!().pos;
        const nearest = (p: number, b: number) => Math.max(b + 0.04, Math.min(p, b + 0.96));
        // At the foot of a tree, the trunk above can obscure the lower log's centre.
        // Try its near side before concluding that it is out of view.
        for (const [tx, ty, tz] of [
          [x + 0.5, y + height, z + 0.5],
          [nearest(px, x), y + height, nearest(pz, z)],
          [nearest(px, x), y + 0.12, nearest(pz, z)],
          [nearest(px, x), y + 0.88, nearest(pz, z)],
        ] as const) {
          const [dx, dy, dz] = [tx - px, ty - py - 1.62, tz - pz];
          api.look!(Math.atan2(dz, dx), Math.atan2(dy, Math.hypot(dx, dz)));
          const hit = api.raycast!();
          if (hit.block?.[0] === x && hit.block[1] === y && hit.block[2] === z) return hit;
        }
        return api.raycast!();
      },
      { at, height },
    );
  }

  async aim(at: Position, height = 0.5) {
    const ray = await this.target(at, height);
    expect(ray.block, `crosshair target ${at.join(', ')}`).toEqual(at);
    return ray;
  }

  async mine(at: Position, id: string) {
    expect((await this.block(at)).id).toBe(id);
    await expect
      .poll(async () => {
        const { vel } = await this.player();
        return Math.hypot(...vel);
      }, poll)
      .toBeLessThan(0.05);
    await this.aim(at);
    await this.page.evaluate(
      ({ at, id }) => {
        const api = window.__blockcraft!;
        const startTicks = api.getWorldTime!();
        const deadline = performance.now() + 60_000;
        api.input!('attack', true);
        return new Promise<void>((resolve, reject) => {
          const waitForBreak = (now: number) => {
            if (api.getBlock!(...at).id === 'air') {
              api.input!('attack', false);
              resolve();
            } else if (now >= deadline) {
              const diagnostic = {
                player: api.getPlayer!(),
                mining: api.getInteraction!(),
                ray: api.raycast!(),
                ticks: api.getWorldTime!() - startTicks,
                fps: api.getRenderStats().fps,
              };
              api.input!('attack', false);
              reject(
                new Error(
                  `Could not mine ${id} at ${at.join(', ')}: ${JSON.stringify(diagnostic)}`,
                ),
              );
            } else requestAnimationFrame(waitForBreak);
          };
          requestAnimationFrame(waitForBreak);
        });
      },
      { at, id },
    );
  }

  async click(rect: Rect | null | undefined, button: 'left' | 'right' = 'left') {
    expect(rect).toBeTruthy();
    await this.page.mouse.click(rect!.x + rect!.w / 2, rect!.y + rect!.h / 2, { button });
  }

  async shiftClick(rect: Rect | null | undefined) {
    await this.page.keyboard.down('Shift');
    try {
      await this.click(rect);
    } finally {
      await this.page.keyboard.up('Shift');
    }
  }

  async openInventory() {
    await this.page.keyboard.press('KeyE');
    await expect.poll(async () => (await this.screen()).name, poll).toBe('inventory');
  }

  async close() {
    await this.click((await this.screen()).closeButton);
    await expect.poll(async () => (await this.screen()).name, poll).toBeNull();
  }

  async craft(result: string, ingredients: Array<string | null>, amount: number, copies = 1) {
    const before = await this.count(result);
    const screen = await this.screen();
    expect(screen.craftingSlots.length).toBe(ingredients.length);
    const inventoryOffset = screen.name === 'crafting' ? 10 : 0;
    for (const id of new Set(ingredients.filter((id): id is string => id !== null))) {
      const stock = await this.inventory();
      const source = stock.findIndex((stack) => stack?.id === id);
      expect(source, `ingredient ${id}`).toBeGreaterThanOrEqual(0);
      const cursor = () => this.page.evaluate(() => window.__blockcraft!.getInventoryCursor!());
      await this.click(screen.slots[source + inventoryOffset]);
      expect(await cursor(), `the visible storage slot picks up ${id}`).toMatchObject({ id });
      const cells = ingredients.flatMap((ingredient, index) => (ingredient === id ? [index] : []));
      if (cells.length === 1 && stock[source]?.count === copies) {
        await this.click(screen.craftingSlots[cells[0]!]);
      } else {
        for (const index of cells)
          for (let copy = 0; copy < copies; copy++)
            await this.click(screen.craftingSlots[index], 'right');
      }
      const rest = await cursor();
      if (rest) {
        await this.click(screen.slots[source + inventoryOffset]);
        expect(await cursor(), 'returning the unused ingredient clears the cursor').toBeNull();
        expect((await this.inventory())[source]).toMatchObject({ ...rest });
      }
    }
    await this.shiftClick(screen.outputSlot);
    expect(await this.count(result), `crafted ${result}`).toBe(before + amount);
  }

  async select(id: string) {
    const slots = await this.inventory();
    const source = slots.findIndex((slot) => slot?.id === id);
    expect(source, `hotbar item ${id}`).toBeGreaterThanOrEqual(0);
    let target = source;
    if (source >= 9) {
      target = slots.slice(0, 9).findIndex((slot) => !slot);
      if (target === -1) target = 8;
      await this.openInventory();
      const { slots: rects } = await this.screen();
      await this.click(rects[source]);
      await this.click(rects[target]);
      if (slots[target]) await this.click(rects[source]);
      await this.close();
    }
    await this.page.keyboard.press(String(target + 1));
    await expect.poll(async () => (await this.player()).selectedSlot, poll).toBe(target);
  }

  async use(at: Position, check: () => Promise<unknown>, expected: unknown, height?: number) {
    await this.aim(at, height);
    await this.input('use', true);
    try {
      await expect.poll(check, poll).toEqual(expected);
    } finally {
      await this.input('use', false);
    }
  }

  async place(id: string, at: Position) {
    await this.select(id);
    const support = offset(at, 0, -1, 0);
    expect((await this.aim(support)).face).toBe('top');
    await this.use(support, async () => (await this.block(at)).id, id);
  }

  async openBlock(at: Position, name: string) {
    await this.use(at, async () => (await this.screen()).name, name);
  }

  async collect(at: Position, id: string, amount: number) {
    await expect
      .poll(
        async () => {
          const count = await this.count(id);
          if (count >= amount) return count;
          const stand = await this.page.evaluate(
            ({ at, id }) => {
              const api = window.__blockcraft!;
              const items = api.getEntities!({ type: 'item' }).filter(
                (e) =>
                  e.item === id &&
                  Math.hypot(
                    e.pos[0] - at[0] - 0.5,
                    e.pos[1] - at[1] - 0.5,
                    e.pos[2] - at[2] - 0.5,
                  ) < 8,
              );
              const player = api.getPlayer!();
              for (const item of items) {
                const [x, y, z] = item.pos.map(Math.floor) as Position;
                for (let floor = y; floor >= y - 3; floor--) {
                  const block = (dy: number) => api.getBlock!(x, floor + dy, z).id;
                  if (
                    block(0) !== 'air' ||
                    block(1) !== 'air' ||
                    ['air', 'water', 'lava'].includes(block(-1))
                  )
                    continue;
                  const candidate: Position = [x + 0.5, floor, z + 0.5];
                  if (
                    Math.hypot(...candidate.map((coord, axis) => coord - player.pos[axis]!)) > 0.25
                  )
                    return candidate;
                }
              }
              return null;
            },
            { at, id },
          );
          if (stand) await this.teleport(stand);
          return count;
        },
        { ...poll, timeout: 60_000, message: `collect ${id} near ${at.join(', ')}` },
      )
      .toBeGreaterThanOrEqual(amount);
  }

  findTree(near: Position) {
    return this.page.evaluate(([px, , pz]) => {
      const api = window.__blockcraft!;
      const directions = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const;
      const originX = Math.floor(px);
      const originZ = Math.floor(pz);
      for (let r = 0; r <= 36; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const [x, z] = [originX + dx, originZ + dz];
            const top = api.getHeight!(x, z);
            const block = (y: number) => api.getBlock!(x, y, z).id;
            for (let y = top - 3; y >= top - 12 && y > 0; y--) {
              if (!['grass_block', 'dirt'].includes(block(y - 1))) continue;
              if (![0, 1, 2, 3].every((n) => block(y + n) === 'oak_log')) continue;
              for (const [ox, oz] of directions) {
                const adjacent = (h: number) => api.getBlock!(x + ox, y + h, z + oz).id;
                if (
                  ['grass_block', 'dirt', 'stone'].includes(adjacent(-1)) &&
                  adjacent(0) === 'air' &&
                  adjacent(1) === 'air'
                ) {
                  return {
                    foot: [x, y, z] as Position,
                    stand: [x + ox + 0.5, y, z + oz + 0.5] as Position,
                  };
                }
              }
            }
          }
        }
      }
      return null;
    }, near);
  }

  async findSurface(near: Position, id: string, radius: number) {
    return this.page.evaluate(
      ({ near: [x, , z], id, radius }) => {
        const api = window.__blockcraft!;
        for (let r = 0; r <= radius; r++) {
          for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
              const bx = Math.floor(x) + dx;
              const bz = Math.floor(z) + dz;
              const top = api.getHeight!(bx, bz);
              for (let y = top; y >= top - 12 && y > 0; y--) {
                if (api.getBlock!(bx, y, bz).id === id) return [bx, y, bz] as Position;
              }
            }
          }
        }
        return null;
      },
      { near, id, radius },
    );
  }

  async surface(near: Position) {
    const at = await this.page.evaluate(([x, y, z]) => {
      const api = window.__blockcraft!;
      const top = api.getHeight!(Math.floor(x), Math.floor(z));
      return [Math.floor(x) + 0.5, top > 0 ? top + 1 : y, Math.floor(z) + 0.5] as Position;
    }, near);
    await this.ground(at);
    return at;
  }

  async standBy(near: Position, ore?: string) {
    const candidates = await this.page.evaluate(
      ({ near: [x, y, z], ore }) => {
        const api = window.__blockcraft!;
        const result: Array<{ at: Position; stand: Position }> = [];
        const starts = (at: Position) => {
          const [bx, by, bz] = at;
          for (const [dx, dz] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ] as const) {
            for (const dy of [-1, 0, 1]) {
              const block = (n: number) => api.getBlock!(bx + dx, by + dy + n, bz + dz).id;
              if (
                block(0) === 'air' &&
                block(1) === 'air' &&
                !['air', 'water', 'lava'].includes(block(-1))
              ) {
                result.push({ at, stand: [bx + dx + 0.5, by + dy, bz + dz + 0.5] });
              }
            }
          }
        };
        starts([x, y, z]);
        if (ore) {
          for (let r = 1; r <= 12 && result.length < 16; r++) {
            for (let dx = -r; dx <= r; dx++) {
              for (let dy = -r; dy <= r; dy++) {
                for (let dz = -r; dz <= r; dz++) {
                  if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
                  const at: Position = [x + dx, y + dy, z + dz];
                  if (api.getBlock!(...at).id === ore) starts(at);
                }
              }
            }
          }
        }
        return result;
      },
      { near, ore },
    );
    for (const { at, stand } of candidates) {
      await this.ground(stand);
      const hit = (await this.target(at)).block;
      if (hit?.every((coord, i) => coord === at[i])) return at;
    }
    return null;
  }

  async clearing(near: Position) {
    const at = await this.page.evaluate(([px, , pz]) => {
      const api = window.__blockcraft!;
      const [x, z] = [Math.floor(px), Math.floor(pz)];
      for (let r = 0; r <= 30; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const [bx, bz] = [x + dx, z + dz];
            const top = api.getHeight!(bx, bz);
            if (top < 1) continue;
            const clear = (ox: number, oz: number) =>
              ['grass_block', 'dirt', 'stone'].includes(api.getBlock!(bx + ox, top, bz + oz).id) &&
              [1, 2].every((dy) => api.getBlock!(bx + ox, top + dy, bz + oz).id === 'air');
            if (
              [
                [-1, 0],
                [0, 0],
                [0, -1],
                [0, 1],
                [1, 0],
                [1, 1],
                [1, -1],
                [2, -1],
                [2, 0],
                [3, -1],
                [3, 0],
                [3, 1],
              ].every(([ox, oz]) => clear(ox!, oz!))
            )
              return [bx + 0.5, top + 1, bz + 0.5] as Position;
          }
        }
      }
      return null;
    }, near);
    expect(at, 'open, level ground for the Workbench, bed and circuit').not.toBeNull();
    await this.ground(at!);
    return at!;
  }

  async entities(types: string[]) {
    return this.page.evaluate(
      (types) =>
        window.__blockcraft!.getEntities!().filter(
          (e): e is Target => 'health' in e && types.includes(e.type),
        ),
      types,
    );
  }

  async hunt(types: string[], retreat: Position) {
    let target: Target | undefined;
    await expect
      .poll(
        async () => {
          target = (await this.entities(types)).find((e) => e.state === 'alive' && e.health > 0);
          return Boolean(target);
        },
        { ...poll, timeout: 60_000 },
      )
      .toBe(true);
    const { id } = target!;
    const attack = await this.page.evaluate(
      ({ id, retreat }) => {
        const api = window.__blockcraft!;
        const find = () =>
          api.getEntities!().find((e): e is Target => 'health' in e && e.id === id);
        const initial = find()!;
        let hits = 0;
        let lastHealth = initial.health;
        let lastSwing = -Infinity;
        const start = performance.now();
        return new Promise<{ hits: number; killed: boolean; pos: Position }>((resolve) => {
          const swing = (now: number) => {
            api.input!('attack', false);
            const mob = find();
            const player = api.getPlayer!();
            if (mob && mob.health < lastHealth) hits++;
            if (mob && mob.state === 'dying') {
              resolve({ hits, killed: true, pos: mob.pos });
              return;
            }
            if (!mob || player.health <= 8 || now - start > 120_000) {
              api.teleport!(...retreat);
              resolve({ hits, killed: false, pos: player.pos });
              return;
            }
            lastHealth = mob.health;
            const tick = api.getWorldTime!();
            if (tick - lastSwing >= 12) {
              const [x, y, z] = mob.pos;
              if (Math.hypot(x - player.pos[0], z - player.pos[2]) > 2)
                api.teleport!(x - 1.4, y, z);
              const [px, py, pz] = api.getPlayer!().pos;
              api.look!(
                Math.atan2(z - pz, x - px),
                Math.atan2(y + 0.7 - py - 1.62, Math.hypot(x - px, z - pz)),
              );
              api.input!('attack', true);
              lastSwing = tick;
            }
            requestAnimationFrame(swing);
          };
          requestAnimationFrame(swing);
        });
      },
      { id, retreat },
    );
    expect(attack.hits, 'the sword damaged the selected creature').toBeGreaterThan(0);
    expect(attack.killed, 'the damage sequence put that creature into its death animation').toBe(
      true,
    );
    expect((await this.player()).health).toBeGreaterThan(0);
    return attack.pos;
  }
}

test.describe.configure({ retries: 0 });

test('M23 plays Survival from world creation through a saved, powered circuit', async ({
  page,
  assertAndSaveScreenshot,
  getRenderStats,
}) => {
  test.setTimeout(process.env.CI ? 25 * 60_000 : 60 * 60_000);
  const game = new Survival(page);
  const worldList = page.locator('#world-list-canvas');
  const singleplayer = page.getByRole('button', { name: 'Singleplayer' });
  const shot = async (name: string) => {
    const png = await assertAndSaveScreenshot({ milestone: 'm23', name: `m23-${name}` });
    assertNotBlank(png);
    assertNoMissingTexture(png);
  };

  await test.step('01 — Create the seeded Survival world', async () => {
    await singleplayer.click();
    await worldList.click({ position: { x: 330, y: 636 } });
    await page.keyboard.type(worldName);
    await worldList.click({ position: { x: 639, y: 228 } });
    await page.keyboard.type(seed);
    await expect(worldList).toHaveAttribute(
      'aria-label',
      new RegExp(`${seed}.*Mode survival`, 'i'),
    );
    await worldList.click({ position: { x: 875, y: 479 } });
    await expect(worldList).toBeHidden({ timeout: 120_000 });
    expect((await game.player()).mode).toBe('survival');
    expect(await page.evaluate(() => window.__blockcraft!.getSettings!())).toMatchObject({
      renderDistance: 8,
      lod: false,
      fxaa: false,
      bloom: false,
      godRays: false,
    });
    await expect.poll(async () => (await getRenderStats()).chunksMeshed, poll).toBeGreaterThan(20);
    await shot('step01-menu-world');
  });

  let home: Position;
  let workshop: Position;
  let planks: string;
  await test.step('02 — Find a forest and harvest four logs', async () => {
    const forest = await game.locate('biome', 'oakwood_forest', (await game.player()).pos);
    expect(forest).not.toBeNull();
    await game.ground(offset(forest!, 0.5, 1, 0.5));
    let tree: Awaited<ReturnType<Survival['findTree']>>;
    await expect
      .poll(async () => {
        tree = await game.findTree(forest!);
        return tree !== null;
      }, poll)
      .toBe(true);
    const { foot, stand } = tree!;
    const [x, bottom, z] = foot;
    await game.ground(stand);
    await game.look(center(foot));
    await game.input('forward', true);
    try {
      const before = stand;
      await expect
        .poll(async () => {
          const { pos } = await game.player();
          return Math.hypot(pos[0] - before[0], pos[2] - before[2]);
        }, poll)
        .toBeGreaterThan(0.05);
    } finally {
      await game.input('forward', false);
    }
    for (let i = 0; i < 4; i++) {
      await game.mine(offset(foot, 0, i, 0), 'oak_log');
      if (i === 1) await game.ground([x + 0.5, bottom, z + 0.5]);
      await expect.poll(() => game.count('oak_log'), poll).toBe(i + 1);
    }
    planks = 'oak_planks';
    await shot('step02-logs');
    home = await game.clearing(foot);
  });

  const pickaxe = (material: string) => [
    material,
    material,
    material,
    null,
    'stick',
    null,
    null,
    'stick',
    null,
  ];
  const sticks = () =>
    game.craft('stick', [planks, null, null, planks, null, null, null, null, null], 4);
  await test.step('03 — Craft planks, Workbench, sticks and wooden pickaxe', async () => {
    await game.openInventory();
    await game.craft(planks, ['oak_log', null, null, null], 16, 4);
    await game.craft('workbench', [planks, planks, planks, planks], 1);
    await game.close();
    workshop = [Math.floor(home[0]) + 1, Math.floor(home[1]), Math.floor(home[2])];
    await game.place('workbench', workshop);
    await game.openBlock(workshop, 'crafting');
    await sticks();
    await sticks();
    await game.craft('wooden_pickaxe', pickaxe(planks), 1);
    await shot('step03-workbench');
    await game.close();
  });

  let mineSite: Position;
  await test.step('04 — Dig a staircase and craft stone tools and Kiln', async () => {
    await game.select('wooden_pickaxe');
    const start = await game.player();
    const [x, y, z] = start.pos.map(Math.floor) as Position;
    const axis = await game.page.evaluate(
      ([x, y, z]) => {
        const api = window.__blockcraft!;
        const directions = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const;
        return (
          directions.find(
            ([dx, dz]) =>
              api.getBlock!(x + dx, y - 1, z + dz).id !== 'air' &&
              api.getBlock!(x + dx, y, z + dz).id === 'air' &&
              api.getBlock!(x + dx, y + 1, z + dz).id === 'air',
          ) ?? null
        );
      },
      [x, y, z] as Position,
    );
    expect(axis).not.toBeNull();
    const [dx, dz] = axis!;
    let stone = 0;
    for (let step = 1; stone < 14 && step <= 45; step++) {
      const next: Position = [x + dx * step, y - step, z + dz * step];
      for (const height of [2, 1, 0]) {
        const cell = offset(next, 0, height, 0);
        const { id } = await game.block(cell);
        if (id === 'air') continue;
        await game.mine(cell, id);
        if (id === 'stone') stone++;
      }
      await game.look([next[0] + 0.5, next[1] + 1.62, next[2] + 0.5]);
      await game.input('forward', true);
      try {
        await expect
          .poll(
            async () => {
              const p = await game.player();
              return (
                p.onGround &&
                Math.floor(p.pos[0]) === next[0] &&
                Math.floor(p.pos[2]) === next[2] &&
                Math.abs(p.pos[1] - next[1]) < 0.1
              );
            },
            { ...poll, intervals: [30, 50, 100] },
          )
          .toBe(true);
      } finally {
        await game.input('forward', false);
      }
      if (stone >= 8 && stone < 11)
        await expect.poll(() => game.count('cobblestone'), poll).toBeGreaterThanOrEqual(8);
    }
    await expect.poll(() => game.count('cobblestone'), poll).toBeGreaterThanOrEqual(14);
    mineSite = (await game.player()).pos;
    await shot('step04-staircase');

    await game.ground(home);
    await game.openBlock(workshop, 'crafting');
    await game.craft('stone_pickaxe', pickaxe('cobblestone'), 1);
    await game.craft(
      'kiln',
      Array.from({ length: 9 }, (_, i) => (i === 4 ? null : 'cobblestone')),
      1,
    );
    await game.craft(
      'stone_sword',
      ['cobblestone', null, null, 'cobblestone', null, null, 'stick', null, null],
      1,
    );
    await game.close();
  });

  await test.step('05 — Gather coal, iron, copper and sand', async () => {
    await game.select('stone_pickaxe');
    let near = mineSite;
    for (const [ore, drop, count] of [
      ['coal_ore', 'coal', 3],
      ['iron_ore', 'raw_iron', 3],
      ['copper_ore', 'raw_copper', 7],
    ] as const) {
      for (let block = 0; block < count; block++) {
        const target = await game.locate('ore', ore, near);
        expect(target, ore).not.toBeNull();
        let at = target!;
        const p = (await game.player()).pos;
        const inReach = Math.hypot(...p.map((coord, i) => coord - at[i]!)) < 4;
        const sight = inReach ? (await game.target(at)).block : undefined;
        const visible = sight?.every((coord, i) => coord === at[i]);
        const exposed = visible ? at : await game.standBy(at, ore);
        if (exposed) at = exposed;
        else {
          await game.surface(at);
          const top = Math.floor((await game.player()).pos[1]) - 1;
          for (let y = top; y > at[1]; y--) {
            const cell: Position = [at[0], y, at[2]];
            const { id } = await game.block(cell);
            if (id !== 'air') await game.mine(cell, id);
            await expect
              .poll(async () => {
                const player = await game.player();
                return player.onGround && player.pos[1] <= y + 0.1;
              }, poll)
              .toBe(true);
          }
        }
        const before = await game.count(drop);
        await game.mine(at, ore);
        if (before < count) await game.collect(at, drop, before + 1);
        near = at;
      }
      expect(await game.count(drop)).toBeGreaterThanOrEqual(count);
    }
    const desert = await game.locate('biome', 'desert', home);
    expect(desert).not.toBeNull();
    await game.ground(offset(desert!, 0.5, 1, 0.5));
    for (let i = 0; i < 4; i++) {
      const at = await game.findSurface(desert!, 'sand', 24);
      expect(at).not.toBeNull();
      const standing = await game.standBy(at!);
      if (!standing) await game.surface(at!);
      await game.mine(at!, 'sand');
      await game.collect(at!, 'sand', i + 1);
    }
    await game.openInventory();
    await shot('step05-materials');
    await game.close();
  });

  await test.step('06 — Smelt iron, copper and sand, then craft an iron pickaxe', async () => {
    await game.ground(home);
    const kiln = offset(workshop, 0, 0, 1);
    await game.ground(offset(home, 0, 0, 1));
    await game.place('kiln', kiln);
    await game.openBlock(kiln, 'kiln');
    const { slots } = await game.screen();
    const moveToKiln = async (id: string, slot: number, count: number) => {
      const source = (await game.inventory()).findIndex((stack) => stack?.id === id);
      expect(source).toBeGreaterThanOrEqual(0);
      await game.click(slots[source + 3]);
      for (let i = 0; i < count; i++) await game.click(slots[slot], 'right');
      if (await page.evaluate(() => window.__blockcraft!.getInventoryCursor!()))
        await game.click(slots[source + 3]);
    };
    await moveToKiln('coal', 1, 3);
    for (const [raw, product, count] of [
      ['raw_iron', 'iron_ingot', 3],
      ['raw_copper', 'copper_ingot', 7],
      ['sand', 'glass', 4],
    ] as const) {
      await moveToKiln(raw, 0, count);
      const kilnState = () =>
        page.evaluate(
          (p) =>
            window.__blockcraft!.getBlockEntity!(...p)?.state as {
              input: { id: string; count: number } | null;
              output: { id: string; count: number } | null;
            },
          kiln,
        );
      const loaded = await kilnState();
      expect((loaded.input?.count ?? 0) + (loaded.output?.count ?? 0), `loaded ${raw}`).toBe(count);
      await game.close();
      // Leave the Kiln to work while the player looks out of the excavation.
      const { pos } = await game.player();
      await game.look(offset(pos, 0.05, 20, 0));
      await expect
        .poll(async () => (await kilnState()).output, {
          ...poll,
          timeout: 12 * 60_000,
          intervals: [500, 1000],
        })
        .toMatchObject({ id: product, count });
      await game.openBlock(kiln, 'kiln');
      await game.shiftClick((await game.screen()).slots[2]);
      expect(await game.count(product)).toBe(count);
    }
    await game.close();
    await game.openBlock(workshop, 'crafting');
    await game.craft('iron_pickaxe', pickaxe('iron_ingot'), 1);
    await shot('step06-iron-pickaxe');
    await game.close();
  });

  await test.step('07 — Kill a naturally spawned hostile at night', async () => {
    await game.select('stone_sword');
    await page.evaluate(() => window.__blockcraft!.setTimeOfDay!(13_000));
    await game.hunt(['hollow', 'skitterer', 'thornling'], home);
    await shot('step07-hostile');
  });

  await test.step('08 — Obtain wool, craft a bed and wake in it at morning', async () => {
    await game.ground(home);
    for (let kill = 0; kill < 3 && (await game.count('wool')) < 3; kill++) {
      const before = await game.count('wool');
      const drop = await game.hunt(['tuftbuck'], home);
      await game.collect(drop, 'wool', before + 1);
    }
    expect(await game.count('wool')).toBeGreaterThanOrEqual(3);
    await game.ground(home);
    await game.openBlock(workshop, 'crafting');
    await game.craft('bed', ['wool', 'wool', 'wool', planks, planks, planks, null, null, null], 1);
    await game.close();
    const bed = offset(workshop, 0, 0, -1);
    await game.ground(offset(home, 0, 0, -1));
    await game.place('bed', bed);
    expect((await game.block(bed)).state.part).toBe('foot');
    await page.evaluate(() => window.__blockcraft!.setTimeOfDay!(13_000));
    const worldTime = () => page.evaluate(() => window.__blockcraft!.getWorldTime!());
    const before = await worldTime();
    const morning = (Math.floor(before / 24_000) + 1) * 24_000;
    await game.use(bed, async () => (await worldTime()) >= morning, true, 0.3);
    await expect.poll(async () => (await game.screen()).name, poll).toBeNull();
    expect(await worldTime()).toBeGreaterThan(before);
    expect(await page.evaluate(() => window.__blockcraft!.getTimeOfDay!())).toBeLessThan(1000);
    const wakeAt = offset(bed, 0.5, 9 / 16, 0.5);
    expect((await game.player()).spawnPoint).toEqual(wakeAt);
    const actual = (await game.player()).pos;
    actual.forEach((value, axis) => expect(value).toBeCloseTo(wakeAt[axis]!, 1));
    await game.look(center(bed));
    await shot('step08-bed');
  });

  let circuit: Position[];
  const circuitState = () => Promise.all(circuit.map((at) => game.block(at)));
  await test.step('09 — Build and toggle a lever, trace and lamp circuit', async () => {
    await game.ground(home);
    await game.openBlock(workshop, 'crafting');
    await game.craft(
      'lever',
      ['stick', null, null, 'cobblestone', null, null, null, null, null],
      1,
    );
    await game.craft(
      'copper_trace',
      ['copper_ingot', 'copper_ingot', 'copper_ingot', null, null, null, null, null, null],
      8,
    );
    await game.craft(
      'lamp',
      [
        'glass',
        'copper_ingot',
        'glass',
        'copper_ingot',
        null,
        'copper_ingot',
        'glass',
        'copper_ingot',
        'glass',
      ],
      1,
    );
    await game.close();

    circuit = [-1, 0, 1].map((dz) => offset(workshop, 2, 0, dz));
    const [lever, trace, lamp] = circuit as [Position, Position, Position];
    await game.ground(offset(home, 2, 0, 0));
    await game.place('lever', lever);
    await game.place('copper_trace', trace);
    await game.place('lamp', lamp);
    expect((await game.block(lamp)).state.lit).toBe('false');
    await game.use(lever, async () => (await game.block(lamp)).state.lit, 'true', 0.2);
    await game.look(center(trace));
    await shot('step09-circuit');
  });

  await test.step('10 — Save and quit, reload, and check inventory and circuit', async () => {
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await game.screen()).name, poll).toBe('pause');
    const inventory = await game.inventory();
    const blocks = await circuitState();
    expect(blocks.map(({ id }) => id)).toEqual(['lever', 'copper_trace', 'lamp']);
    expect(blocks[2]?.state.lit).toBe('true');
    await game.click((await game.screen()).saveQuitButton);
    await expect(singleplayer).toBeVisible({ timeout: 120_000 });
    await page.reload();
    await expect(page).toHaveURL(/\?debug=1/);
    await singleplayer.click();
    await expect(worldList).toHaveAttribute('aria-label', new RegExp(worldName));
    await worldList.click({ position: { x: 490, y: 221 } });
    await expect(worldList).toBeHidden({ timeout: 120_000 });
    expect(await game.inventory()).toEqual(inventory);
    await expect.poll(circuitState, poll).toEqual(blocks);
    await game.look(center(circuit[1]!));
    await shot('step10-reloaded');
  });
});
