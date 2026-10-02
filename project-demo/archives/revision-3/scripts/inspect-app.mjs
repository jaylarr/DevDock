import { _electron } from 'playwright';
import path from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { electronPath } from '../../scripts/electron-path.mjs';
import { demo, root, directories } from './common.mjs';

await directories();
const data = path.join(demo, '.runtime/inspection-user-data');
await mkdir(data, { recursive: true });
await writeFile(path.join(data, 'state.json'), JSON.stringify({ version: 2, roots: [], projects: [], exclusions: [], theme: 'light' }));
const env = { ...process.env, LDM_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE; delete env.LDM_RENDERER_URL;
const app = await _electron.launch({ executablePath: await electronPath(), args: [root], cwd: root, env });
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1600, 820); w.webContents.setZoomFactor(1); });
  await page.setViewportSize({ width: 1600, height: 820 });
  await page.getByRole('heading', { name: 'Your projects.' }).waitFor();
  const metrics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
    body: document.body.getBoundingClientRect().toJSON(), shell: document.querySelector('.app-shell').getBoundingClientRect().toJSON() }));
  console.log(JSON.stringify(metrics, null, 2));
  await page.screenshot({ path: path.join(demo, 'output/qa/inspection.png') });
  await writeFile(path.join(demo, 'output/inspection.json'), JSON.stringify(metrics, null, 2));
} finally { await app.close(); await rm(data, { recursive: true, force: true }); }
