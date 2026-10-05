import { spawn } from 'node:child_process';
import { lstat, mkdir, open, readdir, unlink, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ExternalServer, ExternalServerTarget, LogEntry, ProjectMetadata } from '../../shared/contracts';
import { record } from '../../shared/settings';
import type { ActivityProcess, ActivityReport } from './externalActivity';
import { descendsFrom } from './processOwnership';
import { within } from './identity';
import { readStopTargets, stopServerProcesses } from './externalServerStop';

export interface ServerProcess extends ActivityProcess { entryPath?: string; name?: string }
export interface Listener { pid: number; port: number; host: string }
export interface ServerObservation { id: string; path: string; server: ExternalServer }
async function command(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], signal: AbortSignal.timeout(5000) }); let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); if (output.length > 2000000) child.kill(); }); child.once('error', reject);
    child.once('close', (code) => code === 0 && output.length <= 2000000 ? resolve(output) : reject(new Error('External server check unavailable.')));
  });
}
export async function serverProcesses(): Promise<ServerProcess[]> {
  if (process.platform !== 'win32') return [];
  // Inspect only the executable's script argument for Node-family runtimes. Never return full command lines or environment values.
  const query = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $rows = @(Get-CimInstance Win32_Process | ForEach-Object {
    $entry = $null
    if ($_.Name -match '^(node|bun|deno)\\.exe$' -and $_.CommandLine) {
      $arguments = @([regex]::Matches($_.CommandLine, '"([^"\\r\\n]*)"|(\\S+)') | ForEach-Object { if ($_.Groups[1].Success) {$_.Groups[1].Value} else {$_.Groups[2].Value} })
      for ($index=1; $index -lt $arguments.Count; $index++) {
        $argument=$arguments[$index]
        if ($argument -in @('-e','--eval','-p','--print')) { break }
        if ($argument -in @('-r','--require','--import','--loader','--experimental-loader')) { $index++; continue }
        if ($argument.StartsWith('-')) { continue }
        if ($argument -match '^[a-zA-Z]:[\\\\/].+\\.(cjs|mjs|js|ts)$') { $entry=$argument }
        break
      }
    }
    [pscustomobject]@{pid=$_.ProcessId;parent=$_.ParentProcessId;startedAt=$(if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')});entryPath=$entry;name=$_.Name}
  }); ConvertTo-Json -InputObject $rows -Compress`;
  const text = await command(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', query]);
  const rows: unknown = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error('Invalid server process check.');
  return (rows.filter((row) => record(row) && Number.isSafeInteger(row.pid) && Number.isSafeInteger(row.parent) && typeof row.startedAt === 'string' && Number.isFinite(Date.parse(row.startedAt))) as ServerProcess[]).map((row) => ({ ...row, startedAt: new Date(row.startedAt).toISOString() }));
}
export function parseListeners(text: string): Listener[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const fields = line.trim().split(/\s+/); if (fields[0] !== 'TCP' || fields[3] !== 'LISTENING') return [];
    const address = fields[1]?.match(/^(.*):(\d+)$/); const pid = Number(fields[4]), port = Number(address?.[2]);
    if (!address || !Number.isSafeInteger(pid) || pid <= 0 || !Number.isInteger(port) || port < 1 || port > 65535) return [];
    const host = ['0.0.0.0', '127.0.0.1'].includes(address[1]!) ? '127.0.0.1' : ['[::]', '[::1]'].includes(address[1]!) ? '[::1]' : undefined;
    return host ? [{ pid, port, host }] : [];
  });
}
export async function serverListeners(): Promise<Listener[]> { return process.platform === 'win32' ? parseListeners(await command(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/netstat.exe'), ['-ano'])) : []; }
const sameBirth = (a: string | undefined, b: string) => !!a && Math.abs(Date.parse(a) - Date.parse(b)) < 5000;
function processParents(processes: ServerProcess[]): Map<number, number> {
  const inventory = new Map(processes.map((item) => [item.pid, item]));
  return new Map(processes.map((item) => {
    const parent = inventory.get(item.parent);
    return [item.pid, parent && Date.parse(parent.startedAt) <= Date.parse(item.startedAt) ? item.parent : 0];
  }));
}
export function matchServers(projects: ProjectMetadata[], processes: ServerProcess[], listeners: Listener[], hints: ActivityReport[], now: number, managerPid: number): ServerObservation[] {
  const catalog = projects.filter((project) => !project.missing).sort((a, b) => b.path.length - a.path.length), inventory = new Map(processes.map((item) => [item.pid, item]));
  const parents = processParents(processes), observations: ServerObservation[] = [];
  for (const listener of listeners) {
    const owner = inventory.get(listener.pid); if (!owner || descendsFrom(owner.pid, managerPid, parents)) continue;
    const candidates: { project: ProjectMetadata; source?: ExternalServer['source'] }[] = [];
    const entry = owner.entryPath && catalog.find((project) => within(owner.entryPath!, project.path)); if (entry) candidates.push({ project: entry });
    for (const hint of hints) {
      const reporter = inventory.get(hint.pid);
      if (hint.state === 'closed' || !reporter || !sameBirth(hint.ownerStartedAt, reporter.startedAt) || now - Date.parse(hint.seenAt) > (hint.source === 'vscode' ? 45000 : 7 * 86400000)) continue;
      const terminals = hint.source === 'terminal' ? hint.folders.map((folder) => ({ pid: hint.pid, ownerStartedAt: hint.ownerStartedAt!, path: folder.path })) : hint.terminals ?? [];
      for (const terminal of terminals) {
        const root = inventory.get(terminal.pid); if (!root || !sameBirth(terminal.ownerStartedAt, root.startedAt) || !descendsFrom(owner.pid, root.pid, parents)) continue;
        const project = catalog.find((project) => within(terminal.path, project.path)); if (project) candidates.push({ project, source: hint.source });
      }
    }
    const candidate = candidates.sort((a, b) => b.project.path.length - a.project.path.length || Number(!!b.source) - Number(!!a.source))[0];
    if (candidate && !observations.some((item) => item.id === candidate.project.id && item.server.pid === owner.pid && item.server.port === listener.port)) observations.push({ id: candidate.project.id, path: candidate.project.path, server: { pid: owner.pid, ownerStartedAt: new Date(owner.startedAt).toISOString(), port: listener.port, status: 'unverified', localUrl: `http://${listener.host}:${listener.port}`, source: candidate.source } });
  }
  return observations;
}
const serverKey = (server: ExternalServerTarget) => `${server.pid}:${server.ownerStartedAt}:${server.port}`;
export function planExternalStop(id: string, targets: ExternalServerTarget[], servers: ServerObservation[], processes: ServerProcess[], managerPid: number): ServerProcess[] {
  const inventory = new Map(processes.map((item) => [item.pid, item])), parents = processParents(processes);
  const matches = servers.filter((item) => item.id === id), expected = new Set(targets.map(serverKey));
  if (expected.size !== targets.length) throw new Error('Invalid external server stop request.');
  for (const target of targets) {
    const owner = inventory.get(target.pid);
    if (owner && new Date(owner.startedAt).toISOString() !== target.ownerStartedAt) throw new Error('The external server process changed. Refresh before stopping it.');
  }
  if (!matches.length && targets.every((target) => !inventory.has(target.pid))) return [];
  if (matches.length !== expected.size || matches.some((match) => !expected.has(serverKey(match.server)))) throw new Error('The external servers changed. Refresh before stopping them.');
  const roots = [...new Set(targets.map((target) => target.pid))];
  for (const pid of roots) {
    const owner = inventory.get(pid);
    if (!owner || !/^(node|bun|deno)\.exe$/i.test(owner.name ?? '') || descendsFrom(pid, managerPid, parents) || descendsFrom(managerPid, pid, parents)) throw new Error('This external process cannot be stopped safely. Stop it in its original terminal.');
  }
  const tree = processes.filter((item) => roots.some((pid) => descendsFrom(item.pid, pid, parents)));
  if (servers.some((match) => match.id !== id && tree.some((item) => item.pid === match.server.pid))) throw new Error('The server process tree also runs another registered project. Stop it in its original terminal.');
  if (tree.length > 256 || tree.some((item) => !item.name || /^(code(?: - insiders)?|codex|claude|electron|powershell|pwsh|cmd|conhost|windowsterminal|explorer|chrome|msedge|firefox)\.exe$/i.test(item.name)
    || item.pid === managerPid || descendsFrom(managerPid, item.pid, parents))) throw new Error('The server process tree includes a protected app or terminal. Stop it in its original terminal.');
  // The roots go first to stop them creating more workers; editor and terminal ancestors are never included.
  return [...tree.filter((item) => roots.includes(item.pid)), ...tree.filter((item) => !roots.includes(item.pid))];
}
export interface OutputReport { version: 1; session: string; pid: number; ownerStartedAt: string; terminalPid: number; terminalStartedAt: string; path: string; seenAt: string; state: 'running' | 'closed'; entries: { sequence: number; text: string }[] }
export function readOutput(value: unknown, now: number): OutputReport | undefined {
  if (!record(value) || value.version !== 1 || typeof value.session !== 'string' || !/^[a-f0-9]{64}$/.test(value.session) || !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0 || !Number.isSafeInteger(value.terminalPid) || Number(value.terminalPid) <= 0
    || typeof value.path !== 'string' || value.path.includes('\0') || !/^[a-z]:[\\/]/i.test(value.path) || value.path.length > 32768 || !['running', 'closed'].includes(String(value.state))
    || ![value.ownerStartedAt, value.terminalStartedAt, value.seenAt].every((time) => typeof time === 'string' && time.length <= 40 && Number.isFinite(Date.parse(time)))
    || now - Date.parse(String(value.seenAt)) > 45000 || Date.parse(String(value.seenAt)) > now + 30000 || !Array.isArray(value.entries) || value.entries.length > 128) return;
  let previous = 0;
  for (const entry of value.entries) { if (!record(entry) || !Number.isSafeInteger(entry.sequence) || Number(entry.sequence) <= previous || typeof entry.text !== 'string' || entry.text.length > 4096) return; previous = Number(entry.sequence); }
  return value as unknown as OutputReport;
}
export class ExternalServers {
  private timer?: ReturnType<typeof setInterval>; private outputTimer?: ReturnType<typeof setInterval>; private job?: Promise<void>; private outputJob?: Promise<void>; private closed = false;
  private processes: ServerProcess[] = []; private checkedAt = 0; private servers: ServerObservation[] = []; private sequences = new Map<string, number>(); private feeds = new Set<string>();
  private policyPaths = '';
  private stops = new Map<string, Promise<void>>();
  error?: string;
  constructor(readonly directory: string, private projects: () => ProjectMetadata[], private hints: () => ActivityReport[], private observed: (servers: ServerObservation[]) => Promise<void>,
    private log: (id: string, stream: LogEntry['stream'], text: string) => void, private changed: () => void,
    private options: { processes?: () => Promise<ServerProcess[]>; listeners?: () => Promise<Listener[]>; probe?: (url: string) => Promise<boolean>; now?: () => number; managerPid?: number; captureEnabled?: () => boolean; stopProcesses?: (targets: ServerProcess[]) => Promise<void> } = {}) {}
  hasOutput(id: string): boolean { return this.feeds.has(id); }
  isStopping(id: string): boolean { return this.stops.has(id); }
  async stop(id: string, input: ExternalServerTarget[]): Promise<void> {
    const targets = readStopTargets(input);
    if (this.closed) throw new Error('External server detection is shutting down.');
    if (this.stops.has(id)) throw new Error('This external server is already stopping.');
    const job = Promise.resolve().then(async () => {
      await this.job; await this.refresh();
      if (this.closed || this.error) throw new Error('External servers could not be verified. Refresh before stopping them.');
      const plan = planExternalStop(id, targets, this.servers, this.processes, this.options.managerPid ?? process.pid);
      if (!plan.length) return;
      try {
        this.log(id, 'system', 'Stopping the verified external development server. Its editor and terminal remain open.');
        await (this.options.stopProcesses ?? stopServerProcesses)(plan);
        await this.job; await this.refresh();
        if (this.error) throw new Error('Stop was requested, but server state could not be verified. Refresh to check it.');
        if (this.servers.some((match) => match.id === id && targets.some((target) => target.pid === match.server.pid && target.ownerStartedAt === match.server.ownerStartedAt))) throw new Error('The external server is still listening. Retry or stop it in its original terminal.');
        this.log(id, 'system', 'The external development server stopped.');
      } catch (error) {
        await this.job; await this.refresh();
        this.log(id, 'system', error instanceof Error ? error.message : 'External server stop failed.'); throw error;
      }
    }).finally(() => { this.stops.delete(id); this.changed(); });
    this.stops.set(id, job); this.changed(); return job;
  }
  async initialize(): Promise<void> {
    await mkdir(path.join(this.directory, 'output'), { recursive: true });
    await this.refresh(); this.timer = setInterval(() => { void this.refresh(); }, 5000); this.timer.unref();
    this.outputTimer = setInterval(() => { void this.readOutputs(); }, 500); this.outputTimer.unref();
  }
  async checkBeforeLaunch(): Promise<void> { await this.job; await this.refresh(); if (this.error) throw new Error('Running servers could not be checked. Retry before starting this project.'); }
  async refresh(): Promise<void> {
    if (this.closed) return; if (this.job) return this.job;
    this.job = (async () => {
      try {
        const projects = this.projects(); await this.publishCatalog(projects);
        if (!projects.length) { this.servers = []; await this.observed([]); this.error = undefined; return; }
        const [processes, listeners] = await Promise.all([(this.options.processes ?? serverProcesses)(), (this.options.listeners ?? serverListeners)()]);
        const now = this.options.now?.() ?? Date.now(), matches = matchServers(this.projects(), processes, listeners, this.hints(), now, this.options.managerPid ?? process.pid);
        await Promise.all(matches.map(async (match) => {
          const url = match.server.localUrl!;
          try { const ready = this.options.probe ? await this.options.probe(url) : await this.probe(url); if (ready) match.server.status = 'running'; else match.server.localUrl = undefined; } catch { match.server.localUrl = undefined; }
        }));
        if (this.closed) return;
        this.processes = processes; this.checkedAt = now; this.servers = matches; this.error = undefined; await this.observed(matches); await this.readOutputs();
      } catch { if (!this.closed) { this.error = 'External servers could not be checked. Their last detected state is retained.'; this.changed(); } }
      finally { this.job = undefined; }
    })(); return this.job;
  }
  private async probe(url: string): Promise<boolean> { const response = await fetch(url, { signal: AbortSignal.timeout(900), redirect: 'manual' }); await response.body?.cancel(); return true; }
  private async publishCatalog(projects: ProjectMetadata[]): Promise<void> {
    const paths = JSON.stringify(projects.map((project) => project.path).sort()); if (paths === this.policyPaths) return;
    const target = path.join(this.directory, 'catalog.json'), temporary = target + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, paths, 'utf8'); await rename(temporary, target); this.policyPaths = paths;
  }
  async readOutputs(): Promise<void> {
    if (this.closed) return; if (this.outputJob) return this.outputJob;
    this.outputJob = (async () => {
      const now = this.options.now?.() ?? Date.now(), feeds = new Set<string>();
      try {
        const directory = path.join(this.directory, 'output'), files = (await readdir(directory)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).slice(0, 500);
        for (const filename of files) {
          const file = path.join(directory, filename); let report: OutputReport | undefined;
          try {
            const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) continue;
            if (now - info.mtimeMs > 120000) { await unlink(file); continue; } if (info.size > 262144) continue;
            const handle = await open(file, 'r'); try { const buffer = Buffer.alloc(262145), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); if (bytesRead <= 262144) report = readOutput(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')), now); } finally { await handle.close(); }
          } catch { continue; }
          if (!report || now - this.checkedAt > 15000 || this.closed || this.options.captureEnabled?.() === false) continue;
          const reporter = this.processes.find((item) => item.pid === report.pid), terminal = this.processes.find((item) => item.pid === report.terminalPid);
          if (!reporter || !terminal || !sameBirth(report.ownerStartedAt, reporter.startedAt) || !sameBirth(report.terminalStartedAt, terminal.startedAt)) continue;
          const parents = processParents(this.processes);
          const matched = this.servers.filter((item) => within(report!.path, item.path) && descendsFrom(item.server.pid, report!.terminalPid, parents));
          if (!matched.length) continue;
          for (const id of new Set(matched.map((item) => item.id))) { if (report.state === 'running') feeds.add(id); for (const entry of report.entries) if (entry.sequence > (this.sequences.get(report.session) ?? 0)) this.log(id, 'stdout', entry.text); }
          const latest = report.entries.at(-1)?.sequence; if (latest !== undefined) this.sequences.set(report.session, latest);
        }
        while (this.sequences.size > 500) this.sequences.delete(this.sequences.keys().next().value!);
      } catch { /* The bridge can be absent, loading, or stopping. */ }
      if (!this.closed) { if ([...feeds].sort().join() !== [...this.feeds].sort().join()) { this.feeds = feeds; this.changed(); } }
    })().finally(() => { this.outputJob = undefined; }); return this.outputJob;
  }
  async close(): Promise<void> { this.closed = true; clearInterval(this.timer); clearInterval(this.outputTimer); await Promise.allSettled(this.stops.values()); await this.job; await this.outputJob; }
}
