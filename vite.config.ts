import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: {
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } },
  },
});
