import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { AppService } from '../src/main/services/appService';
import { emptyState, Persistence, UnsupportedState } from '../src/main/services/persistence';
import { defaultSettings, patchSettings, filterString } from '../src/shared/settings';
import { exportPortable, SettingsTransfer, validatePortable, readPortableFile, writePortableFile } from '../src/main/services/settingsTransfer';
import { LocalDiagnostics, versionCommand } from '../src/main/services/diagnostics';
import { dispose, fixtureDirectory, packageFile, root, eventually } from './helpers';

const directories: string[] = []; const services: AppService[] = [];
const provider = { availability: async () => ({ available: false, error: 'private C:\\Sensitive\\Name' }), start: async () => { throw new Error('No real tunnels in settings tests.'); } };
async function fixture(openLocal?: (url: string) => Promise<void>) {
  const directory = await fixtureDirectory(); directories.push(directory);
  const persistence = new Persistence(path.join(directory, 'state'));
  const service = new AppService(persistence, () => {}, { provider, openLocal }); await service.initialize(); services.push(service);
  return { directory, persistence, service };
}
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const service of services.splice(0)) await service.close(); for (const directory of directories.splice(0)) await dispose(directory); });

describe('settings and state commits', () => {
  it.each([
    { appearance: { theme: 'pink' } }, { appearance: { pageSize: '10' } }, { appearance: { pageSize: 100 } },
    { appearance: { density: 'tiny' } }, { discovery: { scanOnLaunch: 1 } }, { behavior: { autoOpenBrowser: 'true' } },
    { behavior: { command: 'exec' } }, { unexpected: {} }, { appearance: null },
  ])('rejects malformed settings %j', (patch) => { expect(() => patchSettings(defaultSettings(), patch)).toThrow(); });
  it('does not publish failed settings and serializes different preferences without losing either', async () => {
    const { service, persistence } = await fixture();
    vi.spyOn(persistence, 'save').mockRejectedValueOnce(new Error('disk full'));
    await expect(service.updateSettings({ appearance: { theme: 'dark' } })).rejects.toThrow('disk full');
    expect(service.snapshot().settings.appearance.theme).toBe('system');
    await Promise.all([service.updateSettings({ appearance: { pageSize: 20 } }), service.updateSettings({ behavior: { logAutoScroll: false } })]);
    expect((await persistence.load()).state.settings).toMatchObject({ appearance: { theme: 'system', pageSize: 20 }, behavior: { logAutoScroll: false } });
  });
  it('preserves a preference saved while discovery is running', async () => {
    const { service, directory, persistence } = await fixture();
    await packageFile(path.join(directory, 'project'), { scripts: { dev: 'node server.cjs' } }); await service.addRoot(directory);
    const scan = service.scan(); const saved = service.updateSettings({ appearance: { density: 'compact' } }); await Promise.all([scan, saved]);
    expect((await persistence.load()).state.settings.appearance.density).toBe('compact'); expect(service.snapshot().projects).toHaveLength(1);
  });
  it('restores typed filters, normalizes removed roots, and resets preferences without dropping registration', async () => {
    const { service, persistence, directory } = await fixture(); await service.addRoot(directory);
    await service.updateSettings({ behavior: { rememberLastFilter: true }, discovery: { scanOnLaunch: false } });
    await service.rememberFilter(root(directory).id); expect(filterString((await persistence.load()).state.view.lastFilter)).toBe(root(directory).id);
    await service.removeRoot(root(directory).id); expect(filterString(service.saved().view.lastFilter)).toBe('all');
    await service.addRoot(directory); await service.resetPreferences(); expect(service.saved().settings).toEqual(defaultSettings()); expect(service.saved().roots).toHaveLength(1);
  });
  it('blocks cache clear for pending managed resources and keeps files when clearing', async () => {
    const { service, directory } = await fixture(); const project = path.join(directory, 'project');
    await packageFile(project, { scripts: { dev: 'node server.cjs' } }); await service.addRoot(directory);
    const managed = vi.spyOn(service.processes, 'isManaged').mockReturnValue(true);
    await expect(service.clearCache()).rejects.toThrow('Stop managed'); expect(service.saved().projects).toHaveLength(1);
    managed.mockReturnValue(false); await service.clearCache(); expect(service.saved().projects).toEqual([]); expect(service.saved().roots).toHaveLength(1);
    expect(await readFile(path.join(project, 'package.json'), 'utf8')).toContain('dev'); await service.scan(); expect(service.saved().projects).toHaveLength(1);
  });
  it('prevents a launch entering during a catalog-replacement save', async () => {
    const { service, persistence, directory } = await fixture(); await packageFile(directory, { scripts: { dev: 'node server.cjs' } }); await service.addRoot(directory);
    let release!: () => void; const original = persistence.save.bind(persistence);
    vi.spyOn(persistence, 'save').mockImplementationOnce(async (state) => { await new Promise<void>((resolve) => { release = resolve; }); await original(state); });
    const clearing = service.clearCache(); await eventually(() => !!release);
    await expect(service.start(service.saved().projects[0]!.id)).rejects.toThrow('catalog change'); release(); await clearing;
  });
  it('atomically enables remembered filters and leaves both fields unchanged on save failure', async () => {
    const { service, persistence } = await fixture(); vi.spyOn(persistence, 'save').mockRejectedValueOnce(new Error('disk full'));
    await expect(service.updateSettings({ behavior: { rememberLastFilter: true } }, 'stopped')).rejects.toThrow('disk full');
    expect(service.saved().settings.behavior.rememberLastFilter).toBe(false); expect(filterString(service.saved().view.lastFilter)).toBe('all');
    await service.updateSettings({ behavior: { rememberLastFilter: true } }, 'stopped'); expect(filterString((await persistence.load()).state.view.lastFilter)).toBe('stopped');
  });
});

