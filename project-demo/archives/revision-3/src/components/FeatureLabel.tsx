import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { FeatureIcon } from './MotionBackdrop';

export type Scene = { id: string; seconds: number; title: string; subtitle: string; note?: string; focus: number; origin: string };
export const FeatureLabel: React.FC<{ scene: Scene; index: number }> = ({ scene, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 25, stiffness: 180 } });
  return <div style={{ position: 'absolute', top: 20, left: 112, right: 112, opacity: enter,
    transform: `translateY(${(1 - enter) * 8}px)`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
    <div>
      <div style={{ fontSize: 40, fontWeight: 650, letterSpacing: -1.3, color: '#f1f4f7' }}>{scene.title}</div>
    </div>
    <div style={{ textAlign: 'right', color: '#707178', fontSize: 14, lineHeight: 1.6 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'flex-end', letterSpacing: 2.4, color: '#b8dec8' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 14px', border: '1px solid #b8dec83d', borderRadius: 30, background: '#b8dec80b' }}><FeatureIcon index={index} size={17} />{scene.subtitle}</span>
        <span style={{ color: '#aaaab2' }}>{String(index + 1).padStart(2, '0')} / 06</span>
      </div>
      {scene.note && <div style={{ letterSpacing: 0.2, color: '#aaaab2', fontSize: 13 }}>{scene.note}</div>}
    </div>
  </div>;
};
