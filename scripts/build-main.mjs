import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

export async function buildMain() {
  await mkdir('dist/main/activity-assets', { recursive: true });
  await cp('integrations/activity', 'dist/main/activity-assets', { recursive: true });
  await build({ entryPoints: ['src/main/runtime/static-server.ts'], outfile: 'dist/main/static-server.cjs', bundle: true,
    platform: 'node', format: 'cjs', target: 'node24', sourcemap: true });
  await build({ entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.cjs', bundle: true,
    platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], sourcemap: true });
  await build({ entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.cjs', bundle: true,
    platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], sourcemap: true });
}

if (process.argv[1]?.endsWith('build-main.mjs')) await buildMain();
