import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig(({ command }) => ({
  // React's development refresh preamble is inline; skip it to retain script-src 'self'.
  // Vite still reloads the page when renderer files change.
  plugins: [...(command === 'build' ? [react()] : []), tailwind()],
  base: './',
  build: { outDir: 'dist/renderer', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5178,
    watch: { ignored: ['**/.test-artifacts/**', '**/.local-state/**', '**/dist/**'] } },
}));
