import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

const C = { mint: '#baffd9', violet: '#b9a3ff', ink: '#0b1020', white: '#f3f5ff', dim: '#98a6be', amber: '#ffe3a3' };
const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const easing = (frame: number, delay = 0) => spring({ frame: frame - delay, fps: 30, config: { damping: 22, stiffness: 150 } });
export type AdScene = { id: string; seconds: number; title: string; subtitle: string; focus: number; origin: string; benefit: string; detail: string; icon: number; note?: string; browser?: string };

export const AdIcon: React.FC<{ index: number; size?: number }> = ({ index, size = 28 }) => {
  const paths = ['M3 7h7l2 3h9v11H3V7z M3 7V4h7l2 3', 'M8 4l13 8-13 8V4z', 'M8 6L2 12l6 6 M16 6l6 6-6 6 M14 3l-4 18', 'M4 6l6 6-6 6 M13 18h7', 'M16 16l5 5 M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M9 15l6-6 M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0', 'M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11z'];
  return <svg width={size} height={size} viewBox={index === 5 ? '-2 -2 28 28' : '0 0 24 24'} fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={paths[index % paths.length]} /></svg>;
};

export const AdBackdrop: React.FC<{ hero?: boolean }> = ({ hero = false }) => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ background: C.ink, overflow: 'hidden' }}>
    <AbsoluteFill style={{ backgroundImage: 'radial-gradient(#aab6d025 1px,transparent 1px)', backgroundSize: '36px 36px', transform: `translate(${f / 20 % 36}px,${f / 34 % 36}px) scale(1.1)`, opacity: hero ? .65 : .3 }} />
    <div style={{ position: 'absolute', left: 800 + Math.sin(f / 80) * 50, top: -300, width: 1300, height: 1200, background: 'radial-gradient(ellipse,#8373ff28,transparent 65%)' }} />
    <div style={{ position: 'absolute', left: -350, top: 340, width: 1150, height: 850, background: 'radial-gradient(ellipse,#60dbab18,transparent 65%)' }} />
    {hero && [0, 1, 2].map(i => <div key={i} style={{ position: 'absolute', left: 1300 - i * 150, top: 80 - i * 130, width: 500 + i * 300, height: 500 + i * 300, border: '1px solid #a3e8ca19', borderRadius: '50%', transform: `rotate(${f / 4 + i * 50}deg)` }}><span style={{ position: 'absolute', left: '50%', top: -4, width: 8, height: 8, borderRadius: '50%', background: i === 1 ? C.violet : C.mint, boxShadow: '0 0 30px #baffd970' }} /></div>)}
    <div style={{ position: 'absolute', left: 80, top: 0, width: 1, height: 1080, background: 'linear-gradient(transparent,#b9a3ff30,transparent)' }} />
    <div style={{ position: 'absolute', right: 80, top: 0, width: 1, height: 1080, background: 'linear-gradient(transparent,#baffd920,transparent)' }} />
  </AbsoluteFill>;
};

const Pill: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = C.mint }) => <div style={{ padding: '11px 18px', color, background: `${color}0c`, border: `1px solid ${color}42`, borderRadius: 40, fontSize: 19, display: 'flex', gap: 10, alignItems: 'center' }}>{children}</div>;

const Screen: React.FC<{ children: React.ReactNode; label?: string; width: number; style?: React.CSSProperties }> = ({ children, label = 'DEVDOCK', width, style }) => <div style={{ width, borderRadius: 18, overflow: 'hidden', border: '1px solid #b9a3ff55', background: '#182032', boxShadow: '0 35px 100px #0007,0 0 55px #a39aff0b', ...style }}>
  <div style={{ height: 32, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 7, borderBottom: '1px solid #39425a' }}>
    {[C.mint, C.violet, '#56647d'].map(c => <span key={c} style={{ width: 7, height: 7, borderRadius: 7, background: c }} />)}
    <span style={{ marginLeft: 12, fontSize: 11, letterSpacing: 1.8, color: '#abb9d0' }}>{label}</span>
  </div><div style={{ overflow: 'hidden' }}>{children}</div>
</div>;

