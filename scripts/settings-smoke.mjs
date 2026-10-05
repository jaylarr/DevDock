import { _electron as automation } from 'playwright';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { electronPath } from './electron-path.mjs';

const base = path.resolve('.test-artifacts'); await mkdir(base, { recursive: true });
const fixture = await mkdtemp(path.join(base, 'settings-fixture-'));
const data = path.join(fixture, 'user-data'); const projects = path.join(fixture, 'projects');
await mkdir(data, { recursive: true });
for (let index = 0; index < 14; index++) {
  const site = path.join(projects, `site-${String(index).padStart(2, '0')}`); await mkdir(site, { recursive: true });
  await writeFile(path.join(site, 'landing page.html'), '<h1>Fictional settings fixture</h1>');
}
const excluded = path.join(projects, 'site-13');
const legacy = { version: 2, roots: [], projects: [], theme: 'sepia', exclusions: [excluded] };
await writeFile(path.join(data, 'state.json'), JSON.stringify(legacy));
const electron = await electronPath(); let application; let page;
const errors = []; const requests = [];
const snapshot = async () => { const result = await page.evaluate(() => window.devManager.snapshot()); assert(result.ok, result.error); return result.value; };
async function eventually(check, message = 'Settings condition timed out') {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(message);
}
async function launch() {
  const env = { ...process.env, LDM_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE; delete env.LDM_RENDERER_URL;
  application = await automation.launch({ executablePath: electron, args: ['.'], cwd: process.cwd(), env });
  page = await application.firstWindow(); page.on('pageerror', (error) => errors.push(error.message)); page.on('request', (request) => requests.push(request.url()));
  await page.getByRole('heading', { name: 'Your projects.' }).waitFor(); await eventually(async () => !!(await snapshot()).settings);
  await application.evaluate(({ shell, clipboard }) => {
    globalThis.__settingsOpened = []; globalThis.__settingsCopied = '';
    shell.openExternal = async (url) => { globalThis.__settingsOpened.push(url); };
    shell.openPath = async (directory) => { globalThis.__settingsFolder = directory; return ''; };
    clipboard.writeText = (text) => { globalThis.__settingsCopied = text; };
  });
}
async function selectFile(filename, cancelled = false) {
  await application.evaluate(({ dialog }, value) => { dialog.showOpenDialog = async () => ({ canceled: value.cancelled, filePaths: value.cancelled ? [] : [value.filename] }); }, { filename, cancelled });
}
async function settings(section) {
  if (await page.getByRole('button', { name: 'Back to projects', exact: true }).count() === 0) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await eventually(async () => page.getByRole('heading', { name: 'Settings.' }).evaluate((element) => document.activeElement === element));
  }
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: section, exact: true }).click();
}
async function back() { await page.getByRole('button', { name: 'Back to projects', exact: true }).click(); }
async function chooseTheme(theme) { await page.getByLabel('Appearance', { exact: true }).selectOption(theme); await eventually(async () => (await snapshot()).settings.appearance.theme === theme); }
async function idle() { await eventually(async () => !(await page.getByRole('status').filter({ hasText: 'Working…' }).count())); }
async function scrollToSectionBottom(target) {
  const panel = page.locator('.settings-content');
  const navTop = await page.locator('.settings-navigation').evaluate((element) => element.getBoundingClientRect().top);
  const box = await panel.boundingBox(); assert(box);
  assert(await panel.evaluate((element) => element.scrollHeight > element.clientHeight));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 10000);
  await eventually(async () => panel.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 2));
  assert(await target.evaluate((element) => {
    const bounds = element.getBoundingClientRect(); const panelBounds = element.closest('.settings-content').getBoundingClientRect();
    return bounds.top >= panelBounds.top && bounds.bottom <= panelBounds.bottom;
  }), 'Lower section control must be inside the visible scroll panel');
  assert.equal(await page.locator('.settings-navigation').evaluate((element) => element.getBoundingClientRect().top), navTop);
}
async function confirm(title, action) { const dialog = page.getByRole('dialog', { name: title, exact: true }); await dialog.getByRole('button', { name: action, exact: true }).click(); try { await dialog.waitFor({ state: 'detached' }); } catch (error) { throw new Error(`${title}: ${await dialog.innerText()}`, { cause: error }); } }

