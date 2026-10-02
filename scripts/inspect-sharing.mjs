import { build } from 'esbuild';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const base = path.resolve('.test-artifacts'); await mkdir(base, { recursive: true });
const file = path.join(base, 'compatibility.cjs');
await build({ entryPoints: ['src/main/services/sharingCompatibility.ts'], outfile: file, bundle: true, platform: 'node', format: 'cjs', target: 'node24' });
const { sharingCompatibility } = createRequire(import.meta.url)(file);
const saved = JSON.parse(await readFile(path.join(process.env.APPDATA, 'Local Dev Manager/state.json'), 'utf8'));
const reports = [];
for (const project of saved.projects ?? []) {
  if ((saved.exclusions ?? []).some((excluded) => project.path.toLowerCase() === excluded.toLowerCase() || project.path.toLowerCase().startsWith(`${excluded.toLowerCase()}\\`))) continue;
  try { await access(project.path); } catch { continue; }
  reports.push({ id: project.id, name: project.name, framework: project.framework, ...await sharingCompatibility(project) });
}
await writeFile(path.join(base, 'project-compatibility.json'), JSON.stringify(reports, null, 2));
console.log(JSON.stringify({ inspected: reports.length, frameworks: reports.reduce((counts, project) => { counts[project.framework] = (counts[project.framework] ?? 0) + 1; return counts; }, {}), withLocalUrls: reports.filter((report) => report.notes.some((note) => note.startsWith('Local-only'))).length, withPossibleSse: reports.filter((report) => report.notes.some((note) => note.startsWith('Possible SSE'))).length, withAuth: reports.filter((report) => report.notes.some((note) => note.startsWith('Login/redirect'))).length, report: '.test-artifacts/project-compatibility.json' }, null, 2));
