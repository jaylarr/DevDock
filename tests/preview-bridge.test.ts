import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { startPreviewBridge, type PreviewBridge } from '../src/main/tunnels/PreviewBridge';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const observed: { url: string; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((req, res) => {
    observed.push({ url: req.url!, headers: req.headers });
    res.setHeader('set-cookie', 'session=fixture; HttpOnly');
    req.pipe(res);
  });
  server.on('upgrade', (req, socket) => {
    observed.push({ url: req.url!, headers: req.headers });
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('data', (data) => socket.write(data));
    socket.on('end', () => socket.end());
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${address.port}`;
  const bridge = await startPreviewBridge(origin); cleanup.push(() => bridge.stop());
  bridge.setPublicOrigin('https://this-preview.trycloudflare.com');
  return { bridge, origin, observed, host: new URL(origin).host };
}
async function exchange(bridge: PreviewBridge, host: string, url: string, headers: IncomingHttpHeaders, upgrade = false) {
  return new Promise<{ status: number; headers?: IncomingHttpHeaders; body?: string; socket?: import('node:net').Socket }>((resolve, reject) => {
    const req = request(bridge.origin, { method: upgrade ? 'GET' : 'POST', path: url, headers: { host, ...headers } });
    req.on('error', reject);
    req.on('upgrade', (res, socket) => resolve({ status: res.statusCode!, socket }));
    req.on('response', (res) => { let body = ''; res.on('data', (data) => { body += data; }); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body })); });
    req.end(upgrade ? undefined : 'Request body');
  });
}
const wsHeaders = { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' };
it.each(['/studio/_next/static/chunk.js?x=1', '/__nextjs_font/geist-latin.woff2?x=1'])('translates current-preview Next asset headers for %s and preserves request data', async (url) => {
  const { bridge, origin, host, observed } = await fixture();
  const response = await exchange(bridge, host, url, { origin: 'https://this-preview.trycloudflare.com', referer: 'https://this-preview.trycloudflare.com/studio?x=2', 'sec-fetch-mode': 'no-cors', 'sec-fetch-site': 'cross-site' });
  expect(response).toMatchObject({ status: 200, body: 'Request body' });
  expect(observed[0]).toMatchObject({ url, headers: { origin, referer: `${origin}/studio?x=2`, host } });
});
it('preserves application authentication, origin, forwarded headers, cookies and responses', async () => {
  const { bridge, host, observed } = await fixture();
  const headers = { origin: 'https://this-preview.trycloudflare.com', referer: 'https://this-preview.trycloudflare.com/login', authorization: 'Bearer fictional', cookie: 'session=fixture', 'x-forwarded-host': 'this-preview.trycloudflare.com', 'x-forwarded-proto': 'https' };
  const response = await exchange(bridge, host, '/api/login?returnTo=%2F', headers);
  expect(observed[0]).toMatchObject({ headers });
  expect(response.headers?.['set-cookie']).toEqual(['session=fixture; HttpOnly']);
});
it('rejects wrong hosts, foreign/null/lookalike origins and expired preview URLs before upstream traffic', async () => {
  const { bridge, host, observed } = await fixture();
  for (const origin of ['https://other-preview.trycloudflare.com', 'https://this-preview.trycloudflare.com.evil', 'null', 'https://user@this-preview.trycloudflare.com', 'not a URL']) {
    expect((await exchange(bridge, host, '/_next/hmr', { ...wsHeaders, origin }, true)).status).toBe(403);
  }
  expect((await exchange(bridge, 'evil.example', '/', {})).status).toBe(403);
  bridge.setPublicOrigin('https://new-preview.trycloudflare.com');
  expect((await exchange(bridge, host, '/_next/hmr', { ...wsHeaders, origin: 'https://this-preview.trycloudflare.com' }, true)).status).toBe(403);
  bridge.setPublicOrigin('https://not-a-tunnel.example');
  expect((await exchange(bridge, host, '/_next/hmr', wsHeaders, true)).status).toBe(403);
  expect(observed).toEqual([]);
});
it('relays Next HMR bidirectionally and closes active upgrades when sharing stops', async () => {
  const { bridge, origin, host, observed } = await fixture();
  const response = await exchange(bridge, host, '/studio/_next/hmr?id=token', { ...wsHeaders, origin: 'https://this-preview.trycloudflare.com' }, true);
  expect(response.status).toBe(101);
  const socket = response.socket!; socket.on('error', () => {});
  expect(observed[0]).toMatchObject({ url: '/studio/_next/hmr?id=token', headers: { origin } });
  const data = once(socket, 'data'); socket.write('HMR payload');
  expect((await data)[0].toString()).toBe('HMR payload');
  const closed = once(socket, 'close'); await bridge.stop(); await closed;
  await expect(fetch(bridge.origin)).rejects.toThrow();
});
it('leaves custom application WebSocket origins unchanged', async () => {
  const { bridge, host, observed } = await fixture();
  const response = await exchange(bridge, host, '/socket', { ...wsHeaders, origin: 'https://app.example' }, true);
  expect(response.status).toBe(101); expect(observed[0]?.headers.origin).toBe('https://app.example');
  response.socket!.destroy();
});
