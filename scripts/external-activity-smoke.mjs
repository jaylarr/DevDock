import { _electron as automation } from 'playwright';
import { build } from 'esbuild';
import { electronPath } from './electron-path.mjs';
import { mkdir, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';

const run = promisify(execFile), require = createRequire(import.meta.url);
const skipNativeVSCode = process.argv.includes('--skip-native-vscode');
const base = path.resolve('.test-artifacts'); await mkdir(base, { recursive: true });
const fixture = await mkdtemp(path.join(base, 'external-activity '));
const data = path.join(fixture, 'user-data'), activity = path.join(data, 'external-activity'), projects = path.join(fixture, 'projects');
const folder = (name) => path.join(projects, name);
for (const name of ['editor-site', 'agent-site', 'shell-site']) { await mkdir(folder(name), { recursive: true }); await writeFile(path.join(folder(name), 'index.html'), '<h1>External activity fixture</h1>'); }
await mkdir(path.join(activity, 'reports'), { recursive: true }); await writeFile(path.join(activity, 'policy.json'), JSON.stringify({ version: 1, enabled: true }));
for (const entry of ['activitySetup', 'externalActivity']) await build({ entryPoints: [`src/main/services/${entry}.ts`], outfile: path.join(fixture, entry + '.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24' });
const { setupActivity, findVSCode } = require(path.join(fixture, 'activitySetup.cjs'));
const options = { directory: activity, assets: path.resolve('dist/main/activity-assets'), home: path.join(fixture, 'home'), documents: path.join(fixture, 'documents'), node: process.execPath };

// Install the actual VSIX into an isolated VS Code profile, then run it in a native extension host.
if (!skipNativeVSCode) {
const vscode = path.join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code');
const vscodeData = path.join(fixture, 'vscode-data'), extensions = path.join(fixture, 'vscode-extensions');
const installation = await findVSCode([vscode]); assert(installation, 'A supported local VS Code installation is required'); const { executable: binary, cli } = installation;
await mkdir(path.join(vscodeData, 'User'), { recursive: true }); await writeFile(path.join(vscodeData, 'User/settings.json'), JSON.stringify({ 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false, 'workbench.startupEditor': 'none' }));
await setupActivity('vscode', { ...options, vscode: { executable: binary, cli, extensionsDirectory: extensions, userDataDirectory: vscodeData } });
const environment = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
const listing = await run(binary, [cli, '--extensions-dir', extensions, '--user-data-dir', vscodeData, '--list-extensions'], { env: environment, timeout: 30000, windowsHide: true });
assert(listing.stdout.includes('devdock-local.devdock-activity'));
const extension = path.join(extensions, (await readdir(extensions)).find((name) => name.startsWith('devdock-local.devdock-activity-')));
const workspace = path.join(fixture, 'fixture.code-workspace'); await writeFile(workspace, JSON.stringify({ folders: [{ path: folder('editor-site') }, { path: folder('agent-site') }] }));
const nativeEvidence = path.join(fixture, 'vscode-native-verification.json');
const runner = path.join(fixture, 'vscode-runner.cjs');
await writeFile(runner, `const vscode = require('vscode');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { readReport, matchReports, activityProcesses } = require(${JSON.stringify(path.join(fixture, 'externalActivity.cjs'))});
exports.run = async () => {
  const extension = vscode.extensions.getExtension('devdock-local.devdock-activity'); assert(extension); await extension.activate();
  const reportsDirectory = ${JSON.stringify(path.join(activity, 'reports'))}; let report;
  for(let attempt=0;attempt<100;attempt++) {
    for(const file of await fs.readdir(reportsDirectory)) { if(!/^[a-f0-9]{64}\\.json$/.test(file)) continue; try { const value=readReport(JSON.parse(await fs.readFile(path.join(reportsDirectory,file),'utf8')),Date.now()); if(value?.source==='vscode' && value.folders.length===2 && value.state==='open') report=value; } catch {} }
    if(report) break; await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert(report,'Native VS Code workspace bridge must report both local folders');
  const projects=report.folders.map((folder,index)=>({id:String(index),path:folder.path,missing:false}));
  const matches=matchReports([report],projects,await activityProcesses(),Date.now(),0); assert.equal(matches.length,2); assert(matches.every(item=>item.presence?.state==='open'));
  const file=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(report.folders[0].path,'index.html'))); await vscode.window.showTextDocument(file);
  await fs.writeFile(${JSON.stringify(nativeEvidence)},JSON.stringify({nativeVSCode:true,folders:report.folders.map(folder=>folder.path),verifiedProcess:true},null,2));
};`);
await run(binary, [cli, '--extensions-dir', extensions, '--user-data-dir', vscodeData, '--new-window', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', `--extensionDevelopmentPath=${extension}`, `--extensionTestsPath=${runner}`, workspace], { env: environment, timeout: 60000, maxBuffer: 128000, windowsHide: true });
await eventually(async () => { try { return JSON.parse(await readFile(nativeEvidence, 'utf8')).verifiedProcess === true; } catch { return false; } }, 'Native VS Code extension-host verification must finish.');
assert(JSON.parse(await readFile(nativeEvidence, 'utf8')).verifiedProcess);
await eventually(async () => {
  const files = (await readdir(path.join(activity, 'reports'))).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
  try { return files.length > 0 && (await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(activity, 'reports', file), 'utf8'))))).every((report) => report.state === 'closed'); } catch { return false; }
}, 'The isolated native extension host must close its session.');
console.log('PASS: offline VSIX installation and native VS Code extension host, two workspace folders, active editor, verified process identity');
}

