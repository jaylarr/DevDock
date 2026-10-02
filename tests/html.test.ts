import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { request } from 'node:http';
import { scanProjects } from '../src/main/services/projectScanner';
import { AppService } from '../src/main/services/appService';
import { Persistence, emptyState } from '../src/main/services/persistence';
import { ProcessManager } from '../src/main/services/processManager';
import { LogManager } from '../src/main/services/logManager';
import { projectId, slug } from '../src/main/services/identity';
import type { ProjectMetadata } from '../src/shared/contracts';
import { dispose, eventually, fixtureDirectory, packageFile, root } from './helpers';

const fixtures: string[] = [];
const managers: ProcessManager[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const manager of managers.splice(0)) await manager.stopAll();
  for (const directory of fixtures.splice(0)) await dispose(directory);
});
async function directory() { const value = await fixtureDirectory(); fixtures.push(value); return value; }
async function html(folder: string, file = 'index.html') { await mkdir(folder, { recursive: true }); await writeFile(path.join(folder, file), '<h1>Static fixture</h1>'); }
async function fixture(entry = 'landing page.html') {
  const folder = await directory(); await html(folder, entry);
  const project = (await scanProjects([root(folder)])).projects[0]!;
  const manager = new ProcessManager(new LogManager(() => {}), () => {}); managers.push(manager);
  return { folder, project, manager };
}
async function rawRequest(origin: string, target: string, method = 'GET', host?: string): Promise<{ status: number; text: string; type: string; location?: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(origin);
    const req = request({ hostname: url.hostname, port: url.port, path: target, method, headers: host ? { Host: host } : undefined }, (res) => {
      let text = ''; res.setEncoding('utf8'); res.on('data', (part) => { text += part; });
      res.on('end', () => resolve({ status: res.statusCode!, text, type: String(res.headers['content-type'] ?? ''), location: res.headers.location }));
    });
    req.on('error', reject); req.end();
  });
}

