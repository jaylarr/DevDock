import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import type { ProjectMetadata, SavedState, Snapshot, Theme } from '../../shared/contracts';
import { emptyState, Persistence } from './persistence';
import { scanProjects } from './projectScanner';
import { normalizePath, projectId, within } from './identity';
import { LogManager } from './logManager';
import { ProcessManager } from './processManager';

export class AppService {
  private state: SavedState = emptyState();
  private diagnostics: string[] = [];
  private scanning?: AbortController;
  private scanJob?: Promise<void>;
  readonly logs: LogManager;
  readonly processes: ProcessManager;
  constructor(private persistence: Persistence, private changed: () => void) {
    this.logs = new LogManager(changed);
    this.processes = new ProcessManager(this.logs, changed);
  }
  async initialize(): Promise<void> {
    const saved = await this.persistence.load();
    this.state = saved.state;
    if (saved.warning) this.diagnostics.push(saved.warning);
  }
  snapshot(): Snapshot {
    return { roots: [...this.state.roots], projects: this.state.projects.map((project) => this.processes.view(project)),
      scanning: !!this.scanning, diagnostics: [...this.diagnostics], theme: this.state.theme };
  }
  project(id: string): ProjectMetadata {
    const project = this.state.projects.find((item) => item.id === id);
    if (!project) throw new Error('Project not found. Rescan the registered folders.');
    return project;
  }
  async addRoot(directory: string): Promise<void> {
    const resolved = await realpath(directory);
    if (!(await stat(resolved)).isDirectory()) throw new Error('Select a directory.');
    if (this.state.roots.some((root) => normalizePath(root.path) === normalizePath(resolved))) throw new Error('This folder is already registered.');
    if (this.scanning) throw new Error('Wait for the current scan or cancel it before changing roots.');
    this.state.roots.push({ id: projectId(resolved), path: resolved, name: path.basename(resolved) || resolved, addedAt: new Date().toISOString() });
    await this.persistence.save(this.state); this.changed();
    await this.scan();
  }
  async removeRoot(id: string): Promise<void> {
    if (this.scanning) throw new Error('Wait for the scan or cancel it before removing a root.');
    if (!this.state.roots.some((root) => root.id === id)) throw new Error('Root folder not found.');
    const children = this.state.projects.filter((item) => item.rootId === id);
    if (children.some((item) => this.processes.isActive(item.id))) throw new Error('Stop this root’s managed projects before removing its registration.');
    this.state.roots = this.state.roots.filter((root) => root.id !== id);
    this.state.projects = this.state.projects.filter((item) => item.rootId !== id);
    await this.persistence.save(this.state); this.changed();
  }
  scan(): Promise<void> {
    if (this.scanJob) return this.scanJob;
    this.scanning = new AbortController();
    const controller = this.scanning;
    const roots = [...this.state.roots];
    this.changed();
    this.scanJob = (async () => {
      try {
        const result = await scanProjects(roots, controller.signal);
        this.diagnostics = result.diagnostics.slice(0, 100);
        if (result.cancelled) { this.diagnostics.push('Scan cancelled. The previous project list was retained.'); return; }
        const discovered = new Map(result.projects.map((item) => [item.id, item]));
        for (const existing of this.state.projects) {
          const unreadable = result.unreadableDirectories.some((directory) => within(existing.path, directory));
          if (!discovered.has(existing.id)) discovered.set(existing.id, { ...existing, missing: !unreadable && result.checkedRoots.includes(existing.rootId) ? true : existing.missing });
        }
        this.state.projects = [...discovered.values()].sort((a, b) => a.name.localeCompare(b.name));
        await this.persistence.save(this.state);
      } finally { this.scanning = undefined; this.scanJob = undefined; this.changed(); }
    })();
    return this.scanJob;
  }
  cancelScan(): void { this.scanning?.abort(); }
  async start(id: string): Promise<void> {
    const project = this.project(id);
    if (project.missing) throw new Error('This project is missing or no longer has a dev script. Rescan before starting.');
    await this.processes.start(project);
  }
  async stop(id: string): Promise<void> { this.project(id); await this.processes.stop(id); }
  async restart(id: string): Promise<void> { await this.stop(id); await this.start(id); }
  async theme(theme: Theme): Promise<void> { this.state.theme = theme; await this.persistence.save(this.state); this.changed(); }
  async close(): Promise<void> {
    this.cancelScan();
    // A failed scan/save must not bypass cleanup of already launched servers.
    await this.scanJob?.catch(() => undefined);
    await this.processes.stopAll();
    await this.persistence.save(this.state);
  }
}
