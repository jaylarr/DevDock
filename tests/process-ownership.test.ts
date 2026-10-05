import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { ownsListeningPort } from '../src/main/services/processOwnership';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
afterEach(() => vi.mocked(spawn).mockReset());
const listing = '  TCP    127.0.0.1:5001  0.0.0.0:0  LISTENING  30\r\n  TCP    [::1]:5002  [::]:0  LISTENING  40\r\n';
function commands(processes = '[{"ProcessId":30,"ParentProcessId":10},{"ProcessId":40,"ParentProcessId":20}]') {
  vi.mocked(spawn).mockImplementation((binary) => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill: vi.fn() });
    setTimeout(() => {
      const output = String(binary).endsWith('netstat.exe') ? listing : processes;
      child.stdout.write(output.slice(0, 10));
      child.emit('exit', 0);
      child.stdout.end(output.slice(10));
      child.emit('close', 0);
    }, 5);
    return child as unknown as ReturnType<typeof spawn>;
  });
}
it('drains JSON after process exit and shares only concurrent checks, never stale successful verdicts', async () => {
  commands();
  expect(await Promise.all([ownsListeningPort(5001, 10, true), ownsListeningPort(5002, 20, true)])).toEqual([true, true]);
  expect(spawn).toHaveBeenCalledTimes(2);
  expect(await ownsListeningPort(5001, 20, true)).toBe(false);
  expect(spawn).toHaveBeenCalledTimes(4);
});
it('fails closed on invalid or empty process snapshots and can verify again after failure', async () => {
  commands(''); await expect(ownsListeningPort(5001, 10, true)).rejects.toThrow();
  commands('{}'); await expect(ownsListeningPort(5001, 10, true)).rejects.toThrow('Invalid');
  commands(); expect(await ownsListeningPort(5001, 10, true)).toBe(true);
});
