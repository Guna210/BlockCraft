import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    {
      name: 'server-module-package',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'package.json', source: '{"type":"module"}\n' });
      },
    },
  ],
  ssr: { noExternal: ['gl-matrix'] },
  build: {
    plugins: [
      {
        name: 'server-module-package',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'package.json', source: '{"type":"module"}\n' });
        },
      },
    ],
    ssr: true,
    outDir: 'dist-server',
    rolldownOptions: {
      input: { main: 'server/main.ts', 'generation-worker': 'server/generation-worker.ts' },
      external: ['ws'],
      output: { entryFileNames: '[name].js' },
    },
  },
});
