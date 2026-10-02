import { chromium } from 'playwright';
import { electronPath } from '../../scripts/electron-path.mjs';
import { findTool, run, npm } from './common.mjs';

export async function verify() {
  if (process.platform !== 'win32') throw new Error('This app currently requires native Windows for server ownership checks.');
  const ffmpeg = await findTool('ffmpeg');
  const version = await run(ffmpeg, ['-version']);
  await findTool('ffprobe');
  await npm(['--version']);
  const browser = await chromium.launch();
  let screencast;
  try { const page = await browser.newPage(); screencast = typeof page.screencast?.start === 'function'; }
  finally { await browser.close(); }
  await electronPath();
  console.log(`Node ${process.version}; ${version.stdout.split('\n')[0]}; Chromium verified; Screencast ${screencast ? 'available' : 'context-video fallback'}.`);
}
if (process.argv[1]?.endsWith('verify.mjs')) await verify();