export const LevelUpIntro: React.FC = () => {
  const f = useCurrentFrame();
  const collapse = interpolate(f, [140, 158], [0, 1], clamp);
  const reveal = easing(f, 153);
  const hook = 1 - collapse;
  const question = easing(f, 48);
  const names = ['atlas-dashboard', 'canvas-studio', 'one-more-side-project'];
  return <AbsoluteFill style={{ color: C.white, overflow: 'hidden' }}>
    <AdBackdrop hero />
    <div style={{ position: 'absolute', top: 72, left: 120, color: C.mint, fontSize: 18, letterSpacing: 3, display: 'flex', gap: 13, alignItems: 'center' }}><span style={{ width: 9, height: 9, borderRadius: 9, background: C.mint, boxShadow: `0 0 25px ${C.mint}` }} /> A LITTLE LESS CHAOS. A LOT MORE BUILDING.</div>
    <div style={{ position: 'absolute', top: 242, left: 120, width: 820, opacity: hook, transform: `translateX(${-collapse * 200}px)` }}>
      <div style={{ color: C.dim, fontSize: 27, marginBottom: 30, letterSpacing: 1 }}>SIDE PROJECT #3 HAS ENTERED THE CHAT</div>
      <div style={{ fontSize: 126, lineHeight: .99, letterSpacing: -7, fontWeight: 750 }}>Another<br />terminal<span style={{ color: C.violet }}>?</span></div>
      <div style={{ marginTop: 40, color: C.mint, fontSize: 54, fontWeight: 550, opacity: question, transform: `translateY(${(1 - question) * 25}px)` }}>Wait. Which port?</div>
    </div>
    {names.map((name, i) => {
      const enter = easing(f, i * 24);
      return <div key={name} style={{ position: 'absolute', left: 1090 - i * 42, top: 228 + i * 150, width: 605, padding: 26, border: '1px solid #aebce04d', borderRadius: 18, background: 'linear-gradient(125deg,#283047,#121829)', boxShadow: '0 30px 70px #0006', opacity: enter * hook, transform: `perspective(1200px) translate(${collapse * -400}px,${(1 - enter) * 80 - collapse * 160}px) rotate(${(i - 1) * 5 + Math.sin(f / 28 + i) * 1.2}deg) scale(${1 - collapse * .5})` }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 26 }}>{[C.mint, C.violet, '#60718d'].map(c => <span key={c} style={{ width: 7, height: 7, borderRadius: 8, background: c }} />)}<span style={{ marginLeft: 12, color: C.dim, fontSize: 17 }}>{name}</span></div>
        <div style={{ fontFamily: 'Consolas, monospace', fontSize: 31 }}><span style={{ color: C.mint }}>❯ </span>npm run dev<span style={{ opacity: f % 24 < 12 ? 1 : 0, color: C.mint }}>▍</span></div>
        <div style={{ marginTop: 22, fontSize: 16, color: '#a8b7ce' }}>localhost:<span style={{ color: C.violet }}>{[5173, 3000, 8080][i]}</span> <span style={{ opacity: .55 }}>— which one was it?</span></div>
      </div>;
    })}
    <div style={{ position: 'absolute', left: 120, top: 247, width: 850, opacity: reveal, transform: `translateY(${(1 - reveal) * 55}px)` }}>
      <div style={{ color: C.violet, fontSize: 22, letterSpacing: 5, marginBottom: 28 }}>MEET DEVDOCK</div>
      <div style={{ fontSize: 102, lineHeight: 1.02, letterSpacing: -5, fontWeight: 750 }}>LOCALHOST:</div>
      <div style={{ fontSize: 154, lineHeight: 1.04, letterSpacing: -8, fontWeight: 800, color: C.mint }}>LEVEL UP<span style={{ color: C.violet }}>↗</span></div>
      <div style={{ marginTop: 30, fontSize: 29, color: '#bdc9dc' }}>Your projects. One dashboard.</div>
      <div style={{ display: 'flex', gap: 12, marginTop: 38 }}>{['Discover', 'Run', 'Create'].map((label, i) => <div key={label} style={{ opacity: easing(f, 176 + i * 7), transform: `translateY(${(1 - easing(f, 176 + i * 7)) * 24}px)` }}><Pill><AdIcon index={i} size={22} />{label}</Pill></div>)}</div>
    </div>
    <div style={{ position: 'absolute', top: 280, left: 990, opacity: reveal, transform: `perspective(1300px) rotateY(-9deg) rotateZ(-3deg) translateY(${(1 - reveal) * 80 + Math.sin(f / 38) * 5}px)` }}>
      <Screen width={800}><Img src={staticFile('assets/hero-dashboard.png')} style={{ width: 800, display: 'block' }} /></Screen>
      <div style={{ position: 'absolute', right: -20, top: -25, padding: '15px 24px', borderRadius: 15, color: '#152a20', background: C.mint, fontSize: 22, fontWeight: 700, transform: 'rotate(4deg)' }}>YOUR BUILD ZONE</div>
    </div>
    <div style={{ position: 'absolute', left: 120, top: 880, fontSize: 16, letterSpacing: 2, color: C.dim, opacity: reveal }}>A DESKTOP HOME FOR YOUR SIDE PROJECTS</div>
  </AbsoluteFill>;
};

