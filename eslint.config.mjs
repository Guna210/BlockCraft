import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

// Expand HTML*Element from the installed DOM declarations, including new platform element types.
const dom = readFileSync(
  createRequire(import.meta.url).resolve('typescript/lib/lib.dom.d.ts'),
  'utf8',
);
const browserGlobals = [
  'window',
  'self',
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
  ...new Set([...dom.matchAll(/^declare var (WebGL\w*)\b/gm)].map((match) => match[1])),
  'alert',
  ...new Set([...dom.matchAll(/^declare var (HTML\w*Element)\b/gm)].map((match) => match[1])),
];

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['ws', 'ws/*', 'node:*', '**/server', '**/server/**'] },
      ],
    },
  },
  {
    files: ['src/{world,gen,gameplay,entity,net}/**/*.ts'],
    linterOptions: { noInlineConfig: true },
    rules: {
      'no-restricted-globals': ['error', { globals: browserGlobals, checkGlobalObject: true }],
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['ws', 'ws/*', 'node:*', '**/server', '**/server/**'],
              message: 'Browser code must not import the Node server.',
            },
            {
              regex:
                '(^|/)(render|ui|audio|mesh|debug|persist|workers)(/|$)|(^|/)engine(?:$|/(?!rng(?:\\.ts)?$))',
              allowTypeImports: true,
              message: 'Shared simulation must not import client runtime code.',
            },
          ],
        },
      ],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    ignores: [
      'dist/',
      'dist-server/',
      'node_modules/',
      'playwright-report/',
      'test-results/',
      'artifacts/',
      'scripts/',
    ],
  },
);
