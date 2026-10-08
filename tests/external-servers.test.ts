import { afterEach, expect, it, vi } from 'vitest';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ExternalServers, matchServers, parseListeners, planExternalStop, readOutput, type ServerProcess } from '../src/main/services/externalServers';
import { readStopTargets, stopFailure } from '../src/main/services/externalServerStop';
import type { ActivityReport } from '../src/main/services/externalActivity';
import { AppService } from '../src/main/services/appService';
import { Persistence } from '../src/main/services/persistence';
import { dispose, fixtureDirectory, packageFile } from './helpers';
import type { ExternalServerTarget, ProjectMetadata } from '../src/shared/contracts';

const directories: string[] = [], services: AppService[] = [], monitors: ExternalServers[] = [];
const now = Date.now(), born = new Date(now - 10000).toISOString(), seenAt = new Date(now).toISOString(), session = createHash('sha256').update('fixture-output').digest('hex');
const project = (id = 'app', folder = 'C:\\projects\\app'): ProjectMetadata => ({ id, name: id, slug: id, rootId: 'root', path: folder, missing: false, kind: 'script', devScript: 'vite', manager: 'npm', framework: 'Vite' });
const processes: ServerProcess[] = [{ pid: 1, parent: 0, startedAt: born }, { pid: 10, parent: 1, startedAt: born }, { pid: 20, parent: 1, startedAt: born }, { pid: 30, parent: 20, startedAt: born }, { pid: 40, parent: 30, startedAt: born }];
const listener = { pid: 40, port: 5173, host: '127.0.0.1' };
const hint = (): ActivityReport => ({ version: 1, source: 'vscode', session, pid: 10, ownerStartedAt: born, seenAt, state: 'open', folders: [{ path: 'C:\\projects\\app', activityAt: seenAt }], terminals: [{ pid: 20, ownerStartedAt: born, path: 'C:\\projects\\app' }] });
async function fixture() { const value = await fixtureDirectory(); directories.push(value); return value; }
afterEach(async () => { for (const service of services.splice(0)) await service.close(); for (const monitor of monitors.splice(0)) await monitor.close(); for (const directory of directories.splice(0)) await dispose(directory); });

