// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { parseOptions } from '../../server/options';

const eslint = new ESLint();
describe('M21b browser/server boundary and CLI', () => {
  for (const filePath of ['src/main.ts', 'src/world/world.ts']) {
    for (const path of ['ws', 'node:fs', '../server/main', '../../server/main']) {
      it(`forbids ${path} in ${filePath}`, async () => {
        const [result] = await eslint.lintText(`import '${path}';\n`, { filePath });
        expect(
          result!.messages.some((message) => message.ruleId?.endsWith('no-restricted-imports')),
        ).toBe(true);
      });
    }
  }
  it('parses CLI overrides and rejects invalid numeric/unknown flags', () => {
    expect(
      parseOptions([
        '--port',
        '0',
        '--view-distance',
        '2',
        '--max-players',
        '4',
        '--delay-ms',
        '150',
        '--reset-world',
      ]),
    ).toMatchObject({ port: 0, viewDistance: 2, maxPlayers: 4, delayMs: 150, resetWorld: true });
    for (const args of [
      ['--port', '65536'],
      ['--view-distance', '0'],
      ['--max-players', '0'],
      ['--delay-ms', '-1'],
      ['--unknown', '1'],
    ])
      expect(() => parseOptions(args)).toThrow();
  });
});
