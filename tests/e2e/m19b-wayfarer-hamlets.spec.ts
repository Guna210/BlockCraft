import fs from 'fs';
import path from 'path';
import { test, expect } from '../harness/fixture';
import { assertNoMissingTexture, assertNotBlank } from '../harness/pixels';

test('M19b: locate, inspect and walk a Wayfarer Hamlet', async ({
  page,
  assertAndSaveScreenshot,
}) => {
  const result = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      seed: 'm19b-wayfarer-hamlet',
      mode: 'creative',
      type: 'default',
      structures: true,
    });
    api.pause!();
    const start = api.locate!('structure', 'wayfarer_hamlet', [0, 64, 0]);
    if (!start) return { start, houses: [], well: null, chest: null, routes: [] };

    api.teleport!(start[0] + 16.5, start[1] + 32, start[2] + 68.5, Math.PI, -0.5);
    await api.waitForTerrain!(5);

    const yMin = Math.max(1, start[1] - 16);
    const yMax = Math.min(300, start[1] + 30);
    const houses: Array<{ x: number; y: number; z: number }> = [];
    let well: { x: number; y: number; z: number } | null = null;
    let chest: { x: number; y: number; z: number; slots: number } | null = null;

    // The centered root's six connectors rotate around its 33×33 footprint. House doors sit
    // exactly one block outward from the four house connectors; sample only those columns.
    const rotate = (x: number, z: number, turns: number): [number, number] => {
      if (turns === 1) return [32 - z, x];
      if (turns === 2) return [32 - x, 32 - z];
      if (turns === 3) return [z, 32 - x];
      return [x, z];
    };
    const entrances = new Set<string>();
    const connectors = [
      { x: 8, z: 0, dx: 0, dz: -1 },
      { x: 24, z: 0, dx: 0, dz: -1 },
      { x: 8, z: 32, dx: 0, dz: 1 },
      { x: 24, z: 32, dx: 0, dz: 1 },
    ];
    for (let turns = 0; turns < 4; turns++) {
      for (const connector of connectors) {
        const [x, z] = rotate(connector.x, connector.z, turns);
        const [dx, dz] = rotate(connector.dx + 16, connector.dz + 16, turns);
        entrances.add(`${start[0] + x + dx - 16},${start[2] + z + dz - 16}`);
      }
    }
    for (const coordinate of entrances) {
      const [x, z] = coordinate.split(',').map(Number);
      for (let y = yMin; y <= yMax; y++) {
        const block = api.getBlock!(x!, y, z!);
        if (block.id === 'oak_door' && block.state['half'] === 'lower')
          houses.push({ x: x!, y, z: z! });
      }
    }
    const wellX = start[0] + 16;
    const wellZ = start[2] + 16;
    for (let y = yMin; y <= yMax; y++) {
      if (api.getBlock!(wellX, y, wellZ).id !== 'water') continue;
      const surrounds = [
        api.getBlock!(wellX + 1, y, wellZ).id,
        api.getBlock!(wellX - 1, y, wellZ).id,
        api.getBlock!(wellX, y, wellZ + 1).id,
        api.getBlock!(wellX, y, wellZ - 1).id,
      ];
      if (surrounds.every((id) => id === 'cobblestone')) {
        well = { x: wellX, y, z: wellZ };
        break;
      }
    }
    const chestColumns = [
      [start[0] + 11, start[2] + 16],
      [start[0] + 16, start[2] + 11],
      [start[0] + 21, start[2] + 16],
      [start[0] + 16, start[2] + 21],
    ];
    for (const [x, z] of chestColumns) {
      for (let y = yMin; y <= yMax; y++) {
        if (api.getBlock!(x!, y, z!).id !== 'chest') continue;
        const entity = api.getBlockEntity!(x!, y, z!);
        const state = entity?.state as
          { slots?: Array<{ id: string; count: number } | null> } | undefined;
        chest = { x: x!, y, z: z!, slots: state?.slots?.filter(Boolean).length ?? 0 };
        break;
      }
      if (chest) break;
    }

    const routes = well
      ? houses.map((door) => {
          const result = api.findPath!(
            [well!.x + 1, well!.y + 1, well!.z],
            [door.x, door.y, door.z],
            {
              height: 2,
              maxNodes: 50000,
            },
          );
          const path = result.path ?? [];
          return {
            status: result.status,
            length: path.length,
            nodesExpanded: result.nodesExpanded,
            door: api.getBlock!(door.x, door.y, door.z),
            maxStep: path.reduce(
              (max, point, index) =>
                index === 0 ? max : Math.max(max, Math.abs(point[1] - path[index - 1]![1])),
              0,
            ),
          };
        })
      : [];

    // Use a higher aerial view so the farm's wheat rows sit above the hotbar with the hamlet.
    api.teleport!(start[0] + 16.5, start[1] + 72, start[2] + 16.5, Math.PI, -1.4);
    await api.tick!(1);
    return { start, houses, well, chest, routes };
  });

  console.log('[m19b hamlet route evidence]', JSON.stringify(result));
  expect(result.start, "locate('structure','wayfarer_hamlet',[0,64,0])").not.toBeNull();
  expect(Math.hypot(result.start![0], result.start![2])).toBeLessThanOrEqual(2000);
  expect(result.houses.length).toBeGreaterThanOrEqual(4);
  expect(result.well).not.toBeNull();
  expect(result.chest?.slots).toBeGreaterThanOrEqual(5);
  expect(result.routes).toHaveLength(result.houses.length);
  for (const route of result.routes) {
    expect(route.status).toBe('success');
    expect(route.length).toBeGreaterThan(1);
    expect(route.maxStep).toBeLessThanOrEqual(1);
  }

  const screenshot = await assertAndSaveScreenshot({ name: 'm19-hamlet', milestone: 'M19b' });
  assertNotBlank(screenshot);
  assertNoMissingTexture(screenshot);
  const destination = path.join(process.cwd(), 'docs/screenshots/M19b/m19-hamlet.png');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), 'artifacts/M19b/m19-hamlet.png'), destination);
});

test('M19b: the Create World Structures toggle excludes hamlets when disabled', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const api = window.__blockcraft!;
    await api.createWorld!({
      seed: 'm19b-no-hamlets',
      type: 'default',
      structures: false,
    });
    await api.waitForTerrain!(2);
    return api.locate!('structure', 'wayfarer_hamlet', [0, 64, 0]);
  });
  expect(result).toBeNull();
});
