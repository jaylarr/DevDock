import { mkdir, readFile, rename, copyFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import type { SavedState } from '../../shared/contracts';
import { object } from './detection';
import { projectId, within } from './identity';

export function emptyState(): SavedState { return { version: 1, roots: [], projects: [], theme: 'system' }; }
function validate(value: unknown): SavedState {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.roots) || !Array.isArray(value.projects)) throw new Error('Invalid saved state.');
  const state = emptyState();
  for (const root of value.roots) {
    if (!object(root) || typeof root.path !== 'string' || !path.isAbsolute(root.path) || typeof root.name !== 'string' || typeof root.addedAt !== 'string') throw new Error('Invalid saved root.');
    state.roots.push({ id: projectId(root.path), path: root.path, name: root.name, addedAt: root.addedAt });
  }
  for (const item of value.projects) {
    if (!object(item) || typeof item.path !== 'string' || !path.isAbsolute(item.path) || typeof item.name !== 'string' || typeof item.devScript !== 'string' ||
      typeof item.rootId !== 'string' || typeof item.slug !== 'string' || typeof item.framework !== 'string' || !['npm', 'pnpm', 'yarn', 'bun'].includes(String(item.manager))) throw new Error('Invalid saved project.');
    const owner = state.roots.find((root) => root.id === item.rootId);
    if (!owner || !within(item.path, owner.path)) throw new Error('Saved project is outside its registered root.');
    state.projects.push({ id: projectId(item.path), name: item.name, path: item.path, rootId: item.rootId, slug: item.slug,
      devScript: item.devScript, framework: item.framework, manager: item.manager as SavedState['projects'][number]['manager'], missing: item.missing === true });
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
