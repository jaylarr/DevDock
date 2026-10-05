import { Agent, createServer, request, type IncomingHttpHeaders } from 'node:http';
import type { Socket } from 'node:net';
import { localOrigin, publicOrigin } from './TunnelProvider';

export interface PreviewBridge { origin: string; setPublicOrigin(value: string): void; stop(): Promise<void> }

// Translate only this session's Next dev requests. Application auth, cookies,
// Origin and forwarded headers otherwise retain their existing meaning.
export async function startPreviewBridge(origin: string): Promise<PreviewBridge> {
  if (localOrigin(origin) !== origin) throw new Error('Invalid preview bridge origin.');
  const target = new URL(origin);
  let publicUrl: string | undefined;
  const sockets = new Set<Socket>();
  const agent = new Agent({ keepAlive: true });
  let stopped = false;
  let stopJob: Promise<void> | undefined;
  const headersFor = (url: string, headers: IncomingHttpHeaders): IncomingHttpHeaders | undefined => {
    if (stopped || headers.host !== target.host || !url.startsWith('/') || url.startsWith('//')) return;
    const forwarded = { ...headers, host: target.host };
    const pathname = new URL(url, origin).pathname;
    if (!/(?:^|\/)(?:_next|__nextjs(?:_font)?)(?:\/|$)/.test(pathname)) return forwarded;
    if (!publicUrl) return;
    for (const key of ['origin', 'referer'] as const) {
      const value = headers[key];
      if (value === undefined) continue;
      if (typeof value !== 'string') return;
      let parsed: URL;
      try { parsed = new URL(value); } catch { return; }
      if (parsed.username || parsed.password || parsed.origin !== publicUrl) return;
      forwarded[key] = key === 'origin' ? origin : `${origin}${parsed.pathname}${parsed.search}`;
    }
    return forwarded;
  };
  const server = createServer((incoming, outgoing) => {
    const headers = headersFor(incoming.url ?? '/', incoming.headers);
    if (!headers) { outgoing.writeHead(403); outgoing.end('Preview request rejected.'); return; }
    const upstream = request(target, { method: incoming.method, path: incoming.url, headers, agent }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers); response.pipe(outgoing);
      response.on('error', () => outgoing.destroy());
    });
    upstream.on('error', () => { if (outgoing.destroyed || outgoing.writableEnded) return; if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end('Local preview unavailable.'); });
    incoming.on('aborted', () => upstream.destroy());
    incoming.on('error', () => upstream.destroy());
    outgoing.on('close', () => upstream.destroy());
    incoming.pipe(upstream);
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('upgrade', (incoming, socket, head) => {
    const headers = headersFor(incoming.url ?? '/', incoming.headers);
    if (!headers) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    const upstream = request(target, { method: incoming.method, path: incoming.url, headers, agent });
    socket.on('error', () => upstream.destroy());
    const failed = () => { if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); };
    upstream.on('error', failed);
    upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      sockets.add(upstreamSocket); upstreamSocket.once('close', () => { sockets.delete(upstreamSocket); socket.destroy(); });
      upstreamSocket.on('error', () => socket.destroy());
      socket.on('error', () => upstreamSocket.destroy()); socket.once('close', () => upstreamSocket.destroy());
      const lines = [`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}`];
      for (let index = 0; index < response.rawHeaders.length; index += 2) lines.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`);
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.pipe(socket); socket.pipe(upstreamSocket);
    });
    upstream.on('response', (response) => {
      socket.end(`HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? 'Bad Gateway'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      response.resume();
    });
    socket.once('close', () => upstream.destroy());
    upstream.end();
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('Cannot allocate preview bridge.'); }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    setPublicOrigin: (value) => { publicUrl = publicOrigin(value); },
    stop: async () => {
      if (stopJob) return stopJob;
      stopped = true;
      stopJob = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      agent.destroy();
      for (const socket of sockets) socket.destroy();
      await stopJob;
    },
  };
}
