import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { ExternalActivity, matchReports, readReport, type ActivityReport, type ProjectObservation } from '../src/main/services/externalActivity';
import { setupActivity, mergeActivityHooks, mergeTerminalProfile, buildActivityExtension, findVSCode } from '../src/main/services/activitySetup';
import { AppService } from '../src/main/services/appService';
import { Persistence } from '../src/main/services/persistence';
import { defaultSettings, readSettings } from '../src/shared/settings';
import type { ProjectMetadata } from '../src/shared/contracts';
import { dispose, fixtureDirectory, packageFile } from './helpers';

const directories: string[] = [], services: AppService[] = [], monitors: ExternalActivity[] = [];
const run = promisify(execFile);
const now = Date.parse('2026-10-04T06:00:00.000Z'), seenAt = new Date(now).toISOString(), startedAt = '2026-10-04T05:00:00.000Z';
const session = createHash('sha256').update('fixture').digest('hex');
const project = (id: string, directory: string): ProjectMetadata => ({ id, path: directory, name: id, slug: id, rootId: 'root', kind: 'static', framework: 'Static HTML', entryFile: 'index.html', missing: false });
const report = (patch: Partial<ActivityReport> = {}): ActivityReport => ({ version: 1, source: 'vscode', session, pid: 123, ownerStartedAt: startedAt, seenAt, state: 'open', folders: [{ path: 'C:\\projects\\app', activityAt: seenAt }], ...patch });
async function fixture() { const directory = await fixtureDirectory(); directories.push(directory); return directory; }
afterEach(async () => { vi.restoreAllMocks(); for (const monitor of monitors.splice(0)) await monitor.close(); for (const service of services.splice(0)) await service.close(); for (const directory of directories.splice(0)) await dispose(directory); });

it('matches exact path boundaries, the deepest project, multiple sources, and current process identities', () => {
  const projects = [project('parent', 'C:\\projects\\app'), project('nested', 'C:\\projects\\app\\nested'), project('similar', 'C:\\projects\\app-other')];
  const observations = matchReports([report({ folders: [{ path: 'C:\\PROJECTS\\APP\\nested\\src', activityAt: seenAt }, { path: 'C:\\projects\\app-other\\src', activityAt: seenAt }] }), report({ source: 'codex' })], projects, [{ pid: 123, parent: 1, startedAt }], now, 999);
  expect(observations.map((item) => [item.id, item.source, item.presence?.state])).toEqual([['nested', 'vscode', 'open'], ['similar', 'vscode', 'open'], ['parent', 'codex', 'open']]);
  expect(matchReports([report({ folders: [{ path: 'C:\\projects\\application', activityAt: seenAt }] })], projects, [], now, 999)).toEqual([]);
});
it('expires closed/dead/stale sessions, prevents PID reuse and ignores DevDock descendants', () => {
  const projects = [project('app', 'C:\\projects\\app')], processes = [{ pid: 123, parent: 1, startedAt }];
  for (const value of [report({ state: 'closed' }), report({ ownerStartedAt: '2026-10-03T05:00:00.000Z' }), report({ seenAt: new Date(now - 46000).toISOString() })]) expect(matchReports([value], projects, processes, now, 999)[0]!.presence).toBeUndefined();
  expect(matchReports([report()], projects, [], now, 999)[0]!.presence).toBeUndefined();
  expect(matchReports([report()], projects, [{ pid: 123, parent: 999, startedAt }], now, 999)).toEqual([]);
  const unverified = report({ pid: 0, ownerStartedAt: undefined, source: 'codex' });
  expect(matchReports([unverified], projects, [], now, 999)[0]!.presence?.state).toBe('recent');
  expect(matchReports([unverified], projects, [], now + 91000, 999)[0]!.presence).toBeUndefined();
});
it.each([{ source: 'unknown' }, { pid: -1 }, { pid: 1.5 }, { session: '../../escape' }, { seenAt: 'bad' }, { seenAt: new Date(now + 60000).toISOString() }, { folders: [{ path: '\\\\network\\secret', activityAt: seenAt }] }, { folders: [{ path: 'C:\\projects\\app', activityAt: 'bad' }] }, { ownerStartedAt: undefined }])('rejects malformed reports %j', (patch) => { expect(readReport({ ...report(), ...patch }, now)).toBeUndefined(); });

