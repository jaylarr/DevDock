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
const staticDirectory = path.join(projects, 'html fixture');
await mkdir(staticDirectory, { recursive: true });
await writeFile(path.join(staticDirectory, 'landing page.html'), '<h1>Desktop HTML fixture</h1><link rel="stylesheet" href="style.css">');
await writeFile(path.join(staticDirectory, 'style.css'), 'body { color: blue; }');
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'desktop-fixture', scripts: { dev: 'node server.cjs' } }));
await writeFile(path.join(directory, 'server.cjs'), `const http = require('node:http'); const server = http.createServer((_req,res)=>res.end('Desktop fixture ready')); server.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+server.address().port));`);
for (let index = 1; index <= 22; index++) {
  const extra = path.join(projects, `z-project-${String(index).padStart(2, '0')}`);
  await mkdir(extra, { recursive: true });
  await writeFile(path.join(extra, 'package.json'), JSON.stringify({ name: path.basename(extra), scripts: { dev: 'node server.cjs' } }));
}
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
async function waitCatalog(page, count) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => window.devManager.snapshot());
    if (state.ok && !state.value.scanning && state.value.projects.length === count) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Catalog did not settle at ${count} projects.`);
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
  const pagination = page.getByRole('navigation', { name: 'Project pagination' });
  await pagination.getByText('1–10 of 24', { exact: true }).waitFor();
  assert.equal(await page.locator('.project-row').count(), 10);
  await pagination.getByRole('button', { name: 'Next', exact: true }).click();
  await pagination.getByText('11–20 of 24', { exact: true }).waitFor();
  await pagination.getByRole('button', { name: 'Next', exact: true }).click();
  await pagination.getByText('21–24 of 24', { exact: true }).waitFor();
  assert.equal(await page.locator('.project-row').count(), 4);
  assert(await pagination.getByRole('button', { name: 'Next', exact: true }).isDisabled());
  await page.getByLabel('Search projects', { exact: true }).fill('desktop-fixture');
  await pagination.getByText('1–1 of 1', { exact: true }).waitFor();
  await page.getByLabel('Search projects', { exact: true }).fill('');
  await pagination.getByText('1–10 of 24', { exact: true }).waitFor();
  await page.getByLabel('Projects per page', { exact: true }).selectOption('5');
  await pagination.getByText('1–5 of 24', { exact: true }).waitFor();
  await page.getByLabel('Projects per page', { exact: true }).selectOption('10');
  await pagination.getByText('1–10 of 24', { exact: true }).waitFor();
  console.log('PASS: pagination, last-page bounds, search reset, adjustable page size');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Discovery', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Settings', exact: true });
  const excludedFixture = path.join(projects, 'z-project-22');
  await application.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, excludedFixture);
  await settings.getByRole('button', { name: 'Exclude folder from discovery', exact: true }).click();
  await settings.locator('li').filter({ hasText: excludedFixture }).getByRole('button', { name: 'Include again', exact: true }).waitFor();
  await waitCatalog(page, 23);
  assert.equal((await page.evaluate(() => window.devManager.snapshot())).value.projects.length, 23);
  await settings.locator('li').filter({ hasText: excludedFixture }).getByRole('button', { name: 'Include again', exact: true }).click();
  await settings.locator('li').filter({ hasText: excludedFixture }).waitFor({ state: 'detached' });
  await waitCatalog(page, 24);
  assert.equal((await page.evaluate(() => window.devManager.snapshot())).value.projects.length, 24);
  await page.getByRole('button', { name: 'Back to projects', exact: true }).click();
  console.log('PASS: discovery migrated into Settings, picker IPC, cache removal, re-inclusion');
  const fixtureRow = page.locator('.project-row').filter({ has: page.getByRole('button', { name: 'View desktop-fixture', exact: true }) });
  const expand = fixtureRow.getByRole('button', { name: 'View logs for desktop-fixture', exact: true });
  await expand.click();
  assert.equal(await expand.getAttribute('aria-expanded'), 'true');
  assert.equal(await fixtureRow.getByRole('region', { name: 'Details for desktop-fixture' }).count(), 1);
  await expand.click();
  assert.equal(await expand.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('.details-panel').count(), 0);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(850, 600));
  await page.waitForTimeout(250);
  const bounds = await page.evaluate(() => {
    const list = document.querySelector('.project-list');
    const pager = document.querySelector('.pagination').getBoundingClientRect();
    return { fits: document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth, scrollable: list.scrollHeight > list.clientHeight, pagerVisible: pager.bottom <= innerHeight, halfViewport: list.clientHeight >= innerHeight / 2 };
  });
  assert.deepEqual(bounds, { fits: true, scrollable: true, pagerVisible: true, halfViewport: true });
  await page.screenshot({ path: path.join(base, 'desktop-pagination-small.png') });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 800));
  console.log('PASS: inline expansion/collapse; list scrolls and pagination fits at 850 × 600');
  await fixtureRow.getByRole('button', { name: 'Start', exact: true }).click();
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
  assert.equal(await fixtureRow.locator('.full-url').textContent(), firstUrl);
  assert.equal(await fixtureRow.locator('.details-panel').count(), 1);
  assert(await fixtureRow.locator('.full-url').evaluate((element) => element.getBoundingClientRect().bottom <= document.querySelector('.project-list').getBoundingClientRect().bottom));
  for (const theme of ['system', 'light', 'high-contrast', 'matrix', 'midnight', 'sepia', 'dark']) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption(theme);
    await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
    await page.getByRole('button', { name: 'Back to projects', exact: true }).click();
    await page.screenshot({ path: path.join(base, `${development ? 'dev' : 'desktop'}-${theme}.png`), fullPage: true });
  }
  const invalidTheme = await page.evaluate(() => window.devManager.updateSettings({ appearance: { theme: 'invalid' } }));
  assert.equal(invalidTheme.ok, false);
  console.log('PASS: project startup, verified URL, live logs, all seven appearances and invalid theme rejection');
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
  // Keep this renderer offline through the HTML controls too. Reconnecting Vite's
  // websocket can reload the page mid-assertion; main IPC/loopback probes stay local.
  await page.getByRole('button', { name: 'Close project details', exact: true }).click();
  const htmlRow = page.locator('.project-row').filter({ has: page.getByRole('button', { name: 'View html fixture', exact: true }) });
  await htmlRow.getByRole('button', { name: 'Start', exact: true }).click();
  const htmlDeadline = Date.now() + 20000;
  let htmlProject;
  while (Date.now() < htmlDeadline) {
    htmlProject = (await page.evaluate(() => window.devManager.snapshot())).value.projects.find((item) => item.name === 'html fixture');
    if (htmlProject?.status === 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(htmlProject.status, 'running');
  assert.equal(htmlProject.kind, 'static');
  const htmlUrl = htmlProject.localUrl;
  assert(new URL(htmlUrl).pathname.endsWith('/landing%20page.html'));
  assert((await (await fetch(htmlUrl)).text()).includes('Desktop HTML fixture'));
  await htmlRow.getByRole('button', { name: 'View logs for html fixture', exact: true }).click();
  await htmlRow.getByText('Entry page', { exact: true }).waitFor();
  assert.equal(await htmlRow.locator('.full-url').textContent(), htmlUrl);
  await application.evaluate(({ shell }) => { globalThis.__openedUrl = undefined; shell.openExternal = async (url) => { globalThis.__openedUrl = url; }; });
  await htmlRow.getByRole('button', { name: 'Open ↗', exact: true }).click();
  assert.equal(await application.evaluate(() => globalThis.__openedUrl), htmlUrl);
  await htmlRow.getByRole('button', { name: 'Stop', exact: true }).click();
  await mustBeClosed(htmlUrl);
  await htmlRow.getByRole('button', { name: 'Start', exact: true }).waitFor();
  await htmlRow.getByRole('button', { name: 'Start', exact: true }).click();
  await htmlRow.getByRole('button', { name: 'Open ↗', exact: true }).waitFor();
  const htmlQuitUrl = (await page.evaluate(() => window.devManager.snapshot())).value.projects.find((item) => item.name === 'html fixture').localUrl;
  await page.screenshot({ path: path.join(base, `${development ? 'dev' : 'desktop'}-html.png`), fullPage: true });
  console.log('PASS: static HTML startup, entry URL, browser-open target, details, Stop and restart');
  await application.close(); application = undefined;
  await mustBeClosed(restartedUrl);
  await mustBeClosed(htmlQuitUrl);
  console.log('PASS: normal Electron quit terminates the managed server');
  page = await launch();
  await page.getByRole('button', { name: 'View desktop-fixture', exact: true }).waitFor();
  const state = await page.evaluate(() => window.devManager.snapshot());
  assert.equal(state.value.projects[0].status, 'stopped');
  assert.equal(state.value.settings.appearance.theme, 'dark');
  assert.equal(state.value.projects[0].localUrl, undefined);
  assert.equal(state.value.projects.find((item) => item.name === 'html fixture').status, 'stopped');
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
