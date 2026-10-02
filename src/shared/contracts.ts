export type Status = 'stopped' | 'starting' | 'running' | 'unverified' | 'stopping' | 'crashed' | 'error';
export type Manager = 'npm' | 'pnpm' | 'yarn' | 'bun';
export type Theme = 'system' | 'light' | 'dark';
export type SharingStatus = 'disabled' | 'connecting' | 'sharing' | 'stopping' | 'error';
export interface SharingView { status: SharingStatus; publicUrl?: string; startedAt?: string; error?: string; managed?: boolean }
export interface SharingAvailability { available: boolean; version?: string; error?: string }
export interface CompatibilityReport { summary: string; notes: string[] }
export interface RootFolder { id: string; path: string; name: string; addedAt: string }
interface ProjectIdentity {
  id: string; name: string; path: string; rootId: string; slug: string;
  missing: boolean;
}
export type ProjectMetadata = ProjectIdentity & (
  | { kind: 'script'; devScript: string; manager: Manager; framework: string; entryFile?: never }
  | { kind: 'static'; entryFile: string; framework: 'Static HTML'; devScript?: never; manager?: never }
);
export type Project = ProjectMetadata & {
  status: Status; managed?: boolean; pid?: number; port?: number; localUrl?: string; error?: string; sharing?: SharingView;
};
export function canLaunch(project: ProjectMetadata): boolean { return project.kind === 'static' || project.manager === 'npm'; }
export interface LogEntry { id: number; timestamp: string; stream: 'stdout' | 'stderr' | 'system'; text: string }
export interface Snapshot { roots: RootFolder[]; projects: Project[]; scanning: boolean; diagnostics: string[]; theme: Theme; exclusions: { id: string; path: string }[]; sharing: SharingAvailability }
export interface SavedState { version: 2; roots: RootFolder[]; projects: ProjectMetadata[]; theme: Theme; exclusions?: string[] }
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export const channels = {
  snapshot: 'state:get', addRoot: 'roots:add', removeRoot: 'roots:remove', scan: 'roots:scan', cancelScan: 'roots:cancel',
  addExclusion: 'discovery:exclude', removeExclusion: 'discovery:include',
  start: 'projects:start', stop: 'projects:stop', restart: 'projects:restart', open: 'projects:open', folder: 'projects:folder',
  share: 'sharing:start', stopSharing: 'sharing:stop', stopAllSharing: 'sharing:stop-all', copyPublicLink: 'sharing:copy', openPublicLink: 'sharing:open',
  compatibility: 'sharing:compatibility',
  logs: 'logs:get', clearLogs: 'logs:clear', copyLogs: 'logs:copy', theme: 'settings:theme', changed: 'state:changed',
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
  restart(id: string): Promise<Result<void>>;
  open(id: string): Promise<Result<void>>;
  folder(id: string): Promise<Result<void>>;
  share(id: string): Promise<Result<void>>;
  sharingCompatibility(id: string): Promise<Result<CompatibilityReport>>;
  stopSharing(id: string): Promise<Result<void>>;
  stopAllSharing(): Promise<Result<void>>;
  copyPublicLink(id: string): Promise<Result<void>>;
  openPublicLink(id: string): Promise<Result<void>>;
  logs(id: string): Promise<Result<LogEntry[]>>;
  clearLogs(id: string): Promise<Result<void>>;
  copyLogs(id: string): Promise<Result<void>>;
  theme(theme: Theme): Promise<Result<void>>;
  onChanged(callback: () => void): () => void;
}
