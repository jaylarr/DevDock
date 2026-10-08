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
  const query = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $handles=@(); $stage='decode'; $targetPid=0; $reason='native-error'; try {
    # Windows PowerShell 5.1 emits a decoded JSON array as one pipeline object.
    # Wrapping that output in @() creates a nested array and breaks multi-process stops.
    $targets=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
    foreach ($target in $targets) {
      $targetPid=[int]$target.pid; $stage='lookup'; $reason='native-error'
      try { $process=[Diagnostics.Process]::GetProcessById($targetPid) } catch [ArgumentException] { continue }
      $handles+= $process; $stage='handle'; $null=$process.Handle
      if ($process.HasExited) { continue }
      $stage='identity'
      $birth=[DateTimeOffset]::Parse($target.startedAt).UtcDateTime
      if ([Math]::Abs(($process.StartTime.ToUniversalTime()-$birth).TotalMilliseconds) -ge 1 -or ($process.ProcessName+'.exe') -ine $target.name) { $reason='identity-changed'; throw 'Process identity changed' }
    }
    foreach ($process in $handles) {
      $targetPid=$process.Id; $stage='terminate'; $reason='native-error'
      if (!$process.HasExited) { try { $process.Kill() } catch { if (!$process.HasExited) { throw } } }
    }
    foreach ($process in $handles) { $targetPid=$process.Id; $stage='wait'; if (!$process.WaitForExit(2000)) { $reason='exit-timeout'; throw 'Process did not exit' } }
    [pscustomobject]@{ok=$true} | ConvertTo-Json -Compress
  } catch {
    $exception=$_.Exception; while ($exception.InnerException) { $exception=$exception.InnerException }
    $nativeCode=$null; if ($exception -is [ComponentModel.Win32Exception]) { $nativeCode=$exception.NativeErrorCode }
    [pscustomobject]@{ok=$false;stage=$stage;pid=$targetPid;reason=$reason;nativeCode=$nativeCode} | ConvertTo-Json -Compress
    exit 1
  } finally { foreach ($process in $handles) { $process.Dispose() } }`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', query], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], signal: AbortSignal.timeout(10000) });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); if (output.length > 4096) child.kill(); });
    child.once('error', (error: NodeJS.ErrnoException) => reject(new Error(error.name === 'AbortError' ? 'The Windows server stop helper timed out. Refresh to check whether the server stopped.' : `Could not start the Windows server stop helper${error.code && /^[A-Z_]+$/.test(error.code) ? ` (${error.code})` : ''}.`)));
    child.once('close', (code) => {
      if (code === 0) { resolve(); return; }
      reject(new Error(stopFailure(output, code)));
    });
  });
}

export function stopFailure(output: string, exitCode: number | null): string {
  let diagnostic: unknown;
  try { diagnostic = output.length <= 4096 ? JSON.parse(output) : undefined; } catch { /* Report only bounded, structured native diagnostics. */ }
  if (record(diagnostic) && diagnostic.ok === false && ['decode', 'lookup', 'handle', 'identity', 'terminate', 'wait'].includes(String(diagnostic.stage))
    && Number.isSafeInteger(diagnostic.pid) && Number(diagnostic.pid) >= 0) {
    const pid = Number(diagnostic.pid) ? ` (PID ${diagnostic.pid})` : '';
    const code = Number.isInteger(diagnostic.nativeCode) && Number(diagnostic.nativeCode) >= 0 ? ` Windows error ${diagnostic.nativeCode}.` : '';
    if (diagnostic.reason === 'identity-changed') return `The external server process changed${pid}. Refresh before stopping it.`;
    if (diagnostic.reason === 'exit-timeout') return `The external process did not exit after termination${pid}. Refresh to check its state.`;
    const stages: Record<string, string> = { decode: 'reading the stop request', lookup: 'finding the external process', handle: 'opening the external process', identity: 'checking the external process identity', terminate: 'terminating the external process', wait: 'waiting for the external process to exit' };
    return `${diagnostic.nativeCode === 5 ? 'Windows denied access' : 'Windows failed'} while ${stages[String(diagnostic.stage)]}${pid}.${code}`;
  }
  return `The Windows server stop helper failed${exitCode !== null ? ` (exit code ${exitCode})` : ''}. Refresh to check the server state.`;
}
