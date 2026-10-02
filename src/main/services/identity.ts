import path from 'node:path';
import { createHash } from 'node:crypto';

export function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
export function projectId(value: string): string { return createHash('sha256').update(normalizePath(value)).digest('hex').slice(0, 16); }
export function slug(name: string, directory: string): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
  return `${safe}-${projectId(directory).slice(0, 6)}`;
}
export function within(directory: string, parent: string): boolean {
  const relative = path.relative(normalizePath(parent), normalizePath(directory));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
