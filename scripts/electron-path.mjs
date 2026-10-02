import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const electronPackageDirectory = path.dirname(fileURLToPath(import.meta.resolve('electron/package.json')));
export async function electronPath() {
  try {
    const filename = (await readFile(path.join(electronPackageDirectory, 'path.txt'), 'utf8')).trim();
    const distribution = path.join(electronPackageDirectory, 'dist');
    const executable = path.resolve(distribution, filename);
    const relative = path.relative(distribution, executable);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid runtime path.');
    await access(executable);
    return executable;
  } catch {
    throw new Error('Electron runtime is missing. During initial online setup, run npm run setup:runtime. Normal app launches never download it.');
  }
}
