import { spawn } from 'node:child_process';
import path from 'node:path';

async function output(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, signal: AbortSignal.timeout(4000), stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
      if (text.length > 1_000_000) child.kill();
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve(text) : reject(new Error('Could not verify server process ownership.')));
  });
}
export function descendsFrom(pid: number, root: number, parents: Map<number, number>): boolean {
  const visited = new Set<number>();
  let current = pid;
  while (current && !visited.has(current)) {
    if (current === root) return true;
    visited.add(current); current = parents.get(current) ?? 0;
  }
  return false;
}
export async function ownsListeningPort(port: number, rootPid: number, requireExclusiveOwnership = false): Promise<boolean> {
  // The first milestone targets native Windows. Other platforms require their own ownership checks.
  if (process.platform !== 'win32') return false;
  const system = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  // Filtering by TCP excludes TCPv6 on Windows; localhost dev servers often bind only to ::1.
  // Read both families and select TCP listening rows below (UDP rows are ignored).
  const listing = await output(path.join(system, 'netstat.exe'), ['-ano']);
  const listeners = listing.split(/\r?\n/).map((line) => line.trim().split(/\s+/))
    .filter((columns) => columns[0] === 'TCP' && columns[1]?.endsWith(`:${port}`) && columns[3] === 'LISTENING')
    .map((columns) => Number(columns[4])).filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  if (!listeners.length) return false;
  // Static read-only query: no renderer values, command lines, or secrets are collected.
  const processes = JSON.parse(await output(path.join(system, 'WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress'])) as { ProcessId: number; ParentProcessId: number }[];
  const parents = new Map(processes.map((item) => [item.ProcessId, item.ParentProcessId]));
  // Sharing fails closed if another process owns an address family/interface on this same port.
  // This avoids confusing an owned IPv4 listener with an unrelated IPv6 localhost endpoint.
  return requireExclusiveOwnership ? listeners.every((pid) => descendsFrom(pid, rootPid, parents)) : listeners.some((pid) => descendsFrom(pid, rootPid, parents));
}
