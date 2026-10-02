import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import captions from '../../public/assets/captions.json';

export const Subtitles: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const cue = captions.cues.find((item) => seconds >= item.start && seconds < item.end);
  if (!cue) return null;
  return <div style={{ position: 'absolute', left: 170, right: 170, bottom: 12, minHeight: 63,
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f6f6f7', fontSize: 27,
    lineHeight: 1.22, fontWeight: 500, textAlign: 'center', whiteSpace: 'pre-line', letterSpacing: 0.1, textShadow: '0 2px 8px #000000' }}>
    {cue.lines}
  </div>;
};
