/// <reference types="vitest" />
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const SAMPLE = /^game\d+\.jpg$/i;
const num = (n: string) => Number(/\d+/.exec(n)?.[0] ?? 0);

/** Names ("game1", "game2", ...) of the screenshots in samples/, numerically sorted. */
function sampleNames(root: string): string[] {
  const dir = resolve(root, 'samples');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => SAMPLE.test(f))
    .map((f) => f.replace(/\.jpg$/i, ''))
    .sort((a, b) => num(a) - num(b));
}

/**
 * The ?debug=1 buttons on the home screen load the screenshots in samples/. The dev server serves
 * the images and a list at /samples/index.json; the build copies both into dist/samples/, so a
 * deployed site has them too.
 */
function samples(): Plugin {
  let root = process.cwd();
  return {
    name: 'samples',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use('/samples/index.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(sampleNames(root)));
      });
    },
    generateBundle() {
      const names = sampleNames(root);
      for (const name of names) {
        this.emitFile({ type: 'asset', fileName: `samples/${name}.jpg`, source: readFileSync(resolve(root, 'samples', `${name}.jpg`)) });
      }
      this.emitFile({ type: 'asset', fileName: 'samples/index.json', source: JSON.stringify(names) });
    },
  };
}

export default defineConfig({
  plugins: [react(), samples()],
  base: './',
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
  },
});