it('identifies real listening descendants of a VS Code terminal without treating an open workspace as a server', () => {
  expect(matchServers([project()], processes, [listener], [hint()], now, 999)[0]).toMatchObject({ id: 'app', server: { pid: 40, port: 5173, localUrl: 'http://127.0.0.1:5173', source: 'vscode' } });
  expect(matchServers([project()], processes, [], [hint()], now, 999)).toEqual([]);
  expect(matchServers([project()], processes, [listener], [{ ...hint(), terminals: [] }], now, 999)).toEqual([]);
  expect(matchServers([project()], processes, [listener], [hint()], now, 20)).toEqual([]);
});
it('uses project-local runtime entry paths and deepest project boundaries without matching unrelated listeners', () => {
  const inventory = processes.map((item) => item.pid === 40 ? { ...item, entryPath: 'C:\\projects\\app\\frontend\\node_modules\\vite\\bin\\vite.js' } : item);
  expect(matchServers([project(), project('frontend', 'C:\\projects\\app\\frontend')], inventory, [listener], [], now, 999)[0]!.id).toBe('frontend');
  expect(matchServers([project('other', 'C:\\projects\\app-other')], inventory, [listener], [], now, 999)).toEqual([]);
});
it('rejects closed and expired reporters, dead terminals, and reused terminal or reporter PIDs', () => {
  const reports = [ { ...hint(), state: 'closed' as const }, { ...hint(), seenAt: new Date(now - 46000).toISOString() }, { ...hint(), ownerStartedAt: new Date(now - 90000).toISOString() }, { ...hint(), terminals: [{ ...hint().terminals![0]!, ownerStartedAt: new Date(now - 90000).toISOString() }] } ];
  for (const report of reports) expect(matchServers([project()], processes, [listener], [report], now, 999)).toEqual([]);
  expect(matchServers([project()], processes.filter((item) => item.pid !== 20), [listener], [hint()], now, 999)).toEqual([]);
});
it('parses IPv4 and IPv6 listeners and skips established connections, UDP, and remote interfaces', () => {
  expect(parseListeners('TCP 0.0.0.0:5173 0.0.0.0:0 LISTENING 40\nTCP [::1]:5174 [::]:0 LISTENING 50\nTCP 192.168.0.2:80 0.0.0.0:0 LISTENING 60\nTCP 127.0.0.1:5173 127.0.0.1:1000 ESTABLISHED 40\nUDP 0.0.0.0:53 *:* 60')).toEqual([{ pid: 40, port: 5173, host: '127.0.0.1' }, { pid: 50, port: 5174, host: '[::1]' }]);
});
it('accepts bounded ordered output and rejects traversal, expired feeds, invalid sequence numbers and oversized entries', () => {
  const output = { version: 1, session, pid: 10, ownerStartedAt: born, terminalPid: 20, terminalStartedAt: born, path: 'C:\\projects\\app', seenAt, state: 'running', entries: [{ sequence: 1, text: 'fixture ready' }] };
  expect(readOutput(output, now)).toBeDefined();
  for (const patch of [{ session: '../escape' }, { path: '\\\\network\\share' }, { seenAt: new Date(now - 46000).toISOString() }, { entries: [{ sequence: 1, text: 'a' }, { sequence: 1, text: 'b' }] }, { entries: [{ sequence: 0, text: 'bad' }] }, { entries: [{ sequence: 1, text: 'x'.repeat(4097) }] }]) expect(readOutput({ ...output, ...patch }, now)).toBeUndefined();
});
it('relays matching output once, rejects unrelated process trees and loses streaming state when a server closes', async () => {
  const directory = await fixture(), lines: string[] = [];
  let captureEnabled = true;
  const monitor = new ExternalServers(directory, () => [project()], () => [hint()], async () => {}, (_id, _stream, text) => lines.push(text), () => {}, { processes: async () => processes, listeners: async () => [listener, { ...listener, port: 5174 }], probe: async () => true, now: () => now, managerPid: 999, captureEnabled: () => captureEnabled }); monitors.push(monitor); await monitor.initialize();
  const output = { version: 1, session, pid: 10, ownerStartedAt: born, terminalPid: 20, terminalStartedAt: born, path: 'C:\\projects\\app', seenAt, state: 'running', entries: [{ sequence: 1, text: 'first' }, { sequence: 2, text: 'next' }] };
  const file = path.join(directory, 'output', session + '.json'); await writeFile(file, JSON.stringify(output)); await monitor.readOutputs(); await monitor.readOutputs(); expect(lines).toEqual(['first', 'next']); expect(monitor.hasOutput('app')).toBe(true);
  await writeFile(file, JSON.stringify({ ...output, terminalPid: 10, entries: [{ sequence: 3, text: 'unrelated' }] })); await monitor.readOutputs(); expect(lines).not.toContain('unrelated');
  await writeFile(file, JSON.stringify({ ...output, state: 'closed' })); await monitor.readOutputs(); expect(monitor.hasOutput('app')).toBe(false);
  captureEnabled = false; await writeFile(file, JSON.stringify({ ...output, entries: [{ sequence: 3, text: 'capture paused' }] })); await monitor.readOutputs(); expect(monitor.hasOutput('app')).toBe(false); expect(lines).not.toContain('capture paused');
});
it('shows an external server and rejects duplicate launch, Stop, and Restart while allowing its verified URL', async () => {
  const directory = await fixture(), root = path.join(directory, 'projects'), app = path.join(root, 'app'); await packageFile(app, { name: 'app', scripts: { dev: 'node server.cjs' } });
  let live = true;
  const service = new AppService(new Persistence(path.join(directory, 'data')), () => {}, { activityDirectory: path.join(directory, 'activity'), activityOptions: { processes: async () => processes }, serverOptions: { processes: async () => processes.map((item) => item.pid === 40 ? { ...item, entryPath: path.join(app, 'server.cjs') } : item), listeners: async () => live ? [listener] : [], probe: async () => true, now: () => now, managerPid: 999 } }); services.push(service);
  await service.initialize(); await service.addRoot(root); await service.externalServers!.refresh(); const id = service.snapshot().projects[0]!.id;
  expect(service.viewProject(id)).toMatchObject({ status: 'running', managed: false, port: 5173, localUrl: 'http://127.0.0.1:5173' });
  expect(await service.openUrl(id)).toBe('http://127.0.0.1:5173'); await expect(service.start(id)).rejects.toThrow('already running outside'); expect(service.processes.isManaged(id)).toBe(false);
  await expect(service.stop(id)).rejects.toThrow('terminal'); await expect(service.restart(id)).rejects.toThrow('terminal');
  await service.updateSettings({ discovery: { externalActivity: false } }); await expect(service.start(id)).rejects.toThrow('already running outside');
  expect(JSON.parse(await readFile(path.join(directory, 'data/state.json'), 'utf8')).projects[0].lastActiveAt).toBe(born);
  live = false; await service.externalServers!.refresh(); expect(service.viewProject(id).status).toBe('stopped'); expect(service.viewProject(id).externalServers).toEqual([]); await expect(service.openUrl(id)).rejects.toThrow('verified');
});
it('fails closed before launching if native server validation fails', async () => {
  const directory = await fixture(); await mkdir(directory, { recursive: true });
  const monitor = new ExternalServers(directory, () => [project()], () => [], async () => {}, () => {}, () => {}, { processes: async () => { throw new Error('private detail'); }, listeners: async () => [] }); monitors.push(monitor);
  await monitor.initialize(); expect(monitor.error).not.toContain('private'); await expect(monitor.checkBeforeLaunch()).rejects.toThrow('Retry before starting');
});