describe('HTML discovery and ownership', () => {
  it('groups nested pages, selects index case-insensitively, and deduplicates overlapping roots', async () => {
    const folder = await directory(); await html(path.join(folder, 'site'), 'INDEX.HTML'); await html(path.join(folder, 'site/pages/about'));
    const result = await scanProjects([root(folder), root(path.join(folder, 'site'))]);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({ kind: 'static', entryFile: 'INDEX.HTML', framework: 'Static HTML' });
    expect(result.projects[0]?.manager).toBeUndefined();
    expect(result.checkedRoots).toHaveLength(2);
  });
  it('discovers sibling sites and makes a deterministic non-index selection', async () => {
    const folder = await directory(); await html(path.join(folder, 'a'), 'z.htm'); await html(path.join(folder, 'a'), 'a.html'); await html(path.join(folder, 'b'));
    const result = await scanProjects([root(folder)]);
    expect(result.projects).toHaveLength(2); expect(result.projects.find((item) => item.name === 'a')?.entryFile).toBe('a.html');
  });
  it('accepts a plain website with a client-side app.js file', async () => {
    const folder = await directory(); await html(folder); await writeFile(path.join(folder, 'app.js'), 'document.title = "Static site";');
    expect((await scanProjects([root(folder)])).projects[0]?.kind).toBe('static');
  });
  it.each([
    { scripts: { dev: 'vite' } },
    { scripts: { dev: 'next dev' }, dependencies: { next: '1' } },
    { scripts: { dev: 'node server.js' } },
    { scripts: { dev: 'vite' }, packageManager: 'yarn@4' },
    { dependencies: { react: '1' } },
    { scripts: { start: 'node server.js' } },
  ])('application evidence always wins over HTML: %j', async (pkg) => {
    const folder = await directory(); await packageFile(folder, pkg); await html(folder); await html(path.join(folder, 'public'));
    const results = await Promise.all([scanProjects([root(folder), root(path.join(folder, 'public'))]), scanProjects([root(path.join(folder, 'public')), root(folder)])]);
    for (const result of results) expect(result.projects.filter((item) => item.kind === 'static')).toEqual([]);
  });
  it('allows a formatting-only manifest but blocks malformed manifests and framework configs', async () => {
    const folder = await directory();
    await packageFile(path.join(folder, 'formatted'), { scripts: { format: 'prettier .' }, devDependencies: { prettier: '1' } }); await html(path.join(folder, 'formatted'));
    await html(path.join(folder, 'broken')); await writeFile(path.join(folder, 'broken/package.json'), '{');
    await html(path.join(folder, 'configured')); await writeFile(path.join(folder, 'configured/vite.config.ts'), '');
    const result = await scanProjects([root(folder)]);
    expect(result.projects.map((item) => item.name)).toEqual(['formatted']); expect(result.diagnostics).toHaveLength(2);
  });
  it('skips conventional static subtrees, exclusions, and generated output but allows explicit standalone docs', async () => {
    const folder = await directory();
    for (const name of ['docs', 'examples', 'public', 'assets', 'dist', 'excluded', 'visible']) await html(path.join(folder, name));
    expect((await scanProjects([root(folder)], undefined, [path.join(folder, 'excluded')])).projects.map((item) => item.name)).toEqual(['visible']);
    expect((await scanProjects([root(folder), root(path.join(folder, 'docs'))], undefined, [path.join(folder, 'excluded')])).projects.map((item) => item.name).sort()).toEqual(['docs', 'visible']);
  });
  it('does not turn an HTML container with a nested app into a static server', async () => {
    const folder = await directory(); await html(folder); await packageFile(path.join(folder, 'app'), { scripts: { dev: 'vite' } });
    const result = await scanProjects([root(folder)]);
    expect(result.projects).toHaveLength(1); expect(result.projects[0]?.kind).toBe('script'); expect(result.diagnostics.join(' ')).toContain('contains an application');
  });
  it('keeps explicitly selected nested static roots separate', async () => {
    const folder = await directory(); await html(folder); await html(path.join(folder, 'nested'));
    expect((await scanProjects([root(folder), root(path.join(folder, 'nested'))])).projects).toHaveLength(2);
  });
  it('does not expose an app public folder when selected without the parent root', async () => {
    const folder = await directory(); await packageFile(folder, { dependencies: { next: '1' } }); await html(path.join(folder, 'public'));
    const result = await scanProjects([root(path.join(folder, 'public'))]);
    expect(result.projects).toEqual([]); expect(result.diagnostics.join(' ')).toContain('belongs to an application');
  });
  it('retains the previous project list contract on cancelled HTML scans', async () => {
    const folder = await directory(); await html(folder); const controller = new AbortController(); controller.abort();
    const result = await scanProjects([root(folder)], controller.signal); expect(result.cancelled).toBe(true); expect(result.projects).toEqual([]);
  });
});

