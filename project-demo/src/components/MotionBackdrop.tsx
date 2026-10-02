import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

export const MotionBackdrop: React.FC<{ hero?: boolean }> = ({ hero = false }) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 60;
  return <AbsoluteFill style={{ overflow: 'hidden', background: '#11151b' }}>
    <AbsoluteFill style={{ backgroundImage: 'linear-gradient(#b8dec809 1px, transparent 1px), linear-gradient(90deg, #b8dec809 1px, transparent 1px)', backgroundSize: '80px 80px',
      transform: `translate(${frame / 18 % 80}px, ${frame / 30 % 80}px) scale(1.12)`, opacity: hero ? 0.65 : 0.3 }} />
    <div style={{ position: 'absolute', width: 1400, height: 1100, left: 730 + drift, top: -480,
      background: 'radial-gradient(ellipse, #79d9b32b 0%, transparent 65%)', opacity: hero ? 1 : 0.6 }} />
    <div style={{ position: 'absolute', width: 1200, height: 1000, left: -420, top: 330 - drift,
      background: 'radial-gradient(ellipse, #9286ed26 0%, transparent 65%)', opacity: hero ? 1 : 0.5 }} />
    {hero && <>
      {[0, 1, 2].map((ring) => <div key={ring} style={{ position: 'absolute', left: 1180 - ring * 100, top: 130 - ring * 100,
        width: 440 + ring * 200, height: 440 + ring * 200, borderRadius: '50%', border: '1px solid #b8dec820', transform: `rotate(${frame / 3 + ring * 32}deg)` }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: ring === 1 ? '#a69aee' : '#b8dec8', position: 'absolute', left: '50%', top: -4, boxShadow: '0 0 24px #b8dec8' }} />
      </div>)}
      <div style={{ position: 'absolute', width: 500, height: 1, left: 140, top: 864, background: 'linear-gradient(90deg, #b8dec8, transparent)', transform: `scaleX(${0.6 + Math.sin(frame / 60) * 0.15})`, transformOrigin: 'left' }} />
    </>}
    <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 40%, #090b113d)' }} />
  </AbsoluteFill>;
};

export const FeatureIcon: React.FC<{ index: number; size?: number }> = ({ index, size = 24 }) => {
  const paths = ['M3 7h7l2 3h9v11H3V7z M3 7V4h7l2 3', 'M8 4l13 8-13 8V4z', 'M4 6l6 6-6 6 M13 18h7', 'M16 16l5 5 M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M12 3l8 4v6c0 4-8 8-8 8s-8-4-8-8V7l8-4z M8 12l3 3 5-6', 'M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11z'];
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[index % paths.length]} /></svg>;
};
