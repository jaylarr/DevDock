import { spawn } from 'node:child_process';
import path from 'node:path';
import type { ExternalServerTarget } from '../../shared/contracts';
import { record } from '../../shared/settings';
import type { ServerProcess } from './externalServers';

export function readStopTargets(value: unknown): ExternalServerTarget[] {
  if (!Array.isArray(value) || !value.length || value.length > 64 || !value.every((item) => record(item)
    && Object.keys(item).every((key) => ['pid', 'ownerStartedAt', 'port'].includes(key))
    && Number.isSafeInteger(item.pid) && Number(item.pid) > 0 && Number.isInteger(item.port) && Number(item.port) > 0 && Number(item.port) <= 65535
    && typeof item.ownerStartedAt === 'string' && item.ownerStartedAt.length <= 40 && Number.isFinite(Date.parse(item.ownerStartedAt)))) throw new Error('Invalid external server stop request.');
  return value as ExternalServerTarget[];
}

export async function stopServerProcesses(targets: ServerProcess[]): Promise<void> {
  if (process.platform !== 'win32') throw new Error('External server stopping is supported on native Windows.');
  const payload = Buffer.from(JSON.stringify(targets.map(({ pid, startedAt, name }) => ({ pid, startedAt, name })))).toString('base64');
  // Pin each process handle before inspecting its birth time. Kill uses that handle, never a newly resolved PID or an editor/terminal ancestor.
  const query = `$ErrorActionPreference='Stop'; $handles=@(); try {
    $targets=@([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json)
    foreach ($target in $targets) {
      $process=[Diagnostics.Process]::GetProcessById([int]$target.pid); $handles+= $process; $null=$process.Handle
      $birth=[DateTimeOffset]::Parse($target.startedAt).UtcDateTime
      if ([Math]::Abs(($process.StartTime.ToUniversalTime()-$birth).TotalMilliseconds) -ge 1 -or ($process.ProcessName+'.exe') -ine $target.name) { throw 'Process identity changed' }
    }
    foreach ($process in $handles) { if (!$process.HasExited) { $process.Kill() } }
    foreach ($process in $handles) { if (!$process.WaitForExit(2000)) { throw 'Process did not exit' } }
  } finally { foreach ($process in $handles) { $process.Dispose() } }`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', query], { windowsHide: true, stdio: 'ignore', signal: AbortSignal.timeout(10000) });
    const failure = () => reject(new Error('The external server could not be stopped safely. Refresh and retry, or stop it in its original terminal.'));
    child.once('error', failure); child.once('close', (code) => code === 0 ? resolve() : failure());
  });
}
