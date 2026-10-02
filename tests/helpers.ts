import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { within } from '../src/main/services/identity';
import type { RootFolder } from '../src/shared/contracts';
import { projectId } from '../src/main/services/identity';

export const fixtureBase = path.resolve('.test-artifacts');
export async function fixtureDirectory(): Promise<string> {
  await mkdir(fixtureBase, { recursive: true });
  return mkdtemp(path.join(fixtureBase, 'test (local) '));
}
export async function dispose(directory: string): Promise<void> {
  if (!within(directory, fixtureBase) || path.resolve(directory) === fixtureBase) throw new Error('Refusing to remove a path outside the fixture directory.');
  await rm(directory, { recursive: true, force: true });
}
export async function packageFile(directory: string, contents: unknown): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'package.json'), JSON.stringify(contents), 'utf8');
}
export function root(directory: string): RootFolder { return { id: projectId(directory), path: directory, name: path.basename(directory), addedAt: new Date().toISOString() }; }
export async function eventually(predicate: () => boolean | Promise<boolean>, timeout = 12000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error('Condition did not become true before the deadline.');
}
export async function mockServer(directory: string, mode: 'normal' | 'crash' | 'quiet' | 'tree' = 'normal'): Promise<void> {
  await packageFile(directory, { name: 'fixture-server', scripts: { dev: 'node server.cjs' } });
  const source = mode === 'crash' ? `console.error('Deliberate startup failure'); process.exit(7);` : mode === 'quiet' ? `console.log('A worker without a web endpoint'); setInterval(() => {}, 1000);` : mode === 'tree' ? `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['child.cjs'], { stdio: 'inherit' });
    console.log('CHILD_PID=' + child.pid);
    setInterval(() => {}, 1000);
  ` : `
    const http = require('node:http');
    const server = http.createServer((_request, response) => response.end('fixture ready'));
    server.listen(Number(process.env.PORT), '127.0.0.1', () => {
      console.log('Local: http://127.0.0.1:' + server.address().port);
      console.log('Unicode: café ✓');
    });
  `;
  await writeFile(path.join(directory, 'server.cjs'), source, 'utf8');
  if (mode === 'tree') await writeFile(path.join(directory, 'child.cjs'), `
    const http = require('node:http');
    const server = http.createServer((_request, response) => response.end('child ready'));
    server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + server.address().port));
  `);
}
