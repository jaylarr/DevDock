import React from 'react';
import { AbsoluteFill, Sequence, Audio, staticFile } from 'remotion';
import scenes from '../storyboard/scenes.json';
import narration from '../storyboard/narration.json';
import { LevelUpIntro, LevelUpOutro, LevelUpScene } from './components/LevelUp';
import { Subtitles } from './components/Subtitles';

export const ProjectMontage: React.FC = () => {
  let cursor = narration.introSeconds * 30;
  const clips = scenes.map((scene, index) => {
    const from = cursor;
    cursor += scene.seconds * 30;
    return <Sequence key={scene.id} from={from} durationInFrames={scene.seconds * 30}>
      <LevelUpScene scene={scene} index={index} total={scenes.length} />
    </Sequence>;
  });
  return <AbsoluteFill style={{ background: '#19191c', fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
    <Audio src={staticFile('assets/soundtrack.wav')} />
    <Sequence durationInFrames={narration.introSeconds * 30}><LevelUpIntro /></Sequence>
    {clips}
    <Sequence from={cursor} durationInFrames={narration.outroSeconds * 30}><LevelUpOutro /></Sequence>
    <Subtitles />
  </AbsoluteFill>;
};