const target: ExternalServerTarget = { pid: 40, ownerStartedAt: born, port: 5173 };
const stopInventory = (): ServerProcess[] => [...processes.map((item) => ({ ...item, name: item.pid === 20 ? 'pwsh.exe' : item.pid === 10 ? 'Code.exe' : 'node.exe', ...(item.pid === 40 ? { entryPath: 'C:\\projects\\app\\server.cjs' } : {}) })), { pid: 50, parent: 40, startedAt: born, name: 'esbuild.exe' }];
const stopMatches = () => matchServers([project()], stopInventory(), [listener], [], now, 999);

it('plans only the listening runtime and its workers, leaving editor, terminal, npm ancestors and unrelated servers open', () => {
  expect(planExternalStop('app', [target], stopMatches(), stopInventory(), 999).map((item) => item.pid)).toEqual([40, 50]);
  const multiport = matchServers([project()], stopInventory(), [listener, { ...listener, port: 5174 }], [], now, 999);
  expect(planExternalStop('app', [target, { ...target, port: 5174 }], multiport, stopInventory(), 999).map((item) => item.pid)).toEqual([40, 50]);
});

it('refuses stale identities, replaced servers, changed ports, other projects, manager ancestors and protected descendants', () => {
  expect(() => planExternalStop('app', [{ ...target, ownerStartedAt: seenAt }], stopMatches(), stopInventory(), 999)).toThrow('process changed');
  expect(() => planExternalStop('app', [{ ...target, pid: 50 }], stopMatches(), stopInventory(), 999)).toThrow('servers changed');
  expect(() => planExternalStop('app', [{ ...target, port: 3000 }], stopMatches(), stopInventory(), 999)).toThrow('servers changed');
  expect(() => planExternalStop('other', [target], stopMatches(), stopInventory(), 999)).toThrow('servers changed');
  expect(() => planExternalStop('app', [target], stopMatches(), stopInventory(), 50)).toThrow('cannot be stopped safely');
  expect(() => planExternalStop('app', [target], stopMatches(), stopInventory(), 30)).toThrow('cannot be stopped safely');
  expect(() => planExternalStop('app', [target], stopMatches(), stopInventory().map((item) => item.pid === 50 ? { ...item, name: 'Code.exe' } : item), 999)).toThrow('protected');
  expect(() => planExternalStop('app', [target], stopMatches(), stopInventory().map((item) => item.pid === 40 ? { ...item, name: 'powershell.exe' } : item), 999)).toThrow('cannot be stopped safely');
  expect(() => planExternalStop('app', [target, target], stopMatches(), stopInventory(), 999)).toThrow('Invalid');
});

it('treats a fully exited target as stopped without touching a new unrelated listener', () => {
  expect(planExternalStop('app', [target], [], stopInventory().filter((item) => item.pid !== 40), 999)).toEqual([]);
  expect(() => planExternalStop('app', [target], [], stopInventory(), 999)).toThrow('servers changed');
});

it('ignores recycled parent PIDs and refuses a process tree serving another registered project', () => {
  const inventory = stopInventory().map((item) => item.pid === 40 ? { ...item, startedAt: seenAt } : item);
  const matches = matchServers([project()], inventory, [listener], [], now, 999);
  expect(planExternalStop('app', [{ ...target, ownerStartedAt: seenAt }], matches, inventory, 999).map((item) => item.pid)).toEqual([40]);
  expect(() => planExternalStop('app', [target], [...stopMatches(), { id: 'other', path: 'C:\\projects\\other', server: { ...target, pid: 50, status: 'running' } }], stopInventory(), 999)).toThrow('another registered project');
});

it('rejects malformed external stop requests and arbitrary process payloads', () => {
  expect(readStopTargets([target])).toEqual([target]);
  for (const input of [undefined, [], Array(65).fill(target), [{ ...target, pid: 0 }], [{ ...target, port: 65536 }], [{ ...target, ownerStartedAt: 'bad' }], [{ ...target, command: 'kill' }]]) expect(() => readStopTargets(input)).toThrow('Invalid');
});

