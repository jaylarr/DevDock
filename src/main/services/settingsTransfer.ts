import { open, realpath, stat, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { SavedState } from '../../shared/contracts';
import { record, onlyKeys, readSettings, projectFilters, type ProjectFilter, type AppSettings, type ImportPreview } from '../../shared/settings';
import { normalizePath, projectId } from './identity';
import type { AppService } from './appService';

const limit = 1024 * 1024;
interface Portable {
  format: 'devdock-settings'; version: 1; exportedAt: string; settings: AppSettings;
  rememberedFilter?: { kind: 'status'; value: ProjectFilter } | { kind: 'root'; path: string };
  discovery?: { roots: { path: string }[]; exclusions: string[] };
}
function localPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32768 || value.includes('\0') || !/^[a-z]:[\\/]/i.test(value) || /[<>"|?*]/.test(value) || value.slice(2).includes(':')) throw new Error('Import requires ordinary absolute local Windows folder paths.');
  return path.win32.normalize(value);
}
export function validatePortable(value: unknown): Portable {
  if (!record(value) || value.format !== 'devdock-settings' || value.version !== 1) throw new Error('Choose a supported DevDock settings export (version 1), not a state backup.');
  onlyKeys(value, ['format', 'version', 'exportedAt', 'settings', 'rememberedFilter', 'discovery']);
  if (typeof value.exportedAt !== 'string' || value.exportedAt.length > 64 || !Number.isFinite(Date.parse(value.exportedAt))) throw new Error('Invalid export date.');
  const result: Portable = { format: 'devdock-settings', version: 1, exportedAt: value.exportedAt, settings: readSettings(value.settings).settings };
  if (value.discovery !== undefined) {
    if (!record(value.discovery)) throw new Error('Invalid discovery configuration.');
    onlyKeys(value.discovery, ['roots', 'exclusions']);
    const { roots, exclusions } = value.discovery;
    if (!Array.isArray(roots) || roots.length > 200 || !Array.isArray(exclusions) || exclusions.length > 2000) throw new Error('Too many or invalid discovery folders.');
    const dedupe = (items: string[]) => [...new Map(items.map((item) => [normalizePath(item), item])).values()];
    const paths = roots.map((root) => { if (!record(root)) throw new Error('Invalid registered folder.'); onlyKeys(root, ['path']); return localPath(root.path); });
    result.discovery = { roots: dedupe(paths).map((directory) => ({ path: directory })), exclusions: dedupe(exclusions.map(localPath)) };
  }
  if (value.rememberedFilter !== undefined) {
    const filter = value.rememberedFilter;
    if (!record(filter)) throw new Error('Invalid remembered filter.');
    if (filter.kind === 'status') {
      onlyKeys(filter, ['kind', 'value']);
      if (!projectFilters.some((value) => value === filter.value)) throw new Error('Invalid remembered filter.');
      result.rememberedFilter = { kind: 'status', value: filter.value as ProjectFilter };
    } else if (filter.kind === 'root') {
      onlyKeys(filter, ['kind', 'path']); const directory = localPath(filter.path);
      if (!result.discovery?.roots.some((root) => normalizePath(root.path) === normalizePath(directory))) throw new Error('Remembered root is missing from exported registrations.');
      result.rememberedFilter = { kind: 'root', path: directory };
    } else throw new Error('Invalid remembered filter.');
  }
  return result;
}
export function exportPortable(state: SavedState, discovery: boolean): Portable {
  const value: Portable = { format: 'devdock-settings', version: 1, exportedAt: new Date().toISOString(), settings: structuredClone(state.settings) };
  if (discovery) value.discovery = { roots: state.roots.map((root) => ({ path: root.path })), exclusions: [...state.exclusions] };
  if (state.settings.behavior.rememberLastFilter) {
    const filter = state.view.lastFilter;
    const root = filter.kind === 'root' && discovery ? state.roots.find((root) => root.id === filter.rootId) : undefined;
    value.rememberedFilter = root ? { kind: 'root', path: root.path } : { kind: 'status', value: filter.kind === 'status' ? filter.value : 'all' };
  }
  return value;
}
export async function readPortableFile(filename: string): Promise<Portable> {
  const file = await open(filename, 'r');
  try {
    const info = await file.stat(); if (!info.isFile() || info.size > limit) throw new Error('Settings export must be a regular file no larger than 1 MiB.');
    const buffer = Buffer.alloc(limit + 1); let total = 0;
    while (total < buffer.length) { const { bytesRead } = await file.read(buffer, total, buffer.length - total, total); if (!bytesRead) break; total += bytesRead; }
    if (total > limit) throw new Error('Settings export is larger than 1 MiB.');
    let parsed: unknown; try { parsed = JSON.parse(buffer.subarray(0, total).toString('utf8')); } catch { throw new Error('Settings file is not valid JSON.'); }
    return validatePortable(parsed);
  } finally { await file.close(); }
}
export async function writePortableFile(filename: string, value: Portable): Promise<void> {
  const data = JSON.stringify(validatePortable(value), null, 2);
  if (Buffer.byteLength(data, 'utf8') > limit) throw new Error('Settings export exceeds the 1 MiB portable-file limit.');
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, data, { encoding: 'utf8', flag: 'wx' }); await rename(temporary, filename); }
  finally { await unlink(temporary).catch(() => undefined); }
}
export class SettingsTransfer {
  private draft?: { token: string; expires: number; revision: number; value: Portable; roots: SavedState['roots'] };
  constructor(private service: AppService) {}
  cancel(token?: string): void { if (!token || this.draft?.token === token) this.draft = undefined; }
  async preview(filename: string): Promise<ImportPreview> {
    this.draft = undefined;
    const value = await readPortableFile(filename);
    const saved = this.service.saved(); const revision = this.service.configurationRevision();
    const roots: SavedState['roots'] = []; const previewRoots: { path: string; available: boolean }[] = [];
    for (const root of value.discovery?.roots ?? []) {
      let directory = root.path; let available = false;
      try { directory = await realpath(directory); available = (await stat(directory)).isDirectory(); if (!available) throw new Error('A registered path is a file.'); }
      catch (error) { if (!(error as NodeJS.ErrnoException).code) throw error; }
      directory = localPath(directory);
      if (value.rememberedFilter?.kind === 'root' && normalizePath(value.rememberedFilter.path) === normalizePath(root.path)) value.rememberedFilter.path = directory;
      if (roots.some((root) => normalizePath(root.path) === normalizePath(directory))) continue;
      roots.push({ id: projectId(directory), name: path.basename(directory) || directory, path: directory, addedAt: new Date().toISOString() });
      previewRoots.push({ path: directory, available });
    }
    if (value.discovery) {
      const exclusions: string[] = [];
      for (const excluded of value.discovery.exclusions) {
        let directory = excluded;
        try { directory = await realpath(excluded); if (!(await stat(directory)).isDirectory()) throw new Error('An excluded path is a file.'); }
        catch (error) { if (!(error as NodeJS.ErrnoException).code) throw error; }
        directory = localPath(directory);
        if (!exclusions.some((item) => normalizePath(item) === normalizePath(directory))) exclusions.push(directory);
      }
      value.discovery.exclusions = exclusions;
    }
    const token = randomUUID();
    this.draft = { token, expires: Date.now() + 300000, revision, value, roots };
    const changes: string[] = [];
    for (const group of ['appearance', 'discovery', 'behavior'] as const) for (const key of Object.keys(value.settings[group])) {
      if (Reflect.get(value.settings[group], key) !== Reflect.get(saved.settings[group], key)) changes.push(`${group}.${key}: ${String(Reflect.get(saved.settings[group], key))} → ${String(Reflect.get(value.settings[group], key))}`);
    }
    if (value.settings.behavior.rememberLastFilter) changes.push('Remembered filter restores with its root, otherwise All projects.');
    return { token, settings: value.settings, preferencesChanged: changes, discovery: value.discovery && { roots: previewRoots, exclusions: value.discovery.exclusions,
      added: roots.filter((root) => !saved.roots.some((old) => old.id === root.id)).length, removed: saved.roots.filter((old) => !roots.some((root) => root.id === old.id)).length, cached: saved.projects.length } };
  }
  async apply(token: string, discovery: boolean): Promise<void> {
    const draft = this.draft;
    if (!draft || draft.token !== token || draft.expires < Date.now()) { this.draft = undefined; throw new Error('Import preview expired. Choose the file again.'); }
    if (discovery && !draft.value.discovery) throw new Error('This export has no discovery folders.');
    const filter = draft.value.rememberedFilter;
    let remembered: string = filter?.kind === 'status' ? filter.value : 'all';
    if (filter?.kind === 'root' && discovery) remembered = draft.roots.find((root) => normalizePath(root.path) === normalizePath(filter.path))?.id ?? 'all';
    await this.service.applySettings(draft.value.settings, remembered, discovery ? { roots: draft.roots, exclusions: draft.value.discovery!.exclusions } : undefined, draft.revision);
    this.draft = undefined;
  }
  export(discovery: boolean): Portable { return exportPortable(this.service.saved(), discovery); }
}