describe('migration and compatibility', () => {
  it('migrates v2 static metadata, saves before initialization, and keeps a write-once legacy backup', async () => {
    const { directory, persistence } = await fixture(); const owner = root(directory);
    await mkdir(path.dirname(persistence.file), { recursive: true });
    const legacy = { version: 2, roots: [owner], projects: [{ id: owner.id, name: 'fictional site', path: directory, rootId: owner.id, slug: 'site', missing: false, kind: 'static', framework: 'Static HTML', entryFile: 'landing page.html' }], theme: 'midnight', exclusions: [path.join(directory, 'private')] };
    await writeFile(persistence.file, JSON.stringify(legacy));
    const service = new AppService(persistence, () => {}, { provider }); await service.initialize(); services.push(service);
    expect(service.saved()).toMatchObject({ version: 3, settings: { appearance: { theme: 'midnight' } }, exclusions: legacy.exclusions });
    expect(service.saved().projects[0]).toMatchObject({ kind: 'static', entryFile: 'landing page.html' });
    expect(JSON.parse(await readFile(`${persistence.file}.v2.bak`, 'utf8'))).toEqual(legacy);
    await service.updateSettings({ appearance: { theme: 'sepia' } }); expect(JSON.parse(await readFile(`${persistence.file}.v2.bak`, 'utf8'))).toEqual(legacy);
  });
  it('repairs a damaged optional preference without losing folders or valid preferences', async () => {
    const { directory, persistence } = await fixture(); await mkdir(path.dirname(persistence.file), { recursive: true });
    const state = { ...emptyState(), roots: [root(directory)] }; state.settings.appearance.theme = 'dark';
    await writeFile(persistence.file, JSON.stringify({ ...state, settings: { ...state.settings, appearance: { ...state.settings.appearance, pageSize: 'bad' } } }));
    const loaded = await persistence.load(); expect(loaded.warning).toContain('defaults'); expect(loaded.state.roots).toHaveLength(1);
    expect(loaded.state.settings.appearance).toMatchObject({ theme: 'dark', pageSize: 10 });
  });
  it('refuses future state without falling back to a backup or overwriting the primary', async () => {
    const { persistence } = await fixture(); await persistence.save(emptyState());
    const future = JSON.stringify({ version: 99, private: 'retain' }); await writeFile(persistence.file, future);
    await expect(persistence.load()).rejects.toBeInstanceOf(UnsupportedState); await expect(persistence.save(emptyState())).rejects.toBeInstanceOf(UnsupportedState);
    expect(await readFile(persistence.file, 'utf8')).toBe(future);
    // Remove the future primary only inside this isolated fixture so normal cleanup can finish.
    await writeFile(persistence.file, JSON.stringify(emptyState()));
  });
  it('recovers a missing primary from backup and refuses a future backup when primary is absent', async () => {
    const { persistence } = await fixture(); await persistence.save(emptyState()); await persistence.save(emptyState()); await unlink(persistence.file);
    expect((await persistence.load()).warning).toContain('Recovered');
    const future = JSON.stringify({ version: 4 }); await writeFile(`${persistence.file}.bak`, future);
    await expect(persistence.load()).rejects.toBeInstanceOf(UnsupportedState); expect(await readFile(`${persistence.file}.bak`, 'utf8')).toBe(future);
  });
});

