import path from 'node:path';
import { writeFile, copyFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia } from '@remotion/renderer';
import { demo, directories } from './common.mjs';
import { finalize } from './finalize.mjs';

export async function render() {
  await directories();
  console.log('Bundling Remotion composition…');
  const serveUrl = await bundle({ entryPoint: path.join(demo, 'src/index.ts'), rootDir: demo,
    publicDir: path.join(demo, 'public'), outDir: path.join(demo, '.runtime/bundle') });
  const browserExecutable = chromium.executablePath();
  const composition = await selectComposition({ serveUrl, id: 'ProjectMontage', browserExecutable });
  let lastProgress = -1;
  const started = Date.now();
  await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation: path.join(demo, 'output/project-montage.mp4'),
    browserExecutable, pixelFormat: 'yuv420p', crf: 18, imageFormat: 'jpeg', jpegQuality: 95,
    concurrency: 2, muted: false, audioCodec: 'aac', audioBitrate: '192k', offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024,
    onProgress: ({ progress }) => {
      const percent = Math.floor(progress * 10) * 10;
      if (percent !== lastProgress) { lastProgress = percent; console.log(`Render ${percent}%`); }
    },
  });
  await finalize();
  await copyFile(path.join(demo, 'output/project-montage.mp4'), path.join(demo, 'output/project-montage-marketing.mp4'));
  await writeFile(path.join(demo, 'output/render-report.json'), JSON.stringify({
    renderedAt: new Date().toISOString(), composition: composition.id, width: composition.width, height: composition.height,
    fps: composition.fps, durationSeconds: composition.durationInFrames / composition.fps,
    renderSeconds: (Date.now() - started) / 1000, codec: 'h264', audio: 'AAC narration, original music and synthesized motion accents', subtitles: 'burned-in and external SRT',
    creativeRevision: 3, motionDesign: 'floating 3D terminal illustrations, kinetic typography, orbit/grid backgrounds, chapter rail, benefit reframing and animated closing card',
  }, null, 2) + '\n');
  console.log('Rendered project-demo/output/project-montage.mp4');
}
if (process.argv[1]?.endsWith('render.mjs')) await render();
