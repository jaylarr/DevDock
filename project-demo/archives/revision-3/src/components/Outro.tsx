import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ background: '#19191c', color: '#eeeef0', justifyContent: 'center', padding: '0 150px 75px', opacity }}>
    <div style={{ fontSize: 19, letterSpacing: 4, color: '#b8dec8', marginBottom: 38 }}>LESS TERMINAL JUGGLING. MORE BUILDING.</div>
    <div style={{ fontSize: 92, fontWeight: 600, letterSpacing: -4 }}>Local Dev Manager.</div>
    <div style={{ fontSize: 31, color: '#aaaab2', marginTop: 28 }}>Electron <span style={{ padding: '0 15px' }}>·</span> React <span style={{ padding: '0 15px' }}>·</span> TypeScript <span style={{ padding: '0 15px' }}>·</span> Vite</div>
    <div style={{ width: 100, height: 2, background: '#707178', margin: '56px 0 28px' }} />
    <div style={{ fontSize: 20, color: '#707178' }}>Windows source-build preview · v0.3.0</div>
  </AbsoluteFill>;
};
