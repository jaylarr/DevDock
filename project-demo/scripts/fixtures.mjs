import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './common.mjs';
import { fixturePage } from './fixture-page.mjs';

export const names = ['atlas-dashboard', 'beacon-api', 'canvas-studio', 'harbor-docs', 'orbit-storefront', 'summit-starter'];
export async function fixtures() {
  await mkdir(path.join(root, '.test-artifacts'), { recursive: true });
  const directory = await mkdtemp(path.join(root, '.test-artifacts/montage-session-'));
  const projects = path.join(directory, 'Demo Projects');
  const data = path.join(directory, 'user-data');
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, 'state.json'), JSON.stringify({ version: 2, roots: [], projects: [], exclusions: [], theme: 'light' }));
  for (const name of names) {
    const folder = path.join(projects, name);
    await mkdir(folder, { recursive: true });
    const html = fixturePage(name);
    await writeFile(path.join(folder, 'index.html'), html);
    if (['canvas-studio', 'harbor-docs'].includes(name)) continue;
    const vite = ['atlas-dashboard', 'orbit-storefront'].includes(name);
    await writeFile(path.join(folder, 'package.json'), JSON.stringify({ name, scripts: { dev: vite ? 'node server.mjs' : 'node server.cjs' }, ...(vite ? { devDependencies: { vite: '8.3.2' } } : {}), ...(name === 'summit-starter' ? { packageManager: 'pnpm@10.0.0' } : {}) }));
    if (vite) {
      await writeFile(path.join(folder, 'server.mjs'), `import {createServer} from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')).href)}; const server=await createServer({root:process.cwd(),configFile:false,server:{host:'127.0.0.1',port:Number(process.env.PORT),strictPort:true}}); await server.listen();server.printUrls();console.log('Ready · fictional demo workspace');`);
    } else {
      await writeFile(path.join(folder, 'server.cjs'), `const http=require('node:http');const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(${JSON.stringify(html)});});server.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+server.address().port));`);
    }
  }
  return { directory, projects, data };
}
