import path from 'node:path';
import { chromium } from 'playwright';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderStill } from '@remotion/renderer';
import { demo, directories } from './common.mjs';

await directories();
const serveUrl = await bundle({ entryPoint: path.join(demo, 'src/index.ts'), rootDir: demo,
  publicDir: path.join(demo, 'public'), outDir: path.join(demo, '.runtime/bundle') });
const browserExecutable = chromium.executablePath();
const composition = await selectComposition({ serveUrl, id: 'ProjectMontage', browserExecutable });
for (const seconds of [1.2, 1.8, 3.2, 4.2, 7.5, 10.5, 15, 18.5, 22.5, 25.5, 29, 31.5, 35.5, 38.5, 42.5, 45.5, 48]) {
  await renderStill({ composition, serveUrl, browserExecutable, frame: Math.round(seconds * composition.fps),
    output: path.join(demo, 'output/qa', `preview-${seconds}.png`), imageFormat: 'png' });
  console.log(`Preview ${seconds}s`);
}
