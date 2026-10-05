import { _electron as automation } from 'playwright';
import { build } from 'esbuild';
import { electronPath } from './electron-path.mjs';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';

const run = promisify(execFile), require = createRequire(import.meta.url), base = path.resolve('.test-artifacts'); await mkdir(base, { recursive: true });
const fixture = await mkdtemp(path.join(base, 'external-servers ')), data = path.join(fixture, 'user-data'), activity = path.join(data, 'external-activity'), project = path.join(fixture, 'projects/vite-app');
await mkdir(project, { recursive: true }); await mkdir(path.join(activity, 'reports'), { recursive: true });
const port = await new Promise((resolve, reject) => { const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close((error) => error ? reject(error) : resolve(value)); }); });
const manifest = JSON.stringify({ name: 'external-vite', scripts: { dev: `node "${path.resolve('node_modules/vite/bin/vite.js')}" --host 127.0.0.1 --port ${port} --strictPort` } });
await writeFile(path.join(project, 'package.json'), manifest); await writeFile(path.join(project, 'index.html'), '<h1>External Vite fixture</h1>');
for (const entry of ['activitySetup', 'externalServers', 'externalServerStop']) await build({ entryPoints: [`src/main/services/${entry}.ts`], outfile: path.join(fixture, entry + '.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24' });
const { setupActivity, findVSCode } = require(path.join(fixture, 'activitySetup.cjs')), { serverProcesses, serverListeners } = require(path.join(fixture, 'externalServers.cjs'));
const { stopServerProcesses } = require(path.join(fixture, 'externalServerStop.cjs'));
const installed = await findVSCode([path.join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code')]); assert(installed);
const vscodeData = path.join(fixture, 'vscode-data'), extensions = path.join(fixture, 'vscode-extensions'), stop = path.join(fixture, 'stop'), ready = path.join(fixture, 'native-ready.json'), done = path.join(fixture, 'native-done.json'), verify = path.join(fixture, 'verify'), verified = path.join(fixture, 'verified.json');
await mkdir(path.join(vscodeData, 'User'), { recursive: true }); await writeFile(path.join(vscodeData, 'User/settings.json'), JSON.stringify({ 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false, 'workbench.startupEditor': 'none', 'terminal.integrated.shellIntegration.enabled': true }));
await setupActivity('vscode', { directory: activity, assets: path.resolve('dist/main/activity-assets'), home: fixture, documents: fixture, node: process.execPath, vscode: { ...installed, extensionsDirectory: extensions, userDataDirectory: vscodeData } });
const extension = path.join(extensions, (await readdir(extensions)).find((name) => name.startsWith('devdock-local.devdock-activity-'))), runner = path.join(fixture, 'vscode-runner.cjs');
const powershell = (await run('powershell.exe', ['-NoProfile', '-Command', '(Get-Command pwsh).Source'], { windowsHide: true })).stdout.trim(); assert(powershell);
const shellIntegration = path.join(path.dirname(installed.cli), 'vs/workbench/contrib/terminal/common/scripts/shellIntegration.ps1');
await writeFile(runner, `const vscode=require('vscode'), fs=require('node:fs/promises'), path=require('node:path'), assert=require('node:assert/strict'), {execFile}=require('node:child_process');
exports.run=async()=>{
 let terminal;
 try {
  await vscode.extensions.getExtension('devdock-local.devdock-activity').activate();
  terminal=vscode.window.createTerminal({name:'DevDock isolated server',shellPath:${JSON.stringify(powershell)},shellArgs:['-NoLogo','-NoProfile'],cwd:vscode.Uri.file(${JSON.stringify(project)})}); terminal.show();
  await new Promise(r=>setTimeout(r,2000)); if(!terminal.shellIntegration) terminal.sendText(${JSON.stringify(". '" + shellIntegration.replaceAll("'", "''") + "'")});
  const deadline=Date.now()+20000; while(!terminal.shellIntegration && Date.now()<deadline) await new Promise(r=>setTimeout(r,100)); assert(terminal.shellIntegration,'Shell integration must activate');
  terminal.shellIntegration.executeCommand('npm.cmd run dev');
  const outputDirectory=${JSON.stringify(path.join(activity, 'output'))}; let feed;
  for(let attempt=0;attempt<200;attempt++) { try { for(const file of await fs.readdir(outputDirectory)) { if(!/^[a-f0-9]{64}\\.json$/.test(file)) continue; const value=JSON.parse(await fs.readFile(path.join(outputDirectory,file),'utf8')); if(value.state==='running' && value.entries.some(entry=>entry.text.includes('http://127.0.0.1:'))) feed=value; } } catch {} if(feed)break; await new Promise(r=>setTimeout(r,100)); }
  assert(feed,'Real npm/Vite startup output must reach the bridge'); await fs.writeFile(${JSON.stringify(ready)},JSON.stringify({terminalPid:await terminal.processId,output:true}));
  while(true) {
   try { await fs.access(${JSON.stringify(verify)}); assert(vscode.window.terminals.includes(terminal),'Original terminal must remain open'); await fs.writeFile(${JSON.stringify(verified)},JSON.stringify({terminalPid:await terminal.processId,editorOpen:true})); } catch {}
   try { await fs.access(${JSON.stringify(stop)}); break; } catch {} await new Promise(r=>setTimeout(r,100));
  }
 } finally {
  if(terminal) { const pid=await terminal.processId; if(pid) await new Promise(resolve=>execFile(path.join(process.env.SystemRoot,'System32/taskkill.exe'),['/PID',String(pid),'/T','/F'],{windowsHide:true},()=>resolve())); terminal.dispose(); }
  await fs.writeFile(${JSON.stringify(done)},JSON.stringify({closed:true}));
 }
};`);
let application, page, native; const errors = []; const url = `http://127.0.0.1:${port}`;
async function eventually(check, message = 'External server smoke timed out') { const end = Date.now() + 30000; while (Date.now() < end) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 150)); } throw new Error(message); }
async function json(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return undefined; } }
const snapshot = async () => { const result = await page.evaluate(() => window.devManager.snapshot()); assert(result.ok, result.error); return result.value; };
const refresh = async () => { const result = await page.evaluate(() => window.devManager.refreshExternalActivity()); assert(result.ok, result.error); };
async function launch() {
 const env = { ...process.env, LDM_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE; delete env.LDM_RENDERER_URL;
 application = await automation.launch({ executablePath: await electronPath(), args: ['.'], cwd: process.cwd(), env }); page = await application.firstWindow(); page.on('pageerror', (error) => errors.push(error.message));
 await page.getByRole('heading', { name: 'Your projects.' }).waitFor(); await eventually(async () => !(await snapshot()).scanning);
 await application.evaluate(({ shell }) => { globalThis.__externalOpened=[]; shell.openExternal=async(url)=>{globalThis.__externalOpened.push(url)}; });
}
try {
 await launch(); await application.evaluate(({ dialog }, directory) => { dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]}); }, path.dirname(project));
 await page.getByRole('button', { name: '+ Add folder', exact: true }).click(); await eventually(async () => (await snapshot()).projects.length === 1 && !(await snapshot()).scanning); await refresh();
 native = run(installed.executable, [installed.cli, '--extensions-dir', extensions, '--user-data-dir', vscodeData, '--new-window', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', `--extensionDevelopmentPath=${extension}`, `--extensionTestsPath=${runner}`, project], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 120000, maxBuffer: 65536 }); await native;
 await eventually(async () => (await json(ready))?.output, 'Native VS Code must start npm run dev and stream its output');
 await eventually(async () => { await refresh(); return (await snapshot()).projects[0].status === 'running'; });
 const current = (await snapshot()).projects[0], id = current.id; assert.equal(current.localUrl, url); assert.equal(current.port, port); assert.equal(current.managed, false); assert.equal(current.externalServers[0].source, 'vscode');
 assert((await serverProcesses()).some((process) => process.pid === current.pid)); assert.equal((await serverListeners()).filter((listener) => listener.port === port).length, 1);
 await eventually(async () => (await page.getByRole('button', { name: 'Start', exact: true }).count()) === 0 && (await page.getByText('Running elsewhere', { exact: true }).count()) === 1);
 await page.getByRole('button', { name: 'View external-vite', exact: true }).click(); await page.getByText('Streaming dev-command output from VS Code.', { exact: true }).waitFor();
 await eventually(async () => { const logs=await page.evaluate((id)=>window.devManager.logs(id),id);return logs.ok && logs.value.some(entry=>entry.text.includes('http://127.0.0.1:')); });
 assert(await page.getByRole('button', { name: 'Restart', exact: true }).isDisabled()); assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(),0);
 assert(await page.getByRole('button', { name: 'Stop external server', exact: true }).isEnabled());
 const blocked=await page.evaluate((id)=>window.devManager.start(id),id);assert.equal(blocked.ok,false);assert.match(blocked.error,/already running outside/);assert.equal((await snapshot()).projects[0].managed,false);
  await page.getByRole('button', { name: 'Open ↗', exact: true }).click(); await eventually(async () => (await application.evaluate(()=>globalThis.__externalOpened))[0] === url, 'Open must target the detected external port');
 await page.setViewportSize({width:850,height:600}); assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)); await page.screenshot({path:path.join(fixture,'external-server-live.png')});
 await writeFile(path.join(project,'index.html'),'<h1>External Vite fixture updated</h1>'); await eventually(async()=>{const result=await page.evaluate((id)=>window.devManager.logs(id),id);return result.ok && result.value.some(entry=>/reload|updated/.test(entry.text));},'Vite reload output must stream live');
 await application.close();application=undefined;assert((await(await fetch(url)).text()).includes('updated')); await launch(); await eventually(async()=>{await refresh();return (await snapshot()).projects[0].status==='running';});
 console.log('PASS: native VS Code npm run dev, real Vite URL/PID/port, streamed output, no duplicate launch, disabled external Restart, browser target, 850x600 layout, reconnect, external server survives DevDock quit');
 const identities=(await snapshot()).projects[0].externalServers.map(({pid,ownerStartedAt,port})=>({pid,ownerStartedAt,port}));
 const stale=await page.evaluate(({id,servers})=>window.devManager.stopExternal(id,servers),{id,servers:identities.map(server=>({...server,ownerStartedAt:new Date(0).toISOString()}))}); assert.equal(stale.ok,false); assert.match(stale.error,/process changed/);
 const malformed=await page.evaluate(({id,servers})=>window.devManager.stopExternal(id,servers),{id,servers:identities.map(server=>({...server,port:0}))}); assert.equal(malformed.ok,false); assert.match(malformed.error,/Invalid/);
 const inventory=await serverProcesses(), owner=inventory.find(process=>process.pid===current.pid); assert(owner);
 await assert.rejects(stopServerProcesses([{...owner,startedAt:new Date(0).toISOString()}]),/could not be stopped safely/); assert((await(await fetch(url)).text()).includes('updated'));
 const terminalPid=(await json(ready)).terminalPid, terminalOwner=inventory.find(process=>process.pid===terminalPid); assert(terminalOwner);
 await page.setViewportSize({width:850,height:600}); await page.getByRole('button', {name:'View external-vite',exact:true}).click();
 await page.getByRole('button',{name:'Stop external server',exact:true}).click();
 await eventually(async()=>!(await snapshot()).projects[0].externalServers.length,'DevDock must stop the external server');
 assert.equal((await snapshot()).projects[0].status,'stopped'); await page.getByRole('button',{name:'Start',exact:true}).waitFor(); assert.equal(await readFile(path.join(project,'package.json'),'utf8'),manifest); assert.deepEqual(errors,[]);
 await assert.rejects(fetch(url,{signal:AbortSignal.timeout(1000)}));
 const remaining=await serverProcesses(); assert(!remaining.some(process=>process.pid===current.pid && process.startedAt===owner.startedAt)); assert(remaining.some(process=>process.pid===terminalPid && process.startedAt===terminalOwner.startedAt));
 await writeFile(verify,'verify'); await eventually(async()=>!!await json(verified),'VS Code must confirm its terminal stays open'); assert.equal((await json(verified)).terminalPid,terminalPid); assert.equal((await json(verified)).editorOpen,true);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)); await page.screenshot({path:path.join(fixture,'external-server-stopped.png')});
 await page.getByRole('button',{name:'Start',exact:true}).click(); await eventually(async()=>{const project=(await snapshot()).projects[0];return project.status==='running' && project.managed;},'The stopped project must start through DevDock');
 await page.getByRole('button',{name:'Stop',exact:true}).click(); await eventually(async()=>(await snapshot()).projects[0].status==='stopped');
 await writeFile(stop,'stop'); await eventually(async()=>!!await json(done));
 console.log('PASS: stale/malformed IPC and native birth-time mismatch refused; Stop external server closes the real port, preserves VS Code and its terminal, restores Start, and permits managed Start/Stop. Evidence: '+fixture);
} finally { await writeFile(stop,'stop'); if(application) await application.close(); if(native) await eventually(async()=>!!await json(done),'The isolated VS Code terminal must close').catch(()=>{}); }
