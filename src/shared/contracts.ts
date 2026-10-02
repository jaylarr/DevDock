export type Status = 'stopped' | 'starting' | 'running' | 'unverified' | 'stopping' | 'crashed' | 'error';
export type Manager = 'npm' | 'pnpm' | 'yarn' | 'bun';
export type Theme = 'system' | 'light' | 'dark';
export interface RootFolder { id: string; path: string; name: string; addedAt: string }
export interface ProjectMetadata {
  id: string; name: string; path: string; rootId: string; slug: string;
  devScript: string; manager: Manager; framework: string; missing: boolean;
}
export interface Project extends ProjectMetadata {
  status: Status; managed?: boolean; pid?: number; port?: number; localUrl?: string; error?: string;
}
export interface LogEntry { id: number; timestamp: string; stream: 'stdout' | 'stderr' | 'system'; text: string }
export interface Snapshot { roots: RootFolder[]; projects: Project[]; scanning: boolean; diagnostics: string[]; theme: Theme }
export interface SavedState { version: 1; roots: RootFolder[]; projects: ProjectMetadata[]; theme: Theme }
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export const channels = {
  snapshot: 'state:get', addRoot: 'roots:add', removeRoot: 'roots:remove', scan: 'roots:scan', cancelScan: 'roots:cancel',
  start: 'projects:start', stop: 'projects:stop', restart: 'projects:restart', open: 'projects:open', folder: 'projects:folder',
  logs: 'logs:get', clearLogs: 'logs:clear', copyLogs: 'logs:copy', theme: 'settings:theme', changed: 'state:changed',
} as const;
export interface DevManagerAPI {
  snapshot(): Promise<Result<Snapshot>>;
  addRoot(): Promise<Result<void>>;
  removeRoot(id: string): Promise<Result<void>>;
  scan(): Promise<Result<void>>;
  cancelScan(): Promise<Result<void>>;
  start(id: string): Promise<Result<void>>;
  stop(id: string): Promise<Result<void>>;
  restart(id: string): Promise<Result<void>>;
  open(id: string): Promise<Result<void>>;
  folder(id: string): Promise<Result<void>>;
  logs(id: string): Promise<Result<LogEntry[]>>;
  clearLogs(id: string): Promise<Result<void>>;
  copyLogs(id: string): Promise<Result<void>>;
  theme(theme: Theme): Promise<Result<void>>;
  onChanged(callback: () => void): () => void;
}
