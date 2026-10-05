import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import type { ExternalPresence, ExternalServer, ExternalServerTarget, ProjectMetadata, Project, SavedState, Snapshot } from '../../shared/contracts';
import { emptyState, Persistence } from './persistence';
import { scanProjects } from './projectScanner';
import { normalizePath, projectId, within } from './identity';
import { LogManager } from './logManager';
import { ProcessManager } from './processManager';
import { TunnelManager } from './tunnelManager';
import { CloudflareQuickTunnelProvider } from '../tunnels/CloudflareQuickTunnelProvider';
import { allFilter, defaultSettings, filterFromString, patchSettings } from '../../shared/settings';
import type { SettingsPatch } from '../../shared/settings';
import type { TunnelProvider } from '../tunnels/TunnelProvider';
import { ExternalActivity, type ProjectObservation } from './externalActivity';
import { ExternalServers, type ServerObservation } from './externalServers';

export class AppService {
  private state: SavedState = emptyState();
  private diagnostics: string[] = [];
  private scanning?: AbortController;
  private scanJob?: Promise<void>;
  private commits: Promise<void> = Promise.resolve();
  private catalogBusy = false;
  private closing = false;
  private revision = 0;
  private recovered = false;
  private lastScan?: Snapshot['lastScan'];
  readonly logs: LogManager;
  readonly processes: ProcessManager;
  readonly tunnels: TunnelManager;
  readonly externalActivity?: ExternalActivity;
  readonly externalServers?: ExternalServers;
  private servers = new Map<string, ExternalServer[]>();
  private external = new Map<string, ExternalPresence[]>();
  constructor(private persistence: Persistence, private changed: () => void, private sharingOptions: { provider?: TunnelProvider; directory?: string; protectedOrigin?: string; openLocal?: (url: string) => Promise<void>; activityDirectory?: string; activityOptions?: ConstructorParameters<typeof ExternalActivity>[4]; serverOptions?: ConstructorParameters<typeof ExternalServers>[6] } = {}) {
    this.logs = new LogManager(changed);
    this.tunnels = new TunnelManager(sharingOptions.provider ?? new CloudflareQuickTunnelProvider(sharingOptions.directory), this.logs, changed);
    this.processes = new ProcessManager(this.logs, changed, undefined, undefined, (id) => { void this.tunnels.stop(id).catch(() => {}); });
    if (sharingOptions.activityDirectory) this.externalActivity = new ExternalActivity(sharingOptions.activityDirectory, () => this.state.projects.filter((project) => !this.excluded(project.path)), (observations) => this.observeExternal(observations), changed, sharingOptions.activityOptions);
    if (sharingOptions.activityDirectory) this.externalServers = new ExternalServers(sharingOptions.activityDirectory, () => this.state.projects.filter((project) => !this.excluded(project.path)), () => this.externalActivity?.serverHints() ?? [], (servers) => this.observeServers(servers), (id, stream, text) => this.logs.append(id, stream, text), changed, { ...sharingOptions.serverOptions, captureEnabled: () => this.state.settings.discovery.externalActivity });
  }
  async initialize(): Promise<void> {
    const saved = await this.persistence.load();
    if (saved.migrate) await this.persistence.save(saved.state);
    this.state = saved.state;
    this.recovered = !!saved.warning?.includes('Recovered');
    if (saved.warning) this.diagnostics.push(saved.warning);
    await this.tunnels.initialize();
    await this.externalActivity?.configure(this.state.settings.discovery.externalActivity);
    await this.externalServers?.initialize();
  }
  snapshot(): Snapshot {
    return { roots: structuredClone(this.state.roots), projects: this.state.projects.map((project) => this.viewProject(project.id)),
      scanning: !!this.scanning, diagnostics: this.diagnostics.slice(-100), settings: structuredClone(this.state.settings), view: structuredClone(this.state.view), revision: this.revision, recovered: this.recovered, lastScan: this.lastScan && { ...this.lastScan },
      exclusions: (this.state.exclusions ?? []).map((directory) => ({ id: projectId(directory), path: directory })), sharing: { ...this.tunnels.availability }, externalDetection: this.externalActivity?.view(), externalServerError: this.externalServers?.error };
  }
  viewProject(id: string): Project {
    const project = this.project(id), runtime = this.processes.view(project), servers = this.servers.get(id) ?? [], server = servers.find((item) => item.status === 'running') ?? servers[0];
    return { ...runtime, ...(!runtime.managed && server ? { status: server.status, pid: server.pid, port: server.port, localUrl: server.localUrl, error: server.status === 'unverified' ? 'An external process is listening; its HTTP URL is not ready yet.' : undefined } : {}),
      ...(this.externalServers?.isStopping(id) ? { status: 'stopping', localUrl: undefined } : {}),
      pinned: project.pinned, lastActiveAt: project.lastActiveAt, lastActivitySource: project.lastActivitySource, external: structuredClone(this.external.get(id) ?? []), externalServers: structuredClone(servers), externalOutput: this.externalServers?.hasOutput(id) ?? false, sharing: this.tunnels.view(id) };
  }
  private async observeServers(observations: ServerObservation[]): Promise<void> {
    if (this.closing) return;
    const next = new Map<string, ExternalServer[]>(), activity = new Map<string, ExternalServer>();
    for (const observation of observations) {
      const values = next.get(observation.id) ?? []; values.push(observation.server); next.set(observation.id, values);
      const previous = this.servers.get(observation.id) ?? [];
      if (!previous.some((item) => item.pid === observation.server.pid && item.ownerStartedAt === observation.server.ownerStartedAt && item.port === observation.server.port)) {
        this.logs.append(observation.id, 'system', `Detected server started outside DevDock · PID ${observation.server.pid} · Port ${observation.server.port}${observation.server.localUrl ? ` · ${observation.server.localUrl}` : ''}`);
        if (!activity.has(observation.id) || observation.server.ownerStartedAt > activity.get(observation.id)!.ownerStartedAt) activity.set(observation.id, observation.server);
      }
    }
    for (const id of this.servers.keys()) if (!next.has(id)) this.logs.append(id, 'system', 'The external server is no longer listening.');
    this.servers = next;
    if (activity.size) try { await this.commit((latest) => {
      for (const project of latest.projects) { const server = activity.get(project.id); if (server && (!project.lastActiveAt || server.ownerStartedAt > project.lastActiveAt)) { project.lastActiveAt = server.ownerStartedAt; project.lastActivitySource = server.source; } } return latest;
    }); } catch { this.diagnostics.push('External server activity could not be saved.'); }
    this.changed();
  }
  async openUrl(id: string): Promise<string> {
    this.project(id);
    if (!this.processes.isManaged(id)) await this.externalServers?.checkBeforeLaunch();
    const project = this.viewProject(id); if (project.status !== 'running' || !project.localUrl) throw new Error('A verified local server is not available.');
    return project.localUrl;
  }
  private async observeExternal(observations: ProjectObservation[]): Promise<void> {
    if (this.closing) return;
    const newest = new Map<string, ProjectObservation>();
    const presence = new Map<string, Map<string, ExternalPresence>>();
    for (const observation of observations) {
      if (!newest.has(observation.id) || observation.activityAt > newest.get(observation.id)!.activityAt) newest.set(observation.id, observation);
      if (observation.presence) {
        const sources = presence.get(observation.id) ?? new Map<string, ExternalPresence>();
        const previous = sources.get(observation.source);
        if (!previous || observation.presence.state === 'working' || observation.presence.seenAt > previous.seenAt) sources.set(observation.source, observation.presence);
        presence.set(observation.id, sources);
      }
    }
    if (this.state.projects.some((project) => newest.has(project.id) && (!project.lastActiveAt || newest.get(project.id)!.activityAt > project.lastActiveAt))) {
      try { await this.commit((latest) => {
        for (const project of latest.projects) {
          const observed = newest.get(project.id);
          if (observed && (!project.lastActiveAt || observed.activityAt > project.lastActiveAt)) { project.lastActiveAt = observed.activityAt; project.lastActivitySource = observed.source; }
        }
        return latest;
      }); } catch {
        const message = 'External activity was detected, but recent activity could not be saved.';
        if (this.diagnostics.at(-1) !== message) this.diagnostics.push(message);
      }
    }
    this.external = new Map([...presence].map(([id, sources]) => [id, [...sources.values()]])); this.changed();
  }
  project(id: string): ProjectMetadata {
    const project = this.state.projects.find((item) => item.id === id);
    if (!project) throw new Error('Project not found. Rescan the registered folders.');
    return project;
  }
  async setPinned(id: string, pinned: boolean): Promise<void> {
    if (typeof pinned !== 'boolean') throw new Error('Invalid pin value.');
    await this.commit((latest) => {
      const project = latest.projects.find((item) => item.id === id);
      if (!project) throw new Error('Project not found. Rescan the registered folders.');
      project.pinned = pinned;
      return latest;
    });
  }
  async recordActivity(id: string): Promise<void> {
    try {
      await this.commit((latest) => {
        const project = latest.projects.find((item) => item.id === id);
        if (!project) return latest;
        project.lastActiveAt = new Date().toISOString();
        project.lastActivitySource = 'devdock';
        return latest;
      });
    } catch {
      this.diagnostics.push('The project action completed, but recent activity could not be saved.');
      this.changed();
    }
  }
  private commit(update: (latest: SavedState) => SavedState): Promise<void> {
    if (this.closing) return Promise.reject(new Error('The manager is shutting down.'));
    const job = this.commits.catch(() => undefined).then(async () => {
      const next = update(structuredClone(this.state));
      const filter = next.view.lastFilter;
      if (!next.settings.behavior.rememberLastFilter || filter.kind === 'root' && !next.roots.some((root) => root.id === filter.rootId)) next.view.lastFilter = allFilter();
      await this.persistence.save(next);
      this.state = next; this.revision++; this.changed();
    });
    this.commits = job; return job;
  }
  private async changeCatalog(update: (latest: SavedState) => SavedState, requireIdle = false): Promise<void> {
    if (this.scanning || this.catalogBusy) throw new Error('Wait for the scan or catalog change to finish.');
    this.catalogBusy = true;
    try { await this.commit((latest) => {
      if (requireIdle && latest.projects.some((project) => this.processes.isManaged(project.id) || this.tunnels.owns(project.id))) throw new Error('Stop managed projects and sharing sessions before replacing discovery data.');
      return update(latest);
    }); } finally { this.catalogBusy = false; }
  }
  async updateSettings(patch: SettingsPatch, currentFilter?: string): Promise<void> {
    await this.commit((latest) => {
      const settings = patchSettings(latest.settings, patch);
      if (currentFilter !== undefined && settings.behavior.rememberLastFilter) latest.view.lastFilter = filterFromString(currentFilter, latest.roots.map((root) => root.id));
      return { ...latest, settings };
    });
    if (patch.discovery?.externalActivity !== undefined) { await this.externalActivity?.configure(this.state.settings.discovery.externalActivity); await this.externalServers?.readOutputs(); }
  }
  async rememberFilter(value: string): Promise<void> {
    await this.commit((latest) => {
      const filter = filterFromString(value, latest.roots.map((root) => root.id));
      if (latest.settings.behavior.rememberLastFilter) latest.view.lastFilter = filter;
      return latest;
    });
  }
  async resetPreferences(): Promise<void> {
    await this.commit((latest) => ({ ...latest, settings: defaultSettings(), view: { lastFilter: allFilter() } }));
    await this.externalActivity?.configure(this.state.settings.discovery.externalActivity);
  }
  async clearCache(): Promise<void> { await this.changeCatalog((latest) => ({ ...latest, projects: [] }), true); }
  saved(): SavedState { return structuredClone(this.state); }
  configurationRevision(): number { return this.revision; }
  async applySettings(settings: SavedState['settings'], filter: string, discovery?: Pick<SavedState, 'roots' | 'exclusions'>, revision?: number): Promise<void> {
    const update = (latest: SavedState) => {
      if (revision !== this.revision) throw new Error('Settings changed after this preview. Choose the file again.');
      const next = { ...latest, settings: patchSettings(defaultSettings(), settings), ...(discovery ?? {}), projects: discovery ? [] : latest.projects };
      try { next.view = { lastFilter: filterFromString(filter, next.roots.map((root) => root.id)) }; } catch { next.view = { lastFilter: allFilter() }; }
      return next;
    };
    if (discovery) await this.changeCatalog(update, true); else await this.commit(update);
    await this.externalActivity?.configure(this.state.settings.discovery.externalActivity);
  }
  private async rescanAfterChange(): Promise<void> {
    try { await this.scan(); } catch { this.diagnostics.push('Discovery settings were saved, but the scan failed. Retry Rescan.'); this.changed(); }
  }
  async addRoot(directory: string): Promise<void> {
    const resolved = await realpath(directory);
    if (!(await stat(resolved)).isDirectory()) throw new Error('Select a directory.');
    if (this.state.roots.some((root) => normalizePath(root.path) === normalizePath(resolved))) throw new Error('This folder is already registered.');
    if (this.scanning) throw new Error('Wait for the current scan or cancel it before changing roots.');
    await this.changeCatalog((latest) => {
      if (latest.roots.some((root) => normalizePath(root.path) === normalizePath(resolved))) throw new Error('This folder is already registered.');
      latest.roots.push({ id: projectId(resolved), path: resolved, name: path.basename(resolved) || resolved, addedAt: new Date().toISOString() });
      return latest;
    });
    await this.rescanAfterChange();
  }
  async removeRoot(id: string): Promise<void> {
    await this.changeCatalog((latest) => {
      if (!latest.roots.some((root) => root.id === id)) throw new Error('Root folder not found.');
      if (latest.projects.filter((item) => item.rootId === id).some((item) => this.processes.isManaged(item.id) || this.tunnels.owns(item.id))) throw new Error('Stop this root’s managed projects and sharing sessions before removing its registration.');
      return { ...latest, roots: latest.roots.filter((root) => root.id !== id), projects: latest.projects.filter((item) => item.rootId !== id) };
    });
  }
  scan(): Promise<void> {
    if (this.scanJob) return this.scanJob;
    if (this.catalogBusy || this.closing) return Promise.reject(new Error('Wait for the catalog change to finish.'));
    this.scanning = new AbortController();
    const controller = this.scanning;
    const roots = [...this.state.roots];
    this.changed();
    this.scanJob = (async () => {
      try {
        const result = await scanProjects(roots, controller.signal, this.state.exclusions);
        this.diagnostics = result.diagnostics.slice(0, 100);
        if (result.cancelled) { this.lastScan = { outcome: 'cancelled', at: new Date().toISOString() }; this.diagnostics.push('Scan cancelled. The previous project list was retained.'); return; }
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
        const projects = [...discovered.values()].sort((a, b) => a.name.localeCompare(b.name));
        await this.commit((latest) => {
          const previous = new Map(latest.projects.map((project) => [project.id, project]));
          return { ...latest, projects: projects.map((project) => {
            const saved = previous.get(project.id);
            return { ...project, pinned: saved?.pinned, lastActiveAt: saved?.lastActiveAt, lastActivitySource: saved?.lastActivitySource };
          }) };
        });
        this.lastScan = { outcome: 'completed', at: new Date().toISOString() };
      } catch (error) { this.lastScan = { outcome: 'failed', at: new Date().toISOString() }; throw error; } finally { this.scanning = undefined; this.scanJob = undefined; this.changed(); }
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
    await this.changeCatalog((latest) => {
      if (latest.exclusions.some((item) => normalizePath(item) === normalizePath(resolved))) throw new Error('This folder is already excluded.');
      return { ...latest, exclusions: [...latest.exclusions, resolved] };
    });
    await this.rescanAfterChange();
  }
  async removeExclusion(id: string): Promise<void> {
    await this.changeCatalog((latest) => {
      if (!latest.exclusions.some((directory) => projectId(directory) === id)) throw new Error('Excluded folder not found.');
      return { ...latest, exclusions: latest.exclusions.filter((directory) => projectId(directory) !== id) };
    });
    await this.rescanAfterChange();
  }
  async start(id: string): Promise<void> {
    if (this.catalogBusy || this.closing) throw new Error('Wait for the catalog change to finish.');
    const autoOpen = this.state.settings.behavior.autoOpenBrowser;
    const project = this.project(id);
    if (this.excluded(project.path)) throw new Error('This folder is excluded from discovery. Stop its managed process or remove the exclusion before starting it.');
    if (project.missing) throw new Error('This project is missing or no longer runnable. Rescan before starting.');
    // Validate current ownership across all roots, not just stale cached static metadata.
    await this.processes.start(project, async () => {
      const result = await scanProjects([...this.state.roots], undefined, this.state.exclusions);
      const current = result.projects.find((item) => item.id === id);
      if (this.excluded(project.path) || !this.state.projects.some((item) => item.id === id)) throw new Error('Project registration changed before launch. Rescan before starting.');
      if (result.cancelled || !current || current.kind !== project.kind || current.entryFile !== project.entryFile) throw new Error('Project detection changed or could not be verified. Rescan before starting.');
      await this.externalActivity?.refresh(); await this.externalServers?.checkBeforeLaunch();
      const external = this.state.projects.find((item) => (this.servers.get(item.id)?.length ?? 0) > 0 && (within(item.path, project.path) || within(project.path, item.path)));
      if (external) throw new Error(`A server for ${external.name} is already running outside DevDock. Use Open, or stop it in its original terminal before starting another.`);
    }, async (url, current) => {
      if (!autoOpen || this.closing || !current() || !this.sharingOptions.openLocal) return;
      try { await this.sharingOptions.openLocal(url); } catch { this.logs.append(id, 'system', 'Could not open the browser. Use Open to retry.'); this.diagnostics.push('Automatic browser opening failed. Use the project Open action to retry.'); this.changed(); }
    });
    await this.recordActivity(id);
  }
  async share(id: string): Promise<void> {
    const eligible = () => {
      if (this.catalogBusy || this.closing) throw new Error('Wait for the catalog change to finish.');
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
    if (!this.processes.isManaged(id) && this.servers.get(id)?.length) throw new Error('Stop this external server in the terminal where it was started.');
    this.project(id); this.tunnels.block(id);
    try { await this.tunnels.stop(id); await this.processes.stop(id); await this.scan(); }
    finally { this.tunnels.unblock(id); }
  }
  async stopExternal(id: string, servers: ExternalServerTarget[]): Promise<void> {
    this.project(id);
    if (this.closing || this.processes.isManaged(id) || !this.externalServers) throw new Error('This project does not have an external server that can be stopped.');
    await this.externalServers.stop(id, servers);
  }
  async restart(id: string): Promise<void> { await this.stop(id); await this.start(id); }
  async close(): Promise<void> {
    await this.externalServers?.close();
    await this.externalActivity?.close();
    this.closing = true;
    this.cancelScan();
    await this.scanJob?.catch(() => undefined);
    await this.commits.catch(() => undefined);
    // A failed scan/save must not bypass cleanup of already launched servers.
    const failures: unknown[] = [];
    try { await this.tunnels.stopAll(true); } catch (error) { failures.push(error); }
    try { await this.processes.stopAll(); } catch (error) { failures.push(error); }
    if (failures.length) { this.closing = false; throw new Error(failures.map((error) => error instanceof Error ? error.message : 'Cleanup failed.').join(' ')); }
    // All configuration changes are already durable; runtime objects are never saved.
  }
}
