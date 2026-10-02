// Real Electron screenshots using disposable fictional projects. No public tunnels.
import { _electron as automation } from 'playwright';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { electronPath } from './electron-path.mjs';

const base = path.resolve('.test-artifacts');
await mkdir(base, { recursive: true });
const fixture = await mkdtemp(path.join(base, 'showcase-'));
const projects = path.join(fixture, 'Demo Projects');
const data = path.join(fixture, 'user-data');
const output = path.resolve('docs/media');
await mkdir(output, { recursive: true });
await mkdir(data, { recursive: true });
// An explicitly empty exclusion list keeps machine-specific defaults out of this demo.
await writeFile(path.join(data, 'state.json'), JSON.stringify({ version: 2, roots: [], projects: [], exclusions: [], theme: 'light' }));
let application;
const urls = [];
const errors = [];
const captures = [];
async function until(predicate) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Showcase fixture did not become ready.');
}
try {
  const names = ['atlas-dashboard', 'beacon-api', 'canvas-studio', 'harbor-docs', 'orbit-storefront', 'summit-starter'];
  for (const name of names) {
    const directory = path.join(projects, name);
    await mkdir(directory, { recursive: true });
    const html = `<!doctype html><html lang="en"><title>${name} demo</title><h1>${name}</h1><p>Fictional showcase project.</p></html>`;
    if (['canvas-studio', 'harbor-docs'].includes(name)) {
      await writeFile(path.join(directory, 'index.html'), html);
    } else if (['atlas-dashboard', 'orbit-storefront'].includes(name)) {
      await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, scripts: { dev: 'node server.mjs' }, devDependencies: { vite: '8.3.2' } }));
      await writeFile(path.join(directory, 'index.html'), html);
      await writeFile(path.join(directory, 'server.mjs'), `import { createServer } from ${JSON.stringify(pathToFileURL(path.resolve('node_modules/vite/dist/node/index.js')).href)}; const server = await createServer({ root: process.cwd(), configFile: false, server: { host: '127.0.0.1', port: Number(process.env.PORT), strictPort: true } }); await server.listen(); server.printUrls();`);
    } else {
      await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, scripts: { dev: 'node server.cjs' }, ...(name === 'summit-starter' ? { packageManager: 'pnpm@10.0.0' } : {}) }));
      await writeFile(path.join(directory, 'server.cjs'), `const http = require('node:http'); const server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(${JSON.stringify(html)}); }); server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + server.address().port));`);
    }
  }
  const env = { ...process.env, LDM_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.LDM_RENDERER_URL;
  application = await automation.launch({ executablePath: await electronPath(), args: ['.'], cwd: process.cwd(), env, timeout: 30000 });
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
  await page.getByRole('heading', { name: 'Your projects.' }).waitFor();
  // Only folder-picker response is stubbed. Scan, IPC, process management and logs are real.
  await application.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, projects);
  await page.getByRole('button', { name: '+ Add folder', exact: true }).click();
  const snapshot = async () => {
    const result = await page.evaluate(() => window.devManager.snapshot());
    assert(result.ok);
    return result.value;
  };
  await until(async () => (await snapshot()).projects.length === names.length);
  assert.deepEqual((await snapshot()).projects.map((item) => item.name).sort(), names);
  assert.equal((await snapshot()).roots.length, 1);
  for (const name of ['atlas-dashboard', 'beacon-api', 'canvas-studio']) {
    const row = page.locator('.project-row').filter({ has: page.getByRole('button', { name: `View ${name}`, exact: true }) });
    await row.getByRole('button', { name: 'Start', exact: true }).click();
    await until(async () => (await snapshot()).projects.find((item) => item.name === name).status === 'running');
  }
  const state = await snapshot();
  urls.push(...state.projects.filter((item) => item.localUrl).map((item) => item.localUrl));
  assert.equal(urls.length, 3);
  for (const url of urls) assert((await fetch(url)).ok);
  assert(state.projects.every((item) => item.sharing.status === 'disabled'));
  const row = page.locator('.project-row').filter({ has: page.getByRole('button', { name: 'View atlas-dashboard', exact: true }) });
  async function capture(filename, caption) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(350); // Allow the application's theme transition to finish.
    // Presentation only: replace fixture paths in visible text and titles. Statuses and logs stay real.
    // MutationObserver handles subsequent React updates without changing the app's saved/backend paths.
    await page.evaluate(({ actual, shown }) => {
      globalThis.__showcaseObserver?.disconnect();
      const scrub = () => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node.textContent.includes(actual)) node.textContent = node.textContent.replaceAll(actual, shown);
        }
        for (const element of document.querySelectorAll('[title]')) {
          if (element.title.includes(actual)) element.title = element.title.replaceAll(actual, shown);
        }
      };
      scrub();
      globalThis.__showcaseObserver = new MutationObserver(scrub);
      globalThis.__showcaseObserver.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title'] });
    }, { actual: projects, shown: 'C:\\Demo Projects' });
    const visible = await page.locator('body').innerText();
    assert(!/C:\\Users\\|RUN DEV WORKSPACE|Automation Context Mapping|showcase-/i.test(visible));
    assert(visible.includes('C:\\Demo Projects'));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
    const png = await page.screenshot({ path: path.join(output, filename) });
    captures.push({ filename, caption, width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
  }
  await capture('01-dashboard-light.png', 'Six fictional projects, three real local servers, light theme.');
  await page.getByRole('switch', { name: 'Dark mode' }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await capture('02-dashboard-dark.png', 'The same fictional workspace in dark mode.');
  await row.getByRole('button', { name: 'View logs for atlas-dashboard', exact: true }).click();
  await page.getByLabel('Project logs', { exact: true }).getByText(/Ready ·/).waitFor();
  await capture('03-project-details.png', 'Real Vite fixture controls, verified local URL and live output.');
  await page.getByRole('button', { name: 'Close project details', exact: true }).click();
  await row.getByRole('button', { name: 'Share Online', exact: true }).click();
  await page.getByRole('button', { name: 'Start sharing', exact: true }).waitFor({ state: 'visible' });
  await until(async () => await page.getByRole('button', { name: 'Start sharing', exact: true }).isEnabled());
  await capture('04-sharing-confirmation.png', 'Public-preview confirmation and compatibility hints; no tunnel was started.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert((await snapshot()).projects.every((item) => item.sharing.status === 'disabled'));
  assert.deepEqual(errors, []);
  await application.close(); application = undefined;
  for (const url of urls) {
    await until(async () => { try { const response = await fetch(url, { signal: AbortSignal.timeout(500) }); await response.body?.cancel(); return false; } catch { return true; } });
  }
  await writeFile(path.join(output, 'screenshots.json'), JSON.stringify({
    capturedAt: new Date().toISOString(), applicationVersion: '0.3.0', platform: process.platform,
    fictionalProjects: names, realLocalServers: ['atlas-dashboard (Vite)', 'beacon-api (Node)', 'canvas-studio (Static HTML)'],
    realUserDataRead: false, publicTunnelsStarted: false, normalQuitCleanupVerified: true,
    presentation: 'Actual Electron renderer. Fixture paths displayed as C:\\Demo Projects; no statuses, links, counts or log content fabricated.',
    captures,
  }, null, 2) + '\n');
  console.log('Captured four fictional-project screenshots. Real local servers stopped; no public tunnels started.');
} finally {
  if (application) await application.close();
  const relative = path.relative(base, path.resolve(fixture));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe showcase cleanup target.');
  await rm(fixture, { recursive: true, force: true });
}
