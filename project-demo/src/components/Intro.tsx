import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, spring, useVideoConfig } from 'remotion';

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 24, stiffness: 160 } });
  const reveal = interpolate(frame, [48, 62], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const problems = ['atlas-dashboard', 'beacon-api', 'canvas-studio'];
  return <AbsoluteFill style={{ background: '#19191c', color: '#eeeef0' }}>
    <div style={{ position: 'absolute', top: 112, left: 150, color: '#b8dec8', fontSize: 17, letterSpacing: 3 }}>YOUR NEXT BUILD STARTS HERE</div>
    <div style={{ position: 'absolute', left: 150, top: 240, opacity: (1 - reveal) * enter, transform: `translateY(${(1 - enter) * 22}px)` }}>
      <div style={{ fontSize: 88, fontWeight: 600, letterSpacing: -4 }}>Still juggling terminals?</div>
      <div style={{ display: 'flex', gap: 24, marginTop: 66 }}>
        {problems.map((name, index) => <div key={name} style={{ width: 455, border: '1px solid #45454b', borderRadius: 9, background: '#232326',
          padding: 24, transform: `translateY(${Math.sin(index * 2) * 13 - reveal * 20}px)`, opacity: interpolate(frame, [index * 6, index * 6 + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
          <div style={{ fontSize: 16, color: '#aaaab2', marginBottom: 38 }}>{name}</div>
          <div style={{ fontFamily: 'Consolas, monospace', fontSize: 24, color: '#eeeef0' }}><span style={{ color: '#b8dec8' }}>❯ </span>npm run dev</div>
          <div style={{ fontSize: 14, color: '#707178', marginTop: 24 }}>A project. Another window.</div>
        </div>)}
      </div>
    </div>
    <div style={{ position: 'absolute', top: 282, left: 150, opacity: reveal, transform: `translateY(${(1 - reveal) * 20}px)` }}>
      <div style={{ display: 'flex', gap: 26, alignItems: 'center', marginBottom: 32 }}>
        <div style={{ width: 82, height: 82, display: 'grid', placeItems: 'center', borderRadius: 7, background: '#eeeef0', color: '#19191c', fontSize: 52 }}>⌘</div>
        <span style={{ color: '#aaaab2', fontSize: 18, letterSpacing: 3 }}>ONE PLACE TO RUN YOUR PROJECTS</span>
      </div>
      <div style={{ fontSize: 106, fontWeight: 600, letterSpacing: -5 }}>DevDock.</div>
      <div style={{ fontSize: 34, color: '#aaaab2', marginTop: 27 }}>Discover. Start. Inspect.</div>
    </div>
  </AbsoluteFill>;
};
