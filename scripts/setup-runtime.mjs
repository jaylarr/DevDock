import { spawn } from 'node:child_process';
import path from 'node:path';
import { electronPackageDirectory } from './electron-path.mjs';

console.log('Preparing the pinned Electron runtime. This explicit setup step may use the internet.');
const child = spawn(process.execPath, [path.join(electronPackageDirectory, 'install.js')], { stdio: 'inherit' });
child.once('error', (error) => { console.error(error); process.exitCode = 1; });
child.once('exit', (code) => { process.exitCode = code ?? 1; });
