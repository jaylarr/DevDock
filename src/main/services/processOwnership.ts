import { spawn } from 'node:child_process';
import path from 'node:path';

async function output(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, signal: AbortSignal.timeout(10000), stdio: ['ignore', 'pipe', 'ignore'] });
    let text = '';
    child.stdout.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
      if (text.length > 1_000_000) child.kill();
    });
    child.once('error', reject);
    // close follows stdout draining; exit can arrive before the last JSON chunk.
    child.once('close', (code) => code === 0 && text.length <= 1_000_000 ? resolve(text) : reject(new Error('Could not verify server process ownership.')));
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
let pendingSnapshot: Promise<{ listing: string; parents: Map<number, number> }> | undefined;
async function ownershipSnapshot(): Promise<{ listing: string; parents: Map<number, number> }> {
  // Concurrent readiness/sharing checks use the same fresh query, never a cached successful verdict.
  if (pendingSnapshot) return pendingSnapshot;
  const system = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  pendingSnapshot = (async () => {
    const [listing, json] = await Promise.all([
      output(path.join(system, 'netstat.exe'), ['-ano']),
      output(path.join(system, 'WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command',
        "$ErrorActionPreference='Stop'; $rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId); ConvertTo-Json -InputObject $rows -Compress"]),
    ]);
    const processes: unknown = JSON.parse(json);
    if (!Array.isArray(processes) || !processes.every((item) => item && Number.isSafeInteger(item.ProcessId) && Number.isSafeInteger(item.ParentProcessId))) {
      throw new Error('Invalid server process ownership snapshot.');
    }
    return { listing, parents: new Map(processes.map((item) => [item.ProcessId as number, item.ParentProcessId as number])) };
  })().finally(() => { pendingSnapshot = undefined; });
  return pendingSnapshot;
}
export async function ownsListeningPort(port: number, rootPid: number, requireExclusiveOwnership = false): Promise<boolean> {
  // The first milestone targets native Windows. Other platforms require their own ownership checks.
  if (process.platform !== 'win32') return false;
  // Filtering by TCP excludes TCPv6 on Windows; localhost dev servers often bind only to ::1.
  // Read both families and select TCP listening rows below (UDP rows are ignored).
  const { listing, parents } = await ownershipSnapshot();
  const listeners = listing.split(/\r?\n/).map((line) => line.trim().split(/\s+/))
    .filter((columns) => columns[0] === 'TCP' && columns[1]?.endsWith(`:${port}`) && columns[3] === 'LISTENING')
    .map((columns) => Number(columns[4])).filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  if (!listeners.length) return false;
  // Sharing fails closed if another process owns an address family/interface on this same port.
  // This avoids confusing an owned IPv4 listener with an unrelated IPv6 localhost endpoint.
  return requireExclusiveOwnership ? listeners.every((pid) => descendsFrom(pid, rootPid, parents)) : listeners.some((pid) => descendsFrom(pid, rootPid, parents));
}
