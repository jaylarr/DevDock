import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import type { ProjectMetadata } from '../../shared/contracts';
import { manifest } from '../services/detection';

export interface PortStartResult { child: ChildProcess; assignedPort: number; origin?: string }
export interface PortProvider { start(project: ProjectMetadata): Promise<PortStartResult> }
export async function executable(name: string): Promise<string> {
  const candidates = process.platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const filename of candidates) {
      const target = path.join(directory.replace(/^"|"$/g, ''), filename);
      try { await access(target); return target; } catch { /* Try the next PATH entry. */ }
    }
  }
  throw new Error(`${name} is unavailable on PATH. Install it separately, then reopen the manager.`);
}
export async function npmCommand(): Promise<{ node: string; cli: string }> {
  const node = await executable('node');
  const npm = await executable('npm');
  const candidates = [path.join(path.dirname(npm), 'node_modules/npm/bin/npm-cli.js'),
    path.join(path.dirname(node), 'node_modules/npm/bin/npm-cli.js'), process.env.npm_execpath];
  for (const candidate of candidates) {
    if (!candidate || !path.isAbsolute(candidate) || !candidate.endsWith('npm-cli.js')) continue;
    try { await access(candidate); return { node, cli: candidate }; } catch { /* Try standard npm installations. */ }
  }
  throw new Error('Cannot locate the installed npm CLI. This milestone supports standard Node.js/npm installations.');
}
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { server.close(); reject(new Error('Cannot allocate local port.')); return; }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
export class NativePortProvider implements PortProvider {
  async start(project: ProjectMetadata): Promise<PortStartResult> {
    if (project.kind !== 'script') throw new Error('This provider requires a package-script project.');
    if (project.manager !== 'npm') throw new Error(`${project.manager} is detected, but this first milestone supports npm execution only.`);
    const pkg = manifest(JSON.parse(await readFile(path.join(project.path, 'package.json'), 'utf8')));
    const script = pkg.scripts.dev;
    if (!script?.trim()) throw new Error('This project no longer has a dev script. Rescan its root.');
    const needsPackages = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length > 0;
    if (needsPackages) {
      let current = project.path;
      let found = false;
      while (!found) {
        try { await access(path.join(current, 'node_modules')); found = true; } catch { /* Dependencies may be inherited from a workspace root. */ }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
      if (!found) throw new Error('Dependencies appear to be missing. Install them yourself before starting; this app does not install project dependencies.');
    }
    const { node, cli } = await npmCommand();
    const assignedPort = await freePort();
    const args = [cli, 'run', 'dev'];
    // Direct node + npm-cli.js avoids cmd.exe quoting/injection around paths with spaces or parentheses.
    // npm itself runs the project's existing trusted dev script using its normal platform shell.
    if (/^vite(?:\s|$)/.test(script) && !/[;&|]/.test(script)) args.push('--', '--port', String(assignedPort), '--host', '127.0.0.1', '--strictPort');
    else if (/^next\s+dev(?:\s|$)/.test(script) && !/[;&|]/.test(script)) args.push('--', '--port', String(assignedPort), '--hostname', '127.0.0.1');
    const child = spawn(node, args, { cwd: project.path, shell: false, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(assignedPort), HOST: '127.0.0.1', NO_COLOR: '1', npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' } });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    return { child, assignedPort };
  }
}
