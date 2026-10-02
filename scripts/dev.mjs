import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { electronPath } from './electron-path.mjs';
import { buildMain } from './build-main.mjs';

const electron = await electronPath();
await buildMain();
const server = await createServer();
await server.listen();
const env = { ...process.env, LDM_RENDERER_URL: server.resolvedUrls.local[0] };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env });
child.once('error', async (error) => { console.error(error); await server.close(); process.exitCode = 1; });
child.once('exit', async (code) => { await server.close(); process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