try {
  await launch(); await eventually(async () => !(await snapshot()).scanning);
  assert.equal((await snapshot()).settings.appearance.theme, 'sepia'); assert.equal((await snapshot()).exclusions[0].path, excluded);
  assert.deepEqual(JSON.parse(await readFile(path.join(data, 'state.json.v2.bak'), 'utf8')), legacy);
  await selectFile(projects); await page.getByRole('button', { name: '+ Add folder', exact: true }).click();
  await eventually(async () => (await snapshot()).projects.length === 13 && !(await snapshot()).scanning);
  const pagination = page.getByRole('navigation', { name: 'Project pagination' });
  await page.getByLabel('Search projects').fill('site-'); await pagination.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'View site-11', exact: true }).click();
  await settings('Appearance'); await back();
  await eventually(async () => page.locator('.settings-entry').evaluate((element) => document.activeElement === element));
  assert.equal(await page.getByLabel('Search projects').inputValue(), 'site-');
  await pagination.getByText('11–13 of 13', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'View site-11', exact: true }).getAttribute('aria-expanded'), 'true');
  await settings('Appearance'); await chooseTheme('high-contrast'); await idle();
  await page.getByLabel('Default projects per page').selectOption('5'); await eventually(async () => (await snapshot()).settings.appearance.pageSize === 5); await idle();
  await page.getByLabel('Project row density').selectOption('compact'); await eventually(async () => (await snapshot()).settings.appearance.density === 'compact'); await idle();
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(850, 600));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(base, 'settings-appearance-small.png') });
  console.log('PASS: v2 migration, exclusion retention, dashboard context, persisted page size and density, minimum-size Settings');

  await settings('Discovery');
  await scrollToSectionBottom(page.getByRole('button', { name: 'Rescan', exact: true }));
  await settings('Local data');
  assert.equal(await page.locator('.settings-content').evaluate((element) => element.scrollTop), 0);
  await scrollToSectionBottom(page.getByRole('button', { name: 'Rescan projects', exact: true }));
  await settings('About & diagnostics'); await page.locator('.diagnostic-preview').waitFor(); await idle();
  await scrollToSectionBottom(page.locator('.settings-help summary'));
  await page.locator('.settings-help summary').click();
  await scrollToSectionBottom(page.locator('.settings-help p').last());
  await page.screenshot({ path: path.join(base, 'settings-help-bottom-small.png') });
  await settings('Discovery');
  console.log('PASS: Discovery, Local data, diagnostics and expanded help lower areas reachable by mouse at minimum window size; section navigation stays visible');
  assert(await page.locator('.sidebar .brand').evaluate((element) => element.getBoundingClientRect().top >= 0));
  await page.getByLabel('Scan when DevDock opens').uncheck(); await eventually(async () => !(await snapshot()).settings.discovery.scanOnLaunch); await idle();
  const spare = path.join(fixture, 'spare'); await mkdir(spare); await selectFile(spare);
  await page.getByRole('region', { name: 'Settings', exact: true }).getByRole('button', { name: 'Add folder', exact: true }).click();
  await eventually(async () => (await snapshot()).roots.length === 2 && !(await snapshot()).scanning); await idle();
  await page.getByRole('button', { name: 'Remove registration for spare', exact: true }).click(); await confirm('Remove folder registration?', 'Remove registration');
  assert.equal((await snapshot()).roots.length, 1); assert.equal((await snapshot()).exclusions.length, 1);
  await application.close(); application = undefined; await launch();
  assert.equal((await snapshot()).lastScan, undefined); assert.equal((await snapshot()).projects.length, 13);
  assert.equal((await snapshot()).settings.appearance.pageSize, 5); assert.equal((await snapshot()).settings.appearance.density, 'compact');
  console.log('PASS: root removal confirmation, saved settings on relaunch, startup scan disabled with cached catalog');

  await page.getByRole('navigation', { name: 'Project filters' }).getByRole('button').filter({ hasText: 'Stopped' }).click();
  await settings('Behavior'); await page.getByLabel('Remember last project filter').check(); await eventually(async () => (await snapshot()).view.lastFilter.value === 'stopped'); await idle();
  await page.getByLabel('Follow logs by default').uncheck(); await eventually(async () => !(await snapshot()).settings.behavior.logAutoScroll); await idle();
  await page.getByLabel('Open browser after verified startup').check(); await eventually(async () => (await snapshot()).settings.behavior.autoOpenBrowser); await idle();
  await application.close(); application = undefined; await launch();
  assert.equal((await snapshot()).view.lastFilter.value, 'stopped');
  await eventually(async () => (await page.getByRole('navigation', { name: 'Project filters' }).getByRole('button').filter({ hasText: 'Stopped' }).getAttribute('class')).includes('selected'));
  await page.getByRole('navigation', { name: 'Project filters' }).getByRole('button').filter({ hasText: 'All projects' }).click();
  await page.getByLabel('Search projects').fill('site-00'); await page.getByRole('button', { name: 'View site-00', exact: true }).click();
  assert.equal(await page.getByLabel('Auto-scroll', { exact: true }).isChecked(), false); await page.getByLabel('Auto-scroll', { exact: true }).check();
  await settings('Behavior'); await back(); assert.equal(await page.getByLabel('Auto-scroll', { exact: true }).isChecked(), true);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await eventually(async () => (await snapshot()).projects.some((project) => project.name === 'site-00' && project.status === 'running'));
  const opened = await application.evaluate(() => globalThis.__settingsOpened); assert.equal(opened.length, 1); assert(opened[0].endsWith('/landing%20page.html'));
  console.log('PASS: remembered filter and log defaults, per-view follow override, exactly one verified browser open with HTML entry');

  await settings('Local data'); assert(await page.getByRole('button', { name: 'Clear cache', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'Open data folder', exact: true }).click(); await idle(); assert.equal(await application.evaluate(() => globalThis.__settingsFolder), data);
  const exported = path.join(fixture, 'settings-export.json');
  await application.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, exported);
  await page.getByRole('checkbox', { name: /Include project folder registrations/ }).check();
  await page.getByRole('button', { name: 'Export settings', exact: true }).click(); await page.getByRole('status').getByText('Settings exported.', { exact: true }).waitFor();
  const portable = JSON.parse(await readFile(exported, 'utf8')); assert.equal(portable.format, 'devdock-settings'); assert.equal(portable.discovery.roots.length, 1); assert(!JSON.stringify(portable).includes('localUrl'));
  await settings('Appearance'); await chooseTheme('matrix'); await idle(); await settings('Local data');
  await selectFile(exported); await page.getByRole('button', { name: 'Import settings', exact: true }).click();
  let review = page.getByRole('dialog', { name: 'Review settings import', exact: true }); await review.waitFor();
  assert.equal(await review.getByRole('checkbox', { name: 'Apply folder registrations and exclusions', exact: true }).isChecked(), false);
  assert(await review.getByRole('checkbox', { name: 'Apply folder registrations and exclusions', exact: true }).isDisabled());
  await page.evaluate(() => window.devManager.updateSettings({ appearance: { density: 'standard' } }));
  await review.getByRole('button', { name: 'Apply import', exact: true }).click(); await review.getByRole('alert').getByText(/Settings changed/).waitFor();
  await review.getByRole('button', { name: 'Cancel', exact: true }).click(); await review.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Import settings', exact: true }).click(); await confirm('Review settings import', 'Apply import');
  assert.equal((await snapshot()).settings.appearance.theme, portable.settings.appearance.theme); assert((await snapshot()).projects.some((project) => project.status === 'running'));
  console.log('PASS: data-folder target, portable export, opt-in folder import, stale-preview rejection, preference import while server runs');

  await back(); await page.getByRole('button', { name: 'Stop', exact: true }).click(); await eventually(async () => !(await snapshot()).projects.some((project) => project.managed) && !(await snapshot()).scanning);
  await page.getByRole('button', { name: 'Start', exact: true }).waitFor();
  await settings('Local data'); await page.getByRole('button', { name: 'Import settings', exact: true }).click(); review = page.getByRole('dialog', { name: 'Review settings import', exact: true });
  await review.getByRole('checkbox', { name: 'Apply folder registrations and exclusions', exact: true }).check(); await confirm('Review settings import', 'Apply import');
  assert.equal((await snapshot()).projects.length, 0); assert.equal((await snapshot()).roots.length, 1); assert.equal((await snapshot()).exclusions.length, 1);
  await page.getByRole('button', { name: 'Rescan projects', exact: true }).click(); await eventually(async () => (await snapshot()).projects.length === 13 && !(await snapshot()).scanning); await idle();
  await page.getByRole('button', { name: 'Clear cache', exact: true }).click(); await confirm('Clear discovery cache?', 'Clear cache'); assert.equal((await snapshot()).projects.length, 0);
  await page.getByRole('button', { name: 'Rescan projects', exact: true }).click(); await eventually(async () => (await snapshot()).projects.length === 13 && !(await snapshot()).scanning); await idle();
  await page.getByRole('button', { name: 'Restore defaults', exact: true }).click();
  const resetDialog = page.getByRole('dialog', { name: 'Restore preference defaults?', exact: true });
  for (let index = 0; index < 4; index++) { await page.keyboard.press('Tab'); assert(await resetDialog.evaluate((element) => element.contains(document.activeElement))); }
  await page.keyboard.press('Escape'); await resetDialog.waitFor({ state: 'detached' });
  assert(await page.getByRole('button', { name: 'Restore defaults', exact: true }).evaluate((element) => element === document.activeElement));
  await page.getByRole('button', { name: 'Restore defaults', exact: true }).click(); await confirm('Restore preference defaults?', 'Restore defaults');
  const defaults = await snapshot(); assert.equal(defaults.settings.appearance.theme, 'system'); assert.equal(defaults.settings.appearance.pageSize, 10); assert.equal(defaults.settings.behavior.autoOpenBrowser, false);
  assert.equal(defaults.roots.length, 1); assert.equal(defaults.projects.length, 13); assert.equal(defaults.exclusions.length, 1);
  await selectFile('', true); await page.getByRole('button', { name: 'Import settings', exact: true }).click(); await page.getByRole('status').getByText('Import cancelled.', { exact: true }).waitFor();
  await application.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
  await page.getByRole('button', { name: 'Export settings', exact: true }).click(); await page.getByRole('status').getByText('Export cancelled.', { exact: true }).waitFor();
  console.log('PASS: folder import replaces cache without files, cache clear/rescan, scoped defaults reset, native dialog cancellation');

  await settings('About & diagnostics'); await page.locator('.diagnostic-preview').waitFor(); await idle();
  const report = await page.locator('.diagnostic-preview').textContent(); assert(!report.includes(fixture)); assert(!report.includes('site-')); assert(!report.includes('http'));
  await page.getByRole('button', { name: 'Copy diagnostics', exact: true }).click(); await idle(); assert.equal(await application.evaluate(() => globalThis.__settingsCopied), report);
  await page.screenshot({ path: path.join(base, 'settings-diagnostics-small.png') });
  assert.deepEqual(errors, []); assert(!requests.some((url) => /^https?:/.test(url)));
  console.log('PASS: sanitized diagnostic preview matches copied report; no renderer errors or external requests');
  await settings('Appearance'); await chooseTheme('light'); await idle();
  await page.locator('.settings-content').evaluate((element) => { element.scrollTop = 0; });
  assert(await page.locator('.sidebar .brand').isVisible());
  assert(await page.locator('.sidebar .brand').evaluate((element) => element.getBoundingClientRect().top >= 0));
  await page.screenshot({ path: path.join(base, 'settings-appearance-light.png') });
  await application.close(); application = undefined;
  console.log(`Settings smoke passed. Isolated evidence: ${fixture}`);
} finally { if (application) await application.close(); }
