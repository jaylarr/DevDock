import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import type { ProjectMetadata, SavedState, Snapshot, Theme } from '../../shared/contracts';
import { emptyState, Persistence } from './persistence';
import { scanProjects } from './projectScanner';
import { normalizePath, projectId, within } from './identity';
import { LogManager } from './logManager';
import { ProcessManager } from './processManager';
import { TunnelManager } from './tunnelManager';
import { CloudflareQuickTunnelProvider } from '../tunnels/CloudflareQuickTunnelProvider';
import type { TunnelProvider } from '../tunnels/TunnelProvider';

export class AppService {
  private state: SavedState = emptyState();
  private diagnostics: string[] = [];
  private scanning?: AbortController;
  private scanJob?: Promise<void>;
  readonly logs: LogManager;
  readonly processes: ProcessManager;
  readonly tunnels: TunnelManager;
  constructor(private persistence: Persistence, private changed: () => void, private sharingOptions: { provider?: TunnelProvider; directory?: string; protectedOrigin?: string } = {}) {
    this.logs = new LogManager(changed);
    this.tunnels = new TunnelManager(sharingOptions.provider ?? new CloudflareQuickTunnelProvider(sharingOptions.directory), this.logs, changed);
    this.processes = new ProcessManager(this.logs, changed, undefined, undefined, (id) => { void this.tunnels.stop(id).catch(() => {}); });
  }
  async initialize(): Promise<void> {
    const saved = await this.persistence.load();
    this.state = saved.state;
    if (saved.warning) this.diagnostics.push(saved.warning);
    await this.tunnels.initialize();
  }
  snapshot(): Snapshot {
    return { roots: [...this.state.roots], projects: this.state.projects.map((project) => ({ ...this.processes.view(project), sharing: this.tunnels.view(project.id) })),
      scanning: !!this.scanning, diagnostics: [...this.diagnostics], theme: this.state.theme,
      exclusions: (this.state.exclusions ?? []).map((directory) => ({ id: projectId(directory), path: directory })), sharing: { ...this.tunnels.availability } };
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
    if (children.some((item) => this.processes.isManaged(item.id) || this.tunnels.owns(item.id))) throw new Error('Stop this root’s managed projects and sharing sessions before removing its registration.');
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
        const result = await scanProjects(roots, controller.signal, this.state.exclusions);
        this.diagnostics = result.diagnostics.slice(0, 100);
        if (result.cancelled) { this.diagnostics.push('Scan cancelled. The previous project list was retained.'); return; }
        const discovered = new Map(result.projects.map((item) => [item.id, item]));
        for (const existing of this.state.projects) {
          if (this.excluded(existing.path)) {
            if (this.processes.isManaged(existing.id) || this.tunnels.owns(existing.id)) {
              discovered.set(existing.id, existing);
              this.diagnostics.push(`Excluded project is still managed; retained until stopped: ${existing.path}`);
            }
            continue;
          }
          const unreadable = result.unreadableDirectories.some((directory) => within(existing.path, directory));
          const fresh = discovered.get(existing.id);
          if (fresh && (this.processes.isManaged(existing.id) || this.tunnels.owns(existing.id)) && (fresh.kind !== existing.kind || fresh.entryFile !== existing.entryFile)) {
            discovered.set(existing.id, { ...existing, missing: true });
            this.diagnostics.push(`Project launch mode changed; stop before adopting the new configuration: ${existing.path}`);
            continue;
          }
          if (existing.kind === 'static' && !fresh && !unreadable && result.checkedRoots.includes(existing.rootId)) {
            if (this.processes.isManaged(existing.id) || this.tunnels.owns(existing.id)) {
              discovered.set(existing.id, { ...existing, missing: true });
              this.diagnostics.push(`Static project is no longer eligible; retained until stopped: ${existing.path}`);
            } else if (!result.applicationRoots.some((owner) => within(existing.path, owner) || within(owner, existing.path)) && !result.projects.some((owner) => within(existing.path, owner.path))) {
              discovered.set(existing.id, { ...existing, missing: true });
            }
            continue;
          }
          if (!discovered.has(existing.id)) discovered.set(existing.id, { ...existing, missing: !unreadable && result.checkedRoots.includes(existing.rootId) ? true : existing.missing });
        }
        this.state.projects = [...discovered.values()].sort((a, b) => a.name.localeCompare(b.name));
        await this.persistence.save(this.state);
      } finally { this.scanning = undefined; this.scanJob = undefined; this.changed(); }
    })();
    return this.scanJob;
  }
  cancelScan(): void { this.scanning?.abort(); }
  private excluded(directory: string): boolean { return (this.state.exclusions ?? []).some((excluded) => within(directory, excluded)); }
  async addExclusion(directory: string): Promise<void> {
    if (this.scanning) throw new Error('Wait for the scan or cancel it before changing exclusions.');
    const resolved = await realpath(directory);
    if (!(await stat(resolved)).isDirectory()) throw new Error('Select a directory.');
    if ((this.state.exclusions ?? []).some((item) => normalizePath(item) === normalizePath(resolved))) throw new Error('This folder is already excluded.');
    this.state.exclusions = [...(this.state.exclusions ?? []), resolved];
    await this.persistence.save(this.state); this.changed(); await this.scan();
  }
  async removeExclusion(id: string): Promise<void> {
    if (this.scanning) throw new Error('Wait for the scan or cancel it before changing exclusions.');
    if (!(this.state.exclusions ?? []).some((directory) => projectId(directory) === id)) throw new Error('Excluded folder not found.');
    this.state.exclusions = (this.state.exclusions ?? []).filter((directory) => projectId(directory) !== id);
    await this.persistence.save(this.state); this.changed(); await this.scan();
  }
  async start(id: string): Promise<void> {
    const project = this.project(id);
    if (this.excluded(project.path)) throw new Error('This folder is excluded from discovery. Stop its managed process or remove the exclusion before starting it.');
    if (project.missing) throw new Error('This project is missing or no longer runnable. Rescan before starting.');
    // Validate current ownership across all roots, not just stale cached static metadata.
    await this.processes.start(project, async () => {
      const result = await scanProjects([...this.state.roots], undefined, this.state.exclusions);
      const current = result.projects.find((item) => item.id === id);
      if (this.excluded(project.path) || !this.state.projects.some((item) => item.id === id)) throw new Error('Project registration changed before launch. Rescan before starting.');
      if (result.cancelled || !current || current.kind !== project.kind || current.entryFile !== project.entryFile) throw new Error('Project detection changed or could not be verified. Rescan before starting.');
    });
  }
  async share(id: string): Promise<void> {
    const eligible = () => {
      const project = this.project(id);
      if (project.missing || this.excluded(project.path)) throw new Error('Missing or excluded projects cannot begin sharing.');
    };
    eligible();
    await this.tunnels.start(id, async () => {
      const origin = await this.processes.verifiedOrigin(id); eligible();
      if (origin.origin === this.sharingOptions.protectedOrigin) throw new Error('The manager interface cannot be shared.');
      return origin;
    });
  }
  async stopSharing(id: string): Promise<void> { this.project(id); await this.tunnels.stop(id); }
  async stopAllSharing(): Promise<void> { await this.tunnels.stopAll(); }
  publicUrl(id: string): string { this.project(id); return this.tunnels.publicUrl(id); }
  async stop(id: string): Promise<void> {
    this.project(id); this.tunnels.block(id);
    try { await this.tunnels.stop(id); await this.processes.stop(id); await this.scan(); }
    finally { this.tunnels.unblock(id); }
  }
  async restart(id: string): Promise<void> { await this.stop(id); await this.start(id); }
  async theme(theme: Theme): Promise<void> { this.state.theme = theme; await this.persistence.save(this.state); this.changed(); }
  async close(): Promise<void> {
    this.cancelScan();
    // A failed scan/save must not bypass cleanup of already launched servers.
    await this.scanJob?.catch(() => undefined);
    const failures: unknown[] = [];
    try { await this.tunnels.stopAll(true); } catch (error) { failures.push(error); }
    try { await this.processes.stopAll(); } catch (error) { failures.push(error); }
    if (failures.length) throw new Error(failures.map((error) => error instanceof Error ? error.message : 'Cleanup failed.').join(' '));
    await this.persistence.save(this.state);
  }
}
