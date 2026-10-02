import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, access, readFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

export const demo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const root = path.resolve(demo, '..');
export const scenes = JSON.parse(await readFile(path.join(demo, 'storyboard/scenes.json'), 'utf8'));
export const fps = 30;
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function directories() {
  for (const folder of ['recordings/raw', 'public/recordings', 'public/assets', 'output/qa', '.runtime']) {
    await mkdir(path.join(demo, folder), { recursive: true });
  }
}
export async function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, ...options });
    let stdout = '', stderr = '';
    child.stdout?.on('data', (data) => { stdout += data; });
    child.stderr?.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${path.basename(executable)} exited ${code}\n${stderr.slice(-5000)}`)));
  });
}
export async function npm(args, cwd = root) {
  // Execute npm's JS entry directly: no cmd quoting or shell command construction.
  const cli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  return run(process.execPath, [cli, ...args], { cwd, stdio: 'inherit' });
}
export async function findTool(name) {
  const override = process.env[`MONTAGE_${name.toUpperCase()}`];
  if (override) { await access(override); return override; }
  try { await run(name, ['-version']); return name; } catch { /* WinGet path may not be inherited. */ }
  const bases = [
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft/WinGet/Packages'),
    path.join(process.env.ProgramFiles || 'C:/Program Files', 'WinGet/Packages'),
    path.join(process.env.ProgramData || 'C:/ProgramData', 'Microsoft/WinGet/Packages'),
  ];
  for (const base of bases) {
    for (const entry of await readdir(base, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !/ffmpeg/i.test(entry.name)) continue;
      const directory = path.join(base, entry.name);
      for (const version of await readdir(directory, { withFileTypes: true })) {
        for (const candidate of [path.join(directory, version.name, 'bin', `${name}.exe`), path.join(directory, version.name, `${name}.exe`)]) {
          try { await access(candidate); return candidate; } catch { /* Continue existing-install search. */ }
        }
      }
    }
  }
  throw new Error(`${name} is unavailable. Set MONTAGE_${name.toUpperCase()} to the existing executable path.`);
}
export async function probe(file) {
  const result = await run(await findTool('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  return JSON.parse(result.stdout);
}
export async function until(predicate, description, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}
