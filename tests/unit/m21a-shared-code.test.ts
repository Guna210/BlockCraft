// @vitest-environment node
import { describe, expect, it, afterEach, vi } from 'vitest';
import { ESLint } from 'eslint';
import { emitExplosion, setGameEventSink } from '../../src/gameplay/event-sink';

const modules = import.meta.glob('../../src/{world,gen,gameplay,entity,net}/**/*.ts');

describe('M21a Node shared module load', () => {
  it('has no browser environment', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });
  for (const [file, load] of Object.entries(modules))
    it(`loads ${file}`, async () => {
      await expect(load()).resolves.toBeDefined();
    });
});

describe('M21a shared boundary lint', () => {
  const lint = new ESLint();
  it('reports both a forbidden global and a client runtime import in every shared folder', async () => {
    for (const folder of ['world', 'gen', 'gameplay', 'entity', 'net']) {
      const [result] = await lint.lintText(
        "import { sound } from '../audio/service';\nwindow.alert(sound);\n",
        { filePath: `src/${folder}/m21a-planted.ts` },
      );
      expect(result!.messages.map((m) => m.ruleId)).toEqual(
        expect.arrayContaining([
          'no-restricted-globals',
          '@typescript-eslint/no-restricted-imports',
        ]),
      );
    }
  });
  it('rejects all client directories, engine modules and browser global-object access', async () => {
    for (const path of [
      'render/camera',
      'ui/hud',
      'audio/service',
      'mesh/greedy',
      'debug/api/core',
      'persist/compress',
      'workers/gen-worker-pool',
      'engine',
      'engine/input',
      'engine/loop',
      'engine/settings',
    ]) {
      const [result] = await lint.lintText(
        `import * as client from '../${path}';\nexport { client };`,
        { filePath: 'src/entity/m21a-planted.ts' },
      );
      expect(
        result!.messages.some((m) => m.ruleId === '@typescript-eslint/no-restricted-imports'),
      ).toBe(true);
    }
    for (const name of [
      'window',
      'document',
      'navigator',
      'location',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'Image',
      'AudioContext',
      'OffscreenCanvas',
      'WebGL2RenderingContext',
      'HTMLCanvasElement',
      'HTMLVideoElement',
      'alert',
    ]) {
      const [result] = await lint.lintText(`export const browser = globalThis.${name};`, {
        filePath: 'src/net/m21a-planted.ts',
      });
      expect(
        result!.messages.some((m) => m.ruleId === 'no-restricted-globals'),
        name,
      ).toBe(true);
    }
  });
  it('allows type imports, shared imports, rng and Node performance.now', async () => {
    const [result] = await lint.lintText(
      `import type { Camera } from '../render/camera';\nimport type { InputEngine } from '../engine/input';\nimport { PRNG } from '../engine/rng';\nexport type SharedTypes = [Camera, InputEngine];\nexport const seed = new PRNG(performance.now());`,
      { filePath: 'src/world/m21a-planted.ts' },
    );
    expect(result!.errorCount).toBe(0);
    const [client] = await lint.lintText('window.alert(1);', {
      filePath: 'src/game/m21a-planted.ts',
    });
    expect(client!.messages.some((m) => m.ruleId === 'no-restricted-globals')).toBe(false);
  });
});

describe('M21a event sink', () => {
  afterEach(() => setGameEventSink(null));
  it('is a no-op by default and forwards existing arguments after startup registration', () => {
    const center = [1, 2, 3] as const;
    emitExplosion(center, 2);
    const explosion = vi.fn();
    setGameEventSink({ explosion });
    emitExplosion(center, 2);
    expect(explosion).toHaveBeenCalledExactlyOnceWith(center, 2);
    expect(explosion.mock.calls[0]![0]).toBe(center);
    setGameEventSink(null);
    emitExplosion(center, 2);
    expect(explosion).toHaveBeenCalledTimes(1);
  });
});
