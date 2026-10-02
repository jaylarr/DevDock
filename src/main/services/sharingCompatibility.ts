import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { CompatibilityReport, ProjectMetadata } from '../../shared/contracts';

export async function sharingCompatibility(project: ProjectMetadata): Promise<CompatibilityReport> {
  const notes = new Set<string>();
  let visited = 0; let bytes = 0; let limited = false;
  const pending = [project.path];
  while (pending.length && visited < 200 && bytes < 1_000_000) {
    const directory = pending.shift()!;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (++visited > 200 || bytes >= 1_000_000) { limited = true; break; }
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || ['node_modules', 'dist', 'build', 'coverage', 'vendor'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { pending.push(file); continue; }
      if (!/\.(?:[cm]?[jt]sx?|html?|json)$/i.test(entry.name) || /(?:lock|credentials|secrets)/i.test(entry.name)) continue;
      const info = await lstat(file).catch(() => undefined);
      if (!info?.isFile() || info.isSymbolicLink() || info.size > 100000) continue;
      const source = await readFile(file, 'utf8').catch(() => ''); bytes += Buffer.byteLength(source);
      const relative = path.relative(project.path, file);
      if (/(?:https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?|file:\/\/)/i.test(source)) notes.add(`Local-only URL found in ${relative}. Browser API/assets may need a public or same-origin URL.`);
      if (/\bEventSource\s*\(|text\/event-stream/.test(source)) notes.add(`Possible SSE streaming in ${relative}. Quick Tunnels do not support SSE.`);
      if (/(?:signInWithOAuth|redirect_uri|callbackUrl|next-auth|@auth\/)/.test(source)) notes.add(`Login/redirect integration found in ${relative}. Temporary URLs may need an authentication allowlist change.`);
      if (notes.size >= 10) { limited = true; break; }
    }
    if (notes.size >= 10) break;
  }
  if (pending.length || limited) notes.add('Inspection reached its file/size limit. This is a compatibility hint, not a complete audit.');
  if (project.kind === 'script' && project.framework === 'Next.js') notes.add('Next.js pages can load while live reload is blocked. The current public hostname may need allowedDevOrigins in next.config. This manager does not change your config.');
  return { summary: project.kind === 'static' ? `Static HTML · public link opens ${project.entryFile}.` : `${project.framework} · shares this project's verified HTTP server only.`,
    notes: [...notes, 'A separate backend port is not exposed by this link. Existing project forms and actions remain usable.'] };
}
