// Explicit opt-in public test. Only generated fixtures are ever launched/shared here.
import { _electron as electronAutomation, chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, writeFile, rm, access, symlink, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { electronPath } from './electron-path.mjs';

const base = path.resolve('.test-artifacts'); await mkdir(base, { recursive: true });
const fixture = await mkdtemp(path.join(base, 'public-preview-'));
const projects = path.join(fixture, 'projects'); const data = path.join(fixture, 'user-data');
const html = path.join(projects, 'html-demo'); const vite = path.join(projects, 'vite-demo'); const next = path.join(projects, 'next-demo');
const evidence = { started: new Date().toISOString(), results: [], urls: [], nextVersion: undefined, cleanup: false };
let application; let browser;
const failures = [];
async function until(predicate, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await predicate(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 250)); }
  throw new Error('Public sharing test timed out.');
}
async function state() { const result = await (await application.firstWindow()).evaluate(() => window.devManager.snapshot()); assert(result.ok, JSON.stringify(result)); return result.value; }
async function action(method, id) { const result = await (await application.firstWindow()).evaluate(async ({ method, id }) => window.devManager[method](id), { method, id }); assert(result.ok, JSON.stringify(result)); }
async function publicText(url, expected) {
  return until(async () => {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'manual' }); const text = await response.text(); return response.ok && text.includes(expected) ? text : false; } catch { return false; }
  }, 45000);
}
async function stoppedPublic(url, marker) {
  return until(async () => {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'manual' }); return !(await response.text()).includes(marker); } catch { return true; }
  }, 30000);
}
try {
  for (const directory of [html, vite, next]) await mkdir(directory, { recursive: true });
  await writeFile(path.join(html, 'landing page.html'), '<!doctype html><h1>Public HTML fixture</h1><link rel="stylesheet" href="style.css"><a href="z-about.html">About</a>');
  await writeFile(path.join(html, 'z-about.html'), '<h1>Public secondary HTML fixture</h1>');
  await writeFile(path.join(html, 'style.css'), 'body { color: rgb(0, 100, 120); }');
  await writeFile(path.join(vite, 'package.json'), JSON.stringify({ name: 'vite-demo', scripts: { dev: 'node server.mjs' }, devDependencies: { vite: '8.3.2' } }));
  await writeFile(path.join(vite, 'server.mjs'), `import { createServer } from ${JSON.stringify(pathToFileURL(path.resolve('node_modules/vite/dist/node/index.js')).href)}; const server = await createServer({ root:process.cwd(), configFile:false, server:{host:'127.0.0.1',port:Number(process.env.PORT),strictPort:true} }); await server.listen(); server.printUrls();`);
  await writeFile(path.join(vite, 'index.html'), '<!doctype html><h1>Public Vite fixture</h1><script type="module" src="/main.js"></script>');
  await writeFile(path.join(vite, 'main.js'), 'document.body.dataset.fixture = "vite-ready";');
  // Reuse installed third-party Next dependencies only, never an existing project's config/source/dev script.
  const saved = JSON.parse(await readFile(path.join(process.env.APPDATA, 'Local Dev Manager/state.json'), 'utf8'));
  let nextDependencies;
  for (const project of saved.projects ?? []) {
    if (project.framework !== 'Next.js') continue;
    const candidate = path.join(project.path, 'node_modules');
    try { await access(path.join(candidate, 'next/dist/bin/next')); nextDependencies = candidate; break; } catch { /* Try another installed runtime. */ }
  }
  if (!nextDependencies) throw new Error('A Next.js runtime is not installed. Prepare fixture dependencies before running this test.');
  evidence.nextVersion = JSON.parse(await readFile(path.join(nextDependencies, 'next/package.json'), 'utf8')).version;
  await symlink(nextDependencies, path.join(next, 'node_modules'), 'junction');
  await writeFile(path.join(next, 'package.json'), JSON.stringify({ name: 'next-demo', scripts: { dev: 'node server.cjs' }, dependencies: { next: evidence.nextVersion } }));
  await writeFile(path.join(next, 'server.cjs'), `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,[${JSON.stringify(path.join(nextDependencies, 'next/dist/bin/next'))},'dev','--webpack','--hostname','127.0.0.1','--port',process.env.PORT],{stdio:'inherit'});child.on('exit',code=>process.exit(code??1));`);
  await mkdir(path.join(next, 'app')); await mkdir(path.join(next, 'public'));
  await writeFile(path.join(next, 'app/layout.js'), 'export default function Layout({children}) { return <html><body>{children}</body></html>; }');
  await writeFile(path.join(next, 'app/client.js'), "'use client'; import {useEffect} from 'react'; export default function Client(){useEffect(()=>{document.body.dataset.nextReady='ready';},[]);return <span>Browser ready</span>;}\n");
  await writeFile(path.join(next, 'app/page.js'), "import Client from './client'; export default function Page() { return <><h1>Public Next fixture</h1><Client/></>; }");
  await writeFile(path.join(next, 'next.config.js'), "module.exports = { allowedDevOrigins: ['*.trycloudflare.com'] };\n");
  await writeFile(path.join(next, 'public/fixture.txt'), 'Public Next asset');
  const env = { ...process.env, LDM_DATA_DIR: data, NEXT_TELEMETRY_DISABLED: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electronAutomation.launch({ executablePath: await electronPath(), args: ['.'], cwd: process.cwd(), env });
  const page = await application.firstWindow(); page.on('pageerror', (error) => failures.push(error.message));
  await page.getByRole('heading', { name: 'Your projects.' }).waitFor();
  await application.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, projects);
  await page.getByRole('button', { name: '+ Add folder', exact: true }).click();
  await until(async () => (await state()).projects.length === 3);
  assert((await state()).sharing.available, JSON.stringify((await state()).sharing));
  await action('share', 'invalid-id').then(() => { throw new Error('Invalid ID accepted'); }, () => {});
  const registered = (await state()).projects;
  const htmlProject = registered.find((project) => project.name === 'html-demo');
  console.log('Starting generated HTML/Vite/Next public fixtures.');
  await action('start', htmlProject.id); await until(async () => (await state()).projects.find((project) => project.id === htmlProject.id).status === 'running');
  const row = page.locator('.project-row').filter({ has: page.getByRole('button', { name: 'View html-demo', exact: true }) });
  await row.getByRole('button', { name: 'Share Online', exact: true }).click();
  await page.getByRole('dialog', { name: 'Share html-demo online?' }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await state()).projects.find((project) => project.id === htmlProject.id).sharing.status, 'disabled');
  await row.getByRole('button', { name: 'Share Online', exact: true }).click();
  await page.getByRole('button', { name: 'Start sharing', exact: true }).click();
  for (const project of registered.filter((project) => project.id !== htmlProject.id)) {
    await action('start', project.id); await until(async () => (await state()).projects.find((item) => item.id === project.id).status === 'running');
    await action('share', project.id);
  }
  const sharing = await until(async () => { const projects = (await state()).projects; if (projects.some((project) => project.sharing.status === 'error')) throw new Error(JSON.stringify(projects.map((project) => ({ name: project.name, sharing: project.sharing, error: project.error })))); return projects.every((project) => project.sharing.status === 'sharing') ? projects : false; });
  evidence.urls = sharing.map((project) => ({ name: project.name, url: project.sharing.publicUrl, local: project.localUrl }));
  assert.equal(new Set(evidence.urls.map((item) => item.url)).size, 3);
  const htmlUrl = evidence.urls.find((item) => item.name === 'html-demo').url;
  const viteUrl = evidence.urls.find((item) => item.name === 'vite-demo').url;
  const nextUrl = evidence.urls.find((item) => item.name === 'next-demo').url;
  await publicText(htmlUrl, 'Public HTML fixture');
  await publicText(new URL('/z-about.html', htmlUrl), 'Public secondary HTML fixture');
  await publicText(new URL('/style.css', htmlUrl), 'rgb(0, 100, 120)');
  await publicText(viteUrl, 'Public Vite fixture'); await publicText(new URL('/main.js', viteUrl), 'vite-ready');
  await publicText(nextUrl, 'Public Next fixture'); await publicText(new URL('/fixture.txt', nextUrl), 'Public Next asset');
  evidence.results.push('Three simultaneous HTML/Vite/Next public HTTPS pages and assets passed from this PC.');
  console.log('PASS: three simultaneous public pages/assets; checking desktop actions and browser reload.');
  await row.getByRole('button', { name: 'View logs for html-demo', exact: true }).click();
  await row.getByRole('button', { name: 'Copy Public Link', exact: true }).click();
  assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), htmlUrl);
  let opened;
  await application.evaluate(({ shell }) => { globalThis.sharingOpenedUrl = undefined; shell.openExternal = async (url) => { globalThis.sharingOpenedUrl = url; }; });
  await row.getByRole('button', { name: 'Open Public Link', exact: true }).click();
  opened = await application.evaluate(() => globalThis.sharingOpenedUrl); assert.equal(opened, htmlUrl);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(850, 600));
  await page.screenshot({ path: path.join(base, 'sharing-small.png') });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
  await page.evaluate(() => window.devManager.theme('light')); await page.screenshot({ path: path.join(base, 'sharing-light.png') });
  await page.evaluate(() => window.devManager.theme('dark')); await page.screenshot({ path: path.join(base, 'sharing-dark.png') });
  evidence.results.push('Confirmation/cancel, compatibility, copy/open public URL, small-window layout, themes passed in Electron. Open browser was stubbed to inspect its target.');
  // Real browser network/WS checks; this browser still runs on the same PC, not an independent network.
  browser = await chromium.launch({ channel: 'msedge' });
  const visit = await browser.newPage(); const sockets = [];
  evidence.browserNotes = [];
  visit.on('console', (message) => { if (evidence.browserNotes.length < 30 && ['error', 'warning'].includes(message.type())) evidence.browserNotes.push(message.text().slice(0, 800)); });
  visit.on('pageerror', (error) => { if (evidence.browserNotes.length < 30) evidence.browserNotes.push(error.message.slice(0, 800)); });
  visit.on('websocket', (socket) => { socket.on('framereceived', () => sockets.push(socket.url())); });
  await visit.goto(viteUrl); await visit.waitForFunction(() => document.body.dataset.fixture === 'vite-ready');
  await writeFile(path.join(vite, 'index.html'), '<!doctype html><h1>Updated public Vite fixture</h1><script type="module" src="/main.js"></script>');
  await visit.getByRole('heading', { name: 'Updated public Vite fixture', exact: true }).waitFor({ timeout: 30000 });
  assert(sockets.some((url) => url.startsWith('wss://'))); evidence.results.push('Vite public WebSocket and browser reload passed.');
  sockets.length = 0;
  await visit.goto(nextUrl); await visit.getByRole('heading', { name: 'Public Next fixture', exact: true }).waitFor();
  await visit.waitForFunction(() => document.body.dataset.nextReady === 'ready', { timeout: 30000 });
  await until(() => sockets.some((url) => new URL(url).host === new URL(nextUrl).host), 30000);
  await writeFile(path.join(next, 'app/page.js'), "import Client from './client'; export default function Page() { return <><h1>Updated public Next fixture</h1><Client/></>; }");
  await visit.getByRole('heading', { name: 'Updated public Next fixture', exact: true }).waitFor({ timeout: 30000 });
  evidence.results.push('Next public browser reload passed.');
  await browser.close(); browser = undefined;
  console.log(`LIVE_URLS ${JSON.stringify(evidence.urls.map(({ name, url }) => ({ name, url })))}`);
  console.log(`EXTERNAL_CHECK_MARKER ${path.join(fixture, 'external-check.json')}`);
  // Allow the calling agent to check these fixture URLs through an independent tool, then signal continuation.
  const marker = path.join(fixture, 'external-check.json');
  await until(async () => { try { return JSON.parse(await readFile(marker, 'utf8')); } catch { return false; } }, 180000).then((result) => evidence.external = result);
  await row.getByRole('button', { name: 'Stop Sharing', exact: true }).click();
  await until(async () => (await state()).projects.find((project) => project.id === htmlProject.id).sharing.status === 'disabled');
  await stoppedPublic(htmlUrl, 'Public HTML fixture'); await publicText(htmlProject.localUrl ?? evidence.urls.find((item) => item.name === 'html-demo').local, 'Public HTML fixture');
  await publicText(viteUrl, 'Updated public Vite fixture'); evidence.results.push('Individual Stop Sharing ended public HTML access while local HTML and other public links remained available.');
  await page.getByRole('button', { name: 'Stop All Sharing', exact: true }).click();
  await until(async () => (await state()).projects.every((project) => project.sharing.status === 'disabled'));
  assert((await state()).projects.every((project) => project.status === 'running'));
  await stoppedPublic(viteUrl, 'Vite fixture'); await stoppedPublic(nextUrl, 'Next fixture');
  evidence.results.push('Stop All Sharing ended remaining public previews and preserved every local server.');
  await action('share', htmlProject.id); await until(async () => (await state()).projects.find((project) => project.id === htmlProject.id).sharing.status === 'sharing');
  const restartedLink = (await state()).projects.find((project) => project.id === htmlProject.id).sharing.publicUrl;
  await action('restart', htmlProject.id); await until(async () => (await state()).projects.find((project) => project.id === htmlProject.id).status === 'running');
  assert.equal((await state()).projects.find((project) => project.id === htmlProject.id).sharing.status, 'disabled'); await stoppedPublic(restartedLink, 'Public HTML fixture');
  await action('share', htmlProject.id); await until(async () => (await state()).projects.find((project) => project.id === htmlProject.id).sharing.status === 'sharing');
  const finalLink = (await state()).projects.find((project) => project.id === htmlProject.id).sharing.publicUrl;
  const localUrls = (await state()).projects.map((project) => project.localUrl);
  await application.close(); application = undefined;
  await stoppedPublic(finalLink, 'Public HTML fixture');
  for (const url of localUrls) await until(async () => { try { const response = await fetch(url, { signal: AbortSignal.timeout(500) }); await response.body?.cancel(); return false; } catch { return true; } }, 10000);
  assert.deepEqual(failures, []); evidence.cleanup = true; evidence.results.push('Restart and normal manager quit ended public sharing; quit closed every fixture local server.');
  console.log('PASS: public sharing smoke checks complete; all fixture tunnels and local servers stopped.');
} catch (error) {
  evidence.error = error.stack ?? String(error);
  if (application) { try { evidence.stateOnFailure = await state(); evidence.logsOnFailure = await (await application.firstWindow()).evaluate(async () => { const state = await window.devManager.snapshot(); return state.ok ? Promise.all(state.value.projects.map(async (project) => ({ name: project.name, logs: await window.devManager.logs(project.id) }))) : state; }); } catch { /* App may already have exited. */ } }
  throw error;
} finally {
  await browser?.close();
  if (application) await application.close();
  evidence.finished = new Date().toISOString();
  await writeFile(path.join(base, 'public-sharing-evidence.json'), JSON.stringify(evidence, null, 2));
  const resolved = path.resolve(fixture); const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe fixture cleanup target.');
  // Remove the fixture junction itself first, never recursively traverse its dependency target.
  const junction = path.join(next, 'node_modules');
  if ((await lstat(junction).catch(() => undefined))?.isSymbolicLink()) await unlink(junction);
  await rm(resolved, { recursive: true, force: true });
}
