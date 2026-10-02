import React from 'react';
import { Composition } from 'remotion';
import { ProjectMontage } from './ProjectMontage';
import scenes from '../storyboard/scenes.json';
import narration from '../storyboard/narration.json';

export const Root: React.FC = () => <Composition id="ProjectMontage" component={ProjectMontage}
  durationInFrames={(narration.introSeconds + scenes.reduce((total, scene) => total + scene.seconds, 0) + narration.outroSeconds) * 30}
  fps={30} width={1920} height={1080} />;