describe('portable settings transfer', () => {
  it('exports preferences only by default, excluding catalog, logs, URLs and root filter identities', async () => {
    const { service, directory } = await fixture(); await service.addRoot(directory); await service.updateSettings({ behavior: { rememberLastFilter: true } }); await service.rememberFilter(root(directory).id);
    const exported = exportPortable(service.saved(), false); const text = JSON.stringify(exported);
    expect(exported.discovery).toBeUndefined(); expect(exported.rememberedFilter).toEqual({ kind: 'status', value: 'all' });
    for (const privateValue of [directory, root(directory).id, 'projects', 'devScript', 'localUrl', 'logs']) expect(text).not.toContain(privateValue);
    expect(validatePortable(exported)).toEqual(exported);
  });
  it.each([
    { version: 2 }, { settings: { appearance: {} } }, { discovery: { roots: [{ path: '\\\\server\\share' }], exclusions: [] } },
    { discovery: { roots: [{ path: 'relative' }], exclusions: [] } }, { discovery: { roots: [{ path: 'C:\\ok', command: 'run' }], exclusions: [] } },
    { rememberedFilter: { kind: 'root', path: 'C:\\absent' } }, { command: 'run' },
  ])('rejects unsafe or malformed imports %j', (change) => { expect(() => validatePortable({ ...exportPortable(emptyState(), false), ...change })).toThrow(); });
  it('reviews immutable drafts, refuses stale or cancelled previews, and requires stopped resources for folder replacement', async () => {
    const { service, directory } = await fixture(); await packageFile(directory, { scripts: { dev: 'node server.cjs' } }); await service.addRoot(directory);
    const transfer = new SettingsTransfer(service); const file = path.join(directory, 'export.json'); const exported = transfer.export(true); exported.settings.appearance.theme = 'dark';
    await writePortableFile(file, exported); let preview = await transfer.preview(file);
    expect(preview.discovery).toMatchObject({ added: 0, removed: 0, cached: 1 }); expect(preview.settings.appearance.theme).toBe('dark');
    await service.updateSettings({ appearance: { pageSize: 20 } }); await expect(transfer.apply(preview.token, false)).rejects.toThrow('changed');
    preview = await transfer.preview(file); transfer.cancel(preview.token); await expect(transfer.apply(preview.token, false)).rejects.toThrow('expired');
    preview = await transfer.preview(file); const managed = vi.spyOn(service.processes, 'isManaged').mockReturnValue(true);
    await expect(transfer.apply(preview.token, true)).rejects.toThrow('Stop managed'); expect(service.saved().projects).toHaveLength(1);
    await transfer.apply(preview.token, false); expect(service.saved().settings.appearance.theme).toBe('dark'); expect(service.saved().projects).toHaveLength(1);
    managed.mockReturnValue(false); preview = await transfer.preview(file); await transfer.apply(preview.token, true);
    expect(service.saved().roots).toHaveLength(1); expect(service.saved().projects).toEqual([]); expect(filterString(service.saved().view.lastFilter)).toBe('all');
  });
  it('retains unavailable imported local folders and rejects oversized files and invalid JSON', async () => {
    const { service, directory } = await fixture(); const transfer = new SettingsTransfer(service); const filename = path.join(directory, 'export.json');
    const exported = transfer.export(false); exported.discovery = { roots: [{ path: path.join(directory, 'not-created') }], exclusions: [] };
    await writePortableFile(filename, exported); const preview = await transfer.preview(filename); expect(preview.discovery?.roots[0]?.available).toBe(false);
    await transfer.apply(preview.token, true); expect(service.saved().roots[0]?.path).toContain('not-created');
    await writeFile(filename, 'x'.repeat(1024 * 1024 + 1)); await expect(readPortableFile(filename)).rejects.toThrow('1 MiB');
    await writeFile(filename, '{'); await expect(readPortableFile(filename)).rejects.toThrow('JSON');
  });
  it('expires previews and retains committed settings when an import save fails', async () => {
    const { service, persistence, directory } = await fixture(); const transfer = new SettingsTransfer(service); const file = path.join(directory, 'settings.json');
    const exported = transfer.export(false); exported.settings.appearance.theme = 'matrix'; await writePortableFile(file, exported);
    let preview = await transfer.preview(file); const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300001);
    await expect(transfer.apply(preview.token, false)).rejects.toThrow('expired'); clock.mockRestore(); preview = await transfer.preview(file);
    vi.spyOn(persistence, 'save').mockRejectedValueOnce(new Error('disk full')); await expect(transfer.apply(preview.token, false)).rejects.toThrow('disk full');
    expect(service.snapshot().settings.appearance.theme).toBe('system'); await transfer.apply(preview.token, false); expect(service.snapshot().settings.appearance.theme).toBe('matrix');
  });
});

