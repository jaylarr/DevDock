import { createServer } from 'node:http';
import { open, readdir, readFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { applicationEvidence, manifest } from '../services/detection.ts';
import { within } from '../services/identity.ts';
import { entryPage, publicFile, publicSegments, staticMime, validEntry } from '../services/staticPolicy.ts';

async function main(): Promise<void> {
  const requestedRoot = process.argv[2];
  const entry = process.argv[3];
  if (!requestedRoot || !path.isAbsolute(requestedRoot) || !validEntry(entry)) throw new Error('Invalid static server arguments.');
  const root = await realpath(requestedRoot);

  async function staticDirectory(directory: string): Promise<boolean> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = entries.filter((item) => item.isFile()).map((item) => item.name);
    if (applicationEvidence(files) || files.includes('pnpm-workspace.yaml')) return false;
    if (entries.some((item) => item.name.toLowerCase() === 'package.json')) {
      try {
        const raw = await readFile(path.join(directory, 'package.json'), 'utf8');
        if (raw.length > 2_000_000 || applicationEvidence(files, manifest(JSON.parse(raw)))) return false;
      } catch { return false; }
    }
    return true;
  }

  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 16384 }, async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    const fail = (status: number) => { if (!response.headersSent) { response.statusCode = status; response.end(`${status}\n`); } else response.destroy(); };
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.setHeader('Allow', 'GET, HEAD'); fail(405); return; }
    const address = server.address();
    if (!address || typeof address === 'string' || ![`127.0.0.1:${address.port}`, `localhost:${address.port}`].includes(request.headers.host ?? '')) { fail(403); return; }
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      // Decode the raw path before URL normalization can erase traversal components.
      const raw = (request.url ?? '').split('?')[0]!;
      if (!raw.startsWith('/') || raw.startsWith('//')) { fail(400); return; }
      const decoded = decodeURIComponent(raw);
      if (decoded.includes('\\') || /[\x00-\x1f]/.test(decoded)) { fail(400); return; }
      const segments = decoded.slice(1).split('/');
      if (segments.at(-1) === '') segments.pop();
      if (!publicSegments(segments)) { fail(403); return; }
      let target = root;
      // Recheck application boundaries and links on every request, including files added after launch.
      if (!(await staticDirectory(root))) { fail(403); return; }
      for (const segment of segments) {
        target = path.join(target, segment);
        const info = await lstat(target);
        if (info.isSymbolicLink()) { fail(403); return; }
        const resolved = await realpath(target);
        if (!within(resolved, root)) { fail(403); return; }
        target = resolved;
        if (info.isDirectory() && !(await staticDirectory(target))) { fail(403); return; }
      }
      const info = await lstat(target);
      if (info.isDirectory()) {
        const files = (await readdir(target, { withFileTypes: true })).filter((item) => item.isFile()).map((item) => item.name);
        const index = target === root ? entry : entryPage(files.filter((file) => /^index\.html?$/i.test(file)));
        if (!index) { fail(404); return; }
        if (segments.length && !decoded.endsWith('/')) {
          response.writeHead(308, { Location: `/${segments.map(encodeURIComponent).join('/')}/` }); response.end(); return;
        }
        target = path.join(target, index);
      }
      if (!publicFile(target) || !publicSegments([path.basename(target)])) { fail(403); return; }
      const file = await lstat(target, { bigint: true });
      if (!file.isFile() || file.isSymbolicLink() || !within(await realpath(target), root)) { fail(403); return; }
      handle = await open(target, 'r');
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || opened.dev !== file.dev || opened.ino !== file.ino || !within(await realpath(target), root)) { fail(403); return; }
      response.writeHead(200, { 'Content-Type': staticMime[path.extname(target).toLowerCase()]!, 'Content-Length': String(opened.size) });
      if (request.method === 'HEAD') { response.end(); return; }
      await pipeline(handle.createReadStream({ autoClose: false }), response);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      fail(error instanceof URIError ? 400 : ['ENOENT', 'ENOTDIR'].includes(code ?? '') ? 404 : code === 'EACCES' || code === 'EPERM' ? 403 : 500);
    } finally { await handle?.close().catch(() => undefined); }
  });
  server.maxConnections = 64;
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing static listener.');
    process.send?.({ port: address.port });
  });
  process.on('message', (message) => {
    if (message === 'stop') { server.close(() => process.exit(0)); server.closeAllConnections(); }
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { server.close(() => process.exit(0)); server.closeAllConnections(); });
  process.on('disconnect', () => { server.close(() => process.exit(0)); server.closeAllConnections(); });
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Static server failed.'); process.exit(1); });
