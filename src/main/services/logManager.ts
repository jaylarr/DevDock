import { stripVTControlCharacters } from 'node:util';
import type { LogEntry } from '../../shared/contracts';

export class LogManager {
  private buffers = new Map<string, { entries: LogEntry[]; bytes: number }>();
  private sequence = 0;
  constructor(private changed: () => void, private maxLines = 5000, private maxBytes = 1_000_000, private globalBytes = 16_000_000) {}
  append(id: string, stream: LogEntry['stream'], text: string): void {
    const buffer = this.buffers.get(id) ?? { entries: [], bytes: 0 };
    this.buffers.set(id, buffer);
    for (const line of stripVTControlCharacters(text).replaceAll('\r', '').split('\n')) {
      if (!line) continue;
      const clipped = line.slice(0, 16000);
      buffer.entries.push({ id: ++this.sequence, timestamp: new Date().toISOString(), stream, text: clipped });
      buffer.bytes += Buffer.byteLength(clipped);
    }
    while (buffer.entries.length > this.maxLines || buffer.bytes > this.maxBytes) this.trim(buffer);
    let total = [...this.buffers.values()].reduce((sum, item) => sum + item.bytes, 0);
    while (total > this.globalBytes) {
      const oldest = [...this.buffers.values()].filter((item) => item.entries.length).sort((a, b) => a.entries[0]!.id - b.entries[0]!.id)[0];
      if (!oldest) break;
      total -= this.trim(oldest);
    }
    this.changed();
  }
  private trim(buffer: { entries: LogEntry[]; bytes: number }): number {
    const entry = buffer.entries.shift();
    const size = entry ? Buffer.byteLength(entry.text) : 0;
    buffer.bytes -= size;
    return size;
  }
  get(id: string): LogEntry[] { return [...(this.buffers.get(id)?.entries ?? [])]; }
  clear(id: string): void { this.buffers.delete(id); this.changed(); }
}
