import path from 'node:path';
import { rename } from 'node:fs/promises';
import { demo, probe, run, findTool } from './common.mjs';

export async function finalize() {
  const video = path.join(demo, 'output/project-montage.mp4');
  const metadata = await probe(video);
  const stream = metadata.streams.find((item) => item.codec_type === 'video');
  if (stream.pix_fmt === 'yuv420p' && stream.color_range !== 'pc') return;
  const temporary = path.join(demo, 'output/project-montage-compatible.mp4');
  const inputRange = stream.color_range === 'pc' || stream.pix_fmt.startsWith('yuvj') ? 'full' : 'limited';
  await run(await findTool('ffmpeg'), ['-y', '-i', video, '-vf', `scale=in_range=${inputRange}:out_range=limited,format=yuv420p`,
    '-map', '0:v:0', '-map', '0:a?', '-c:a', 'copy', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-movflags', '+faststart', temporary]);
  const result = await probe(temporary);
  if (result.streams.find((item) => item.codec_type === 'video')?.pix_fmt !== 'yuv420p') throw new Error('Delivery color-range normalization failed.');
  await rename(temporary, video);
  console.log('Normalized delivery MP4 to limited-range yuv420p with fast-start metadata.');
}
if (process.argv[1]?.endsWith('finalize.mjs')) await finalize();
