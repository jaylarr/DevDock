import React from 'react';
import { AbsoluteFill, Sequence, Audio, staticFile } from 'remotion';
import scenes from '../storyboard/scenes.json';
import narration from '../storyboard/narration.json';
import { Intro } from './components/MarketingIntro';
import { Outro } from './components/MarketingOutro';
import { VideoScene } from './components/VideoScene';
import { Subtitles } from './components/Subtitles';

export const ProjectMontage: React.FC = () => {
  let cursor = narration.introSeconds * 30;
  const clips = scenes.map((scene, index) => {
    const from = cursor;
    cursor += scene.seconds * 30;
    return <Sequence key={scene.id} from={from} durationInFrames={scene.seconds * 30}>
      <VideoScene scene={scene} index={index} />
    </Sequence>;
  });
  return <AbsoluteFill style={{ background: '#19191c', fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
    <Audio src={staticFile('assets/soundtrack.wav')} />
    <Sequence durationInFrames={narration.introSeconds * 30}><Intro /></Sequence>
    {clips}
    <Sequence from={cursor} durationInFrames={narration.outroSeconds * 30}><Outro /></Sequence>
    <Subtitles />
  </AbsoluteFill>;
};