describe('saved state and reclassification', () => {
  it('migrates v1 projects and preserves a separate v1 rollback backup and empty exclusions', async () => {
    const folder = await directory(); const owner = root(folder);
    const legacy = { version: 1, roots: [owner], projects: [{ id: projectId(folder), name: 'old', path: folder, rootId: owner.id, slug: slug('old', folder), devScript: 'vite', manager: 'npm', framework: 'Vite', missing: false }], exclusions: [], theme: 'dark' };
    const persistence = new Persistence(folder); await writeFile(persistence.file, JSON.stringify(legacy));
    const loaded = await persistence.load(); expect(loaded.state.version).toBe(2); expect(loaded.state.projects[0]?.kind).toBe('script'); expect(loaded.state.exclusions).toEqual([]);
    await persistence.save(loaded.state); await persistence.save({ ...loaded.state, theme: 'light' });
    expect(JSON.parse(await readFile(`${persistence.file}.v1.bak`, 'utf8'))).toEqual(legacy);
    expect((await persistence.load()).state.theme).toBe('light');
  });
  it.each(['../secret.html', 'C:\\secret.html', '.secret.html', 'index.html:stream', 'index.js'])('rejects unsafe persisted entry %s', async (entryFile) => {
    const folder = await directory(); const owner = root(folder); const persistence = new Persistence(folder);
    const project = { id: projectId(folder), name: 'site', path: folder, rootId: owner.id, slug: slug('site', folder), kind: 'static', framework: 'Static HTML', entryFile, missing: false };
    await writeFile(persistence.file, JSON.stringify({ ...emptyState(), roots: [owner], projects: [project] }));
    expect((await persistence.load()).warning).toContain('could not be read');
  });
  it('blocks a stale HTML launch and adopts script mode on rescan with the same ID', async () => {
    const folder = await directory(); const site = path.join(folder, 'site'); await html(site);
    const service = new AppService(new Persistence(path.join(folder, 'state')), () => {}); await service.initialize(); await service.addRoot(site);
    const project = service.snapshot().projects[0]!;
    await packageFile(site, { scripts: { dev: 'vite' } });
    await expect(service.start(project.id)).rejects.toThrow('detection changed');
    await service.scan(); expect(service.snapshot().projects[0]).toMatchObject({ id: project.id, kind: 'script' });
  });
  it('removes superseded static descendants instead of leaving them startable in the cache', async () => {
    const folder = await directory(); await html(path.join(folder, 'site'));
    const service = new AppService(new Persistence(path.join(folder, 'state')), () => {}); await service.initialize(); await service.addRoot(folder);
    await packageFile(folder, { scripts: { dev: 'vite' } }); await service.scan();
    expect(service.snapshot().projects).toHaveLength(1); expect(service.snapshot().projects[0]?.kind).toBe('script');
  });
  it('preserves a recovered v1 backup before writing v2 state', async () => {
    const folder = await directory(); const persistence = new Persistence(folder);
    const legacy = { version: 1, roots: [], projects: [], exclusions: [], theme: 'dark' };
    await writeFile(persistence.file, 'broken'); await writeFile(`${persistence.file}.bak`, JSON.stringify(legacy));
    const loaded = await persistence.load(); expect(loaded.warning).toContain('Recovered'); await persistence.save(loaded.state);
    expect(JSON.parse(await readFile(`${persistence.file}.v1.bak`, 'utf8'))).toEqual(legacy);
  });
  it('reserves the runtime during validation so root removal cannot orphan a pending start', async () => {
    const folder = await directory(); await html(folder); const service = new AppService(new Persistence(path.join(folder, 'state')), () => {});
    await service.initialize(); await service.addRoot(folder); const project = service.snapshot().projects[0]!;
    const realStart = service.processes.start.bind(service.processes);
    let finish!: () => void;
    vi.spyOn(service.processes, 'start').mockImplementation((item) => realStart(item, () => new Promise<void>((_resolve, reject) => { finish = () => reject(new Error('Cancelled fixture validation')); })));
    const starting = service.start(project.id); const rejected = expect(starting).rejects.toThrow('Cancelled fixture validation');
    expect(service.snapshot().projects[0]?.managed).toBe(true);
    await expect(service.removeRoot(root(folder).id)).rejects.toThrow('Stop this root'); finish(); await rejected;
  });
});

