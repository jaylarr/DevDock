import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';

if (process.platform !== 'win32') { console.log('SKIP: external stop requires native Windows.'); process.exit(0); }
const base = path.resolve('.test-artifacts'); await mkdir(base, { recursive: true });
const fixture = await mkdtemp(path.join(base, 'external-stop-native-'));
const require = createRequire(import.meta.url);
for (const entry of ['externalServers', 'externalServerStop']) await build({ entryPoints: [`src/main/services/${entry}.ts`], outfile: path.join(fixture, entry + '.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24' });
const { serverProcesses, serverListeners } = require(path.join(fixture, 'externalServers.cjs'));
const { stopServerProcesses } = require(path.join(fixture, 'externalServerStop.cjs'));
const worker = path.join(fixture, 'worker.cjs'), server = path.join(fixture, 'server.cjs');
await writeFile(worker, 'setInterval(() => {}, 1000);');
await writeFile(server, `const {spawn}=require('node:child_process'),http=require('node:http'),fs=require('node:fs');
const worker=spawn(process.execPath,[${JSON.stringify(worker)}],{stdio:'ignore',windowsHide:true});
const server=http.createServer((_request,response)=>response.end('temporary stop fixture'));
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.argv[2],JSON.stringify({pid:process.pid,workerPid:worker.pid,port:server.address().port})));`);
const owned = new Map();
let serial = 0;
async function eventually(check, message) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(message);
}
async function pair() {
  const ready = path.join(fixture, `ready-${++serial}.json`);
  const child = spawn(process.execPath, [server, ready], { windowsHide: true, stdio: 'ignore' });
  child.on('error', error => { throw error; });
  let identity;
  await eventually(async () => { try { identity = JSON.parse(await readFile(ready, 'utf8')); return true; } catch { return false; } }, 'Fixture must start');
  const [inventory, listeners] = await Promise.all([serverProcesses(), serverListeners()]);
  for (const pid of [identity.pid, identity.workerPid]) {
    const target = inventory.find(item => item.pid === pid);
    assert(target && target.name.toLowerCase() === 'node.exe');
    owned.set(pid, target);
  }
  assert(listeners.some(item => item.pid === identity.pid && item.port === identity.port));
  // Exercise the native helper with only our two known Node identities. Windows may
  // create console hosts for this synthetic setup; protected processes are never targets.
  const plan = [owned.get(identity.pid), owned.get(identity.workerPid)];
  assert.equal(plan[0].entryPath, server); assert.equal(plan[1].entryPath, worker); assert.equal(plan[1].parent, identity.pid);
  assert.deepEqual(plan.map(item => item.pid).sort((a, b) => a - b), [identity.pid, identity.workerPid].sort((a, b) => a - b));
  for (const target of plan) owned.set(target.pid, target);
  return { identity, plan, url: `http://127.0.0.1:${identity.port}` };
}
async function closed(test) {
  const [inventory, listeners] = await Promise.all([serverProcesses(), serverListeners()]);
  assert(!listeners.some(item => item.pid === test.identity.pid && item.port === test.identity.port));
  for (const target of test.plan) assert(!inventory.some(item => item.pid === target.pid && item.startedAt === target.startedAt), `PID ${target.pid} must exit`);
}
try {
  const multiple = await pair();
  const changed = multiple.plan.map((item, index) => index ? { ...item, startedAt: new Date(0).toISOString() } : item);
  await assert.rejects(stopServerProcesses(changed), /process changed/);
  assert.equal((await fetch(multiple.url)).status, 200, 'Wrong worker identity must preserve the server');
  await stopServerProcesses(multiple.plan); await closed(multiple);
  console.log('PASS: native multi-process stop terminates the server and worker; wrong worker identity stops neither.');

  const exitedWorker = await pair();
  await stopServerProcesses([exitedWorker.plan.find(item => item.pid === exitedWorker.identity.workerPid)]);
  assert.equal((await fetch(exitedWorker.url)).status, 200, 'Stopping the worker alone must leave its server open');
  await stopServerProcesses(exitedWorker.plan); await closed(exitedWorker);
  console.log('PASS: an already-exited worker does not prevent stopping its verified server. Evidence: ' + fixture);
} finally {
  // Cleanup uses the same birth-time/name checks and only identities created by this fixture.
  const inventory = await serverProcesses();
  const remaining = [...owned.values()].filter(target => inventory.some(item => item.pid === target.pid && item.startedAt === target.startedAt));
  if (remaining.length) await stopServerProcesses(remaining);
}
