import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, spring, useVideoConfig } from 'remotion';
import { MotionBackdrop, FeatureIcon } from './MotionBackdrop';

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const collapse = interpolate(frame, [44, 62], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const identity = spring({ frame: frame - 58, fps, config: { damping: 20, stiffness: 140 } });
  const hook = interpolate(frame, [43, 53], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ color: '#f1f4f7', overflow: 'hidden' }}>
    <MotionBackdrop hero />
    <div style={{ position: 'absolute', top: 106, left: 140, display: 'flex', alignItems: 'center', gap: 12, fontSize: 17, letterSpacing: 3, color: '#b8dec8' }}>
      <span style={{ width: 8, height: 8, background: '#b8dec8', borderRadius: '50%', boxShadow: '0 0 20px #b8dec8' }} /> YOUR NEXT BUILD STARTS HERE
    </div>
    <div style={{ position: 'absolute', top: 218, left: 140, fontSize: 100, lineHeight: 1.1, fontWeight: 650, letterSpacing: -5, opacity: hook }}>
      {['Still', 'juggling', 'terminals?'].map((word, i) => {
        const enter = spring({ frame: frame - i * 4, fps, config: { damping: 22 } });
        return <span key={word} style={{ display: 'inline-block', marginRight: 22, opacity: enter, transform: `translateY(${(1 - enter) * 55}px)`, color: i === 1 ? '#b8dec8' : '#f1f4f7' }}>{word}</span>;
      })}
    </div>
    <div style={{ position: 'absolute', left: 140, top: 475, display: 'flex', gap: 26, perspective: 1200 }}>
      {['atlas-dashboard', 'beacon-api', 'canvas-studio'].map((name, i) => {
        const enter = spring({ frame: frame - 5 - i * 7, fps, config: { damping: 18, stiffness: 130 } });
        const float = Math.sin(frame / 19 + i * 2) * 8;
        return <div key={name} style={{ width: 490, boxSizing: 'border-box', padding: 28, background: 'linear-gradient(135deg, #283239, #1a2029)', border: '1px solid #9cc9b54d', borderRadius: 18,
          boxShadow: '0 30px 65px #00000050', opacity: enter * (1 - collapse), transformOrigin: 'center',
          transform: `translate(${collapse * (1 - i) * 510}px, ${(1 - enter) * 90 + float - collapse * 150}px) rotate(${(i - 1) * 5 * (1 - collapse)}deg) rotateY(${(1 - i) * 8 * (1 - collapse)}deg) scale(${1 - collapse * 0.7})` }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 16, color: '#c3cbd2', marginBottom: 42 }}>
            {['#b8dec8', '#a89bef', '#708391'].map((color) => <span key={color} style={{ width: 7, height: 7, background: color, borderRadius: '50%' }} />)}
            <span style={{ marginLeft: 12 }}>{name}</span>
          </div>
          <div style={{ fontFamily: 'Consolas, monospace', fontSize: 28 }}><span style={{ color: '#b8dec8' }}>❯ </span>npm run dev<span style={{ color: '#b8dec8', opacity: frame % 24 < 12 ? 1 : 0 }}>▍</span></div>
          <div style={{ marginTop: 26, fontSize: 14, color: '#8796a5' }}>A project. Another window.</div>
        </div>;
      })}
    </div>
    <div style={{ position: 'absolute', top: 280, left: 140, opacity: identity, transform: `translateY(${(1 - identity) * 30}px)` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginBottom: 28 }}>
        <div style={{ width: 80, height: 80, display: 'grid', placeItems: 'center', borderRadius: 20, color: '#10231e', background: '#b8dec8', fontSize: 48, boxShadow: '0 0 80px #b8dec825', transform: `rotate(${(1 - identity) * -18}deg)` }}>⌘</div>
        <span style={{ fontSize: 17, letterSpacing: 3, color: '#b5c4cf' }}>ONE PLACE. EVERY PROJECT.</span>
      </div>
      <div style={{ fontSize: 110, fontWeight: 650, letterSpacing: -5 }}>Local Dev Manager<span style={{ color: '#b8dec8' }}>.</span></div>
      <div style={{ display: 'flex', gap: 18, marginTop: 40 }}>
        {['Discover', 'Start', 'Inspect'].map((text, i) => {
          const enter = spring({ frame: frame - 68 - i * 6, fps, config: { damping: 24 } });
          return <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 23px', border: '1px solid #b8dec83d', background: '#b8dec80b', borderRadius: 40, fontSize: 23, color: '#d6e5df', opacity: enter, transform: `translateY(${(1 - enter) * 25}px)` }}><FeatureIcon index={i} />{text}</div>;
        })}
      </div>
    </div>
  </AbsoluteFill>;
};