export const LevelUpScene: React.FC<{ scene: AdScene; index: number; total: number }> = ({ scene, index, total }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const end = scene.seconds * fps;
  const enter = easing(f);
  const browserBeat = scene.browser ? interpolate(f, [end - 100, end - 80], [0, 1], clamp) : 0;
  const benefit = scene.seconds >= 6 ? interpolate(f, [end - 48, end - 28], [0, 1], clamp) : 0;
  const reframe = Math.max(browserBeat, benefit);
  // Clear the outgoing screen before the browser/text arrive; avoid double exposure.
  const browserReveal = interpolate(browserBeat, [.35, .7], [0, 1], clamp);
  const benefitReveal = interpolate(reframe, [.8, .98], [0, 1], clamp);
  const screenOpacity = scene.browser ? Math.max(0, 1 - browserBeat * 3) : 1;
  const zoom = interpolate(f, [0, end * .15, end * .3, end * .8, end - 1], [1, 1, scene.focus, scene.focus, 1], clamp);
  const title = browserBeat > .5 ? scene.benefit : scene.title;
  return <AbsoluteFill style={{ color: C.white, overflow: 'hidden' }}>
    <AdBackdrop />
    <div style={{ position: 'absolute', left: 110, top: 48, right: 110, display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: enter }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}><div style={{ color: C.mint, border: '1px solid #baffd935', background: '#baffd90a', borderRadius: 14, padding: 12 }}><AdIcon index={scene.icon} /></div><div><div style={{ fontSize: 13, color: C.violet, letterSpacing: 3, marginBottom: 5 }}>{String(index + 1).padStart(2, '0')} / {scene.subtitle}</div><div style={{ fontSize: 34, fontWeight: 650, letterSpacing: -1 }}>{title}</div></div></div>
      {scene.note && <div style={{ fontSize: 16, color: scene.id === '05-preview' ? C.amber : C.dim, padding: '11px 17px', border: '1px solid #b4bcd32c', background: '#0b1020bb', borderRadius: 30 }}>{scene.note}</div>}
    </div>
    <div style={{ position: 'absolute', top: 127 + reframe * 125 + (1 - enter) * 30, left: 180 + reframe * 500, opacity: enter * screenOpacity, transform: `scale(${(1 - reframe * .31) * (.985 + enter * .015)})`, transformOrigin: '0 0' }}>
      <Screen width={1560}><div style={{ width: 1560, height: 799.5, overflow: 'hidden' }}><OffthreadVideo src={staticFile(`recordings/${scene.id}.mp4`)} muted style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${zoom})`, transformOrigin: scene.origin }} /></div></Screen>
    </div>
    {reframe > 0 && <div style={{ position: 'absolute', left: 120, top: 285, width: 510, opacity: benefitReveal, transform: `translateX(${(1 - benefitReveal) * -40}px)` }}>
      <div style={{ color: C.mint, marginBottom: 25 }}><AdIcon index={scene.icon} size={54} /></div>
      <div style={{ fontSize: 87, lineHeight: 1.01, fontWeight: 750, letterSpacing: -4 }}>{scene.benefit}</div>
      <div style={{ fontSize: 26, color: '#adbbd3', lineHeight: 1.45, marginTop: 28 }}>{scene.detail}</div>
      <div style={{ width: 100, height: 4, background: `linear-gradient(90deg,${C.mint},${C.violet})`, marginTop: 33, borderRadius: 4 }} />
      {scene.id === '05-preview' && <div style={{ marginTop: 24, color: C.amber, fontSize: 17 }}>Review access. Share deliberately.</div>}
    </div>}
    {scene.browser && <div style={{ position: 'absolute', top: 205 + (1 - browserBeat) * 100, left: 670, opacity: browserReveal, transform: `perspective(1500px) rotateY(${-3 * browserBeat}deg) rotateZ(-1deg)` }}><Screen label={scene.id === '07-html' ? 'ACTUAL LOCAL HTML PREVIEW · FICTIONAL SITE' : 'ACTUAL LOCAL NPM PREVIEW · FICTIONAL SITE'} width={1110}><Img src={staticFile(`assets/${scene.browser}`)} style={{ width: 1110, display: 'block' }} /></Screen></div>}
    {scene.id === '06-theme' && f >= 22 && f < 42 && <div style={{ position: 'absolute', width: 200, height: 1200, left: interpolate(f, [22, 42], [-200, 2100]), top: -60, background: 'linear-gradient(90deg,transparent,#b9a3ff33,transparent)', transform: 'rotate(12deg)', pointerEvents: 'none' }} />}
    <div style={{ position: 'absolute', left: 180, right: 180, top: 978, display: 'flex', gap: 8 }}>{Array.from({ length: total }, (_, i) => <div key={i} style={{ flex: 1, height: 3, background: '#293147', borderRadius: 3 }}><div style={{ height: 3, width: `${i < index ? 100 : i === index ? Math.min(100, f / end * 100) : 0}%`, background: i === index ? C.mint : C.violet, borderRadius: 3 }} /></div>)}</div>
    <div style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, background: C.violet, transform: `translateX(${interpolate(f, [0, 12], [1920, 3840], clamp)}px)` }} />
  </AbsoluteFill>;
};

export const LevelUpOutro: React.FC = () => {
  const f = useCurrentFrame();
  const enter = easing(f);
  return <AbsoluteFill style={{ color: C.white, overflow: 'hidden' }}>
    <AdBackdrop hero />
    <div style={{ position: 'absolute', left: 120, top: 90, fontSize: 19, letterSpacing: 4, color: C.mint }}>YOUR NEXT SIDE PROJECT IS CALLING.</div>
    <div style={{ position: 'absolute', left: 120, top: 252, opacity: enter, transform: `translateY(${(1 - enter) * 45}px)` }}>
      <div style={{ fontSize: 42, color: C.dim, letterSpacing: -1 }}>Less terminal juggling.</div>
      <div style={{ fontSize: 127, lineHeight: 1.03, fontWeight: 750, letterSpacing: -6, marginTop: 22, color: C.mint }}>More<br />building<span style={{ color: C.violet }}>.</span></div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 39, fontSize: 37, fontWeight: 650 }}><span style={{ display: 'grid', placeItems: 'center', background: C.mint, color: '#11271d', borderRadius: 16, width: 62, height: 62, fontSize: 41 }}>⌘</span>DevDock</div>
      <div style={{ marginTop: 27, color: '#b8c5da', fontSize: 26 }}>Your projects. One dashboard. More building.</div>
    </div>
    <div style={{ position: 'absolute', left: 1040, top: 205, opacity: easing(f, 12), transform: `perspective(1200px) rotateY(-7deg) rotateZ(-4deg) translateY(${Math.sin(f / 28) * 5}px)` }}>
      <Screen width={700}><Img src={staticFile('assets/hero-dashboard.png')} style={{ width: 700, display: 'block' }} /></Screen>
      <div style={{ marginTop: 48, fontSize: 38, fontWeight: 700, letterSpacing: -1, color: C.mint }}>LOCALHOST: LEVEL UP ↗</div>
      <div style={{ display: 'flex', gap: 13, marginTop: 25 }}>{['Discover', 'Run', 'Create'].map((text, i) => <div key={text} style={{ opacity: easing(f, 30 + i * 7) }}><Pill><AdIcon index={i} size={21} />{text}</Pill></div>)}</div>
    </div>
    <div style={{ position: 'absolute', left: 120, top: 886, display: 'flex', gap: 18, alignItems: 'center', opacity: easing(f, 30) }}><Pill color={C.violet}>Windows source-build preview · v0.3.0</Pill><span style={{ fontSize: 17, color: C.dim }}>Built for the joy of building.</span></div>
  </AbsoluteFill>;
};
