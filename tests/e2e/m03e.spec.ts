import { test, expect } from '../harness/fixture';

// M03e: the ore locator is registered in the production build, and what it returns is what the
// worker-generated world holds. The unit tests (tests/unit/ores.test.ts) own the Appendix A.4
// criteria; this checks the real debug API end to end.

const ORES = ['coal_ore', 'copper_ore', 'iron_ore', 'gold_ore', 'lumite_ore'];

test.describe('M03e: ore locator through the debug API', () => {
  test('locate("ore", ...) returns blocks the generated world holds as that ore', async ({
    page,
  }) => {
    const result = await page.evaluate(
      async ({ ores }) => {
        const api = window.__blockcraft!;
        await api.createWorld!({ seed: 'blockcraft-test-seed-42', type: 'default' });
        await api.waitForTerrain!(4);
        const near: [number, number, number] = [0, 64, 0];
        const rows: Array<{
          id: string;
          pos: [number, number, number] | null;
          block: string | null;
        }> = [];
        for (const id of ores) {
          const pos = api.locate!('ore', id, near);
          // columns of radius 4 around the origin are loaded (x, z in [-64, 79])
          const loaded = pos && pos[0] >= -64 && pos[0] < 80 && pos[2] >= -64 && pos[2] < 80;
          rows.push({
            id,
            pos,
            block: pos && loaded ? api.getBlock!(pos[0], pos[1], pos[2]).id : null,
          });
        }
        return {
          rows,
          skyshard: api.locate!('ore', 'skyshard_ore', near),
          unknown: api.locate!('ore', 'unobtainium_ore', near),
        };
      },
      { ores: ORES },
    );

    let checked = 0;
    for (const row of result.rows) {
      expect(row.pos, `${row.id} found`).not.toBeNull();
      if (row.block !== null) {
        expect(row.block, `${row.id} at ${row.pos}`).toBe(row.id);
        checked++;
      }
    }
    // the common ores lie inside the loaded area, so their blocks are read from the real world
    expect(checked).toBeGreaterThanOrEqual(3);
    expect(result.skyshard).toBeNull();
    expect(result.unknown).toBeNull();
    console.log(`[m03e e2e] ${JSON.stringify(result.rows)}`);
  });
});
