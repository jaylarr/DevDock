import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, access, rm } from 'node:fs/promises';
import { demo, scenes, probe, findTool, run, directories } from './common.mjs';

export async function qa() {
  await directories();
  const video = path.join(demo, 'output/project-montage.mp4');
  const videoSha256 = createHash('sha256').update(await readFile(video)).digest('hex');
  const marketingCopy = path.join(demo, 'output/project-montage-marketing.mp4');
  assert.equal(createHash('sha256').update(await readFile(marketingCopy)).digest('hex'), videoSha256, 'Named marketing copy must match the verified export.');
  assert.equal(createHash('sha256').update(await readFile(path.join(demo,'output/project-montage-level-up.mp4'))).digest('hex'),videoSha256);
  const metadata = await probe(video);
  const stream = metadata.streams.find((item) => item.codec_type === 'video');
  const script = JSON.parse(await readFile(path.join(demo, 'storyboard/narration.json'), 'utf8'));
  const captions = JSON.parse(await readFile(path.join(demo, 'public/assets/captions.json'), 'utf8'));
  const duration = script.introSeconds + script.outroSeconds + scenes.reduce((total, item) => total + item.seconds, 0);
  const audio = metadata.streams.find((item) => item.codec_type === 'audio');
  assert(audio, 'Final video must contain narration and music.');
  assert.equal(audio.codec_name, 'aac');
  assert(Math.abs(Number(audio.duration) - duration) < 0.1);
  assert.deepEqual(captions.cues.map((cue) => cue.text), script.segments.flatMap((segment) => segment.lines));
  let previousEnd = 0;
  for (const cue of captions.cues) {
    assert(cue.start >= previousEnd && cue.end > cue.start && cue.end <= duration);
    const lines = cue.lines.split('\n');
    assert(lines.length <= 2 && lines.every((line) => line.length <= 42));
    previousEnd = cue.end;
  }
  await access(path.join(demo, 'output/project-montage.srt'));
  await rm(path.join(demo, 'output/visual-review.json'), { force: true });
  assert.equal(stream.width, 1920); assert.equal(stream.height, 1080);
  assert.equal(stream.codec_name, 'h264'); assert.equal(stream.pix_fmt, 'yuv420p');
  assert.equal(stream.r_frame_rate, '30/1');
  assert(Math.abs(Number(metadata.format.duration) - duration) < 0.1);
  const ffmpeg = await findTool('ffmpeg');
  // Full decode validates every frame, not just successful container creation.
  await run(ffmpeg, ['-v', 'error', '-xerror', '-i', video, '-f', 'null', '-']);
  const levels = await run(ffmpeg, ['-hide_banner', '-i', video, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
  const meanDb = Number(levels.stderr.match(/mean_volume: ([\d.-]+) dB/)?.[1]);
  const peakDb = Number(levels.stderr.match(/max_volume: ([\d.-]+) dB/)?.[1]);
  assert(Number.isFinite(meanDb) && meanDb > -35, 'Audio must be audible.');
  assert(Number.isFinite(peakDb) && peakDb < 0, 'Audio must retain headroom.');
  const stems = [];
  for (const name of ['narration.wav','original-score.wav','sound-effects.wav']) {
    const file = path.join(demo,'public/assets',name);
    const stem = await probe(file);
    assert(Math.abs(Number(stem.format.duration)-duration)<.1, `${name} must span the composition.`);
    const measured = await run(ffmpeg,['-hide_banner','-i',file,'-af','volumedetect','-f','null','-']);
    const mean = Number(measured.stderr.match(/mean_volume: ([\d.-]+) dB/)?.[1]);
    const peak = Number(measured.stderr.match(/max_volume: ([\d.-]+) dB/)?.[1]);
    assert(Number.isFinite(mean) && mean>-65 && peak<0, `${name} must be non-silent with headroom.`);
    stems.push({name,meanDb:mean,peakDb:peak});
  }
  const frames = [{ name: 'intro', time: 1.2 }, { name: 'intro-question', time: 3.2 }, { name: 'intro-convergence', time: 5.1 }, { name: 'identity', time: 7.2 }];
  let offset = script.introSeconds;
  for (const scene of scenes) {
    frames.push({ name: scene.id, time: offset + scene.seconds * 0.5 });
    frames.push({ name: `${scene.id}-transition`, time: offset + 0.2 });
    frames.push({ name: `${scene.id}-benefit`, time: offset + scene.seconds - 0.5 });
    offset += scene.seconds;
  }
  frames.push({ name: 'outro', time: offset + 2 });
  for (const frame of frames) {
    await run(ffmpeg, ['-y', '-ss', String(frame.time), '-i', video, '-frames:v', '1', '-update', '1', path.join(demo, 'output/qa', `${frame.name}-final.png`)]);
  }
  await run(ffmpeg, ['-y', '-i', video, '-vf', 'fps=1/3,scale=480:270,tile=4x5', '-frames:v', '1', '-update', '1', path.join(demo, 'output/qa/contact-sheet.jpg')]);
  await writeFile(path.join(demo, 'output/qa-report.json'), JSON.stringify({
    verifiedAt: new Date().toISOString(), videoSha256, marketingCopyMatches: true, durationSeconds: Number(metadata.format.duration), resolution: [stream.width, stream.height],
    fps: stream.r_frame_rate, codec: stream.codec_name, pixelFormat: stream.pix_fmt, fullDecodePassed: true,
    audio: { codec: audio.codec_name, durationSeconds: Number(audio.duration), meanDb, peakDb, stems }, subtitleCues: captions.cues.length,
    sizeBytes: Number(metadata.format.size), extractedFrames: frames,
    visualReview: 'Inspect output/qa/contact-sheet.jpg and source/final PNGs after generation. Automated checks do not certify visual polish.',
  }, null, 2) + '\n');
  console.log(`QA passed: ${duration}s, 1920×1080, 30 FPS, H.264/AAC, ${captions.cues.length} subtitles; full decode passed. Review output/qa.`);
}
if (process.argv[1]?.endsWith('qa.mjs')) await qa();
