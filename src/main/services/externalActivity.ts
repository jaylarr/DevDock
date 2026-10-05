import { lstat, mkdir, open, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { externalSources, type ExternalSource, type ExternalPresence, type ExternalDetection, type ProjectMetadata } from '../../shared/contracts';
import { record } from '../../shared/settings';
import { within } from './identity';

export interface ActivityProcess { pid: number; parent: number; startedAt: string }
export interface ActivityReport {
  version: 1; source: ExternalSource; session: string; pid: number; ownerStartedAt?: string; seenAt: string; state: 'open' | 'working' | 'closed';
  folders: { path: string; activityAt: string }[];
  terminals?: { pid: number; ownerStartedAt: string; path: string }[];
}
export interface ProjectObservation { id: string; source: ExternalSource; activityAt: string; presence?: ExternalPresence }
const timestamp = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
export function readReport(value: unknown, now: number): ActivityReport | undefined {
  if (!record(value) || value.version !== 1 || !externalSources.some((source) => source === value.source) || typeof value.session !== 'string' || !/^[a-f0-9]{64}$/.test(value.session)
    || !Number.isSafeInteger(value.pid) || Number(value.pid) < 0 || !timestamp(value.seenAt) || Date.parse(value.seenAt) > now + 30000 || now - Date.parse(value.seenAt) > 7 * 86400000
    || !['open', 'working', 'closed'].includes(String(value.state)) || !Array.isArray(value.folders) || value.folders.length > 100
    || Number(value.pid) > 0 && !timestamp(value.ownerStartedAt)) return;
  const folders: ActivityReport['folders'] = [];
  for (const folder of value.folders) {
    if (!record(folder) || typeof folder.path !== 'string' || folder.path.length > 32768 || folder.path.includes('\0') || !/^[a-z]:[\\/]/i.test(folder.path)
      || !timestamp(folder.activityAt) || Date.parse(folder.activityAt) > Date.parse(value.seenAt) + 30000) return;
    folders.push({ path: path.win32.normalize(folder.path), activityAt: new Date(folder.activityAt).toISOString() });
  }
  const terminals: NonNullable<ActivityReport['terminals']> = [];
  if (value.terminals !== undefined) {
    if (value.source !== 'vscode' || !Array.isArray(value.terminals) || value.terminals.length > 100) return;
    for (const terminal of value.terminals) {
      if (!record(terminal) || !Number.isSafeInteger(terminal.pid) || Number(terminal.pid) <= 0 || !timestamp(terminal.ownerStartedAt)
        || typeof terminal.path !== 'string' || terminal.path.length > 32768 || terminal.path.includes('\0') || !/^[a-z]:[\\/]/i.test(terminal.path)) return;
      terminals.push({ pid: Number(terminal.pid), ownerStartedAt: terminal.ownerStartedAt, path: path.win32.normalize(terminal.path) });
    }
  }
  return { version: 1, source: value.source as ExternalSource, session: value.session, pid: Number(value.pid), ownerStartedAt: value.ownerStartedAt as string | undefined,
    seenAt: new Date(value.seenAt).toISOString(), state: value.state as ActivityReport['state'], folders, ...(value.terminals !== undefined ? { terminals } : {}) };
}
function descendant(pid: number, parent: number, processes: Map<number, ActivityProcess>): boolean {
  const seen = new Set<number>();
  while (pid && !seen.has(pid)) { if (pid === parent) return true; seen.add(pid); pid = processes.get(pid)?.parent ?? 0; }
  return false;
}
export function matchReports(reports: ActivityReport[], projects: ProjectMetadata[], processes: ActivityProcess[], now: number, managerPid: number): ProjectObservation[] {
  const candidates = [...projects].filter((project) => !project.missing).sort((a, b) => b.path.length - a.path.length);
  const processMap = new Map(processes.map((process) => [process.pid, process]));
  const observations: ProjectObservation[] = [];
  for (const report of reports) {
    if (report.pid && descendant(report.pid, managerPid, processMap)) continue;
    const owner = processMap.get(report.pid);
    const fresh = report.source !== 'vscode' || now - Date.parse(report.seenAt) < 45000;
    const alive = fresh && !!owner && !!report.ownerStartedAt && Math.abs(Date.parse(owner.startedAt) - Date.parse(report.ownerStartedAt)) < 5000;
    const state = report.state === 'closed' ? undefined : alive ? report.state : report.pid === 0 && now - Date.parse(report.seenAt) < 90000 ? 'recent' : undefined;
    for (const folder of report.folders) {
      const project = candidates.find((project) => within(folder.path, project.path));
      if (!project) continue;
      observations.push({ id: project.id, source: report.source, activityAt: folder.activityAt, presence: state ? { source: report.source, state, seenAt: report.seenAt } : undefined });
    }
  }
  return observations;
}
export async function activityProcesses(): Promise<ActivityProcess[]> {
  if (process.platform !== 'win32') return [];
  const binary = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // Deliberately excludes command lines, window contents, and environment values.
  const query = 'Get-CimInstance Win32_Process | Select-Object @{n="pid";e={$_.ProcessId}},@{n="parent";e={$_.ParentProcessId}},@{n="startedAt";e={if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString("o")}}} | ConvertTo-Json -Compress';
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['-NoProfile', '-NonInteractive', '-Command', query], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'], signal: AbortSignal.timeout(4000) });
    let output = ''; let failed = false;
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); if (output.length > 1000000) { failed = true; child.kill(); } });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0 || failed) { reject(new Error('Process check unavailable.')); return; }
      try { const result: unknown = JSON.parse(output); const rows = Array.isArray(result) ? result : [result];
        resolve(rows.filter((row) => record(row) && Number.isSafeInteger(row.pid) && Number.isSafeInteger(row.parent) && timestamp(row.startedAt)) as ActivityProcess[]);
      } catch { reject(new Error('Invalid process check.')); }
    });
  });
}
export class ExternalActivity {
  private reports: ActivityReport[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private job?: Promise<void>;
  private generation = 0;
  private closed = false;
  private configurations: Promise<void> = Promise.resolve();
  private status: ExternalDetection = { enabled: false, checking: false, installed: [], connected: [] };
  readonly reportsDirectory: string;
  constructor(readonly directory: string, private projects: () => ProjectMetadata[], private observed: (observations: ProjectObservation[]) => Promise<void>, private changed: () => void,
    private options: { processes?: () => Promise<ActivityProcess[]>; now?: () => number; managerPid?: number } = {}) { this.reportsDirectory = path.join(directory, 'reports'); }
  view(): ExternalDetection { return structuredClone(this.status); }
  serverHints(): ActivityReport[] { return this.reports; }
  configure(enabled: boolean): Promise<void> {
    const job = this.configurations.catch(() => undefined).then(() => this.applyConfiguration(enabled));
    this.configurations = job; return job;
  }
  private async applyConfiguration(enabled: boolean): Promise<void> {
    if (this.closed) return;
    this.generation++; if (this.timer) clearInterval(this.timer); this.timer = undefined;
    await mkdir(this.reportsDirectory, { recursive: true });
    const policy = path.join(this.directory, 'policy.json');
    await writeFile(`${policy}.tmp`, JSON.stringify({ version: 1, enabled }), 'utf8'); await rename(`${policy}.tmp`, policy);
    this.status.enabled = enabled;
    const entries = await readdir(this.directory); this.status.installed = externalSources.filter((source) => entries.includes(`${source}.installed`));
    if (!enabled) { this.reports = []; this.status.connected = []; this.status.error = undefined; await this.observed([]); this.changed(); return; }
    if (!this.closed) { this.timer = setInterval(() => { void this.refresh(); }, 5000); this.timer.unref(); await this.refresh(); }
  }
  async installed(source: ExternalSource): Promise<void> {
    if (!this.status.installed.includes(source)) this.status.installed.push(source); this.changed();
  }
  async refresh(): Promise<void> {
    if (this.job) return this.job;
    if (this.closed || !this.status.enabled) return;
    const generation = this.generation;
    this.status.checking = true; this.changed();
    this.job = (async () => {
      const now = this.options.now?.() ?? Date.now();
      try {
        const reports: ActivityReport[] = [];
        const candidates: { file: string; modified: number }[] = [];
        for (const file of (await readdir(this.reportsDirectory)).filter((file) => /^[a-f0-9]{64}\.json$/.test(file))) {
          try {
            const filename = path.join(this.reportsDirectory, file), info = await lstat(filename);
            if (!info.isFile() || info.isSymbolicLink() || info.size > 32768) continue;
            if (now - info.mtimeMs > 7 * 86400000) { await unlink(filename); continue; }
            candidates.push({ file, modified: info.mtimeMs });
          } catch { /* A reporter may replace or remove its file during discovery. */ }
        }
        // A growing session history must not crowd out currently reporting tools.
        const files = candidates.sort((a, b) => b.modified - a.modified).slice(0, 500);
        for (const { file } of files) {
          const filename = path.join(this.reportsDirectory, file);
          try {
            const info = await lstat(filename); if (!info.isFile() || info.isSymbolicLink() || info.size > 32768) continue;
            const handle = await open(filename, 'r');
            try { const buffer = Buffer.alloc(32769); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); if (bytesRead > 32768) continue;
              const report = readReport(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')), now); if (report) reports.push(report);
            } finally { await handle.close(); }
          } catch { /* Atomic writers, closed sessions, and malformed reports are safely skipped. */ }
        }
        const processes = reports.some((report) => report.pid > 0 && report.state !== 'closed') ? await (this.options.processes ?? activityProcesses)() : [];
        if (generation !== this.generation || this.closed) return;
        this.reports = reports;
        const observations = matchReports(reports, this.projects(), processes, now, this.options.managerPid ?? process.pid);
        await this.observed(observations);
        this.status.connected = [...new Set(observations.filter((item) => item.presence).map((item) => item.source))];
        this.status.checkedAt = new Date(now).toISOString(); this.status.error = undefined;
      } catch {
        if (generation === this.generation && !this.closed) { this.status.error = 'External activity could not be checked. Retry the check.'; this.status.connected = []; await this.observed([]); }
      } finally { this.status.checking = false; this.job = undefined; this.changed(); }
    })();
    return this.job;
  }
  async close(): Promise<void> { this.closed = true; this.generation++; if (this.timer) clearInterval(this.timer); await this.configurations.catch(() => undefined); await this.job; }
}
