import { mkdir, readFile, rename, copyFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { SavedState } from '../../shared/contracts';
import { externalSources, isTheme } from '../../shared/contracts';
import { allFilter, defaultSettings, readSettings, record, filterFromString } from '../../shared/settings';
import { object } from './detection';
import { projectId, within } from './identity';
import { validEntry } from './staticPolicy';

export function emptyState(): SavedState { return { version: 3, roots: [], projects: [], settings: defaultSettings(), view: { lastFilter: allFilter() }, exclusions: [] }; }
export class UnsupportedState extends Error {}
function validate(value: unknown, repair = false): SavedState {
  if (object(value) && typeof value.version === 'number' && value.version > 3) throw new UnsupportedState('This data was saved by a newer DevDock. Use that version; the data has not been changed.');
  if (!object(value) || ![1, 2, 3].includes(Number(value.version)) || typeof value.version !== 'number' || !Array.isArray(value.roots) || !Array.isArray(value.projects)) throw new Error('Invalid saved state.');
  const state = emptyState();
  if (value.exclusions !== undefined) {
    if (!Array.isArray(value.exclusions) || value.exclusions.some((item) => typeof item !== 'string' || !path.isAbsolute(item))) throw new Error('Invalid excluded folders.');
    state.exclusions = [...new Set(value.exclusions as string[])];
  }
  for (const root of value.roots) {
    if (!object(root) || typeof root.path !== 'string' || !path.isAbsolute(root.path) || typeof root.name !== 'string' || typeof root.addedAt !== 'string') throw new Error('Invalid saved root.');
    state.roots.push({ id: projectId(root.path), path: root.path, name: root.name, addedAt: root.addedAt });
  }
  for (const item of value.projects) {
    if (!object(item) || typeof item.path !== 'string' || !path.isAbsolute(item.path) || typeof item.name !== 'string' ||
      typeof item.rootId !== 'string' || typeof item.slug !== 'string' || typeof item.framework !== 'string') throw new Error('Invalid saved project.');
    const owner = state.roots.find((root) => root.id === item.rootId);
    if (!owner || !within(item.path, owner.path)) throw new Error('Saved project is outside its registered root.');
    const validActivity = typeof item.lastActiveAt === 'string' && Number.isFinite(Date.parse(item.lastActiveAt)) && new Date(item.lastActiveAt).toISOString() === item.lastActiveAt;
    const validSource = item.lastActivitySource === 'devdock' || externalSources.some((source) => source === item.lastActivitySource);
    if (!repair && item.lastActivitySource !== undefined && !validSource) throw new Error('Invalid project activity source.');
    if (!repair && (item.pinned !== undefined && typeof item.pinned !== 'boolean' || item.lastActiveAt !== undefined && !validActivity)) throw new Error('Invalid project activity metadata.');
    const identity = { id: projectId(item.path), name: item.name, path: item.path, rootId: item.rootId, slug: item.slug, missing: item.missing === true,
      ...(typeof item.pinned === 'boolean' ? { pinned: item.pinned } : {}), ...(validActivity ? { lastActiveAt: item.lastActiveAt as string } : {}),
      ...(validSource ? { lastActivitySource: item.lastActivitySource as 'devdock' | typeof externalSources[number] } : {}) };
    if (value.version >= 2 && item.kind === 'static') {
      if (!validEntry(item.entryFile) || item.framework !== 'Static HTML') throw new Error('Invalid static project entry.');
      state.projects.push({ ...identity, kind: 'static', entryFile: item.entryFile, framework: 'Static HTML' });
    } else {
      if (value.version >= 2 && item.kind !== 'script' || typeof item.devScript !== 'string' || !['npm', 'pnpm', 'yarn', 'bun'].includes(String(item.manager))) throw new Error('Invalid script project.');
      state.projects.push({ ...identity, kind: 'script', devScript: item.devScript, framework: item.framework, manager: item.manager as 'npm' | 'pnpm' | 'yarn' | 'bun' });
    }
  }
  if (value.version < 3 && isTheme(value.theme)) state.settings.appearance.theme = value.theme;
  if (value.version === 3) state.settings = readSettings(value.settings, repair).settings;
  if (state.settings.behavior.rememberLastFilter && record(value.view) && record(value.view.lastFilter)) {
    const filter = value.view.lastFilter;
    try { state.view.lastFilter = filterFromString(filter.kind === 'root' ? filter.rootId : filter.value, state.roots.map((root) => root.id)); } catch { /* Removed or damaged remembered filter defaults to all. */ }
  }
  return state;
}
export class Persistence {
  private queue = Promise.resolve();
  readonly file: string;
  constructor(directory: string) { this.file = path.join(directory, 'state.json'); }
  async load(): Promise<{ state: SavedState; warning?: string; migrate?: boolean }> {
    try { return this.loaded(JSON.parse(await readFile(this.file, 'utf8'))); }
    catch (error) {
      if (error instanceof UnsupportedState) throw error;
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      try { const loaded = this.loaded(JSON.parse(await readFile(`${this.file}.bak`, 'utf8'))); return { ...loaded, migrate: true, warning: 'Saved state was damaged or missing. Recovered the previous backup.' }; }
      catch (backupError) {
        if (backupError instanceof UnsupportedState) throw backupError;
        if (missing && (backupError as NodeJS.ErrnoException).code === 'ENOENT') return { state: emptyState() };
        return { state: emptyState(), warning: 'Saved state could not be read. Your project files were not changed; add roots again.' };
      }
    }
  }
  private loaded(value: unknown): { state: SavedState; warning?: string; migrate?: boolean } {
    const state = validate(value, true);
    const repaired = record(value) && value.version === 3 && readSettings(value.settings, true).repaired;
    return { state, migrate: record(value) && value.version !== 3 || repaired, warning: repaired ? 'Invalid preferences were restored to defaults; your catalog was retained.' : undefined };
  }
  save(state: SavedState): Promise<void> {
    const data = JSON.stringify(validate(state), null, 2);
    const operation = this.queue.catch(() => undefined).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      for (const legacyPath of [this.file, `${this.file}.bak`]) {
        let legacy: unknown;
        try { legacy = JSON.parse(await readFile(legacyPath, 'utf8')); validate(legacy, true); } catch (error) { if (error instanceof UnsupportedState) throw error; continue; }
        if (object(legacy) && [1, 2].includes(Number(legacy.version))) {
          try { await copyFile(legacyPath, `${this.file}.v${String(legacy.version)}.bak`, constants.COPYFILE_EXCL); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
          break;
        }
      }
      await writeFile(`${this.file}.tmp`, data, 'utf8');
      try {
        await access(this.file);
        // Do not overwrite a good recovery backup with an already corrupted primary.
        let valid = false;
        try { validate(JSON.parse(await readFile(this.file, 'utf8')), true); valid = true; } catch (error) { if (error instanceof UnsupportedState) throw error; /* Preserve existing backup. */ }
        if (valid) await copyFile(this.file, `${this.file}.bak`);
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await rename(`${this.file}.tmp`, this.file);
    });
    this.queue = operation;
    return operation;
  }
}
