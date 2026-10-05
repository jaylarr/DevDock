import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { stripVTControlCharacters } from 'node:util';
import type { SharingAvailability } from '../../shared/contracts';
import pin from './cloudflared-pin.json';
import { localOrigin, publicOrigin, type TunnelEvents, type TunnelHandle, type TunnelProvider } from './TunnelProvider';
import { startPreviewBridge, type PreviewBridge } from './PreviewBridge';

const alive = (child: ChildProcess) => !!child.pid && child.exitCode === null && child.signalCode === null;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : typeof address === 'object' && address ? resolve(address.port) : reject(new Error('Cannot allocate tunnel metrics port.')));
    });
  });
}
export class TunnelOutput {
  private partial = '';
  private discarding = false;
  constructor(private events: TunnelEvents) {}
  write(value: string): void {
    // Bound partial lines before buffering, including a malicious single huge chunk.
    for (const part of value.split(/(?<=\n)/)) {
      const ended = part.endsWith('\n');
      if (!this.discarding) {
        this.partial += part.slice(0, Math.max(0, 16000 - this.partial.length));
        if (this.partial.length >= 16000 && !ended) this.discarding = true;
      }
      if (ended) { this.line(this.partial); this.partial = ''; this.discarding = false; }
    }
  }
  private line(value: string): void {
    const text = stripVTControlCharacters(value).trim();
    if (!text) return;
    this.events.log(text);
    let message = text;
    try { const event: unknown = JSON.parse(text); if (event && typeof event === 'object' && 'message' in event && typeof event.message === 'string') message = event.message; } catch { /* Quick Tunnel's URL banner is plain text even with JSON logging. */ }
    const candidate = message.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com(?=[\s"/]|$)/)?.[0];
    if (candidate && publicOrigin(candidate)) this.events.url(candidate);
    if (/Registered tunnel connection/.test(message)) this.events.connected();
  }
}
export class CloudflareQuickTunnelProvider implements TunnelProvider {
  constructor(private directory = path.resolve('.sharing-runtime')) {}
  private binary(): string { return path.join(this.directory, pin.version, 'cloudflared.exe'); }
  async availability(): Promise<SharingAvailability> {
    try {
      if (process.platform !== pin.platform || process.arch !== pin.arch) throw new Error('Public sharing supports Windows x64 in this release.');
      const contents = await readFile(this.binary());
      if (createHash('sha256').update(contents).digest('hex') !== pin.sha256) throw new Error('Sharing runtime checksum mismatch. Run npm run setup:sharing, then reopen the manager.');
      return { available: true, version: pin.version };
    } catch (error) {
      return { available: false, error: error instanceof Error && !('code' in error) ? error.message : 'Sharing runtime is missing. Run npm run setup:sharing, then reopen the manager.' };
    }
  }
  async start(origin: string, events: TunnelEvents, signal: AbortSignal): Promise<TunnelHandle> {
    if (localOrigin(origin) !== origin) throw new Error('Only a verified loopback HTTP origin can be shared.');
    const available = await this.availability();
    if (!available.available) throw new Error(available.error);
    signal.throwIfAborted();
    const base = path.join(this.directory, 'sessions'); await mkdir(base, { recursive: true });
    const home = await mkdtemp(path.join(base, 'tunnel-'));
    let child: ChildProcess | undefined;
    let bridge: PreviewBridge | undefined;
    try {
      bridge = await startPreviewBridge(origin);
      const preview = bridge;
      const metrics = `http://127.0.0.1:${await freePort()}`;
      signal.throwIfAborted();
      // Allow only OS runtime variables; isolate account configuration and inherited TUNNEL_* flags.
      const env: NodeJS.ProcessEnv = { HOME: home, USERPROFILE: home };
      for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
      child = spawn(this.binary(), ['tunnel', '--no-autoupdate', '--url', preview.origin, '--http-host-header', new URL(origin).host,
        '--metrics', new URL(metrics).host, '--output', 'json', '--loglevel', 'info'], {
        cwd: home, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      const processHandle = child;
      let stopping = false;
      let stopPromise: Promise<void> | undefined;
      let connected = false;
      let checking = false;
      for (const stream of [child.stdout, child.stderr]) {
        const output = new TunnelOutput({ ...events, url: (value) => { preview.setPublicOrigin(value); events.url(value); }, connected: () => { connected = true; events.connected(); } });
        const decoder = new StringDecoder('utf8');
        stream?.on('data', (chunk: Buffer) => output.write(decoder.write(chunk)));
        stream?.on('end', () => output.write(decoder.end()));
      }
      const monitor = setInterval(() => {
        if (!connected || checking || stopping) return;
        checking = true;
        void fetch(`${metrics}/ready`, { signal: AbortSignal.timeout(1500), redirect: 'manual' }).then(async (response) => {
          await response.body?.cancel();
          if (!stopping && alive(processHandle)) { if (response.ok) events.connected(); else events.disconnected(); }
        }).catch(() => { if (!stopping && alive(processHandle)) events.disconnected(); }).finally(() => { checking = false; });
      }, 3000);
      child.once('error', (error) => { clearInterval(monitor); void preview.stop().catch(() => {}); if (!stopping) events.exited(error.message); });
      child.once('exit', (code, sig) => { clearInterval(monitor); void preview.stop().catch(() => {}); if (!stopping) events.exited(`Tunnel exited (${code ?? sig}). Retry sharing when ready.`); });
      const handle: TunnelHandle = {
        alive: () => alive(processHandle),
        stop: () => {
          if (stopPromise) return stopPromise;
          stopping = true; clearInterval(monitor);
          stopPromise = (async () => {
            await preview.stop();
            if (alive(processHandle)) {
              let forceError: unknown;
              await killTree(processHandle.pid!, false).catch(() => undefined);
              await pause(250);
              if (alive(processHandle)) await killTree(processHandle.pid!, true).catch((error: unknown) => { forceError = error; });
              const deadline = Date.now() + 4000;
              while (alive(processHandle) && Date.now() < deadline) await pause(50);
              if (alive(processHandle)) throw forceError ?? new Error('Tunnel did not stop. Retry Stop Sharing before closing.');
            }
            // This directory was created under the fixed session root, never from renderer input.
            if (path.dirname(home) !== base) throw new Error('Invalid tunnel session cleanup path.');
            await rm(home, { recursive: true, force: true });
          })().catch((error: unknown) => { stopPromise = undefined; throw error; });
          return stopPromise;
        },
      };
      await new Promise<void>((resolve, reject) => { child!.once('spawn', resolve); child!.once('error', reject); });
      if (signal.aborted) await handle.stop();
      return handle;
    } catch (error) {
      await bridge?.stop();
      if (child && alive(child)) await killTree(child.pid!, true);
      await rm(home, { recursive: true, force: true });
      throw error;
    }
  }
}
async function killTree(pid: number, force: boolean): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], {
      windowsHide: true, shell: false, signal: AbortSignal.timeout(3000), stdio: 'ignore',
    });
    child.once('error', reject); child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Could not stop owned tunnel ${pid} (${code}).`)));
  });
}
