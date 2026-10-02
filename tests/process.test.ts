import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { ProcessManager, localOrigin } from '../src/main/services/processManager';
import { LogManager } from '../src/main/services/logManager';
import { descendsFrom } from '../src/main/services/processOwnership';
import { scanProjects } from '../src/main/services/projectScanner';
import type { ProjectMetadata } from '../src/shared/contracts';
import { fixtureDirectory, dispose, mockServer, root, eventually, packageFile } from './helpers';

const fixtures: string[] = [];
const managers: ProcessManager[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.stopAll();
  for (const directory of fixtures.splice(0)) await dispose(directory);
});
async function fixture(mode: Parameters<typeof mockServer>[1] = 'normal') {
  const directory = await fixtureDirectory(); fixtures.push(directory);
  await mockServer(directory, mode);
  const project = (await scanProjects([root(directory)])).projects[0]!;
  const logs = new LogManager(() => {});
  const manager = new ProcessManager(logs, () => {}, undefined, 800);
  managers.push(manager);
  return { directory, project, manager, logs };
}
async function unreachable(url: string): Promise<boolean> {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(500) }); await response.body?.cancel(); return false; } catch { return true; }
}
describe('real npm processes on the host operating system', () => {
  it('starts, captures Unicode logs, rejects duplicate starts, stops, and restarts without editing the manifest', async () => {
    const { directory, project, manager, logs } = await fixture();
    const original = await readFile(path.join(directory, 'package.json'), 'utf8');
    await manager.start(project);
    await expect(manager.start(project)).rejects.toThrow('already');
    await eventually(() => manager.view(project).status === 'running');
    const firstUrl = manager.view(project).localUrl!;
    expect(await (await fetch(firstUrl)).text()).toBe('fixture ready');
    expect(logs.get(project.id).some((line) => line.text.includes('café ✓'))).toBe(true);
    await manager.stop(project.id); expect(manager.view(project).status).toBe('stopped');
    await eventually(() => unreachable(firstUrl));
    await manager.start(project); await eventually(() => manager.view(project).status === 'running');
    expect(await readFile(path.join(directory, 'package.json'), 'utf8')).toBe(original);
  });
  it('detects failed startup and captures the failure output', async () => {
    const { project, manager, logs } = await fixture('crash');
    await manager.start(project);
    await eventually(() => manager.view(project).status === 'crashed');
    expect(manager.view(project).localUrl).toBeUndefined();
    expect(logs.get(project.id).some((entry) => entry.text.includes('Deliberate startup failure'))).toBe(true);
  });
  it('does not call a surviving worker a ready web server', async () => {
    const { project, manager } = await fixture('quiet');
    await manager.start(project);
    await eventually(() => manager.view(project).status === 'unverified');
    expect(manager.view(project).localUrl).toBeUndefined();
  });
  it('clears the unverified diagnostic when a slow server becomes ready', async () => {
    const { directory, project, manager } = await fixture();
    await writeFile(path.join(directory, 'server.cjs'), `const http = require('node:http'); const server = http.createServer((_req,res)=>res.end('late')); setTimeout(()=>server.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+server.address().port)),2000);`);
    await manager.start(project);
    await eventually(() => manager.view(project).status === 'unverified');
    await eventually(() => manager.view(project).status === 'running');
    expect(manager.view(project).error).toBeUndefined();
  });
  it('terminates a nested child server, not only its npm parent', async () => {
    const { project, manager, logs } = await fixture('tree');
    await manager.start(project); await eventually(() => manager.view(project).status === 'running');
    const url = manager.view(project).localUrl!;
    const line = logs.get(project.id).find((entry) => entry.text.startsWith('CHILD_PID='));
    expect(line).toBeDefined();
    const childPid = Number(line!.text.split('=')[1]);
    await manager.stop(project.id); await eventually(() => unreachable(url));
    expect(() => process.kill(childPid, 0)).toThrow();
  });
  it('runs two servers simultaneously and shutdown frees both ports', async () => {
    const first = await fixture(); const second = await fixture();
    await Promise.all([first.manager.start(first.project), second.manager.start(second.project)]);
    await eventually(() => first.manager.view(first.project).status === 'running' && second.manager.view(second.project).status === 'running');
    const urls = [first.manager.view(first.project).localUrl!, second.manager.view(second.project).localUrl!];
    expect(urls[0]).not.toBe(urls[1]);
    await Promise.all([first.manager.stopAll(), second.manager.stopAll()]);
    await eventually(async () => (await Promise.all(urls.map(unreachable))).every(Boolean));
  });
  it('starts a real Vite server with temporary port flags and leaves project files intact', async () => {
    const directory = await fixtureDirectory(); fixtures.push(directory);
    await packageFile(directory, { name: 'vite-fixture', scripts: { dev: 'vite' }, devDependencies: { vite: '*' } });
    await writeFile(path.join(directory, 'index.html'), '<h1>Real Vite fixture</h1>');
    const original = await readFile(path.join(directory, 'package.json'), 'utf8');
    const project = (await scanProjects([root(directory)])).projects[0]!;
    const manager = new ProcessManager(new LogManager(() => {}), () => {}); managers.push(manager);
    await manager.start(project); await eventually(() => manager.view(project).status === 'running');
    expect(await (await fetch(manager.view(project).localUrl!)).text()).toContain('Real Vite fixture');
    expect(await readFile(path.join(directory, 'package.json'), 'utf8')).toBe(original);
  });
  it.each(['prefix', 'workspace'] as const)('verifies the actual IPv6 Vite URL through an npm %s wrapper after a port conflict', async (wrapper) => {
    const occupied = createServer((_request, response) => response.end('unrelated IPv6 server'));
    await new Promise<void>((resolve) => occupied.listen(0, '::1', resolve));
    const address = occupied.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port.');
    try {
      const directory = await fixtureDirectory(); fixtures.push(directory);
      const frontend = path.join(directory, 'frontend');
      await packageFile(directory, { name: 'wrapped-vite-fixture', private: true,
        ...(wrapper === 'workspace' ? { workspaces: ['frontend'] } : {}),
        scripts: { dev: wrapper === 'prefix' ? 'npm --prefix frontend run dev' : 'npm --workspace frontend run dev' } });
      const vite = path.resolve('node_modules/vite/bin/vite.js');
      const host = wrapper === 'prefix' ? 'localhost' : '::1';
      await packageFile(frontend, { name: 'frontend', scripts: { dev: `node "${vite}" --host ${host} --port ${address.port}` } });
      await writeFile(path.join(frontend, 'index.html'), '<h1>Wrapped IPv6 Vite fixture</h1>');
      const original = await Promise.all([directory, frontend].map((folder) => readFile(path.join(folder, 'package.json'), 'utf8')));
      const project = (await scanProjects([root(directory)])).projects.find((item) => item.path === directory)!;
      const logs = new LogManager(() => {});
      const manager = new ProcessManager(logs, () => {}); managers.push(manager);
      await manager.start(project);
      await eventually(() => manager.view(project).status === 'running');
      const actual = manager.view(project).localUrl!;
      expect(new URL(actual).hostname).toBe(wrapper === 'prefix' ? 'localhost' : '[::1]');
      expect(Number(new URL(actual).port)).toBeGreaterThan(address.port);
      expect(logs.get(project.id).some((line) => line.text.includes(`Port ${address.port} is in use`))).toBe(true);
      expect(await (await fetch(actual)).text()).toContain('Wrapped IPv6 Vite fixture');
      await manager.stop(project.id);
      await eventually(() => unreachable(actual));
      expect(await (await fetch(`http://[::1]:${address.port}`)).text()).toBe('unrelated IPv6 server');
      expect(await Promise.all([directory, frontend].map((folder) => readFile(path.join(folder, 'package.json'), 'utf8')))).toEqual(original);
    } finally { await new Promise<void>((resolve) => occupied.close(() => resolve())); }
  });
  it('rejects unsupported managers without bootstrapping or downloading them', async () => {
    const { project, manager } = await fixture();
    await expect(manager.start({ ...project, manager: 'yarn' } as ProjectMetadata)).rejects.toThrow('npm execution only');
    expect(manager.view(project).status).toBe('error');
  });
  it.each(['127.0.0.1', '::1'])('does not mark an unrelated %s endpoint ready or stop its owner', async (host) => {
    const foreign = createServer((_request, response) => response.end('unrelated server'));
    await new Promise<void>((resolve) => foreign.listen(0, host, resolve));
    const address = foreign.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port.');
    const url = `http://${host === '::1' ? '[::1]' : host}:${address.port}`;
    try {
      const { directory, project, manager } = await fixture('quiet');
      await writeFile(path.join(directory, 'server.cjs'), `console.log('Local: ' + ${JSON.stringify(url)}); setInterval(()=>{},1000);`);
      await manager.start(project);
      await eventually(() => manager.view(project).status === 'unverified');
      expect(manager.view(project).localUrl).toBeUndefined();
      await manager.stop(project.id);
      expect(await (await fetch(url)).text()).toBe('unrelated server');
    } finally { await new Promise<void>((resolve) => foreign.close(() => resolve())); }
  });
});
it('checks descendant ownership without following cyclic or unrelated parent chains', () => {
  const parents = new Map([[30, 20], [20, 10], [50, 60], [60, 50]]);
  expect(descendsFrom(30, 10, parents)).toBe(true);
  expect(descendsFrom(10, 10, parents)).toBe(true);
  expect(descendsFrom(30, 99, parents)).toBe(false);
  expect(descendsFrom(50, 10, parents)).toBe(false);
});
it('accepts only credential-free HTTP loopback origins with explicit ports', () => {
  expect(localOrigin('http://127.0.0.1:4000/path')).toBe('http://127.0.0.1:4000');
  expect(localOrigin('http://localhost:4000')).toBe('http://localhost:4000');
  for (const value of ['file:///C:/secret', 'javascript:alert(1)', 'http://example.com:4000', 'http://localhost.evil:4000', 'http://user:pass@localhost:4000', 'http://localhost', 'https://localhost:4000']) expect(localOrigin(value)).toBeUndefined();
});
