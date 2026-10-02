import { mkdir, readFile, rename, copyFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { SavedState } from '../../shared/contracts';
import { object } from './detection';
import { projectId, within } from './identity';
import { validEntry } from './staticPolicy';

// Approved exclusion for this local installation; editable through Discovery settings.
export const initialExclusions = [String.raw`C:\Users\user\Desktop\PROGRAMMING\AUTOMATIONS\Automation Context Mapping\app\data\releases`];
export function emptyState(): SavedState { return { version: 2, roots: [], projects: [], theme: 'system', exclusions: [...initialExclusions] }; }
function validate(value: unknown): SavedState {
  if (!object(value) || ![1, 2].includes(Number(value.version)) || typeof value.version !== 'number' || !Array.isArray(value.roots) || !Array.isArray(value.projects)) throw new Error('Invalid saved state.');
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
    const identity = { id: projectId(item.path), name: item.name, path: item.path, rootId: item.rootId, slug: item.slug, missing: item.missing === true };
    if (value.version === 2 && item.kind === 'static') {
      if (!validEntry(item.entryFile) || item.framework !== 'Static HTML') throw new Error('Invalid static project entry.');
      state.projects.push({ ...identity, kind: 'static', entryFile: item.entryFile, framework: 'Static HTML' });
    } else {
      if (value.version === 2 && item.kind !== 'script' || typeof item.devScript !== 'string' || !['npm', 'pnpm', 'yarn', 'bun'].includes(String(item.manager))) throw new Error('Invalid script project.');
      state.projects.push({ ...identity, kind: 'script', devScript: item.devScript, framework: item.framework, manager: item.manager as 'npm' | 'pnpm' | 'yarn' | 'bun' });
    }
  }
  if (value.theme === 'light' || value.theme === 'dark' || value.theme === 'system') state.theme = value.theme;
  return state;
}
export class Persistence {
  private queue = Promise.resolve();
  readonly file: string;
  constructor(directory: string) { this.file = path.join(directory, 'state.json'); }
  async load(): Promise<{ state: SavedState; warning?: string }> {
    try { return { state: validate(JSON.parse(await readFile(this.file, 'utf8'))) }; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: emptyState() };
      try { return { state: validate(JSON.parse(await readFile(`${this.file}.bak`, 'utf8'))), warning: 'Saved state was damaged. Recovered the previous backup.' }; }
      catch { return { state: emptyState(), warning: 'Saved state could not be read. Your project files were not changed; add roots again.' }; }
    }
  }
  save(state: SavedState): Promise<void> {
    const data = JSON.stringify(validate(state), null, 2);
    const operation = this.queue.catch(() => undefined).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      for (const legacyPath of [this.file, `${this.file}.bak`]) {
        let legacy: unknown;
        try { legacy = JSON.parse(await readFile(legacyPath, 'utf8')); validate(legacy); } catch { continue; }
        if (object(legacy) && legacy.version === 1) {
          try { await copyFile(legacyPath, `${this.file}.v1.bak`, constants.COPYFILE_EXCL); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
          break;
        }
      }
      await writeFile(`${this.file}.tmp`, data, 'utf8');
      try {
        await access(this.file);
        // Do not overwrite a good recovery backup with an already corrupted primary.
        let valid = false;
        try { validate(JSON.parse(await readFile(this.file, 'utf8'))); valid = true; } catch { /* Preserve existing backup. */ }
        if (valid) await copyFile(this.file, `${this.file}.bak`);
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await rename(`${this.file}.tmp`, this.file);
    });
    this.queue = operation;
    return operation;
  }
}
