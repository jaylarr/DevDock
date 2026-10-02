import path from 'node:path';
import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';
import { demo, scenes, directories, probe, run, findTool } from './common.mjs';

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
function wrap(text, limit = 52) {
  if (text.length <= limit) return text;
  const words = text.split(/\s+/);
  const choices = words.slice(1).map((_, i) => [words.slice(0, i + 1).join(' '), words.slice(i + 1).join(' ')]);
  const best = choices.filter((lines) => lines.every((line) => line.length <= limit))
    .sort((a, b) => Math.abs(a[0].length - a[1].length) - Math.abs(b[0].length - b[1].length))[0];
  if (!best) throw new Error(`Subtitle is too long: ${text}`);
  return best.join('\n');
}
function score() {
  const music = new Float32Array(samples(totalSeconds));
  const beat = 60 / 108;
  const chords = [[146.83, 174.61, 220], [116.54, 146.83, 174.61], [130.81, 164.81, 196], [110, 138.59, 164.81]];
  // Original deterministic composition: low pulse, restrained plucked triads and soft ticks.
  for (let time = 0; time < totalSeconds; time += beat) {
    const index = Math.round(time / beat), chord = chords[Math.floor(index / 8) % chords.length];
    const root = chord[0] / 2;
    for (let i = 0; i < samples(Math.min(0.22, totalSeconds - time)); i++) {
      const t = i / sampleRate;
      const envelope = Math.min(1, t * 150) * Math.exp(-t * 20);
      music[samples(time) + i] += 0.032 * envelope * Math.sin(2 * Math.PI * (root + 28 * Math.exp(-t * 35)) * t);
    }
    if (index % 2 === 0) {
      const note = chord[(index / 2) % 3] * 2;
      for (let i = 0; i < samples(Math.min(0.85, totalSeconds - time)); i++) {
        const t = i / sampleRate;
        const envelope = Math.min(1, t * 100) * Math.exp(-t * 5);
        music[samples(time) + i] += 0.021 * envelope * (Math.sin(2 * Math.PI * note * t) + 0.18 * Math.sin(4 * Math.PI * note * t));
      }
    }
    if (index % 2 === 1) {
      for (let i = 0; i < samples(Math.min(0.045, totalSeconds - time)); i++) {
        const t = i / sampleRate;
        music[samples(time) + i] += 0.005 * Math.exp(-t * 110) * (Math.sin(2 * Math.PI * 4200 * t) + Math.sin(2 * Math.PI * 5800 * t));
      }
    }
  }
  // Quiet synthesized motion accents: no sampled or third-party sound effects.
  const accents = [1.85];
  let chapterTime = script.introSeconds;
  for (const scene of scenes) {
    accents.push(chapterTime, chapterTime + scene.seconds - 1.33);
    chapterTime += scene.seconds;
  }
  accents.push(chapterTime);
  for (const start of accents) {
    for (let i = 0; i < samples(0.34) && samples(start) + i < music.length; i++) {
      const t = i / sampleRate;
      const envelope = Math.sin(Math.PI * t / 0.34) ** 2;
      const sweep = Math.sin(2 * Math.PI * (620 * t + 1800 * t * t));
      const air = (Math.sin(2 * Math.PI * 2351 * t) + Math.sin(2 * Math.PI * 3547 * t)) / 2;
      music[samples(start) + i] += 0.012 * envelope * (sweep * 0.55 + air * 0.45);
    }
  }
  for (let i = 0; i < music.length; i++) music[i] *= Math.min(1, i / samples(0.5), (music.length - i) / samples(1.5));
  return music;
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
  await writeFile(path.join(assets, 'original-score.wav'), wav(score()));
  await run(ffmpeg, ['-y', '-i', path.join(assets, 'narration-raw.wav'), '-af', 'loudnorm=I=-16:TP=-2:LRA=7', '-ar', '48000', '-c:a', 'pcm_s16le', path.join(assets, 'narration.wav')]);
  await run(ffmpeg, ['-y', '-i', path.join(assets, 'narration.wav'), '-i', path.join(assets, 'original-score.wav'),
    '-filter_complex', '[0:a]asplit=2[voice][side];[1:a][side]sidechaincompress=threshold=0.018:ratio=7:attack=5:release=180[music];[voice][music]amix=inputs=2:normalize=0,alimiter=limit=0.95[mix]',
    '-map', '[mix]', '-t', String(totalSeconds), '-ar', '48000', '-c:a', 'pcm_s16le', path.join(assets, 'soundtrack.wav')]);
  const captionData = { durationSeconds: totalSeconds, voice, timing: 'measured generated sentence audio', cues: captions };
  await writeFile(path.join(assets, 'captions.json'), JSON.stringify(captionData, null, 2) + '\n');
  const srt = captions.map((cue, i) => `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.lines}\n`).join('\n');
  await writeFile(path.join(demo, 'output/project-montage.srt'), srt);
  await writeFile(path.join(demo, 'output/audio-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(),
    engine: 'local Kokoro-82M-v1.0 q8', voice, source: 'original written narration / generic synthetic voice',
    soundtrack: 'original procedural composition, 108 BPM, synthesized transition accents, ducked under narration', durationSeconds: totalSeconds, subtitleCues: captions.length, segments: report }, null, 2) + '\n');
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
