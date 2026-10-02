import { afterEach, describe, expect, it } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { scanProjects } from '../src/main/services/projectScanner';
import { manifest, packageManager, framework } from '../src/main/services/detection';
import { normalizePath, projectId, slug, within } from '../src/main/services/identity';
import { dispose, fixtureDirectory, packageFile, root } from './helpers';

const fixtures: string[] = [];
afterEach(async () => { for (const directory of fixtures.splice(0)) await dispose(directory); });
describe('project discovery', () => {
  it('discovers nested dev scripts without executing them; skips generated folders, invalid manifests, and duplicates', async () => {
    const directory = await fixtureDirectory(); fixtures.push(directory);
    for (const name of ['app-one', 'nested/app-two', 'node_modules/hidden', '.git/hidden', 'dist/hidden']) await packageFile(path.join(directory, name), { name: 'same', scripts: { dev: 'DO_NOT_EXECUTE' } });
    await packageFile(path.join(directory, 'no-dev'), { scripts: { start: 'node index.js' } });
    await mkdir(path.join(directory, 'broken')); await writeFile(path.join(directory, 'broken/package.json'), '{');
    const result = await scanProjects([root(directory), root(path.join(directory, 'nested'))]);
    expect(result.projects).toHaveLength(2);
    expect(new Set(result.projects.map((item) => item.id)).size).toBe(2);
    expect(new Set(result.projects.map((item) => item.slug)).size).toBe(2);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.projects.map((item) => item.devScript)).toEqual(['DO_NOT_EXECUTE', 'DO_NOT_EXECUTE']);
  });
  it('cancels without reporting a completed scan', async () => {
    const directory = await fixtureDirectory(); fixtures.push(directory);
    const controller = new AbortController(); controller.abort();
    const result = await scanProjects([root(directory)], controller.signal);
    expect(result.cancelled).toBe(true); expect(result.projects).toEqual([]);
  });
  it('survives a missing root and reports it', async () => {
    const directory = await fixtureDirectory(); fixtures.push(directory);
    const result = await scanProjects([root(path.join(directory, 'missing'))]);
    expect(result.projects).toEqual([]); expect(result.diagnostics[0]).toContain('Cannot read folder');
  });
  it('inherits the workspace manager but respects explicit child overrides', async () => {
    const directory = await fixtureDirectory(); fixtures.push(directory);
    await packageFile(directory, { packageManager: 'pnpm@10', workspaces: ['apps/*'] });
    await packageFile(path.join(directory, 'apps/one'), { name: 'one', scripts: { dev: 'vite' } });
    await packageFile(path.join(directory, 'apps/two'), { name: 'two', packageManager: 'npm@11', scripts: { dev: 'vite' } });
    const result = await scanProjects([root(directory)]);
    expect(result.projects.find((item) => item.name === 'one')?.manager).toBe('pnpm');
    expect(result.projects.find((item) => item.name === 'two')?.manager).toBe('npm');
  });
});
describe('metadata', () => {
  it.each([
    [{ packageManager: 'yarn@4.0.0' }, ['pnpm-lock.yaml'], 'yarn'],
    [{}, ['pnpm-lock.yaml', 'package-lock.json'], 'pnpm'], [{}, ['yarn.lock'], 'yarn'],
    [{}, ['bun.lock'], 'bun'], [{}, ['bun.lockb'], 'bun'], [{}, ['npm-shrinkwrap.json'], 'npm'], [{}, [], 'npm'],
  ])('resolves package-manager declarations and lockfiles', (pkg, files, expected) => expect(packageManager(manifest(pkg), files)).toBe(expected));
  it('recognizes frameworks before generic React', () => {
    expect(framework(manifest({ dependencies: { next: '1', react: '1' } }))).toBe('Next.js');
    expect(framework(manifest({ dependencies: { '@sveltejs/kit': '1', vite: '1' } }))).toBe('SvelteKit');
    expect(framework(manifest({ scripts: { dev: 'vite --open' } }))).toBe('Vite');
    expect(framework(manifest({ scripts: { dev: 'node server.js' } }))).toBe('Node');
  });
  it('uses stable path identities and distinct sanitized slugs', () => {
    const location = path.resolve('Some Projects (test)');
    expect(projectId(location)).toBe(projectId(path.join(location, '.')));
    if (process.platform === 'win32') expect(projectId(location)).toBe(projectId(location.toUpperCase()));
    expect(normalizePath(location)).toBe(normalizePath(path.join(location, '.')));
    expect(slug('@Client/HELLO App', location)).toMatch(/^client-hello-app-[a-f0-9]{6}$/);
    expect(slug('same', location)).not.toBe(slug('same', path.join(location, 'other')));
    expect(within(path.join(location, 'child'), location)).toBe(true);
    expect(within(`${location}-other`, location)).toBe(false);
  });
});
