const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { stripVTControlCharacters } = require('node:util');
const configuration = require('./bridge-config.json');
let timer, queue = Promise.resolve();
const session = createHash('sha256').update('vscode:' + randomUUID()).digest('hex');
const ownerStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
const activity = new Map();
const births = new Map(), executions = new Map();
const localPath = (uri) => uri?.scheme === 'file' && /^[a-z]:[\\/]/i.test(uri.fsPath) ? uri.fsPath : undefined;
function within(child, parent) { const value = path.win32.relative(parent.toLowerCase(), child.toLowerCase()); return value === '' || value !== '..' && !value.startsWith('..\\') && !path.win32.isAbsolute(value); }
async function terminalOwner(terminal) {
  if (vscode.env.remoteName) return;
  const pid = await terminal.processId; if (!Number.isSafeInteger(pid) || pid <= 0) return;
  const previous = births.get(terminal); if (previous?.pid === pid) return previous;
  const startedAt = await new Promise((resolve) => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`], { windowsHide: true, timeout: 3000, maxBuffer: 1024 }, (error, stdout) => resolve(error ? undefined : stdout.trim())));
  if (!startedAt || !Number.isFinite(Date.parse(startedAt))) return;
  const owner = { pid, ownerStartedAt: new Date(startedAt).toISOString() }; births.set(terminal, owner); return owner;
}
async function terminals() {
  const values = await Promise.all(vscode.window.terminals.map(async (terminal) => {
    const cwd = executions.get(terminal)?.path || localPath(terminal.shellIntegration?.cwd) || localPath(terminal.creationOptions?.cwd);
    if (!cwd) return; const owner = await terminalOwner(terminal); return owner ? { ...owner, path: cwd } : undefined;
  })); return values.filter(Boolean).slice(0, 100);
}
async function permitted(cwd) {
  try {
    const policy = JSON.parse(await fs.readFile(path.join(configuration.dataDirectory, 'policy.json'), 'utf8'));
    const catalog = JSON.parse(await fs.readFile(path.join(configuration.dataDirectory, 'catalog.json'), 'utf8'));
    return policy.enabled === true && Array.isArray(catalog) && catalog.some((folder) => typeof folder === 'string' && within(cwd, folder));
  } catch { return false; }
}
function flushOutput(execution) {
  execution.writes = (execution.writes || Promise.resolve()).catch(() => {}).then(async () => {
    if (!execution.owner || !await permitted(execution.path)) return;
    const directory = path.join(configuration.dataDirectory, 'output'); await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, execution.session + '.json'), temporary = file + '.' + randomUUID() + '.tmp';
    const report = { version: 1, session: execution.session, pid: process.pid, ownerStartedAt, terminalPid: execution.owner.pid, terminalStartedAt: execution.owner.ownerStartedAt,
      path: execution.path, seenAt: new Date().toISOString(), state: execution.closed ? 'closed' : 'running', entries: execution.entries };
    await fs.writeFile(temporary, JSON.stringify(report), { encoding: 'utf8', mode: 0o600 }); await fs.rename(temporary, file);
  }).catch(() => {}); return execution.writes;
}
function queueOutput(execution) { if (!execution.flushTimer) { execution.flushTimer = setTimeout(() => { execution.flushTimer = undefined; void flushOutput(execution); }, 200); execution.flushTimer.unref(); } }
function outputLine(execution, line) {
  const text = stripVTControlCharacters(line).slice(0, 4096); if (!text) return;
  execution.entries.push({ sequence: ++execution.sequence, text });
  while (execution.entries.length > 128 || Buffer.byteLength(JSON.stringify(execution.entries)) > 131072) execution.entries.shift();
  queueOutput(execution);
}
function capture(event) {
  const command = event.execution.commandLine.value.trim(), cwd = localPath(event.execution.cwd || event.shellIntegration.cwd);
  // Observe only a plain dev command. Never export command text, other commands, or terminal scrollback.
  if (!cwd || /[;&|\r\n]/.test(command) || !/^(?:npm(?:\.cmd)?\s+run\s+dev|pnpm(?:\.cmd)?\s+(?:run\s+)?dev|yarn(?:\.cmd)?\s+(?:run\s+)?dev|bun(?:\.exe)?\s+(?:run\s+)?dev)(?:\s+--(?:\s.*)?)?$/i.test(command)) return;
  const stream = event.execution.read(); // Attach immediately so startup output is included.
  const execution = { original: event.execution, session: createHash('sha256').update('vscode-output:' + randomUUID()).digest('hex'), path: cwd, entries: [], sequence: 0, closed: false };
  executions.set(event.terminal, execution);
  void (async () => {
    try {
      if (!await permitted(cwd)) return; execution.owner = await terminalOwner(event.terminal); if (!execution.owner) return;
      activity.set(cwd, new Date().toISOString()); await write(); await flushOutput(execution); let partial = '';
      for await (const chunk of stream) {
        if (!await permitted(cwd)) break;
        partial += chunk; const lines = partial.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n'); partial = lines.pop() || '';
        for (const line of lines) outputLine(execution, line);
        if (partial.length > 16000) { outputLine(execution, partial); partial = ''; }
      }
      if (partial) outputLine(execution, partial);
    } catch { /* Output capture must never interfere with the running command. */ }
    finally { execution.closed = true; clearTimeout(execution.flushTimer); await flushOutput(execution); if (executions.get(event.terminal) === execution) executions.delete(event.terminal); }
  })();
}
function folders() {
  const open = (vscode.workspace.workspaceFolders || []).filter((folder) => folder.uri.scheme === 'file');
  const now = new Date().toISOString();
  for (const folder of open) if (!activity.has(folder.uri.fsPath)) activity.set(folder.uri.fsPath, now);
  return open.map((folder) => ({ path: folder.uri.fsPath, activityAt: activity.get(folder.uri.fsPath) }));
}
function write(closed = false) {
  queue = queue.catch(() => {}).then(async () => {
    try {
      const directory = configuration.dataDirectory;
      const policy = JSON.parse(await fs.readFile(path.join(directory, 'policy.json'), 'utf8')); if (!policy.enabled) return;
      const open = folders();
      const record = { version: 1, source: 'vscode', session, pid: process.pid, ownerStartedAt, seenAt: new Date().toISOString(), state: closed || !open.length ? 'closed' : 'open', folders: open, terminals: closed ? [] : await terminals() };
      const reports = path.join(directory, 'reports'); await fs.mkdir(reports, { recursive: true });
      const file = path.join(reports, session + '.json'), temporary = file + '.' + randomUUID() + '.tmp';
      await fs.writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 }); await fs.rename(temporary, file);
    } catch { /* Optional local metadata only; never interfere with editing. */ }
  });
  return queue;
}
function markEditor(editor) {
  if (editor?.document.uri.scheme !== 'file') return;
  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (folder) activity.set(folder.uri.fsPath, new Date().toISOString());
  void write();
}
exports.activate = (context) => {
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { void write(); }), vscode.window.onDidChangeActiveTextEditor(markEditor),
    vscode.window.onDidChangeWindowState((state) => { if (state.focused) markEditor(vscode.window.activeTextEditor); }));
  context.subscriptions.push(vscode.window.onDidStartTerminalShellExecution(capture), vscode.window.onDidOpenTerminal(() => { void write(); }),
    vscode.window.onDidCloseTerminal((terminal) => { births.delete(terminal); const execution = executions.get(terminal); if (execution) { execution.closed = true; void flushOutput(execution); } void write(); }),
    vscode.window.onDidChangeTerminalShellIntegration(() => { void write(); }));
  timer = setInterval(() => { void write(); for (const execution of executions.values()) void flushOutput(execution); }, 15000); timer.unref();
  void write();
};
exports.deactivate = async () => { clearInterval(timer); for (const execution of executions.values()) { clearTimeout(execution.flushTimer); execution.closed = true; await flushOutput(execution); } await write(true); };
