import { _electron as automation } from 'playwright';
import { electronPath } from './electron-path.mjs';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const base = path.resolve('.test-artifacts'); await mkdir(base, { recursive: true });
const fixture = await mkdtemp(path.join(base, 'projects-focus '));
const projects = path.join(fixture, 'projects'), data = path.join(fixture, 'user-data');
for (let index = 0; index < 13; index++) {
  const directory = path.join(projects, `site-${String(index).padStart(2, '0')}`);
  await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, 'index.html'), '<h1>Focus fixture</h1>');
}
const errors = [], requests = []; let application, page;
async function eventually(predicate) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error('Project focus smoke timed out.');
}
async function snapshot() { const result = await page.evaluate(() => window.devManager.snapshot()); assert(result.ok, result.error); return result.value; }
async function launch() {
  const env = { ...process.env, LDM_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE; delete env.LDM_RENDERER_URL;
  application = await automation.launch({ executablePath: await electronPath(), args: ['.'], cwd: process.cwd(), env });
  page = await application.firstWindow(); page.on('pageerror', (error) => errors.push(error.message)); page.on('request', (request) => requests.push(request.url()));
  await page.getByRole('heading', { name: 'Your projects.' }).waitFor(); await eventually(async () => !(await snapshot()).scanning);
  await application.evaluate(({ shell }) => { globalThis.__focusOpened = []; shell.openPath = async (directory) => { globalThis.__focusOpened.push(directory); return ''; }; shell.openExternal = async () => {}; });
}
async function filter(label) { await page.getByRole('navigation', { name: 'Project filters' }).getByRole('button').filter({ has: page.getByText(label, { exact: true }) }).click(); }
function row(name) { return page.locator('.project-row').filter({ has: page.getByRole('button', { name: `View ${name}`, exact: true }) }); }
async function openFolder(name) { await page.getByRole('button', { name: `View ${name}`, exact: true }).click(); await row(name).getByRole('button', { name: 'Open folder', exact: true }).click(); await eventually(async () => !!(await snapshot()).projects.find((item) => item.name === name)?.lastActiveAt); }
async function assertLayout() {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert(await page.locator('.project-list').evaluate((element) => element.scrollWidth <= element.clientWidth));
  const pagination = await page.getByRole('navigation', { name: 'Project pagination' }).boundingBox(); assert(pagination && pagination.y + pagination.height <= await page.evaluate(() => innerHeight));
  assert(await page.getByRole('button', { name: 'Settings', exact: true }).evaluate((element) => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
}
try {
  await launch();
  await application.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, projects);
  await page.getByRole('button', { name: '+ Add folder', exact: true }).click(); await eventually(async () => (await snapshot()).projects.length === 13 && !(await snapshot()).scanning);
  await filter('Recent activity'); await page.getByRole('heading', { name: 'No recent activity yet' }).waitFor();
  await filter('All projects'); const pagination = page.getByRole('navigation', { name: 'Project pagination' });
  await pagination.getByRole('button', { name: 'Next', exact: true }).click();
  const pin = page.getByRole('button', { name: 'Pin site-12', exact: true }); await pin.focus(); await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: /Pinned projects/ }).waitFor();
  await eventually(async () => (await snapshot()).projects.find((item) => item.name === 'site-12')?.pinned);
  assert.equal(await page.locator('.project-row').first().getByRole('button', { name: 'View site-12', exact: true }).count(), 1);
  await pagination.getByRole('button', { name: 'Previous', exact: true }).click(); assert.equal(await page.locator('.project-row').count(), 11);
  assert.equal(await page.locator('.project-row').first().getByRole('button', { name: 'View site-12', exact: true }).count(), 1);
  await filter('Pinned'); assert.equal(await page.locator('.project-row').count(), 1);
  await filter('Recent activity'); await page.getByRole('heading', { name: 'No recent activity yet' }).waitFor();
  await filter('All projects'); await page.getByLabel('Search projects').fill('site-00'); assert.equal(await page.getByRole('button', { name: 'Unpin site-12', exact: true }).count(), 0);
  await page.getByLabel('Search projects').fill(''); await openFolder('site-02');
  await filter('Recent activity'); assert.equal(await page.locator('.project-row').count(), 1);
  await filter('All projects'); await openFolder('site-01');
  await filter('Recent activity'); assert.equal(await page.locator('.project-row').count(), 2);
  assert.equal(await page.locator('.project-row').first().getByRole('button', { name: 'View site-01', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'View site-01', exact: true }).click();
  await row('site-01').getByRole('button', { name: 'Start', exact: true }).click();
  await eventually(async () => (await snapshot()).projects.find((item) => item.name === 'site-01')?.status === 'running');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(850, 600));
  await assertLayout(); await page.screenshot({ path: path.join(fixture, 'focus-running-small.png') });
  const beforeOpen = (await snapshot()).projects.find((item) => item.name === 'site-01').lastActiveAt;
  await row('site-01').getByRole('button', { name: 'Open ↗', exact: true }).click();
  await eventually(async () => (await snapshot()).projects.find((item) => item.name === 'site-01').lastActiveAt !== beforeOpen);
  const before = (await snapshot()).projects.find((item) => item.name === 'site-01').lastActiveAt;
  await application.evaluate(({ shell }) => { shell.openPath = async () => 'Fixture open failure'; });
  await row('site-01').getByRole('button', { name: 'Open folder', exact: true }).click(); await page.getByRole('alert').getByText('Fixture open failure', { exact: true }).waitFor();
  assert.equal((await snapshot()).projects.find((item) => item.name === 'site-01').lastActiveAt, before);
  const id = (await snapshot()).projects.find((item) => item.name === 'site-01').id;
  assert.equal((await page.evaluate((id) => window.devManager.setPinned(id, 'yes'), id)).ok, false);
  assert.equal((await page.evaluate(() => window.devManager.setPinned('invalid', true))).ok, false);
  await row('site-01').getByRole('button', { name: 'Stop', exact: true }).click(); await eventually(async () => !(await snapshot()).scanning && !(await snapshot()).projects.some((item) => item.managed));
  console.log('PASS: keyboard pinning, pins on every page, scoped search/filters, newest-first recent activity, successful browser/folder/start events, failed opens and invalid IPC');
  await filter('All projects'); if (await page.getByRole('button', { name: 'Dismiss error', exact: true }).count()) await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(850, 600));
  await assertLayout(); await page.screenshot({ path: path.join(fixture, 'focus-small.png') });
  await application.close(); application = undefined; await launch();
  const state = await snapshot(); assert(state.projects.find((item) => item.name === 'site-12').pinned); assert(state.projects.find((item) => item.name === 'site-01').lastActiveAt); assert(state.projects.every((item) => item.status === 'stopped'));
  await page.getByRole('button', { name: '↻ Rescan', exact: true }).click(); await eventually(async () => !(await snapshot()).scanning);
  assert((await snapshot()).projects.find((item) => item.name === 'site-12').pinned);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 800));
  await assertLayout(); await page.screenshot({ path: path.join(fixture, 'focus-light.png') });
  await page.evaluate(() => window.devManager.updateSettings({ appearance: { theme: 'dark' } })); await eventually(async () => (await page.locator('html').getAttribute('data-theme')) === 'dark');
  await page.screenshot({ path: path.join(fixture, 'focus-dark.png') });
  await page.getByRole('button', { name: 'Unpin site-12', exact: true }).click(); await eventually(async () => !(await snapshot()).projects.find((item) => item.name === 'site-12').pinned);
  const saved = JSON.parse(await readFile(path.join(data, 'state.json'), 'utf8')); assert(!saved.projects.find((item) => item.name === 'site-12').pinned); assert(saved.projects.find((item) => item.name === 'site-01').lastActiveAt);
  assert.deepEqual(errors, []); assert(!requests.some((url) => /^https?:/.test(url)));
  console.log(`PASS: restart/rescan persistence, stopped runtime on restart, durable unpin, minimum-size layout, light/dark appearance, no renderer errors or external requests. Evidence: ${fixture}`);
} finally { if (application) await application.close(); }
