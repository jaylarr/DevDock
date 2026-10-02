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
for (const seconds of [1.2, 3.2, 5.4, 7.2, 11, 15.5, 19, 23, 26, 29, 31.5, 35, 40, 44, 46.5, 49, 53, 56, 59]) {
  await renderStill({ composition, serveUrl, browserExecutable, frame: Math.round(seconds * composition.fps),
    output: path.join(demo, 'output/qa', `preview-${seconds}.png`), imageFormat: 'png' });
  console.log(`Preview ${seconds}s`);
}
