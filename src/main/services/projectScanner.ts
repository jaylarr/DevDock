import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Manager, ProjectMetadata, RootFolder } from '../../shared/contracts';
import { manifest, framework, packageManager } from './detection';
import { normalizePath, projectId, slug } from './identity';

const ignored = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.cache', '.output', '.nuxt', '.vercel', '.turbo', 'out', 'tmp', 'temp', 'vendor', '.test-artifacts']);
export interface ScanResult { projects: ProjectMetadata[]; diagnostics: string[]; checkedRoots: string[]; unreadableDirectories: string[]; cancelled: boolean }
export async function scanProjects(roots: RootFolder[], signal?: AbortSignal): Promise<ScanResult> {
  const result: ScanResult = { projects: [], diagnostics: [], checkedRoots: [], unreadableDirectories: [], cancelled: false };
  const visited = new Set<string>();
  let directories = 0;
  for (const root of roots) {
    if (signal?.aborted) break;
    const pending: { directory: string; inherited?: Manager }[] = [{ directory: root.path }];
    let rootReadable = false;
    while (pending.length && !signal?.aborted) {
      const { directory, inherited } = pending.pop()!;
      let childManager = inherited;
      if (++directories > 50000) { result.diagnostics.push('Scan directory limit reached. Select narrower root folders.'); return { ...result, cancelled: true }; }
      let entries;
      try {
        const canonical = normalizePath(await realpath(directory));
        if (visited.has(canonical)) continue;
        entries = await readdir(directory, { withFileTypes: true });
        visited.add(canonical);
        rootReadable = true;
      } catch { result.diagnostics.push(`Cannot read folder: ${directory}`); result.unreadableDirectories.push(directory); continue; }
      const files = entries.map((entry) => entry.name);
      if (files.includes('pnpm-workspace.yaml')) childManager = 'pnpm';
      if (entries.some((entry) => entry.name === 'package.json' && entry.isFile())) {
        try {
          const raw = await readFile(path.join(directory, 'package.json'), 'utf8');
          if (raw.length > 2_000_000) throw new Error('Manifest is too large.');
          const pkg = manifest(JSON.parse(raw));
          if (pkg.workspace || files.includes('pnpm-workspace.yaml')) childManager = pkg.packageManager ? packageManager(pkg, files) : childManager ?? packageManager(pkg, files);
          const script = pkg.scripts.dev;
          if (script?.trim()) {
            const name = pkg.name?.trim() || path.basename(directory);
            result.projects.push({ id: projectId(directory), name, path: directory, rootId: root.id, slug: slug(name, directory),
              devScript: script, framework: framework(pkg), manager: pkg.packageManager || files.some((file) => ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'package-lock.json', 'npm-shrinkwrap.json'].includes(file)) ? packageManager(pkg, files) : inherited ?? packageManager(pkg, files), missing: false });
          }
        } catch { result.diagnostics.push(`Invalid or unreadable package.json: ${directory}`); }
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink() && !ignored.has(entry.name.toLowerCase())) pending.push({ directory: path.join(directory, entry.name), inherited: childManager });
      }
    }
    if (rootReadable) result.checkedRoots.push(root.id);
  }
  result.cancelled = signal?.aborted ?? false;
  return result;
}
