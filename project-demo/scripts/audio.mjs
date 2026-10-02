import path from 'node:path';
import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';
import { demo, scenes, directories, probe, run, findTool } from './common.mjs';
import { levelUpScore } from './score-level-up.mjs';

const script = JSON.parse(await readFile(path.join(demo, 'storyboard/narration.json'), 'utf8'));
const sampleRate = 24000;
const totalSeconds = script.introSeconds + scenes.reduce((sum, scene) => sum + scene.seconds, 0) + script.outroSeconds;
const samples = (seconds) => Math.round(seconds * sampleRate);
function wav(pcm) {
  const output = Buffer.alloc(44 + pcm.length * 2);
  output.write('RIFF'); output.writeUInt32LE(output.length - 8, 4); output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24); output.writeUInt32LE(sampleRate * 2, 28); output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34);
  output.write('data', 36); output.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) output.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), 44 + i * 2);
  return output;
}
function srtTime(seconds) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
function wrap(text, limit = 42) {
  if (text.length <= limit) return text;
  const words = text.split(/\s+/);
  const choices = words.slice(1).map((_, i) => [words.slice(0, i + 1).join(' '), words.slice(i + 1).join(' ')]);
  const best = choices.filter((lines) => lines.every((line) => line.length <= limit))
    .sort((a, b) => Math.abs(a[0].length - a[1].length) - Math.abs(b[0].length - b[1].length))[0];
  if (!best) throw new Error(`Subtitle is too long: ${text}`);
  return best.join('\n');
}
export async function audio() {
  await directories();
  const cache = path.join(demo, '.cache/voice-clips');
  await mkdir(cache, { recursive: true });
  env.cacheDir = path.join(demo, '.cache/tts-model');
  env.backends.onnx.wasm.numThreads = 2;
  const ffmpeg = await findTool('ffmpeg');
  const voice = process.env.MONTAGE_VOICE || script.voice;
  let tts;
  const narration = new Float32Array(samples(totalSeconds));
  const captions = [], report = [];
  let offset = 0;
  for (const segment of script.segments) {
    const slot = segment.id === 'intro' ? script.introSeconds : segment.id === 'outro' ? script.outroSeconds : scenes.find((scene) => scene.id === segment.id)?.seconds;
    if (!slot) throw new Error(`No duration for spoken segment ${segment.id}.`);
    const clips = [];
    for (const text of segment.lines) {
      const spokenText = text.replace(/\bVite\b/g, 'veet');
      const hash = createHash('sha256').update(JSON.stringify({ text: spokenText, voice, speed: script.speed, model: 'Kokoro-82M-v1.0/q8' })).digest('hex').slice(0, 20);
      const filename = path.join(cache, `${hash}.wav`);
      try { await access(filename); } catch {
        if (!tts) {
          console.log('Loading local neural voice model (download once, then cached)…');
          const completed = new Set();
          tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
            dtype: 'q8', device: 'cpu', progress_callback: (event) => {
              if (event.status === 'done' && !completed.has(event.file)) { completed.add(event.file); console.log(`Voice model ready: ${event.file}`); }
            },
          });
        }
        const generated = await tts.generate(spokenText, { voice, speed: script.speed });
        await generated.save(filename);
      }
      const metadata = await probe(filename);
      clips.push({ text, filename, seconds: Number(metadata.format.duration) });
    }
    const leading = 0.24, gap = 0.16, trailing = 0.18;
    const available = slot - leading - trailing - gap * (clips.length - 1);
    const spoken = clips.reduce((sum, clip) => sum + clip.seconds, 0);
    const tempo = Math.max(1, spoken / available);
    if (tempo > 1.35) throw new Error(`Narration for ${segment.id} is too long. Shorten its script or extend its scene.`);
    let cursor = offset + leading;
    for (const clip of clips) {
      const pcm = await readPcm(ffmpeg, clip.filename, tempo);
      const begin = samples(cursor);
      for (let i = 0; i < pcm.length && begin + i < narration.length; i++) narration[begin + i] += pcm[i];
      const end = cursor + pcm.length / sampleRate;
      captions.push({ start: cursor, end, text: clip.text, lines: wrap(clip.text), scene: segment.id });
      cursor = end + gap;
    }
    report.push({ id: segment.id, offset, slotSeconds: slot, tempo, sourceSpeechSeconds: spoken });
    offset += slot;
    console.log(`Voiced ${segment.id}.`);
  }
  const assets = path.join(demo, 'public/assets');
  await writeFile(path.join(assets, 'narration-raw.wav'), wav(narration));
  const recording = JSON.parse(await readFile(path.join(demo,'output/recording-report.json'),'utf8'));
  const processing = JSON.parse(await readFile(path.join(demo,'output/processing-report.json'),'utf8'));
  const events = [];
  let chapter = script.introSeconds;
  for (const scene of scenes) {
    const captured = recording.captures.find(item=>item.id===scene.id);
    const processed = processing.find(item=>item.id===scene.id);
    for(const event of captured?.events || []) events.push({type:event.type,time:chapter+event.time/(processed?.speed || 1)});
    events.push({type:'transition',time:chapter});
    if(scene.seconds>=6) events.push({type:'transition',time:chapter+scene.seconds-(scene.browser?3.1:1.5)});
    if(scene.id==='05-preview') events.push({type:'link',time:chapter+2});
    chapter += scene.seconds;
  }
  const composed=levelUpScore(totalSeconds,sampleRate,events);
  await writeFile(path.join(assets, 'original-score.wav'), wav(composed.music));
  await writeFile(path.join(assets, 'sound-effects.wav'), wav(composed.effects));
  await run(ffmpeg, ['-y', '-i', path.join(assets, 'narration-raw.wav'), '-af', 'loudnorm=I=-16:TP=-2:LRA=7', '-ar', '48000', '-c:a', 'pcm_s16le', path.join(assets, 'narration.wav')]);
  await run(ffmpeg, ['-y', '-i', path.join(assets, 'narration.wav'), '-i', path.join(assets, 'original-score.wav'), '-i', path.join(assets, 'sound-effects.wav'),
    '-filter_complex', '[0:a]asplit=2[voice][side];[1:a][side]sidechaincompress=threshold=0.018:ratio=5:attack=5:release=200[music];[voice][music][2:a]amix=inputs=3:normalize=0,alimiter=limit=0.95[mix]',
    '-map', '[mix]', '-t', String(totalSeconds), '-ar', '48000', '-c:a', 'pcm_s16le', path.join(assets, 'soundtrack.wav')]);
  const captionData = { durationSeconds: totalSeconds, voice, timing: 'measured generated sentence audio', cues: captions };
  await writeFile(path.join(assets, 'captions.json'), JSON.stringify(captionData, null, 2) + '\n');
  const srt = captions.map((cue, i) => `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.lines}\n`).join('\n');
  await writeFile(path.join(demo, 'output/project-montage.srt'), srt);
  await writeFile(path.join(demo, 'output/project-montage-level-up.srt'), srt);
  await writeFile(path.join(demo, 'output/audio-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(),
    engine: 'local Kokoro-82M-v1.0 q8', voice, source: 'original written narration / generic synthetic voice',
    soundtrack: 'original 112 BPM electronic groove, bass/arpeggios/pads/drums, ducked under narration', effects:'original synthesized clicks, typing, readiness/link chimes and transition sweeps', events, durationSeconds: totalSeconds, subtitleCues: captions.length, segments: report }, null, 2) + '\n');
  console.log(`Generated ${totalSeconds}s soundtrack and ${captions.length} synchronized subtitle cues.`);
}

async function readPcm(executable, filename, tempo) {
  const { spawn } = await import('node:child_process');
  const buffer = await new Promise((resolve, reject) => {
    const child = spawn(executable, ['-v', 'error', '-i', filename, '-af', `atempo=${tempo.toFixed(6)}`, '-ar', String(sampleRate), '-ac', '1', '-f', 'f32le', '-'], { windowsHide: true });
    const chunks = []; let stderr = '';
    child.stdout.on('data', (data) => chunks.push(data)); child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(stderr)));
  });
  const pcm = new Float32Array(buffer.length / 4);
  for (let i = 0; i < pcm.length; i++) pcm[i] = buffer.readFloatLE(i * 4);
  return pcm;
}
if (process.argv[1]?.endsWith('audio.mjs')) await audio();
