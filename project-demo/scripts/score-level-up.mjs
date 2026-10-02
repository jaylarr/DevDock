// Original deterministic synthesis. No stock recording, sampled song, or third-party SFX.
export function levelUpScore(seconds, sr, events) {
  const count = Math.round(seconds * sr);
  const music = new Float32Array(count), effects = new Float32Array(count);
  const samples = t => Math.round(t * sr);
  const beat = 60 / 112;
  const chords = [[146.83,174.61,220], [116.54,146.83,174.61], [174.61,220,261.63], [130.81,164.81,196]];
  let seed = 90210;
  const noise = () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed / 2147483648 - 1; };
  const add = (buffer, start, duration, fn) => {
    const begin = samples(start), length = Math.min(samples(duration), count-begin);
    for(let i=0;i<length;i++) if(begin+i>=0) buffer[begin+i] += fn(i/sr,i);
  };
  const drop = 4.95;
  for(let n=0, time=0;time<seconds;n++,time=n*beat/2) {
    const chord = chords[Math.floor(n/32)%4];
    const energy = time<drop ? .32 : time>=37 && time<47 ? .66 : 1;
    // Eighth-note pluck with a little octave shimmer and a short echo.
    const frequency = chord[[0,1,2,1,0,2,1,2][n%8]]*(n%4===3?4:2);
    const pluck = t => .034*energy*Math.min(1,t*130)*Math.exp(-t*6)*(Math.sin(2*Math.PI*frequency*t)+.13*Math.sin(4*Math.PI*frequency*t));
    add(music,time,.8,pluck);
    add(music,time+beat*.75,.7,t=>pluck(t)*.24);
    if(n%2===0) {
      const bass = chord[0]/2;
      add(music,time,.42,t=>.09*energy*Math.min(1,t*180)*Math.exp(-t*8)*(Math.sin(2*Math.PI*bass*t)+.15*Math.sin(4*Math.PI*bass*t)));
    }
    if(time>=drop && n%8===0 || time>=drop && n%8===5) {
      add(music,time,.24,t=>.12*Math.exp(-t*22)*Math.sin(2*Math.PI*(48*t+95*(1-Math.exp(-t*38))/38)));
    }
    if(time>=drop && n%8===4) {
      add(music,time,.14,t=>energy*.03*Math.exp(-t*35)*(noise()*.7+Math.sin(2*Math.PI*185*t)*.3));
    }
    if(time>=drop) add(music,time,.05,t=>energy*.009*Math.exp(-t*100)*(noise()*.45+Math.sin(2*Math.PI*7100*t)*.55));
  }
  // Warm evolving pads. Keep low enough that speech stays in front.
  for(let i=0;i<count;i++) {
    const t=i/sr, chord=chords[Math.floor(t/(beat*16))%4];
    const local=t%(beat*16), envelope=Math.min(1,local/.6,(beat*16-local)/.8);
    for(const hz of chord) music[i] += .008*envelope*(Math.sin(2*Math.PI*hz*t)+.22*Math.sin(2*Math.PI*(hz+.4)*t));
  }
  const whoosh = start => add(effects,start,.3,t=>.025*Math.sin(Math.PI*t/.3)**2*(Math.sin(2*Math.PI*(700*t+1600*t*t))*.55+noise()*.18));
  [0.35,1.2,2.2].forEach(start=>add(effects,start,.1,t=>.035*Math.exp(-t*45)*Math.sin(2*Math.PI*210*t)));
  add(effects,3.7,.23,t=>.025*Math.sin(Math.PI*t/.23)**2*Math.sin(2*Math.PI*(520*t-450*t*t)));
  whoosh(4.7);
  add(effects,5,.4,t=>.055*Math.exp(-t*12)*Math.sin(2*Math.PI*65*t));
  for(const event of events) {
    if(event.type==='transition') whoosh(event.time);
    if(event.type==='click') add(effects,event.time,.065,t=>.025*Math.exp(-t*80)*(Math.sin(2*Math.PI*1300*t)+noise()*.2));
    if(event.type==='typing') for(let k=0;k<6;k++) add(effects,event.time+k*.07,.025,t=>.01*Math.exp(-t*140)*noise());
    if(event.type==='ready') [0,.13].forEach((dt,k)=>add(effects,event.time+dt,.32,t=>.025*Math.min(1,t*150)*Math.exp(-t*12)*Math.sin(2*Math.PI*[659.25,880][k]*t)));
    if(event.type==='link') [0,.17].forEach((dt,k)=>add(effects,event.time+dt,.36,t=>.021*Math.min(1,t*120)*Math.exp(-t*9)*Math.sin(2*Math.PI*[523.25,783.99][k]*t)));
  }
  [0,.17,.34].forEach((dt,k)=>add(effects,54.1+dt,.36,t=>.028*Math.min(1,t*130)*Math.exp(-t*10)*Math.sin(2*Math.PI*[523.25,659.25,783.99][k]*t)));
  for(let i=0;i<count;i++) {
    const t=i/sr;
    music[i]*=Math.min(1,t/.5,(seconds-t)/1.7);
    effects[i]*=Math.min(1,(seconds-t)/.6);
  }
  return {music,effects};
}
