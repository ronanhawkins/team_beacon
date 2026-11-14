import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { demoRelay } from './tools/demo-relay.js';

export default defineConfig({
  publicDir: 'public',
  plugins: [demoRelay()],
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/.local/**', '**/.venv/**', '**/data/raw/**', '**/data/out/**'] } },
  preview: { port: 4173, strictPort: true },
  build: { rollupOptions: { input: { home: resolve('index.html'), headset: resolve('apps/headset/index.html') } } },
});
