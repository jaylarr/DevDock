import path from 'node:path';
import { access, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { ProjectMetadata } from '../../shared/contracts';
import { executable, NativePortProvider, type PortProvider, type PortStartResult } from './NativePortProvider';
import { object } from '../services/detection';
import { validEntry } from '../services/staticPolicy';

export class StaticPortProvider implements PortProvider {
  constructor(private helper = typeof __dirname === 'string'
    ? path.join(__dirname, typeof __filename === 'string' && __filename.endsWith('.ts') ? '../runtime/static-server.ts' : 'static-server.cjs')
    : path.resolve('src/main/runtime/static-server.ts')) {}
  async start(project: ProjectMetadata): Promise<PortStartResult> {
    if (project.kind !== 'static' || !validEntry(project.entryFile)) throw new Error('Invalid static entry page. Rescan its root.');
    if (!(await lstat(path.join(project.path, project.entryFile))).isFile()) throw new Error('Static entry page is missing. Rescan its root.');
    await access(this.helper);
    const node = await executable('node');
    const child = spawn(node, [this.helper, project.path, project.entryFile], { cwd: project.path, shell: false,
      windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    const assignedPort = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Static server did not start within 10 seconds.')), 10000);
      const finish = (error?: Error, port?: number) => {
        clearTimeout(timer); child.off('message', message); child.off('error', failed); child.off('exit', exited);
        if (error) { child.kill(); reject(error); } else resolve(port!);
      };
      const message = (value: unknown) => { if (object(value) && Number.isInteger(value.port) && Number(value.port) > 0 && Number(value.port) <= 65535) finish(undefined, Number(value.port)); };
      const failed = (error: Error) => finish(error);
      const exited = (code: number | null) => finish(new Error(`Static server exited before listening (${code}).`));
      child.on('message', message); child.once('error', failed); child.once('exit', exited);
    });
    return { child, assignedPort, origin: `http://127.0.0.1:${assignedPort}` };
  }
}
export class ProjectPortProvider implements PortProvider {
  constructor(private script: PortProvider = new NativePortProvider(), private staticSite: PortProvider = new StaticPortProvider()) {}
  start(project: ProjectMetadata): Promise<PortStartResult> { return (project.kind === 'static' ? this.staticSite : this.script).start(project); }
}