it('reads bounded local reports, skips malformed files and clears badges when disabled or checking fails', async () => {
  const directory = await fixture(), observations: ProjectObservation[][] = [];
  const processes = vi.fn(async () => [{ pid: 123, parent: 1, startedAt }]);
  const monitor = new ExternalActivity(directory, () => [project('app', 'C:\\projects\\app')], async (values) => { observations.push(values); }, () => {}, { processes, now: () => now, managerPid: 999 }); monitors.push(monitor);
  await monitor.configure(true);
  await writeFile(path.join(monitor.reportsDirectory, session + '.json'), JSON.stringify(report()));
  await writeFile(path.join(monitor.reportsDirectory, 'b'.repeat(64) + '.json'), 'x'.repeat(32769));
  await writeFile(path.join(monitor.reportsDirectory, 'c'.repeat(64) + '.json'), 'broken');
  await monitor.refresh(); expect(observations.at(-1)).toHaveLength(1); expect(monitor.view().connected).toEqual(['vscode']);
  processes.mockRejectedValueOnce(new Error('sensitive local error')); await monitor.refresh(); expect(monitor.view().error).not.toContain('sensitive'); expect(observations.at(-1)).toEqual([]);
  await monitor.configure(false); expect(monitor.view().enabled).toBe(false); expect(JSON.parse(await readFile(path.join(directory, 'policy.json'), 'utf8')).enabled).toBe(false);
});
it('serializes toggles and discards a check that finishes after closing', async () => {
  const directory = await fixture(); let release!: (value: { pid: number; parent: number; startedAt: string }[]) => void;
  const observed = vi.fn(async () => {});
  const monitor = new ExternalActivity(directory, () => [project('app', 'C:\\projects\\app')], observed, () => {}, { processes: () => new Promise((resolve) => { release = resolve; }), now: () => now }); monitors.push(monitor);
  await monitor.configure(true); await writeFile(path.join(monitor.reportsDirectory, session + '.json'), JSON.stringify(report()));
  const check = monitor.refresh();
  while (!release) await new Promise((resolve) => setTimeout(resolve, 10));
  observed.mockClear(); const closed = monitor.close(); release([{ pid: 123, parent: 1, startedAt }]); await Promise.all([check, closed]); expect(observed).not.toHaveBeenCalled();
  const other = new ExternalActivity(path.join(directory, 'other'), () => [], async () => {}, () => {}); monitors.push(other);
  await Promise.all([other.configure(true), other.configure(false), other.configure(true)]); expect(other.view().enabled).toBe(true);
});
it('persists external recency once per new activity while keeping runtime and pins separate', async () => {
  const directory = await fixture(); await packageFile(path.join(directory, 'projects', 'app'), { name: 'app', scripts: { dev: 'node server.cjs' } });
  const persistence = new Persistence(path.join(directory, 'data'));
  const liveNow = Date.now(), liveSeen = new Date(liveNow).toISOString();
  const service = new AppService(persistence, () => {}, { activityDirectory: path.join(directory, 'activity'), activityOptions: { now: () => liveNow, processes: async () => [{ pid: 123, parent: 1, startedAt }], managerPid: 999 } }); services.push(service);
  await service.initialize(); await service.addRoot(path.join(directory, 'projects')); const app = service.snapshot().projects[0]!; await service.setPinned(app.id, true);
  await writeFile(path.join(service.externalActivity!.reportsDirectory, session + '.json'), JSON.stringify(report({ seenAt: liveSeen, folders: [{ path: path.join(app.path, 'src'), activityAt: liveSeen }] })));
  await service.externalActivity!.refresh(); const updated = service.snapshot().projects[0]!;
  expect(updated).toMatchObject({ pinned: true, status: 'stopped', lastActiveAt: liveSeen, lastActivitySource: 'vscode', external: [{ source: 'vscode', state: 'open' }] });
  const revision = service.configurationRevision(); await service.externalActivity!.refresh(); expect(service.configurationRevision()).toBe(revision);
  await service.updateSettings({ discovery: { externalActivity: false } }); expect(service.snapshot().projects[0]!.external).toEqual([]); expect(service.snapshot().projects[0]!.lastActiveAt).toBe(liveSeen);
  const restored = new AppService(persistence, () => {}); services.push(restored); await restored.initialize(); expect(restored.snapshot().projects[0]).toMatchObject({ pinned: true, lastActiveAt: liveSeen, status: 'stopped', external: [] });
});
it('keeps old portable settings compatible with the new discovery preference', () => {
  const legacy = defaultSettings(); const discovery: Partial<typeof legacy.discovery> = { ...legacy.discovery }; delete discovery.externalActivity;
  expect(readSettings({ ...legacy, discovery }).settings.discovery.externalActivity).toBe(true);
});
it('merges agent hooks idempotently without changing unrelated handlers or settings', () => {
  const initial = { model: 'existing', hooks: { Stop: [{ matcher: 'custom', hooks: [{ type: 'command', command: 'keep-me' }, { type: 'command', command: 'node old/devdock-activity-hook.cjs' }] }], CustomEvent: [{ value: 'keep' }] } };
  const once = mergeActivityHooks(initial, 'node new/devdock-activity-hook.cjs');
  expect(mergeActivityHooks(once, 'node new/devdock-activity-hook.cjs')).toEqual(once);
  expect(once).toMatchObject({ model: 'existing', hooks: { CustomEvent: [{ value: 'keep' }] } });
  expect((once.hooks as typeof initial.hooks).Stop[0]).toEqual({ matcher: 'custom', hooks: [{ type: 'command', command: 'keep-me' }] });
  expect(initial.hooks.Stop[0]!.hooks).toHaveLength(2);
  const execForm = mergeActivityHooks({}, 'node.exe', ['devdock-activity-hook.cjs', 'claude']); expect(mergeActivityHooks(execForm, 'node.exe', ['devdock-activity-hook.cjs', 'claude'])).toEqual(execForm);
});
it('installs isolated hook/profile integrations with recoverable originals and refuses malformed existing configuration', async () => {
  const directory = await fixture(), options = { directory: path.join(directory, 'activity'), assets: path.resolve('integrations/activity'), home: path.join(directory, 'home'), documents: path.join(directory, 'documents'), node: process.execPath };
  const settings = path.join(options.home, '.claude/settings.json'); await mkdir(path.dirname(settings), { recursive: true });
  const original = JSON.stringify({ permissions: { allow: ['keep'] } }); await writeFile(settings, original);
  await setupActivity('claude', options); await setupActivity('claude', options);
  expect(JSON.parse(await readFile(settings, 'utf8')).permissions).toEqual({ allow: ['keep'] });
  const backups = (await readdir(path.dirname(settings))).filter((name) => name.endsWith('.bak')); expect(backups.length).toBe(2); expect(await readFile(path.join(path.dirname(settings), backups[0]!), 'utf8')).toBe(original);
  await setupActivity('codex', options); const codex = JSON.parse(await readFile(path.join(options.home, '.codex/hooks.json'), 'utf8')); expect(codex.hooks.SessionEnd[0].hooks[0].command).toContain(' codex ');
  const profile = path.join(options.documents, 'PowerShell/Microsoft.PowerShell_profile.ps1'); await mkdir(path.dirname(profile), { recursive: true }); await writeFile(profile, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('function prompt { "Existing 漢字" }', 'utf16le')]));
  await setupActivity('terminal', options); const first = await readFile(profile, 'utf8'); expect(first).toContain('Existing 漢字'); expect(first.startsWith('\ufeff')).toBe(true); await setupActivity('terminal', options); expect(await readFile(profile, 'utf8')).toBe(first);
  expect(mergeTerminalProfile('function prompt { "custom" }', 'C:\\quoted\'folder\\helper.ps1', options.directory)).toContain('function prompt { "custom" }');
  await writeFile(settings, 'invalid'); await expect(setupActivity('claude', options)).rejects.toThrow('not changed'); expect(await readFile(settings, 'utf8')).toBe('invalid');
});
it('builds a local VSIX and the hook reporter drops private payloads and closes sessions without inflating activity', async () => {
  const directory = await fixture(), options = { directory: path.join(directory, 'activity'), assets: path.resolve('integrations/activity'), home: directory, documents: directory, node: process.execPath };
  await mkdir(path.join(options.directory, 'reports'), { recursive: true }); await writeFile(path.join(options.directory, 'policy.json'), JSON.stringify({ version: 1, enabled: true }));
  const extension = await buildActivityExtension(options); const archive = await readFile(extension); expect(archive.readUInt32LE(0)).toBe(0x04034b50); expect(archive.includes(Buffer.from('extension/package.json'))).toBe(true);
  const helper = path.resolve('integrations/activity/devdock-activity-hook.cjs');
  const invoke = async (event: string) => {
    const input = JSON.stringify({ cwd: directory, session_id: 'isolated', hook_event_name: event, prompt: 'PRIVATE_PROMPT', tool_response: 'PRIVATE_TOOL_RESPONSE' });
    const child = run(process.execPath, [helper, 'codex', options.directory], { timeout: 6000 }); child.child.stdin!.end(input); const result = await child; expect(result.stdout).toBe('');
    const file = (await readdir(path.join(options.directory, 'reports'))).find((name) => name.endsWith('.json'))!; return await readFile(path.join(options.directory, 'reports', file), 'utf8');
  };
  const opening = await invoke('SessionStart'); expect(opening).not.toContain('PRIVATE'); const activityAt = JSON.parse(opening).folders[0].activityAt;
  const ending = JSON.parse(await invoke('SessionEnd')); expect(ending.state).toBe('closed'); expect(ending.folders[0].activityAt).toBe(activityAt);
});
it('locates both conventional and versioned VS Code layouts without accepting arbitrary wrapper paths', async () => {
  const directory = await fixture(), conventional = path.join(directory, 'old'), versioned = path.join(directory, 'new');
  for (const installation of [conventional, versioned]) { await mkdir(path.join(installation, 'bin'), { recursive: true }); await writeFile(path.join(installation, 'Code.exe'), 'fixture'); }
  const oldCli = path.join(conventional, 'resources/app/out/cli.js'), newCli = path.join(versioned, '07f806f999/resources/app/out/cli.js');
  for (const cli of [oldCli, newCli]) { await mkdir(path.dirname(cli), { recursive: true }); await writeFile(cli, 'fixture'); }
  await writeFile(path.join(versioned, 'bin/code.cmd'), '"%~dp0..\\Code.exe" "%~dp0..\\07f806f999\\resources\\app\\out\\cli.js" %*');
  expect((await findVSCode([conventional]))?.cli).toBe(oldCli); expect((await findVSCode([versioned]))?.cli).toBe(newCli);
  await writeFile(path.join(versioned, 'bin/code.cmd'), '"%~dp0..\\Code.exe" "%~dp0..\\..\\07f806f999\\resources\\app\\out\\cli.js" %*');
  expect(await findVSCode([versioned])).toBeUndefined();
  const outside = path.join(directory, 'resources/app/out/cli.js'); await mkdir(path.dirname(outside), { recursive: true }); await writeFile(outside, 'fixture');
  await writeFile(path.join(versioned, 'bin/code.cmd'), '"%~dp0..\\Code.exe" "%~dp0..\\..\\resources\\app\\out\\cli.js" %*'); expect(await findVSCode([versioned])).toBeUndefined();
});