describe('real managed static HTTP server', () => {
  it('serves a non-index entry, assets, HEAD and nested indexes; rejects unsafe requests; stops and restarts', async () => {
    const { folder, project, manager } = await fixture();
    await writeFile(path.join(folder, 'style.css'), 'body { color: red; }'); await writeFile(path.join(folder, 'main.js'), 'console.log(1)');
    await html(path.join(folder, 'pages')); await mkdir(path.join(folder, 'empty'));
    await writeFile(path.join(folder, '.env'), 'PRIVATE'); await writeFile(path.join(folder, 'secrets.json'), 'PRIVATE'); await writeFile(path.join(folder, 'config.json'), 'PRIVATE');
    await packageFile(folder, { scripts: { format: 'prettier .' } });
    await manager.start(project); await expect(manager.start(project)).rejects.toThrow('already');
    await eventually(() => manager.view(project).status === 'running');
    const url = manager.view(project).localUrl!; const origin = new URL(url).origin;
    expect(url).toContain('/landing%20page.html'); expect(await (await fetch(url)).text()).toContain('Static fixture');
    expect((await rawRequest(origin, '/style.css?v=1')).type).toContain('text/css'); expect((await rawRequest(origin, '/main.js')).type).toContain('text/javascript');
    expect(await rawRequest(origin, '/landing%20page.html', 'HEAD')).toMatchObject({ status: 200, text: '' });
    expect(await rawRequest(origin, '/')).toMatchObject({ status: 200 }); expect(await rawRequest(origin, '/pages')).toMatchObject({ status: 308, location: '/pages/' });
    expect(await rawRequest(origin, '/pages/')).toMatchObject({ status: 200 });
    for (const target of ['/missing.html', '/empty/']) expect((await rawRequest(origin, target)).status).toBe(404);
    expect((await rawRequest(origin, '/', 'POST')).status).toBe(405);
    for (const target of ['/../outside.html', '/%2e%2e/outside.html', '/%2e%2e%2foutside.html', '/.env', '/package.json', '/secrets.json', '/config.json', '/tsconfig.json', '/index.html:stream']) expect((await rawRequest(origin, target)).status).toBe(403);
    for (const target of ['/bad%ZZ', '/%00', '/%5c..%5coutside.html']) expect((await rawRequest(origin, target)).status).toBe(400);
    expect((await rawRequest(origin, '/', 'GET', 'evil.example')).status).toBe(403);
    expect(manager.logs.get(project.id).some((line) => line.text.includes('Starting Static HTML'))).toBe(true);
    await manager.stop(project.id); await expect(fetch(url)).rejects.toThrow();
    await manager.start(project); await eventually(() => manager.view(project).status === 'running');
    expect(await (await fetch(manager.view(project).localUrl!)).text()).toContain('Static fixture');
  });
  it('refuses a symlink escape and newly added application subtrees', async () => {
    const { folder, project, manager } = await fixture(); const outside = await directory(); await html(outside);
    await symlink(outside, path.join(folder, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await manager.start(project); await eventually(() => manager.view(project).status === 'running'); const origin = new URL(manager.view(project).localUrl!).origin;
    expect((await rawRequest(origin, '/linked/index.html')).status).toBe(403);
    await packageFile(path.join(folder, 'new-app'), { scripts: { dev: 'vite' } }); await html(path.join(folder, 'new-app'));
    expect((await rawRequest(origin, '/new-app/index.html')).status).toBe(403);
    await packageFile(folder, { dependencies: { react: '1' } }); expect((await rawRequest(origin, '/landing%20page.html')).status).toBe(403);
  });
  it('uses separate actual ports for sibling sites and closes both on quit', async () => {
    const first = await fixture(); const second = await fixture();
    await Promise.all([first.manager.start(first.project), second.manager.start(second.project)]);
    await eventually(() => first.manager.view(first.project).status === 'running' && second.manager.view(second.project).status === 'running');
    const urls = [first.manager.view(first.project).localUrl!, second.manager.view(second.project).localUrl!]; expect(new URL(urls[0]!).port).not.toBe(new URL(urls[1]!).port);
    await Promise.all([first.manager.stopAll(), second.manager.stopAll()]);
    for (const url of urls) await expect(fetch(url)).rejects.toThrow();
  });
  it('blocks nested duplicate servers even while a start is pending', async () => {
    const { project, manager } = await fixture(); const nested = { ...project, id: projectId(path.join(project.path, 'nested')), path: path.join(project.path, 'nested') } as ProjectMetadata;
    const starting = manager.start(project); await expect(manager.start(nested)).rejects.toThrow('overlapping'); await starting;
    await expect(manager.start(nested)).rejects.toThrow('overlapping');
  });
  it('keeps active metadata through reclassification and adopts script mode after Stop', async () => {
    const folder = await directory(); const site = path.join(folder, 'site'); await html(site);
    const service = new AppService(new Persistence(path.join(folder, 'state')), () => {}); managers.push(service.processes);
    await service.initialize(); await service.addRoot(site); const project = service.snapshot().projects[0]!;
    await service.start(project.id); await eventually(() => service.snapshot().projects[0]?.status === 'running');
    await packageFile(site, { scripts: { dev: 'vite' } }); await service.scan();
    expect(service.snapshot().projects[0]).toMatchObject({ kind: 'static', managed: true, missing: true });
    await service.stop(project.id); expect(service.snapshot().projects[0]).toMatchObject({ kind: 'script', status: 'stopped', missing: false });
  });
});
