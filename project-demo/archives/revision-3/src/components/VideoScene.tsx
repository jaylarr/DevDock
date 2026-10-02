import React from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile, interpolate, useCurrentFrame, spring, useVideoConfig } from 'remotion';
import { BrowserFrame } from './BrowserFrame';
import { FeatureLabel, type Scene } from './FeatureLabel';
import { MotionBackdrop } from './MotionBackdrop';
import { BenefitBeat, benefitProgress, ChapterRail } from './BenefitBeat';

export const VideoScene: React.FC<{ scene: Scene; index: number }> = ({ scene, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const end = scene.seconds * 30;
  const enter = spring({ frame, fps, config: { damping: 24, stiffness: 180 } });
  const beat = benefitProgress(frame, scene.seconds);
  const zoom = interpolate(frame, [0, 22, 65, end - 28, end - 1], [1, 1, scene.focus, scene.focus, 1], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ overflow: 'hidden' }}>
    <MotionBackdrop />
    <FeatureLabel scene={scene} index={index} />
    <ChapterRail index={index} progress={frame / end} opacity={enter * (1 - beat)} />
    <AbsoluteFill style={{ opacity: 0.4 + enter * 0.6, transform: `translate(${beat * 330}px, ${(1 - enter) * 34}px) scale(${(0.98 + enter * 0.02) * (1 - beat * 0.32)})`, transformOrigin: '50% 50%' }}>
    <BrowserFrame>
      <OffthreadVideo src={staticFile(`recordings/${scene.id}.mp4`)} muted
        style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${zoom})`,
          transformOrigin: scene.origin }} />
    </BrowserFrame>
    </AbsoluteFill>
    <BenefitBeat index={index} seconds={scene.seconds} />
    <div style={{ position: 'absolute', left: 112, right: 112, top: 993, height: 2, background: '#303035' }}>
      <div style={{ width: `${Math.min(100, (index + frame / end) / 6 * 100)}%`, height: '100%', background: 'linear-gradient(90deg, #a89bef, #b8dec8)', boxShadow: '0 0 10px #b8dec880' }} />
    </div>
  </AbsoluteFill>;
};
