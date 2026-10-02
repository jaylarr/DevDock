import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { MotionBackdrop } from './MotionBackdrop';

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 24, stiffness: 130 } });
  const second = spring({ frame: frame - 17, fps, config: { damping: 22 } });
  return <AbsoluteFill style={{ color: '#f1f4f7', overflow: 'hidden' }}>
    <MotionBackdrop hero />
    <div style={{ position: 'absolute', top: 120, left: 140, fontSize: 17, letterSpacing: 3, color: '#b8dec8', opacity: enter }}>YOUR WORKSPACE. READY.</div>
    <div style={{ position: 'absolute', left: 140, top: 248, opacity: enter, transform: `translateY(${(1 - enter) * 45}px)` }}>
      <div style={{ fontSize: 64, letterSpacing: -2, color: '#9eacb9' }}>Less terminal juggling.</div>
      <div style={{ fontSize: 150, fontWeight: 650, letterSpacing: -7, marginTop: 3, opacity: second, transform: `translateY(${(1 - second) * 35}px)` }}>More <span style={{ color: '#b8dec8' }}>building.</span></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 52, fontSize: 36, fontWeight: 600 }}>
        <span style={{ display: 'grid', placeItems: 'center', width: 56, height: 56, background: '#b8dec8', color: '#152720', borderRadius: 14, fontSize: 36 }}>⌘</span>DevDock.
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 30 }}>
        {['Electron', 'React', 'TypeScript', 'Vite'].map((text, i) => {
          const chip = spring({ frame: frame - 30 - i * 5, fps, config: { damping: 24 } });
          return <div key={text} style={{ border: '1px solid #8da8a642', padding: '10px 18px', borderRadius: 30, color: '#bac9d2', fontSize: 18, opacity: chip, transform: `translateY(${(1 - chip) * 20}px)` }}>{text}</div>;
        })}
      </div>
      <div style={{ marginTop: 26, fontSize: 17, color: '#8395a5' }}>Windows source-build preview · v0.3.0</div>
    </div>
  </AbsoluteFill>;
};