describe('local diagnostics', () => {
  it('bounds and validates version output and sanitizes copied reports', async () => {
    expect(await versionCommand(process.execPath, ['--version'])).toMatchObject({ status: 'available' });
    expect(await versionCommand(process.execPath, ['-e', "console.log('private path')"])).toMatchObject({ status: 'unavailable', code: 'invalid_version' });
    expect(await versionCommand(process.execPath, ['-e', "console.log('x'.repeat(5000))"])).toMatchObject({ status: 'unavailable', code: 'output_limit' });
    const { service, directory } = await fixture(); await service.addRoot(directory);
    const diagnostics = new LocalDiagnostics(service, { version: '0.3.0', electron: '44.5.1' }); const report = await diagnostics.get();
    expect(report.report).toContain('Registered roots: 1'); expect(report.report).not.toContain(directory); expect(report.report).not.toContain('Sensitive');
    expect(diagnostics.reportText(report.reportId)).toBe(report.report); await diagnostics.get(); expect(() => diagnostics.reportText(report.reportId)).toThrow('changed');
  });
  it('caches runtime checks until requested refresh and handles absent runtimes and timeouts', async () => {
    const { service } = await fixture(); const diagnostics = new LocalDiagnostics(service, { version: '0.3.0', electron: '44.5.1' });
    expect((await diagnostics.get()).node.status).toBe('available'); vi.stubEnv('PATH', '');
    expect((await diagnostics.get()).node.status).toBe('available'); const refreshed = await diagnostics.get(true);
    expect(refreshed.node.status).toBe('unavailable'); expect(refreshed.npm.status).toBe('unavailable');
    expect(await versionCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])).toMatchObject({ status: 'unavailable' });
  });
});

it('opens only an opted-in verified launch once, preserves HTML entry URLs, and keeps browser failures separate from server status', async () => {
  const openLocal = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined); const { service, directory } = await fixture(openLocal);
  await writeFile(path.join(directory, 'landing page.html'), '<h1>Fictional fixture</h1>'); await service.addRoot(directory);
  const project = service.saved().projects[0]!;
  await service.start(project.id); await service.updateSettings({ behavior: { autoOpenBrowser: true } });
  await eventually(() => service.snapshot().projects[0]?.status === 'running').catch(() => { throw new Error(JSON.stringify({ project: service.snapshot().projects[0], logs: service.logs.get(project.id) })); }); expect(openLocal).not.toHaveBeenCalled();
  await service.restart(project.id); await eventually(() => openLocal.mock.calls.length === 1);
  expect(openLocal.mock.calls[0]?.[0]).toMatch(/\/landing%20page.html$/); expect(service.snapshot().projects[0]?.status).toBe('running');
  await service.scan(); expect(openLocal).toHaveBeenCalledTimes(1);
  openLocal.mockRejectedValueOnce(new Error('browser missing')); await service.restart(project.id);
  await eventually(() => openLocal.mock.calls.length === 2); expect(service.snapshot().projects[0]?.status).toBe('running');
  expect(service.logs.get(project.id).some((entry) => entry.text.includes('Use Open to retry'))).toBe(true);
});
