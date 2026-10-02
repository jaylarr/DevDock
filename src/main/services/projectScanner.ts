import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Manager, ProjectMetadata, RootFolder } from '../../shared/contracts';
import { manifest, framework, packageManager, applicationEvidence } from './detection';
import { normalizePath, projectId, slug, within } from './identity';
import { entryPage } from './staticPolicy';

const ignored = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.cache', '.output', '.nuxt', '.vercel', '.turbo', 'out', 'tmp', 'temp', 'vendor', '.test-artifacts']);
const staticIgnored = new Set(['docs', 'documentation', 'examples', 'public', 'assets']);
export interface ScanResult {
  projects: ProjectMetadata[]; diagnostics: string[]; checkedRoots: string[]; unreadableDirectories: string[];
  applicationRoots: string[]; cancelled: boolean;
}
export async function scanProjects(roots: RootFolder[], signal?: AbortSignal, exclusions: string[] = []): Promise<ScanResult> {
  const result: ScanResult = { projects: [], diagnostics: [], checkedRoots: [], unreadableDirectories: [], applicationRoots: [], cancelled: false };
  const visited = new Set<string>();
  const candidates: { directory: string; root: RootFolder; entryFile: string }[] = [];
  const orderedRoots = [...roots].sort((a, b) => a.path.length - b.path.length || normalizePath(a.path).localeCompare(normalizePath(b.path)));
  const explicit = new Set(roots.map((root) => normalizePath(root.path)));
  let directories = 0;
  // Explicitly selecting an app's public/docs folder must not bypass its parent application ownership.
  // Generated directories form a boundary (for example, isolated test fixtures or explicitly selected exports).
  for (const root of orderedRoots) {
    let ancestor = path.dirname(root.path);
    while (ancestor !== path.dirname(ancestor) && !ignored.has(path.basename(ancestor).toLowerCase()) && !signal?.aborted) {
      try {
        const entries = await readdir(ancestor, { withFileTypes: true });
        const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
        let blocked = applicationEvidence(files) || files.includes('pnpm-workspace.yaml');
        if (entries.some((entry) => entry.name.toLowerCase() === 'package.json')) {
          try {
            const raw = await readFile(path.join(ancestor, 'package.json'), 'utf8');
            blocked ||= raw.length > 2_000_000 || applicationEvidence(files, manifest(JSON.parse(raw)));
          } catch { blocked = true; }
        }
        if (blocked) {
          result.applicationRoots.push(ancestor);
          result.diagnostics.push(`Selected root belongs to an application; static fallback skipped: ${root.path}`); break;
        }
      } catch {
        result.applicationRoots.push(ancestor);
        result.diagnostics.push(`Cannot verify parent application ownership; static fallback skipped: ${ancestor}`); break;
      }
      ancestor = path.dirname(ancestor);
    }
  }
  for (const root of orderedRoots) {
    if (signal?.aborted) break;
    const pending: { directory: string; inherited?: Manager; staticAllowed: boolean }[] = [{ directory: root.path, staticAllowed: true }];
    let rootReadable = false;
    while (pending.length && !signal?.aborted) {
      const current = pending.pop()!;
      let { directory } = current;
      const { inherited } = current;
      if (exclusions.some((excluded) => within(directory, excluded))) continue;
      let childManager = inherited;
      if (++directories > 50000) { result.diagnostics.push('Scan directory limit reached. Select narrower root folders.'); return { ...result, cancelled: true }; }
      let entries;
      try {
        directory = await realpath(directory);
        const canonical = normalizePath(directory);
        if (exclusions.some((excluded) => within(canonical, excluded))) continue;
        if (visited.has(canonical)) { rootReadable = true; continue; }
        entries = await readdir(directory, { withFileTypes: true });
        visited.add(canonical); rootReadable = true;
      } catch { result.diagnostics.push(`Cannot read folder: ${directory}`); result.unreadableDirectories.push(directory); continue; }
      const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
      let blocked = applicationEvidence(files);
      if (files.includes('pnpm-workspace.yaml')) { childManager = 'pnpm'; blocked = true; }
      let name = path.basename(directory);
      if (entries.some((entry) => entry.name.toLowerCase() === 'package.json')) {
        try {
          const raw = await readFile(path.join(directory, 'package.json'), 'utf8');
          if (raw.length > 2_000_000) throw new Error('Manifest is too large.');
          const pkg = manifest(JSON.parse(raw));
          name = pkg.name?.trim() || name;
          blocked ||= applicationEvidence(files, pkg);
          if (pkg.workspace || files.includes('pnpm-workspace.yaml')) childManager = pkg.packageManager ? packageManager(pkg, files) : childManager ?? packageManager(pkg, files);
          const script = pkg.scripts.dev;
          if (script?.trim()) {
            result.projects.push({ id: projectId(directory), kind: 'script', name, path: directory, rootId: root.id, slug: slug(name, directory),
              devScript: script, framework: framework(pkg), manager: pkg.packageManager || files.some((file) => ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'package-lock.json', 'npm-shrinkwrap.json'].includes(file)) ? packageManager(pkg, files) : inherited ?? packageManager(pkg, files), missing: false });
          } else if (blocked) result.diagnostics.push(`Application has no supported dev script; static fallback skipped: ${directory}`);
        } catch { blocked = true; result.diagnostics.push(`Invalid or unreadable package.json: ${directory}`); }
      } else if (blocked) result.diagnostics.push(`Application/server evidence found; static fallback skipped: ${directory}`);
      if (blocked) result.applicationRoots.push(directory);
      const entryFile = entryPage(files);
      const staticAllowed = current.staticAllowed || explicit.has(normalizePath(directory));
      if (entryFile && staticAllowed) candidates.push({ directory, root, entryFile });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink() && !ignored.has(entry.name.toLowerCase())) {
          pending.push({ directory: path.join(directory, entry.name), inherited: childManager,
            staticAllowed: staticAllowed && !staticIgnored.has(entry.name.toLowerCase()) });
        }
      }
    }
    if (rootReadable) result.checkedRoots.push(root.id);
  }
  // Resolve ownership after inventorying all roots, so overlapping roots cannot create static application children.
  const staticRoots: string[] = [];
  for (const candidate of candidates.sort((a, b) => a.directory.length - b.directory.length || a.directory.localeCompare(b.directory))) {
    const { directory, entryFile } = candidate;
    if (result.applicationRoots.some((owner) => within(directory, owner))) continue;
    if (result.applicationRoots.some((child) => within(child, directory))) {
      result.diagnostics.push(`HTML folder contains an application; select a narrower static root: ${directory}`); continue;
    }
    if (staticRoots.some((owner) => within(directory, owner)) && !explicit.has(normalizePath(directory))) continue;
    const owner = [...orderedRoots].reverse().find((root) => within(directory, root.path)) ?? candidate.root;
    const name = path.basename(directory);
    result.projects.push({ id: projectId(directory), kind: 'static', name, path: directory, rootId: owner.id,
      slug: slug(name, directory), framework: 'Static HTML', entryFile, missing: false });
    staticRoots.push(directory);
  }
  result.applicationRoots = [...new Set(result.applicationRoots)];
  result.cancelled = signal?.aborted ?? false;
  return result;
}
