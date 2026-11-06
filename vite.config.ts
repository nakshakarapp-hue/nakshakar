/// <reference types="vitest" />
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/** Writes a service worker listing every built file, so the website keeps working with no internet. */
function offlineCache(): Plugin {
  return {
    name: 'offline-cache',
    apply: 'build',
    closeBundle() {
      const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
      const files = walk('dist').filter((f) => !f.endsWith('/sw.js'));
      const hash = createHash('sha256');
      files.forEach((f) => hash.update(readFileSync(f)));
      const list = files.map((f) => `./${f.slice('dist/'.length)}`);
      const template = readFileSync('scripts/sw-template.js', 'utf8');
      writeFileSync('dist/sw.js', template.replace('__VERSION__', hash.digest('hex').slice(0, 16)).replace('__FILES__', JSON.stringify(list)));
    },
  };
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

export default defineConfig({
  // Relative base so the bundle loads from Capacitor's local WebView origin.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), offlineCache()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          jspdf: ['jspdf'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/units/**'],
      reporter: ['text'],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
