import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import captions from '../../public/assets/captions.json';

export const Subtitles: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const cue = captions.cues.find((item) => seconds >= item.start && seconds < item.end);
  if (!cue) return null;
  return <div style={{ position: 'absolute', left: 150, right: 150, bottom: 18, minHeight: 68,
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f6f6ff', fontSize: 30,
    lineHeight: 1.22, fontWeight: 550, textAlign: 'center', whiteSpace: 'pre-line', letterSpacing: 0.1 }}>
    <span style={{ padding: '8px 22px', background: '#070c19ee', border: '1px solid #9ab3d220', borderRadius: 13, boxShadow: '0 4px 20px #0004' }}>{cue.lines.split(/(Start|HTML|localhost|building|Dark mode|Light mode|Local Dev Manager)/g).map((word, i) => <span key={i} style={{ color: /^(Start|HTML|localhost|building|Dark mode|Light mode|Local Dev Manager)$/.test(word) ? '#baffd9' : undefined }}>{word}</span>)}</span>
  </div>;
};
