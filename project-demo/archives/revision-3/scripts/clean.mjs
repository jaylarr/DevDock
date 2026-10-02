import path from 'node:path';
import { rm } from 'node:fs/promises';
import { demo } from './common.mjs';

// Only generated montage assets. Never clean the application, user data, or node_modules.
for (const folder of ['recordings/raw', 'public/recordings', 'public/assets', 'output', '.runtime']) {
  const target = path.resolve(demo, folder);
  const relative = path.relative(demo, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe clean target.');
  await rm(target, { recursive: true, force: true });
}
console.log('Removed generated montage assets. Source and dependencies preserved.');
