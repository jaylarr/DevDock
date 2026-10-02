export function fixturePage(name) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${name} · Demo</title><style>
  *{box-sizing:border-box}body{margin:0;background:#10141e;color:#eef4f9;font-family:system-ui;padding:44px 64px}
  nav{display:flex;justify-content:space-between;font-size:15px;color:#a6b2c7}.pill{border:1px solid #485572;padding:10px 18px;border-radius:30px}
  .hero{display:grid;grid-template-columns:1.1fr 1fr;gap:36px;margin-top:75px}small{color:#a5f3cd;letter-spacing:3px}
  h1{font-size:74px;line-height:1.05;letter-spacing:-4px;margin:25px 0}p{font-size:19px;line-height:1.6;color:#b2bdd0;max-width:470px}
  .cta{background:#baffd9;border-radius:35px;padding:18px 25px;color:#152721;display:inline-block;margin-top:18px}
  .art{position:relative;height:380px;background:radial-gradient(ellipse,#9660ff44,transparent 70%);display:grid;place-items:center}
  .ring{width:300px;height:300px;border:2px solid #baffd9;border-radius:50%;transform:rotate(-25deg) scaleY(.55);position:absolute}
  .ring:nth-child(2){transform:rotate(45deg) scaleY(.6);border-color:#ae9aff}.orb{width:145px;height:145px;border-radius:45px;background:linear-gradient(145deg,#bbffd9,#b5a0ff);transform:rotate(-12deg);box-shadow:0 0 100px #ac8fff55}
  .cards{display:flex;gap:18px;margin-top:35px}.card{flex:1;border:1px solid #34415a;border-radius:20px;padding:22px;background:#ffffff04}
  .card b{color:#d7e2f1;font-size:18px}.card p{font-size:15px;margin:10px 0 0}footer{color:#7e90aa;margin-top:24px;font-size:12px;letter-spacing:2px}
  </style><nav><b>${name.toUpperCase()}</b><span class="pill">Fictional demonstration project</span></nav>
  <div class="hero"><div><small>SMALL PROJECT. BIG POSSIBILITY.</small><h1>${name==='canvas-studio'?'Make something<br>just for fun.':'Your next idea<br>starts here.'}</h1>
  <p>A colorful little ${name==='canvas-studio'?'HTML experiment':'development playground'}, served locally by DevDock.</p><div class="cta">Keep creating ↗</div></div>
  <div class="art"><div class="ring"></div><div class="ring"></div><div class="orb"></div></div></div>
  <div class="cards"><div class="card"><b>Explore an idea</b><p>Start with something small.</p></div><div class="card"><b>Make it yours</b><p>Try a color. Change a shape.</p></div><div class="card"><b>Enjoy the process</b><p>Your next side project can begin here.</p></div></div>
  <footer>REAL LOCAL PREVIEW · FICTIONAL DEMO CONTENT</footer></html>`;
}
