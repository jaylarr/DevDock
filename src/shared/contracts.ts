import type { AppSettings, SettingsPatch, SavedFilter, ImportPreview, Diagnostics } from './settings';
export type Status = 'stopped' | 'starting' | 'running' | 'unverified' | 'stopping' | 'crashed' | 'error';
export type Manager = 'npm' | 'pnpm' | 'yarn' | 'bun';
export const themes = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'high-contrast', label: 'High Contrast' },
  { value: 'matrix', label: 'Matrix' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'sepia', label: 'Sepia' },
] as const;
export type Theme = typeof themes[number]['value'];
export function isTheme(value: unknown): value is Theme { return themes.some((theme) => theme.value === value); }
export type SharingStatus = 'disabled' | 'connecting' | 'sharing' | 'stopping' | 'error';
export interface SharingView { status: SharingStatus; publicUrl?: string; startedAt?: string; error?: string; managed?: boolean }
export interface SharingAvailability { available: boolean; version?: string; error?: string }
export interface CompatibilityReport { summary: string; notes: string[] }
export interface RootFolder { id: string; path: string; name: string; addedAt: string }
export const externalSources = ['vscode', 'codex', 'claude', 'terminal'] as const;
export type ExternalSource = typeof externalSources[number];
export const externalLabels: Record<ExternalSource, string> = { vscode: 'VS Code', codex: 'Codex', claude: 'Claude Code', terminal: 'PowerShell' };
export interface ExternalPresence { source: ExternalSource; state: 'open' | 'working' | 'recent'; seenAt: string }
export interface ExternalDetection { enabled: boolean; checking: boolean; checkedAt?: string; error?: string; installed: ExternalSource[]; connected: ExternalSource[] }
export interface ExternalServer { pid: number; ownerStartedAt: string; port: number; status: 'running' | 'unverified'; localUrl?: string; source?: ExternalSource }
export type ExternalServerTarget = Pick<ExternalServer, 'pid' | 'ownerStartedAt' | 'port'>;
interface ProjectIdentity {
  id: string; name: string; path: string; rootId: string; slug: string;
  missing: boolean;
  pinned?: boolean; lastActiveAt?: string; lastActivitySource?: ExternalSource | 'devdock';
}
export type ProjectMetadata = ProjectIdentity & (
  | { kind: 'script'; devScript: string; manager: Manager; framework: string; entryFile?: never }
  | { kind: 'static'; entryFile: string; framework: 'Static HTML'; devScript?: never; manager?: never }
);
export type Project = ProjectMetadata & {
  status: Status; managed?: boolean; pid?: number; port?: number; localUrl?: string; error?: string; sharing?: SharingView;
  external?: ExternalPresence[];
  externalServers?: ExternalServer[]; externalOutput?: boolean;
};
export function canLaunch(project: ProjectMetadata): boolean { return project.kind === 'static' || project.manager === 'npm'; }
export interface LogEntry { id: number; timestamp: string; stream: 'stdout' | 'stderr' | 'system'; text: string }
export interface Snapshot { roots: RootFolder[]; projects: Project[]; scanning: boolean; diagnostics: string[]; settings: AppSettings; view: { lastFilter: SavedFilter }; revision: number; recovered: boolean; lastScan?: { outcome: 'completed' | 'cancelled' | 'failed'; at: string }; exclusions: { id: string; path: string }[]; sharing: SharingAvailability; externalDetection?: ExternalDetection; externalServerError?: string }
export interface SavedState { version: 3; roots: RootFolder[]; projects: ProjectMetadata[]; settings: AppSettings; view: { lastFilter: SavedFilter }; exclusions: string[] }
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export const channels = {
  snapshot: 'state:get', addRoot: 'roots:add', removeRoot: 'roots:remove', scan: 'roots:scan', cancelScan: 'roots:cancel',
  addExclusion: 'discovery:exclude', removeExclusion: 'discovery:include',
  start: 'projects:start', stop: 'projects:stop', restart: 'projects:restart', open: 'projects:open', folder: 'projects:folder',
  pin: 'projects:pin',
  externalRefresh: 'activity:refresh', externalSetup: 'activity:setup', stopExternal: 'projects:stop-external',
  share: 'sharing:start', stopSharing: 'sharing:stop', stopAllSharing: 'sharing:stop-all', copyPublicLink: 'sharing:copy', openPublicLink: 'sharing:open',
  compatibility: 'sharing:compatibility',
  logs: 'logs:get', clearLogs: 'logs:clear', copyLogs: 'logs:copy', changed: 'state:changed',
  settings: 'settings:update', filter: 'settings:filter', reset: 'settings:reset', dataFolder: 'settings:data-folder',
  exportSettings: 'settings:export', previewImport: 'settings:import-preview', applyImport: 'settings:import-apply', cancelImport: 'settings:import-cancel',
  clearCache: 'settings:clear-cache', diagnostics: 'settings:diagnostics', copyDiagnostics: 'settings:diagnostics-copy',
} as const;
export interface DevManagerAPI {
  snapshot(): Promise<Result<Snapshot>>;
  addRoot(): Promise<Result<void>>;
  removeRoot(id: string): Promise<Result<void>>;
  scan(): Promise<Result<void>>;
  cancelScan(): Promise<Result<void>>;
  addExclusion(): Promise<Result<void>>;
  removeExclusion(id: string): Promise<Result<void>>;
  start(id: string): Promise<Result<void>>;
  stop(id: string): Promise<Result<void>>;
  stopExternal(id: string, servers: ExternalServerTarget[]): Promise<Result<void>>;
  restart(id: string): Promise<Result<void>>;
  open(id: string): Promise<Result<void>>;
  folder(id: string): Promise<Result<void>>;
  setPinned(id: string, pinned: boolean): Promise<Result<void>>;
  refreshExternalActivity(): Promise<Result<void>>;
  setupExternalActivity(source: ExternalSource): Promise<Result<string>>;
  share(id: string): Promise<Result<void>>;
  sharingCompatibility(id: string): Promise<Result<CompatibilityReport>>;
  stopSharing(id: string): Promise<Result<void>>;
  stopAllSharing(): Promise<Result<void>>;
  copyPublicLink(id: string): Promise<Result<void>>;
  openPublicLink(id: string): Promise<Result<void>>;
  logs(id: string): Promise<Result<LogEntry[]>>;
  clearLogs(id: string): Promise<Result<void>>;
  copyLogs(id: string): Promise<Result<void>>;
  updateSettings(patch: SettingsPatch, currentFilter?: string): Promise<Result<void>>;
  rememberFilter(filter: string): Promise<Result<void>>;
  resetPreferences(): Promise<Result<void>>;
  openDataFolder(): Promise<Result<void>>;
  exportSettings(includeDiscovery: boolean): Promise<Result<'cancelled' | 'exported'>>;
  previewImport(): Promise<Result<ImportPreview | null>>;
  applyImport(token: string, discovery: boolean): Promise<Result<void>>;
  cancelImport(token: string): Promise<Result<void>>;
  clearCache(): Promise<Result<void>>;
  getDiagnostics(refresh?: boolean): Promise<Result<Diagnostics>>;
  copyDiagnostics(reportId: string): Promise<Result<void>>;
  onChanged(callback: () => void): () => void;
}
