import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig, spring } from 'remotion';
import { FeatureIcon } from './MotionBackdrop';

const benefits = [
  ['One', 'workspace.', 'FOLDERS → PROJECTS'],
  ['Ready.', 'Set. Build.', 'PICK → START → RUN'],
  ['Full', 'visibility.', 'LOGS + RUNTIME DETAILS'],
  ['Find your', 'focus.', 'SEARCH + ACTIVE FILTER'],
  ['Share', 'deliberately.', 'REVIEW ACCESS FIRST'],
  ['Make it', 'yours.', 'LIGHT ↔ DARK'],
];

export function benefitProgress(frame: number, seconds: number) {
  return interpolate(frame, [seconds * 30 - 40, seconds * 30 - 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
}

export const BenefitBeat: React.FC<{ index: number; seconds: number }> = ({ index, seconds }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - (seconds * fps - 36), fps, config: { damping: 23, stiffness: 170 } });
  const text = benefits[index];
  return <div style={{ position: 'absolute', top: 342, left: 112, width: 550, color: '#f1f4f7', opacity: enter, transform: `translateX(${(1 - enter) * -45}px)` }}>
    <div style={{ width: 60, height: 60, display: 'grid', placeItems: 'center', color: '#b8dec8', background: '#b8dec80f', border: '1px solid #b8dec840', borderRadius: 16, marginBottom: 24 }}><FeatureIcon index={index} size={30} /></div>
    <div style={{ fontSize: index === 4 ? 74 : 89, lineHeight: 1.05, fontWeight: 650, letterSpacing: -4 }}>{text[0]}<br /><span style={{ color: '#b8dec8' }}>{text[1]}</span></div>
    <div style={{ marginTop: 26, fontSize: 14, letterSpacing: 2, color: '#acbcc9' }}>{text[2]}</div>
    <div style={{ width: 130 * enter, height: 3, borderRadius: 3, background: 'linear-gradient(90deg, #b8dec8, #a89bef)', marginTop: 25 }} />
  </div>;
};

export const ChapterRail: React.FC<{ index: number; progress: number; opacity: number }> = ({ index, progress, opacity }) => <div style={{ position: 'absolute', left: 33, top: 350, opacity, display: 'flex', flexDirection: 'column', gap: 17 }}>
  {Array.from({ length: 6 }, (_, i) => <div key={i} style={{ position: 'relative', width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 13,
    color: i <= index ? '#b8dec8' : '#576877', border: `1px solid ${i === index ? '#b8dec870' : '#8da8a625'}`, background: i === index ? '#b8dec818' : '#11151b',
    boxShadow: i === index ? '0 0 30px #b8dec811' : 'none' }}>
    <FeatureIcon index={i} size={19} />
    {i === index && <div style={{ position: 'absolute', bottom: -5, height: 2, width: 42 * progress, left: 0, background: '#b8dec8' }} />}
  </div>)}
</div>;