let application, page, terminal; const errors = [], requests = [];
async function eventually(check, message = 'External activity smoke timed out.') { const end = Date.now() + 20000; while (Date.now() < end) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error(message); }
const snapshot = async () => { const result = await page.evaluate(() => window.devManager.snapshot()); assert(result.ok, result.error); return result.value; };
async function launch() {
  const env = { ...process.env, LDM_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE; delete env.LDM_RENDERER_URL;
  application = await automation.launch({ executablePath: await electronPath(), args: ['.'], cwd: process.cwd(), env }); page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message)); page.on('request', (request) => requests.push(request.url()));
  await page.getByRole('heading', { name: 'Your projects.' }).waitFor(); await eventually(async () => !(await snapshot()).scanning);
}
async function refresh() { const result = await page.evaluate(() => window.devManager.refreshExternalActivity()); assert(result.ok, result.error); }
const row = (name) => page.locator('.project-row').filter({ has: page.getByRole('button', { name: `View ${name}`, exact: true }) });
async function filter(label) { await page.getByRole('navigation', { name: 'Project filters' }).getByRole('button').filter({ has: page.getByText(label, { exact: true }) }).click(); }
const ownBirth = new Date(Date.now() - process.uptime() * 1000).toISOString();
async function report(source, name, state = 'open', seenAt = new Date().toISOString()) {
  const session = createHash('sha256').update('controlled-fixture:' + source).digest('hex');
  const value = { version: 1, source, session, pid: process.pid, ownerStartedAt: ownBirth, seenAt, state, folders: [{ path: folder(name), activityAt: seenAt }] };
  await writeFile(path.join(activity, 'reports', session + '.json'), JSON.stringify(value)); return value;
}
try {
  await launch(); await application.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, projects);
  await page.getByRole('button', { name: '+ Add folder', exact: true }).click(); await eventually(async () => (await snapshot()).projects.length === 3 && !(await snapshot()).scanning);
  await report('vscode', 'editor-site'); await report('codex', 'agent-site', 'working'); await report('claude', 'agent-site');
  await setupActivity('terminal', options);
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
  const shellScript = `function prompt { 'CustomPrompt' }; Set-Location -LiteralPath ${quote(folder('shell-site'))}; . ${quote(path.join(options.documents, 'WindowsPowerShell/Microsoft.PowerShell_profile.ps1'))}; if ((prompt) -ne 'CustomPrompt') { exit 7 }; [Console]::ReadLine() | Out-Null`;
  terminal = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', shellScript], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let shellError = ''; terminal.stderr.on('data', (chunk) => { shellError += chunk; }); terminal.on('error', (error) => { shellError += error.message; });
  await eventually(async () => { await refresh(); return (await snapshot()).projects.every((project) => project.external.length); }, 'All external sources must reach the renderer.');
  assert.equal(shellError, '');
  const state = await snapshot(); assert(state.projects.every((project) => project.status === 'stopped' && !project.managed && project.lastActiveAt));
  assert.equal(state.projects.find((project) => project.name === 'agent-site').external.length, 2);
  assert.equal(await row('agent-site').getByRole('button', { name: 'Start', exact: true }).count(), 1);
  const activeCount = page.getByRole('navigation', { name: 'Project filters' }).getByRole('button').filter({ has: page.getByText('Active', { exact: true }) }).locator('.count');
  await eventually(async () => await activeCount.textContent() === '0');
  await filter('Active'); await page.getByRole('heading', { name: 'No matching projects', exact: true }).waitFor(); assert.equal(await page.locator('.project-row').count(), 0);
  await page.screenshot({ path: path.join(fixture, 'active-filter-stopped-sessions.png') });
  await filter('Recent activity'); await eventually(async () => await page.locator('.project-row').count() === 3);
  assert.equal(await page.locator('.status-label').filter({ hasText: 'Stopped' }).count(), 3);
  await row('agent-site').getByRole('button', { name: 'Start', exact: true }).click();
  await eventually(async () => (await snapshot()).projects.find((project) => project.name === 'agent-site').status === 'running' && await activeCount.textContent() === '1');
  await filter('Active'); await eventually(async () => await page.locator('.project-row').count() === 1);
  assert.equal(await row('agent-site').count(), 1);
  await page.screenshot({ path: path.join(fixture, 'active-filter-running-server.png') });
  await row('agent-site').getByRole('button', { name: 'Stop', exact: true }).click();
  await eventually(async () => await activeCount.textContent() === '0' && await page.locator('.project-row').count() === 0);
  assert.equal((await snapshot()).projects.find((project) => project.name === 'agent-site').status, 'stopped');
  await filter('Recent activity'); await eventually(async () => await page.locator('.project-row').count() === 3);
  console.log('PASS: Active excludes stopped projects with open tool sessions, includes a started server, returns to zero after Stop, and retains stopped projects in Recent activity');
  await page.getByRole('button', { name: 'Pin agent-site', exact: true }).click(); await eventually(async () => (await snapshot()).projects.find((project) => project.name === 'agent-site').pinned);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(850, 600));
  await page.setViewportSize({ width: 850, height: 600 }); assert.equal(await page.evaluate(() => innerWidth), 850);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert(await page.locator('.project-list').evaluate((element) => element.scrollWidth <= element.clientWidth));
  await page.screenshot({ path: path.join(fixture, 'external-projects-small.png') });
  await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'External activity', exact: true }).click();
  await page.getByRole('heading', { name: 'External activity', exact: true }).waitFor(); await page.getByRole('button', { name: skipNativeVSCode ? 'Set up VS Code' : 'Repair VS Code', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.devManager.setupExternalActivity('bad-source'))).ok, false);
  await page.screenshot({ path: path.join(fixture, 'external-settings-small.png') });
  const panel = page.locator('.settings-content'), panelBox = await panel.boundingBox(); assert(panelBox);
  await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + panelBox.height / 2); await page.mouse.wheel(0, 10000);
  const lastSetup = page.getByRole('button', { name: 'Set up PowerShell', exact: true });
  await eventually(async () => lastSetup.evaluate((element) => { const r = element.getBoundingClientRect(), panel = element.closest('.settings-content').getBoundingClientRect(); return r.top >= panel.top && r.bottom <= panel.bottom; }));
  await page.locator('.settings-help summary').click(); await page.mouse.wheel(0, 10000); await eventually(async () => panel.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 2));
  await page.screenshot({ path: path.join(fixture, 'external-settings-help-small.png') });
  await panel.evaluate((element) => element.scrollTo({ top: 0 }));
  await page.getByLabel('Detect external activity', { exact: true }).click(); await eventually(async () => !(await snapshot()).externalDetection.enabled); assert((await snapshot()).projects.every((project) => !project.external.length));
  assert.equal(JSON.parse(await readFile(path.join(activity, 'policy.json'), 'utf8')).enabled, false);
  await page.getByLabel('Detect external activity', { exact: true }).click(); await eventually(async () => (await snapshot()).externalDetection.enabled); await refresh();
  terminal.stdin.end('exit\n'); await eventually(() => terminal.exitCode !== null); await refresh(); assert(!((await snapshot()).projects.find((project) => project.name === 'shell-site').external.length));
  await report('codex', 'agent-site', 'closed'); await report('claude', 'agent-site', 'closed'); await report('vscode', 'editor-site', 'open', new Date(Date.now() - 46000).toISOString());
  await eventually(async () => { await refresh(); return (await snapshot()).projects.every((project) => !project.external.length); }, 'Closed and expired tool sessions must clear after the next activity check.');
  await page.getByRole('button', { name: 'Back to projects', exact: true }).click(); await filter('Active'); await page.getByRole('heading', { name: 'No matching projects', exact: true }).waitFor();
  await filter('Recent activity'); assert.equal(await page.locator('.project-row').count(), 3);
  await application.close(); application = undefined; await launch(); const restored = await snapshot(); assert(restored.projects.every((project) => project.lastActiveAt && project.status === 'stopped')); assert(restored.projects.find((project) => project.name === 'agent-site').pinned);
  assert.deepEqual(errors, []); assert(!requests.some((url) => /^https?:/.test(url)));
  console.log(`PASS: real PowerShell profile/prompt bridge, controlled agent/source protocol badges, server-status separation, focus filters, pins/recency, 850x600 layout, disable/re-enable, stale/dead/closed sessions, restart persistence, no renderer errors or external renderer requests. Evidence: ${fixture}`);
} finally { if (terminal && terminal.exitCode === null) { terminal.stdin.end('exit\n'); terminal.kill(); } if (application) await application.close(); }
