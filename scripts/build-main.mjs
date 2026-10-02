import { build } from 'esbuild';

export async function buildMain() {
  await build({ entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.cjs', bundle: true,
    platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], sourcemap: true });
  await build({ entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.cjs', bundle: true,
    platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], sourcemap: true });
}

if (process.argv[1]?.endsWith('build-main.mjs')) await buildMain();
