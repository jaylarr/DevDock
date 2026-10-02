import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { demo, scenes, directories, probe, findTool, run, fps } from './common.mjs';

export async function processRecordings(selected) {
  await directories();
  const ffmpeg = await findTool('ffmpeg');
  const report = [];
  for (const scene of scenes.filter((item) => !selected || item.id === selected)) {
    const source = path.join(demo, 'recordings/raw', `${scene.id}.webm`);
    const metadata = await probe(source);
    const duration = Number(metadata.format.duration);
    if (!(duration > 0)) throw new Error(`Invalid source recording: ${scene.id}`);
    // Preserve interaction timing unless the clip exceeds its editorial slot.
    const rate = Math.min(1, scene.seconds / duration);
    const filters = `setpts=${rate.toFixed(6)}*(PTS-STARTPTS),scale=1600:820:flags=lanczos,setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=12`;
    await run(ffmpeg, ['-y', '-i', source, '-vf', filters, '-t', String(scene.seconds + 0.4), '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(demo, 'public/recordings', `${scene.id}.mp4`)]);
    report.push({ id: scene.id, sourceSeconds: duration, outputSeconds: scene.seconds + 0.4, speed: 1 / rate });
    console.log(`Processed ${scene.id} (${duration.toFixed(1)}s → ${scene.seconds}s slot).`);
  }
  await writeFile(path.join(demo, 'output', selected ? `processing-${selected}.json` : 'processing-report.json'), JSON.stringify(report, null, 2) + '\n');
}
if (process.argv[1]?.endsWith('process.mjs')) await processRecordings(process.argv.find((arg) => arg.startsWith('--scene='))?.split('=')[1]);
