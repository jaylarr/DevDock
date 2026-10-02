import { _electron as electronAutomation } from 'playwright';
import { electronPath } from './electron-path.mjs';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const base = path.resolve('.test-artifacts');
const electron = await electronPath();
const development = process.argv.includes('--dev');
const vite = development ? await (await import('vite')).createServer() : undefined;
await vite?.listen();
const rendererOrigin = vite?.resolvedUrls.local[0];
await mkdir(base, { recursive: true });
const fixture = await mkdtemp(path.join(base, 'desktop (test) '));
const data = path.join(fixture, 'user-data');
const projects = path.join(fixture, 'projects');
const directory = path.join(projects, 'desktop fixture');
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'desktop-fixture', scripts: { dev: 'node server.cjs' } }));
await writeFile(path.join(directory, 'server.cjs'), `const http = require('node:http'); const server = http.createServer((_req,res)=>res.end('Desktop fixture ready')); server.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+server.address().port));`);
let application;
const failures = [];
const requests = [];
async function launch() {
  const env = { ...process.env, LDM_DATA_DIR: data };
  if (rendererOrigin) env.LDM_RENDERER_URL = rendererOrigin;
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electronAutomation.launch({ executablePath: electron, args: ['.'], cwd: process.cwd(), env, timeout: 30000 });
  application.process().stderr.on('data', (chunk) => { const text = String(chunk); if (/Error|failed/i.test(text)) console.error(text.trim()); });
  const page = await application.firstWindow();
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 1000));
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await page.getByRole('heading', { name: 'Your projects.' }).waitFor();
  await page.waitForFunction(() => !!window.devManager);
  return page;
}
async function waitStatus(page, status) {
  // Poll on the Node side: contextBridge promises belong to the preload's isolated realm.
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => window.devManager.snapshot());
    if (state.ok && state.value.projects.some((item) => item.status === status)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Desktop project did not reach ${status}: ${JSON.stringify(await page.evaluate(() => window.devManager.snapshot()))}`);
}
async function mustBeClosed(url) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(500) }); await response.body?.cancel(); }
    catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Fixture port remained open after closing Electron.');
}
try {
  let page = await launch();
  const bridge = await page.evaluate(() => ({ node: typeof window.require, process: typeof window.process, keys: Object.keys(window.devManager) }));
  assert.equal(bridge.node, 'undefined'); assert.equal(bridge.process, 'undefined');
  assert(!bridge.keys.some((key) => ['fs', 'exec', 'spawn', 'ipcRenderer'].includes(key)));
  const rejected = await page.evaluate(() => window.devManager.start('invalid-id'));
  assert.equal(rejected.ok, false);
  console.log('PASS: sandboxed renderer, narrow preload bridge, invalid ID rejected');
  // Stub only the native picker result; the production IPC/root/scanner/persistence flow remains real.
  await application.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, projects);
  await page.getByRole('button', { name: '+ Add folder', exact: true }).click();
  await page.getByRole('button', { name: 'View desktop-fixture', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.devManager.snapshot())).value.roots.length, 1);
  console.log('PASS: folder-selection response, IPC scan, project list, saved root');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await waitStatus(page, 'running');
  const readyState = await page.evaluate(() => window.devManager.snapshot());
  const firstUrl = readyState.value.projects[0].localUrl;
  if (!firstUrl) {
    console.error('Unexpected runtime state:', JSON.stringify(readyState));
    console.error('Fixture logs:', JSON.stringify(await page.evaluate((id) => window.devManager.logs(id), readyState.value.projects[0].id)));
  }
  assert.equal(await (await fetch(firstUrl)).text(), 'Desktop fixture ready');
  await page.getByRole('button', { name: 'View logs for desktop-fixture', exact: true }).click();
  await page.getByLabel('Project logs', { exact: true }).getByText(/Ready ·/).waitFor();
  await page.getByLabel('Appearance', { exact: true }).selectOption('light');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.screenshot({ path: path.join(base, `${development ? 'dev' : 'desktop'}-light.png`), fullPage: true });
  await page.getByLabel('Appearance', { exact: true }).selectOption('dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.screenshot({ path: path.join(base, `${development ? 'dev' : 'desktop'}-dark.png`), fullPage: true });
  console.log('PASS: project startup, verified URL, live logs, light/dark screenshots');
  // Browser-side offline emulation: the UI remains local; main-process loopback probes continue.
  await page.context().setOffline(true);
  if (!development) {
    await page.reload();
    await page.getByRole('button', { name: 'View logs for desktop-fixture', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await waitStatus(page, 'running');
  const restartedUrl = (await page.evaluate(() => window.devManager.snapshot())).value.projects[0].localUrl;
  assert.equal(await (await fetch(restartedUrl)).text(), 'Desktop fixture ready');
  console.log('PASS: restart with renderer offline; no external UI resources required');
  await application.close(); application = undefined;
  await mustBeClosed(restartedUrl);
  console.log('PASS: normal Electron quit terminates the managed server');
  page = await launch();
  await page.getByRole('button', { name: 'View desktop-fixture', exact: true }).waitFor();
  const state = await page.evaluate(() => window.devManager.snapshot());
  assert.equal(state.value.projects[0].status, 'stopped');
  assert.equal(state.value.theme, 'dark');
  assert.equal(state.value.projects[0].localUrl, undefined);
  console.log('PASS: root/theme persist; process status and URLs reset on relaunch');
  assert.deepEqual(failures, []);
  assert(!requests.some((url) => /^https?:/.test(url) && (!rendererOrigin || new URL(url).origin !== new URL(rendererOrigin).origin)));
  console.log('PASS: no renderer page errors or external HTTP requests');
  await application.close(); application = undefined;
  console.log(`Desktop smoke checks passed. Screenshots: .test-artifacts/${development ? 'dev' : 'desktop'}-light.png and ${development ? 'dev' : 'desktop'}-dark.png`);
} finally {
  if (application) await application.close();
  await vite?.close();
  const relative = path.relative(base, path.resolve(fixture));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe fixture cleanup target.');
  await rm(fixture, { recursive: true, force: true });
}
