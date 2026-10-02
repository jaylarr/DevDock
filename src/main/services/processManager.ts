import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { stripVTControlCharacters } from 'node:util';
import type { Project, ProjectMetadata, Status } from '../../shared/contracts';
import { NativePortProvider, type PortProvider } from '../ports/NativePortProvider';
import { LogManager } from './logManager';
import { ownsListeningPort } from './processOwnership';

interface Runtime {
  child: ChildProcess; status: Status; assignedPort: number; pid: number; intentional: boolean;
  origin?: string; ready?: string; error?: string; startedAt: number;
  timer?: ReturnType<typeof setInterval>; checking: boolean; stopPromise?: Promise<void>;
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export function localOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.port || url.username || url.password) return;
    return `${url.protocol}//${url.host}`;
  } catch { return; }
}
export class ProcessManager {
  private runtime = new Map<string, Runtime>();
  private failures = new Map<string, string>();
  private pending = new Map<string, Promise<void>>();
  private closing = false;
  constructor(readonly logs: LogManager, private changed: () => void, private provider: PortProvider = new NativePortProvider(), private readinessTimeout = 20000) {}
  view(project: ProjectMetadata): Project {
    const run = this.runtime.get(project.id);
    const failure = this.failures.get(project.id);
    return { ...project, status: run?.status ?? (failure ? 'error' : this.pending.has(project.id) ? 'starting' : 'stopped'),
      managed: this.isActive(project.id),
      pid: run?.pid, port: run?.ready ? Number(new URL(run.ready).port) : undefined, localUrl: run?.ready, error: run?.error ?? failure };
  }
  start(project: ProjectMetadata): Promise<void> {
    if (this.closing) return Promise.reject(new Error('The application is shutting down.'));
    if (this.pending.has(project.id) || this.isActive(project.id)) return Promise.reject(new Error('This project is already starting or running.'));
    this.runtime.delete(project.id);
    const job = this.launch(project).finally(() => { this.pending.delete(project.id); this.changed(); });
    this.pending.set(project.id, job);
    this.changed();
    return job;
  }
  isActive(id: string): boolean {
    const run = this.runtime.get(id);
    return !!run && run.child.exitCode === null && run.child.signalCode === null;
  }
  private async launch(project: ProjectMetadata): Promise<void> {
    this.failures.delete(project.id);
    try {
      const { child, assignedPort } = await this.provider.start(project);
      if (!child.pid) throw new Error('The development process could not be created.');
      const run: Runtime = { child, pid: child.pid, assignedPort, status: 'starting', intentional: false, startedAt: Date.now(), checking: false };
      this.runtime.set(project.id, run);
      this.logs.append(project.id, 'system', `Starting npm run dev · PID ${child.pid} · PORT=${assignedPort}`);
      for (const [stream, readable] of [['stdout', child.stdout], ['stderr', child.stderr]] as const) {
        const decoder = new StringDecoder('utf8');
        let partial = '';
        const consume = (text: string) => {
          partial += stripVTControlCharacters(text).replaceAll('\r', '\n');
          const parts = partial.split('\n');
          partial = parts.pop() ?? '';
          for (const line of parts) {
            this.logs.append(project.id, stream, line);
            const match = line.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+/);
            if (match) run.origin = localOrigin(match[0]);
          }
          if (partial.length > 16000) { this.logs.append(project.id, stream, partial.slice(0, 16000)); partial = ''; }
        };
        readable?.on('data', (chunk: Buffer) => consume(decoder.write(chunk)));
        readable?.on('end', () => { consume(decoder.end()); if (partial) this.logs.append(project.id, stream, partial); });
      }
      child.once('error', (error) => {
        if (run.timer) clearInterval(run.timer);
        run.status = 'error'; run.ready = undefined; run.error = error.message;
        this.logs.append(project.id, 'system', error.message); this.changed();
      });
      child.once('exit', (code, signal) => {
        if (run.timer) clearInterval(run.timer);
        run.ready = undefined;
        run.status = run.intentional ? 'stopped' : code === 0 ? 'stopped' : 'crashed';
        run.error = !run.intentional && code !== 0 ? `Process exited (${code ?? signal}). See logs.` : undefined;
        this.logs.append(project.id, 'system', `Process exited · ${code ?? signal ?? 'unknown'}`); this.changed();
      });
      run.timer = setInterval(() => { void this.checkReady(project.id, run); }, 400);
      if (this.closing) await this.terminate(project.id, run);
      this.changed();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start project.';
      this.failures.set(project.id, message); this.logs.append(project.id, 'system', message);
      throw new Error(message);
    }
  }
  private async checkReady(id: string, run: Runtime): Promise<void> {
    if (this.runtime.get(id) !== run || run.checking || !['starting', 'unverified'].includes(run.status)) return;
    run.checking = true;
    try {
      // Require a URL from this process's output, not just a surviving PID or somebody else's occupied port.
      if (run.origin) {
        const response = await fetch(run.origin, { signal: AbortSignal.timeout(1200), redirect: 'manual' });
        await response.body?.cancel();
        const owned = await ownsListeningPort(Number(new URL(run.origin).port), run.pid);
        if (owned && this.runtime.get(id) === run && ['starting', 'unverified'].includes(run.status) && run.child.exitCode === null && run.child.signalCode === null) {
          run.status = 'running'; run.ready = run.origin; run.error = undefined;
          if (run.timer) clearInterval(run.timer);
          this.logs.append(id, 'system', `Ready · ${run.ready} · HTTP ${response.status}`); this.changed();
        }
      }
    } catch { /* The server may still be booting. */ }
    finally {
      run.checking = false;
      if (run.status === 'starting' && Date.now() - run.startedAt > this.readinessTimeout) {
        run.status = 'unverified'; run.error = 'Process is alive, but a ready local URL could not be verified.';
        this.logs.append(id, 'system', run.error); this.changed();
      }
    }
  }
  async stop(id: string): Promise<void> {
    const pending = this.pending.get(id);
    if (pending) await pending.catch(() => undefined);
    const run = this.runtime.get(id);
    if (!run || run.child.exitCode !== null || run.child.signalCode !== null) return;
    if (run.stopPromise) return run.stopPromise;
    run.stopPromise = this.terminate(id, run).finally(() => { run.stopPromise = undefined; });
    return run.stopPromise;
  }
  private async terminate(id: string, run: Runtime): Promise<void> {
    run.intentional = true; run.status = 'stopping'; run.ready = undefined;
    if (run.timer) clearInterval(run.timer);
    this.changed();
    try {
      if (process.platform === 'win32') {
        // SIGTERM on Windows kills only the npm parent. taskkill /T must see the parent alive to identify descendants.
        // Attempt a tree-wide close first, then force the same owned tree; never kill by executable name or port.
        await this.taskkill(run.pid, false).catch(() => undefined);
        await sleep(400);
        if (run.child.exitCode === null && run.child.signalCode === null) await this.taskkill(run.pid, true);
      } else {
        try { process.kill(-run.pid, 'SIGTERM'); } catch { run.child.kill('SIGTERM'); }
        await sleep(400);
        try { process.kill(-run.pid, 'SIGKILL'); } catch { /* Group already stopped. */ }
      }
      const deadline = Date.now() + 4000;
      while (run.child.exitCode === null && run.child.signalCode === null && Date.now() < deadline) await sleep(50);
      if (run.child.exitCode === null && run.child.signalCode === null) throw new Error('Process tree did not stop. Review logs before closing.');
      run.status = 'stopped'; run.error = undefined; this.changed();
    } catch (error) {
      run.status = 'error'; run.error = error instanceof Error ? error.message : 'Stop failed.';
      this.logs.append(id, 'system', run.error); this.changed(); throw error;
    }
  }
  private taskkill(pid: number, force: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const binary = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\taskkill.exe`;
      const child = spawn(binary, ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], { windowsHide: true, signal: AbortSignal.timeout(3000) });
      child.once('error', reject);
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Could not stop owned process tree ${pid} (${code}).`)));
    });
  }
  async stopAll(): Promise<void> {
    this.closing = true;
    await Promise.allSettled([...this.pending.values()]);
    const results = await Promise.allSettled([...this.runtime.keys()].map((id) => this.stop(id)));
    const failures = results.filter((item) => item.status === 'rejected');
    if (failures.length) { this.closing = false; throw new Error(`${failures.length} process tree(s) could not be stopped.`); }
  }
}