it('reports bounded native failure stages without exposing raw PowerShell output', () => {
  expect(stopFailure(JSON.stringify({ ok: false, stage: 'terminate', pid: 40, reason: 'native-error', nativeCode: 5 }), 1)).toContain('Windows denied access while terminating the external process (PID 40). Windows error 5.');
  expect(stopFailure(JSON.stringify({ ok: false, stage: 'identity', pid: 40, reason: 'identity-changed' }), 1)).toContain('process changed (PID 40)');
  expect(stopFailure(JSON.stringify({ ok: false, stage: 'wait', pid: 40, reason: 'exit-timeout' }), 1)).toContain('did not exit after termination');
  expect(stopFailure('private command line or environment value', 1)).toBe('The Windows server stop helper failed (exit code 1). Refresh to check the server state.');
  expect(stopFailure(JSON.stringify({ ok: false, stage: 'private text', pid: 40 }), null)).not.toContain('private text');
});

it('stops through the service with a fresh check, updates state, preserves activity, and keeps external Restart disabled', async () => {
  const directory = await fixture(), app = path.join(directory, 'app'); await packageFile(app, { name: 'app', scripts: { dev: 'node server.cjs' } });
  let live = true;
  const stopProcesses = vi.fn(async (plan: ServerProcess[]) => { expect(plan.map((item) => item.pid)).toEqual([40, 50]); live = false; });
  const service = new AppService(new Persistence(path.join(directory, 'data')), () => {}, { activityDirectory: path.join(directory, 'activity'), serverOptions: {
    processes: async () => stopInventory().filter((item) => live || ![40, 50].includes(item.pid)).map((item) => item.pid === 40 ? { ...item, entryPath: path.join(app, 'server.cjs') } : item),
    listeners: async () => live ? [listener] : [], probe: async () => true, now: () => now, managerPid: 999, stopProcesses,
  } }); services.push(service); await service.initialize(); await service.addRoot(app); await service.externalServers!.refresh();
  const id = service.snapshot().projects[0]!.id;
  await expect(service.restart(id)).rejects.toThrow('terminal');
  await service.updateSettings({ discovery: { externalActivity: false } });
  await service.stopExternal(id, [target]); expect(stopProcesses).toHaveBeenCalledOnce();
  expect(service.viewProject(id)).toMatchObject({ status: 'stopped', managed: false, externalServers: [], lastActiveAt: born });
  expect(service.logs.get(id).some((entry) => entry.text === 'The external development server stopped.')).toBe(true);
  await expect(service.openUrl(id)).rejects.toThrow('verified');
});

it('does not terminate anything after a failed fresh check or PID reuse, and reports failed stops without claiming success', async () => {
  const directory = await fixture(); let failCheck = false, reused = false;
  const stopProcesses = vi.fn(async () => { throw new Error('permission denied'); });
  const monitor = new ExternalServers(directory, () => [project()], () => [], async () => {}, () => {}, () => {}, {
    processes: async () => { if (failCheck) throw new Error('check failed'); return stopInventory().map((item) => reused && item.pid === 40 ? { ...item, startedAt: seenAt } : item); },
    listeners: async () => [listener], probe: async () => true, managerPid: 999, stopProcesses,
  }); monitors.push(monitor); await monitor.initialize(); failCheck = true;
  await expect(monitor.stop('app', [target])).rejects.toThrow('could not be verified'); expect(stopProcesses).not.toHaveBeenCalled();
  failCheck = false; reused = true;
  await expect(monitor.stop('app', [target])).rejects.toThrow('process changed'); expect(stopProcesses).not.toHaveBeenCalled();
  reused = false;
  await expect(monitor.stop('app', [target])).rejects.toThrow('permission denied'); expect(monitor.isStopping('app')).toBe(false);
});

it('serializes duplicate stops and checks that the listener actually disappears after termination', async () => {
  const directory = await fixture(); let release!: () => void;
  const stopProcesses = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
  const monitor = new ExternalServers(directory, () => [project()], () => [], async () => {}, () => {}, () => {}, { processes: async () => stopInventory(), listeners: async () => [listener], probe: async () => true, managerPid: 999, stopProcesses });
  monitors.push(monitor); await monitor.initialize();
  const stopping = monitor.stop('app', [target]); expect(monitor.isStopping('app')).toBe(true);
  await expect(monitor.stop('app', [target])).rejects.toThrow('already stopping');
  await vi.waitFor(() => expect(stopProcesses).toHaveBeenCalledOnce()); release();
  await expect(stopping).rejects.toThrow('still listening'); expect(monitor.isStopping('app')).toBe(false);
});

it('closing detection leaves external servers running', async () => {
  const directory = await fixture(), stopProcesses = vi.fn();
  const monitor = new ExternalServers(directory, () => [project()], () => [], async () => {}, () => {}, () => {}, { processes: async () => stopInventory(), listeners: async () => [listener], probe: async () => true, managerPid: 999, stopProcesses });
  await monitor.initialize(); await monitor.close(); expect(stopProcesses).not.toHaveBeenCalled(); await expect(monitor.stop('app', [target])).rejects.toThrow('shutting down');
});
