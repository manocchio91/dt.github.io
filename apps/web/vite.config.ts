/// <reference types="vitest/config" />
import { copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Percorso di pubblicazione: "/" in locale, "/<repository>/" su GitHub Pages (VITE_BASE). */
function base(): string {
  const b = process.env.VITE_BASE?.trim() || '/';
  return `/${b.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
}

/**
 * GitHub Pages non ha riscrittura lato server: una rotta come /progetti/… ricaricata
 * restituirebbe 404. Copiando index.html in 404.html l'app si avvia comunque e il
 * router mostra la pagina richiesta.
 */
function spaFallback(): Plugin {
  let outDir = 'dist';
  return {
    name: 'mdt-spa-404-fallback',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    writeBundle() {
      const index = join(outDir, 'index.html');
      if (existsSync(index)) copyFileSync(index, join(outDir, '404.html'));
    },
  };
}

export default defineConfig({
  base: base(),
  plugins: [react(), tailwindcss(), spaFallback()],
  server: { port: 5173, strictPort: true },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: { maplibre: ['maplibre-gl'] } } },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    // test di interfaccia completi (rendering + IndexedDB): margine per macchine lente o CI sotto carico
    testTimeout: 20_000,
  },
});
