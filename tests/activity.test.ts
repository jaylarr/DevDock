import { afterEach, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppService } from '../src/main/services/appService';
import { Persistence } from '../src/main/services/persistence';
import { recentProjects, orderUnpinned } from '../src/renderer/projectOrdering';
import { exportPortable, validatePortable } from '../src/main/services/settingsTransfer';
import type { Project } from '../src/shared/contracts';
import { dispose, fixtureDirectory, packageFile } from './helpers';

const directories: string[] = [];
const services: AppService[] = [];
async function fixture() {
  const directory = await fixtureDirectory(); directories.push(directory);
  const projects = path.join(directory, 'projects');
  for (const name of ['alpha', 'zebra']) await packageFile(path.join(projects, name), { name, scripts: { dev: 'node server.cjs' } });
  const persistence = new Persistence(path.join(directory, 'data'));
  const service = new AppService(persistence, () => {}, { provider: { availability: async () => ({ available: false }), start: async () => { throw new Error('No tunnels in activity tests.'); } } });
  services.push(service); await service.initialize(); await service.addRoot(projects);
  return { service, persistence };
}
afterEach(async () => { vi.restoreAllMocks(); for (const service of services.splice(0)) await service.close(); for (const directory of directories.splice(0)) await dispose(directory); });

it('retains pins and activity across concurrent scans, preference changes and relaunches without restoring runtime', async () => {
  const { service, persistence } = await fixture(); const project = service.snapshot().projects[1]!;
  expect(project.lastActiveAt).toBeUndefined();
  await Promise.all([service.scan(), service.setPinned(project.id, true), service.recordActivity(project.id), service.updateSettings({ appearance: { theme: 'dark' } })]);
  const saved = service.snapshot().projects.find((item) => item.id === project.id)!;
  expect(saved.pinned).toBe(true); expect(Number.isFinite(Date.parse(saved.lastActiveAt!))).toBe(true);
  const restored = new AppService(persistence, () => {}); services.push(restored); await restored.initialize(); await restored.scan();
  expect(restored.snapshot().projects.find((item) => item.id === project.id)).toMatchObject({ pinned: true, lastActiveAt: saved.lastActiveAt, status: 'stopped' });
  expect(restored.snapshot().settings.appearance.theme).toBe('dark');
  await restored.setPinned(project.id, false);
  expect((await persistence.load()).state.projects.find((item) => item.id === project.id)).toMatchObject({ pinned: false, lastActiveAt: saved.lastActiveAt });
});

it('publishes pins only after a durable save and rejects unknown projects and malformed pin values', async () => {
  const { service, persistence } = await fixture(); const project = service.snapshot().projects[0]!;
  vi.spyOn(persistence, 'save').mockRejectedValueOnce(new Error('disk full'));
  await expect(service.setPinned(project.id, true)).rejects.toThrow('disk full');
  expect(service.snapshot().projects[0]!.pinned).toBeUndefined();
  await expect(service.setPinned('unknown', true)).rejects.toThrow('not found');
  await expect(service.setPinned(project.id, 'yes' as unknown as boolean)).rejects.toThrow('Invalid pin');
  await service.setPinned(project.id, true);
  vi.spyOn(service.processes, 'view').mockReturnValue({ ...project, status: 'running', managed: true });
  expect(service.snapshot().projects[0]!.pinned).toBe(true);
});

it('records successful starts but does not record failed launches or let an activity save failure mask a completed action', async () => {
  const { service, persistence } = await fixture(); const [alpha, zebra] = service.snapshot().projects;
  const start = vi.spyOn(service.processes, 'start').mockRejectedValueOnce(new Error('launch failed')).mockResolvedValue(undefined);
  await expect(service.start(alpha!.id)).rejects.toThrow('launch failed');
  expect(service.project(alpha!.id).lastActiveAt).toBeUndefined();
  await service.start(zebra!.id); expect(service.project(zebra!.id).lastActiveAt).toBeDefined(); expect(start).toHaveBeenCalledTimes(2);
  vi.spyOn(persistence, 'save').mockRejectedValueOnce(new Error('disk full'));
  await expect(service.start(alpha!.id)).resolves.toBeUndefined();
  expect(service.project(alpha!.id).lastActiveAt).toBeUndefined();
  expect(service.snapshot().diagnostics.join(' ')).toContain('recent activity could not be saved');
});

it('repairs damaged optional activity fields without losing the catalog and clears metadata with removed registration', async () => {
  const { service, persistence } = await fixture(); const state = service.saved();
  await writeFile(persistence.file, JSON.stringify({ ...state, projects: state.projects.map((item) => ({ ...item, pinned: 'bad', lastActiveAt: 'not a date' })) }));
  const loaded = await persistence.load(); expect(loaded.state.projects).toHaveLength(2); expect(loaded.state.projects[0]!.lastActiveAt).toBeUndefined(); expect(loaded.state.projects[0]!.pinned).toBeUndefined();
  await service.setPinned(state.projects[0]!.id, true); await service.recordActivity(state.projects[0]!.id);
  await service.removeRoot(state.roots[0]!.id); expect(service.snapshot().projects).toEqual([]);
  expect(await readFile(path.join(state.projects[0]!.path, 'package.json'), 'utf8')).toContain('alpha');
});

it.each(['pinned', 'recent'])('restores and exports the %s filter', async (filter) => {
  const { service, persistence } = await fixture();
  await service.updateSettings({ behavior: { rememberLastFilter: true } }, filter);
  expect((await persistence.load()).state.view.lastFilter).toEqual({ kind: 'status', value: filter });
  expect(validatePortable(exportPortable(service.saved(), false)).rememberedFilter).toEqual({ kind: 'status', value: filter });
});

it('bounds recent projects to ten, sorts by activity with stable ties, and keeps pins out of paginated rows', () => {
  const projects = Array.from({ length: 13 }, (_, index) => ({ id: String(index), name: `project-${index}`, kind: 'static', framework: 'Static HTML', entryFile: 'index.html', path: `C:/projects/${index}`, rootId: 'root', slug: String(index), missing: false, status: 'stopped',
    ...(index > 0 ? { lastActiveAt: new Date(2026, 0, index).toISOString() } : {}), pinned: index === 12 } as Project));
  const recent = recentProjects(projects);
  expect(recent.map((item) => item.id)).toEqual(['12', '11', '10', '9', '8', '7', '6', '5', '4', '3']);
  const ordered = orderUnpinned(projects, new Set(recent.map((item) => item.id)));
  expect(ordered[0]!.id).toBe('11'); expect(ordered).toHaveLength(12); expect(ordered.some((item) => item.pinned)).toBe(false);
  expect(projects[0]!.id).toBe('0');
  const tied = [{ ...projects[1]!, name: 'Z' }, { ...projects[1]!, id: 'tie', name: 'A' }];
  expect(recentProjects(tied).map((item) => item.name)).toEqual(['A', 'Z']);
});
