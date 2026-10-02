import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { TunnelManager } from '../src/main/services/tunnelManager';
import { TunnelOutput, CloudflareQuickTunnelProvider } from '../src/main/tunnels/CloudflareQuickTunnelProvider';
import { publicOrigin, type TunnelEvents, type TunnelHandle, type TunnelProvider, type VerifiedOrigin } from '../src/main/tunnels/TunnelProvider';
import { LogManager } from '../src/main/services/logManager';
import { AppService } from '../src/main/services/appService';
import { ProcessManager } from '../src/main/services/processManager';
import { scanProjects } from '../src/main/services/projectScanner';
import { Persistence } from '../src/main/services/persistence';
import { sharingCompatibility } from '../src/main/services/sharingCompatibility';
import { dispose, eventually, fixtureDirectory, mockServer, root } from './helpers';

class FakeProvider implements TunnelProvider {
  sessions: { events: TunnelEvents; handle: TunnelHandle; alive: boolean; failStop: boolean }[] = [];
  available = true;
  beforeStart?: () => Promise<void>;
  async availability() { return { available: this.available, error: this.available ? undefined : 'Missing runtime' }; }
  async start(_origin: string, events: TunnelEvents): Promise<TunnelHandle> {
    await this.beforeStart?.();
    const session = { events, alive: true, failStop: false, handle: {} as TunnelHandle };
    session.handle = { alive: () => session.alive, stop: async () => { if (session.failStop) throw new Error('Stop failed'); session.alive = false; } };
    this.sessions.push(session); return session.handle;
  }
  ready(index = 0) { const session = this.sessions[index]!; session.events.url(`https://fixture-${index}.trycloudflare.com`); session.events.connected(); }
}
const managers: TunnelManager[] = [];
const services: AppService[] = [];
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const manager of managers.splice(0)) await manager.stopAll();
  for (const service of services.splice(0)) await service.close();
  for (const directory of directories.splice(0)) await dispose(directory);
});
async function setup(timeout = 2000) {
  const provider = new FakeProvider();
  const manager = new TunnelManager(provider, new LogManager(() => {}), () => {}, timeout, 30, 50); managers.push(manager); await manager.initialize();
  let current = true; let owned = true;
  const origin: VerifiedOrigin = { origin: 'http://127.0.0.1:5001', entryPath: '/landing%20page.html', current: () => current, owned: async () => owned };
  return { provider, manager, verify: async () => origin, change: () => { current = false; }, losePort: () => { owned = false; } };
}
describe('sharing sessions and races', () => {
  it('requires both a valid URL and connection evidence, preserving the HTML entry', async () => {
    const { provider, manager, verify } = await setup(); await manager.start('a', verify);
    provider.sessions[0]!.events.url('https://demo-site.trycloudflare.com');
    expect(manager.view('a').status).toBe('connecting'); expect(() => manager.publicUrl('a')).toThrow();
    provider.sessions[0]!.events.connected();
    expect(manager.publicUrl('a')).toBe('https://demo-site.trycloudflare.com/landing%20page.html');
    await manager.stop('a'); expect(manager.view('a')).toEqual({ status: 'disabled' }); expect(provider.sessions[0]!.alive).toBe(false);
  });
  it('reserves a session before asynchronous verification and rejects duplicate requests', async () => {
    const { provider, manager, verify } = await setup();
    let release!: () => void;
    const first = manager.start('a', async () => { await new Promise<void>((resolve) => { release = resolve; }); return verify(); });
    await expect(manager.start('a', verify)).rejects.toThrow('already'); release(); await first;
    expect(provider.sessions).toHaveLength(1);
  });
  it('cancels validation before spawning and ignores late events after cancellation', async () => {
    const { provider, manager, verify } = await setup(); let release!: () => void;
    const start = manager.start('a', async () => { await new Promise<void>((resolve) => { release = resolve; }); return verify(); });
    const stop = manager.stop('a'); release(); await start; await stop;
    expect(provider.sessions).toHaveLength(0); expect(manager.view('a').status).toBe('disabled');
    await manager.start('a', verify); await manager.stop('a'); provider.ready();
    expect(manager.view('a').status).toBe('disabled');
  });
  it('cleans up a handle spawned after stop was requested', async () => {
    const { provider, manager, verify } = await setup(); let release!: () => void;
    provider.beforeStart = () => new Promise<void>((resolve) => { release = resolve; });
    const start = manager.start('a', verify); await eventually(() => !!release);
    const stop = manager.stop('a'); release(); await start; await stop;
    expect(provider.sessions[0]!.alive).toBe(false); expect(manager.view('a').status).toBe('disabled');
  });
  it('keeps three concurrent links independent and stops all without blocking future explicit shares', async () => {
    const { provider, manager, verify } = await setup();
    await Promise.all(['a', 'b', 'c'].map((id) => manager.start(id, verify))); [0, 1, 2].forEach((index) => provider.ready(index));
    expect(new Set(['a', 'b', 'c'].map((id) => manager.publicUrl(id))).size).toBe(3);
    await manager.stop('b'); expect(manager.view('a').status).toBe('sharing'); expect(manager.view('c').status).toBe('sharing');
    await manager.stopAll(); expect(provider.sessions.every((session) => !session.alive)).toBe(true);
    await manager.start('a', verify); expect(provider.sessions).toHaveLength(4);
  });
  it('times out a provider that never connects and retains an error', async () => {
    const { provider, manager, verify } = await setup(40); await manager.start('a', verify);
    await eventually(() => manager.view('a').status === 'error' && !manager.owns('a'));
    expect(provider.sessions[0]!.alive).toBe(false); expect(manager.view('a').publicUrl).toBeUndefined();
  });
  it('clears an invalid URL and stops its session', async () => {
    const { provider, manager, verify } = await setup(); await manager.start('a', verify);
    provider.sessions[0]!.events.url('https://evil.example'); await eventually(() => !manager.owns('a'));
    expect(manager.view('a').status).toBe('error'); expect(() => manager.publicUrl('a')).toThrow();
  });
  it('clears the link on disconnect and stops after the grace period, requiring explicit retry', async () => {
    const { provider, manager, verify } = await setup(); await manager.start('a', verify); provider.ready();
    provider.sessions[0]!.events.disconnected(); expect(manager.view('a').publicUrl).toBeUndefined();
    await eventually(() => manager.view('a').status === 'error' && !manager.owns('a'));
    provider.ready(); expect(manager.view('a').status).toBe('error');
    await manager.start('a', verify); expect(provider.sessions).toHaveLength(2);
  });
  it('permits recovery inside the disconnect grace period without creating another tunnel', async () => {
    const { provider, manager, verify } = await setup(); await manager.start('a', verify); provider.ready();
    provider.sessions[0]!.events.disconnected(); provider.sessions[0]!.events.connected();
    expect(manager.view('a').status).toBe('sharing'); expect(provider.sessions).toHaveLength(1);
  });
  it('invalidates a port whose ownership changes', async () => {
    const { provider, manager, verify, losePort } = await setup(); await manager.start('a', verify); provider.ready(); losePort();
    await eventually(() => manager.view('a').status === 'error' && !manager.owns('a'));
    expect(manager.view('a').error).toContain('owned');
  });
  it('ignores late connection evidence from an old local process generation', async () => {
    const { provider, manager, verify, change } = await setup(); await manager.start('a', verify); change(); provider.ready();
    expect(() => manager.publicUrl('a')).toThrow(); await eventually(() => !manager.owns('a'));
  });
  it('retains failed cleanup ownership and supports a retry', async () => {
    const { provider, manager, verify } = await setup(); await manager.start('a', verify); provider.ready();
    provider.sessions[0]!.failStop = true; await expect(manager.stop('a')).rejects.toThrow('Stop failed');
    expect(manager.view('a').managed).toBe(true); expect(manager.view('a').publicUrl).toBeUndefined();
    await expect(manager.start('a', verify)).rejects.toThrow('already');
    provider.sessions[0]!.failStop = false; await manager.stop('a'); expect(manager.view('a').status).toBe('disabled');
  });
  it('reports verification failure without leaving startup bookkeeping or a timer', async () => {
    const { manager } = await setup(); await expect(manager.start('a', async () => { throw new Error('Wrong owner'); })).rejects.toThrow('Wrong owner');
    await eventually(() => !manager.owns('a')); expect(manager.view('a').error).toBe('Wrong owner');
  });
  it('prevents shares during project stop and after app shutdown', async () => {
    const { manager, verify } = await setup(); manager.block('a'); await expect(manager.start('a', verify)).rejects.toThrow('stopping');
    manager.unblock('a'); await manager.stopAll(true); await expect(manager.start('a', verify)).rejects.toThrow('stopping');
  });
  it('serializes overlapping Stop All requests and blocks new sessions until cleanup ends', async () => {
    const { provider, manager, verify } = await setup(); await manager.start('a', verify); provider.ready();
    let release!: () => void; const originalStop = provider.sessions[0]!.handle.stop;
    provider.sessions[0]!.handle.stop = async () => { await new Promise<void>((resolve) => { release = resolve; }); await originalStop(); };
    const first = manager.stopAll(); const second = manager.stopAll(); await eventually(() => !!release);
    await expect(manager.start('b', verify)).rejects.toThrow('stopping'); release(); await Promise.all([first, second]);
    await manager.start('b', verify); expect(provider.sessions).toHaveLength(2);
  });
});
describe('provider parsing and trust boundaries', () => {
  it('rejects foreign hosts, lookalikes, credentials, paths, fragments, and non-HTTPS URLs', () => {
    for (const value of ['http://demo.trycloudflare.com', 'https://trycloudflare.com', 'https://demo.trycloudflare.com.evil', 'https://x.y.trycloudflare.com', 'https://user@demo.trycloudflare.com', 'https://demo.trycloudflare.com:444', 'https://demo.trycloudflare.com/path', 'https://demo.trycloudflare.com?x=1', 'https://demo.trycloudflare.com#x']) expect(publicOrigin(value)).toBeUndefined();
    expect(publicOrigin('https://demo-site.trycloudflare.com')).toBe('https://demo-site.trycloudflare.com');
  });
  it('parses split URL banners and JSON connection logs but not arbitrary ready-like text', () => {
    const events = { url: vi.fn(), connected: vi.fn(), disconnected: vi.fn(), exited: vi.fn(), log: vi.fn() };
    const parser = new TunnelOutput(events);
    parser.write('| https://demo-site.try'); parser.write('cloudflare.com |\n');
    expect(events.url).toHaveBeenCalledWith('https://demo-site.trycloudflare.com'); expect(events.connected).not.toHaveBeenCalled();
    parser.write('{"message":"Registered tunnel connection","connIndex":0}\n'); expect(events.connected).toHaveBeenCalledTimes(1);
    parser.write('ready hello\n'); expect(events.connected).toHaveBeenCalledTimes(1);
  });
  it('bounds oversized partial output and resumes parsing the next line', () => {
    const events = { url: vi.fn(), connected: vi.fn(), disconnected: vi.fn(), exited: vi.fn(), log: vi.fn() };
    const parser = new TunnelOutput(events); parser.write('x'.repeat(2_000_000)); parser.write('\nhttps://demo.trycloudflare.com\n');
    expect(events.log.mock.calls[0]![0].length).toBeLessThanOrEqual(16000); expect(events.url).toHaveBeenCalledWith('https://demo.trycloudflare.com');
  });
  it('missing runtime affects sharing availability only and invalid origins never spawn', async () => {
    const directory = await fixtureDirectory(); directories.push(directory);
    const provider = new CloudflareQuickTunnelProvider(directory);
    expect((await provider.availability()).available).toBe(false);
    const events = { url: vi.fn(), connected: vi.fn(), disconnected: vi.fn(), exited: vi.fn(), log: vi.fn() };
    await expect(provider.start('http://example.com:8000', events, new AbortController().signal)).rejects.toThrow('loopback');
  });
});
describe('application integration with real local HTML and mock tunnels', () => {
  it('accepts an observed process exit even when the forced-stop command races and returns an error', async () => {
    const directory = await fixtureDirectory(); directories.push(directory); await mockServer(directory);
    const project = (await scanProjects([root(directory)])).projects[0]!;
    const manager = new ProcessManager(new LogManager(() => {}), () => {});
    const internal = manager as unknown as { taskkill(pid: number, force: boolean): Promise<void> };
    const kill = internal.taskkill.bind(internal);
    try {
      await manager.start(project); await eventually(() => manager.view(project).status === 'running');
      vi.spyOn(internal, 'taskkill').mockImplementation(async (pid, force) => {
        if (!force) return; // Model a graceful close that has not completed yet.
        await kill(pid, true); throw new Error('Command completed with a stale process-exit error');
      });
      await manager.stop(project.id); expect(manager.view(project).status).toBe('stopped'); expect(manager.isManaged(project.id)).toBe(false);
    } finally { vi.restoreAllMocks(); await manager.stopAll(); }
  });
  async function fixture() {
    const directory = await fixtureDirectory(); directories.push(directory); const site = path.join(directory, 'site');
    await mkdir(site); await writeFile(path.join(site, 'landing page.html'), '<h1>Fixture</h1>');
    const provider = new FakeProvider(); const persistence = new Persistence(path.join(directory, 'state'));
    const service = new AppService(persistence, () => {}, { provider }); services.push(service); await service.initialize(); await service.addRoot(site);
    const project = service.snapshot().projects[0]!; return { service, provider, project, directory, persistence };
  }
  it('rejects stopped/unverified IDs, preserves local server after Stop Sharing, and never persists URLs', async () => {
    const { service, provider, project, directory, persistence } = await fixture();
    await expect(service.share(project.id)).rejects.toThrow('verified'); await expect(service.share('invalid')).rejects.toThrow('not found');
    await service.start(project.id); await eventually(() => service.processes.view(project).status === 'running');
    await service.share(project.id); provider.ready(); expect(service.publicUrl(project.id)).toContain('/landing%20page.html');
    await service.stopSharing(project.id); expect(await (await fetch(service.processes.view(project).localUrl!)).text()).toContain('Fixture');
    const saved = await readFile(path.join(directory, 'state/state.json'), 'utf8'); expect(saved).not.toContain('trycloudflare'); expect(saved).not.toContain('sharing');
    const restored = new AppService(persistence, () => {}, { provider }); await restored.initialize(); expect(restored.snapshot().projects[0]!.sharing).toEqual({ status: 'disabled' }); await restored.close();
  });
  it('ends sharing before stopping/restarting a real HTML process', async () => {
    const { service, provider, project } = await fixture(); await service.start(project.id); await eventually(() => service.processes.view(project).status === 'running');
    await service.share(project.id); provider.ready(); await service.restart(project.id);
    expect(provider.sessions[0]!.alive).toBe(false); expect(service.tunnels.view(project.id).status).toBe('disabled');
    await eventually(() => service.processes.view(project).status === 'running');
  });
  it('refuses sharing when an unrelated IPv6 listener occupies the same port as the owned IPv4 origin', async () => {
    const { service, provider, project } = await fixture(); await service.start(project.id); await eventually(() => service.processes.view(project).status === 'running');
    const foreign = createServer((_request, response) => response.end('Foreign endpoint'));
    try {
      await new Promise<void>((resolve, reject) => { foreign.once('error', reject); foreign.listen(service.processes.view(project).port!, '::1', resolve); });
      await expect(service.share(project.id)).rejects.toThrow('owned'); expect(provider.sessions).toHaveLength(0);
    } finally { await new Promise<void>((resolve) => foreign.close(() => resolve())); }
  });
  it('cleans sharing when the managed server crashes and keeps excluded entries stoppable', async () => {
    const { service, provider, project } = await fixture(); await service.start(project.id); await eventually(() => service.processes.view(project).status === 'running');
    await service.share(project.id); provider.ready(); await service.addExclusion(project.path);
    await expect(service.share(project.id)).rejects.toThrow('excluded');
    process.kill(service.processes.view(project).pid!); await eventually(() => !service.tunnels.owns(project.id));
    expect(provider.sessions[0]!.alive).toBe(false); await service.scan();
  });
  it('close still stops projects when a tunnel fails cleanup, and supports retry', async () => {
    const { service, provider, project } = await fixture(); await service.start(project.id); await eventually(() => service.processes.view(project).status === 'running');
    await service.share(project.id); provider.ready(); provider.sessions[0]!.failStop = true;
    await expect(service.close()).rejects.toThrow('sharing'); expect(service.processes.isManaged(project.id)).toBe(false);
    provider.sessions[0]!.failStop = false; await service.close(); expect(provider.sessions[0]!.alive).toBe(false);
  });
  it('retains an excluded project with failed tunnel cleanup so it remains stoppable', async () => {
    const { service, provider, project } = await fixture(); await service.start(project.id); await eventually(() => service.processes.view(project).status === 'running');
    await service.share(project.id); provider.ready(); provider.sessions[0]!.failStop = true;
    await service.processes.stop(project.id); await eventually(() => service.tunnels.view(project.id).status === 'error');
    await service.addExclusion(project.path); expect(service.snapshot().projects.some((item) => item.id === project.id)).toBe(true);
    await expect(service.removeRoot(project.rootId)).rejects.toThrow('sharing');
    provider.sessions[0]!.failStop = false; await service.stopSharing(project.id); await service.scan(); expect(service.snapshot().projects).toHaveLength(0);
  });
  it('inspects compatibility without reporting source secrets or reading hidden configuration', async () => {
    const { project } = await fixture();
    await writeFile(path.join(project.path, 'client.js'), "fetch('http://localhost:3001/api'); new EventSource('/events'); signInWithOAuth({provider:'google'}); // secret-marker");
    await writeFile(path.join(project.path, '.env'), 'PRIVATE=http://localhost:9999');
    const report = await sharingCompatibility(project);
    expect(report.notes.join(' ')).toContain('Local-only'); expect(report.notes.join(' ')).toContain('SSE'); expect(report.notes.join(' ')).toContain('Login');
    expect(JSON.stringify(report)).not.toContain('secret-marker'); expect(JSON.stringify(report)).not.toContain('.env');
  });
});
