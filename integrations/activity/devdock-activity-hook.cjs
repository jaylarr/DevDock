// Local Codex / Claude Code hook. Only allowlisted activity metadata is written.
const { readFileSync, mkdirSync, writeFileSync, renameSync } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const source = process.argv[2], directory = process.argv[3];
function owner(previous, event) {
  if (event !== 'SessionStart' && previous?.pid && previous.ownerStartedAt) {
    try { process.kill(previous.pid, 0); return { pid: previous.pid, ownerStartedAt: previous.ownerStartedAt }; } catch { /* Find the current owner below. */ }
  }
  if (process.platform !== 'win32') return { pid: 0 };
  // Query only the ancestry of this hook; never collect command lines or transcripts.
  const query = `$id=${process.pid}; $seen=@{}; while($id -and !$seen.ContainsKey($id)){ $seen[$id]=$true; $p=Get-CimInstance Win32_Process -Filter "ProcessId=$id"; if(!$p){break}; [pscustomobject]@{pid=$p.ProcessId;name=$p.Name;startedAt=$p.CreationDate.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress; $id=$p.ParentProcessId }`;
  try {
    const output = execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', query], { encoding: 'utf8', windowsHide: true, timeout: 1800, maxBuffer: 8192, stdio: ['ignore', 'pipe', 'ignore'] });
    const ancestors = output.trim().split(/\r?\n/).map((line) => JSON.parse(line)).filter((item) => item.pid !== process.pid);
    const named = ancestors.find((item) => source === 'codex' ? /^codex(?:-.*)?\.exe$/i.test(item.name) : /^claude(?:-.*)?\.exe$/i.test(item.name));
    const selected = named || (source === 'claude' ? ancestors.find((item) => /^node\.exe$/i.test(item.name)) : undefined);
    if (selected) return { pid: selected.pid, ownerStartedAt: new Date(selected.startedAt).toISOString() };
  } catch { /* An unverified report gets a short Recent badge, never a live-session claim. */ }
  return { pid: 0 };
}
function report(input) {
  if (!['codex', 'claude'].includes(source) || !path.isAbsolute(directory) || !input || typeof input.cwd !== 'string' || !path.isAbsolute(input.cwd) || typeof input.session_id !== 'string') return;
  const policy = JSON.parse(readFileSync(path.join(directory, 'policy.json'), 'utf8')); if (policy.enabled !== true) return;
  const events = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd']; if (!events.includes(input.hook_event_name)) return;
  const session = createHash('sha256').update(source + ':' + input.session_id).digest('hex');
  const reports = path.join(directory, 'reports'), file = path.join(reports, session + '.json');
  let previous; try { previous = JSON.parse(readFileSync(file, 'utf8')); } catch { /* First event for this session. */ }
  const seenAt = new Date().toISOString();
  const ending = input.hook_event_name === 'SessionEnd';
  const folders = ending && previous?.folders ? previous.folders : [{ path: input.cwd, activityAt: seenAt }];
  const record = { version: 1, source, session, ...owner(previous, input.hook_event_name), seenAt, state: ending ? 'closed' : ['UserPromptSubmit', 'PostToolUse'].includes(input.hook_event_name) ? 'working' : 'open', folders };
  mkdirSync(reports, { recursive: true }); const temporary = file + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 }); renameSync(temporary, file);
}
let input = '', tooLarge = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { if (Buffer.byteLength(input) + Buffer.byteLength(chunk) > 131072) { tooLarge = true; input = ''; } else if (!tooLarge) input += chunk; });
process.stdin.on('end', () => { try { if (!tooLarge) report(JSON.parse(input)); } catch { /* A metadata bridge never blocks an agent or emits conversation content. */ } });
