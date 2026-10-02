import { _electron, chromium } from 'playwright';
import { writeFile, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { electronPath } from '../../scripts/electron-path.mjs';
import { demo, root, directories, scenes, delay, until, findTool, run, probe } from './common.mjs';
import { fixtures, names } from './fixtures.mjs';

export async function record(selected) {
  if (selected && !scenes.some((scene) => scene.id === selected)) throw new Error(`Unknown scene: ${selected}`);
  await directories();
  const fixture = await fixtures();
  let application, capturing = false;
  const errors = [], urls = new Set(), captures = [];
  try {
    const browser = await chromium.launch();
    const supportPage = await browser.newPage();
    const useScreencast = typeof supportPage.screencast?.start === 'function';
    await browser.close();
    const env = { ...process.env, LDM_DATA_DIR: fixture.data };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.LDM_RENDERER_URL;
    // This isolated session has its own instance lock. An existing user's app is never adopted.
    application = await _electron.launch({ executablePath: await electronPath(), args: [root], cwd: root, env, timeout: 45000,
      ...(!useScreencast ? { recordVideo: { dir: path.join(demo, '.runtime/context-video'), size: { width: 1600, height: 820 } } } : {}) });
    const page = await application.firstWindow();
    const contextStartedAt = Date.now();
    const contextVideo = !useScreencast ? page.video() : undefined;
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(1600, 820);
      window.webContents.setZoomFactor(1);
    });
    await page.setViewportSize({ width: 1600, height: 820 });
    // Remain inside the recorded viewport on hosts with Windows display scaling.
    // Center the native dialog after Tailwind's reset removes its UA margin.
    await page.addStyleTag({ content: 'dialog.share-confirmation{margin:auto} ::-webkit-scrollbar{width:6px;height:6px}' });
    // Video-only editorial hover and pointer treatment in the isolated demo.
    await page.addStyleTag({ content: 'button:hover{box-shadow:0 0 0 2px #91e7c380,0 0 22px #91e7c335!important} .button:hover{transform:translateY(-1px) scale(1.025)}' });
    await page.evaluate(() => {
      const cursor = document.createElement('div');
      cursor.innerHTML = '<svg width="32" height="38" viewBox="0 0 32 38"><path d="M3 2 L3 29 L10 22 L16 35 L22 32 L16 19 L27 18 Z" fill="#c2ffdc" stroke="#111d26" stroke-width="2"/></svg>';
      cursor.style.cssText='position:fixed;left:-100px;top:-100px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 2px 5px #0008)';
      document.body.append(cursor);
      document.addEventListener('pointermove', (event) => {
        const parent = document.querySelector('dialog[open]') || document.body;
        if (cursor.parentElement !== parent) parent.append(cursor);
        cursor.style.left = `${event.clientX}px`;cursor.style.top = `${event.clientY}px`;
      });
      document.addEventListener('pointerdown', (event) => {
        const ripple = document.createElement('div');
        ripple.style.cssText=`position:fixed;left:${event.clientX-20}px;top:${event.clientY-20}px;width:40px;height:40px;border:2px solid #9bf2c8;border-radius:50%;pointer-events:none;z-index:2147483646`;
        (document.querySelector('dialog[open]') || document.body).append(ripple);
        ripple.animate([{transform:'scale(.3)',opacity:1},{transform:'scale(2.4)',opacity:0}],{duration:550}).finished.then(()=>ripple.remove());
      });
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('heading', { name: 'Your projects.' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await application.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, fixture.projects);
    // Presentation redaction only. Main-process state, server readiness and logs stay authentic.
    await page.evaluate(({ actual, parent }) => {
      const scrub = () => {
        const replace = (text) => text.replaceAll(actual, 'C:\\Demo Projects').replaceAll(parent, 'C:\\Demo Session');
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const next = replace(node.textContent || '');
          if (next !== node.textContent) node.textContent = next;
        }
        for (const element of document.querySelectorAll('[title]')) {
          const next = replace(element.title);
          if (next !== element.title) element.title = next;
        }
      };
      scrub();
      const observer = new MutationObserver(scrub);
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title'] });
    }, { actual: fixture.projects, parent: root });
    const snapshot = async () => {
      const result = await page.evaluate(() => window.devManager.snapshot());
      assert(result.ok, result.error);
      for (const item of result.value.projects) if (item.localUrl) urls.add(item.localUrl);
      return result.value;
    };
    const row = (name) => page.locator('article').filter({ has: page.getByRole('button', { name: `View ${name}`, exact: true }) });
    let activeEvents, activeStartedAt;
    const click = async (locator) => {
      const box = await locator.boundingBox();
      if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 }); await delay(180); }
      if (activeEvents) activeEvents.push({ type: 'click', time: (Date.now() - activeStartedAt) / 1000 });
      await locator.click();
    };
    const privacyCheck = async () => {
      const text = await page.locator('body').innerText();
      assert(!/C:\\Users\\|RUN DEV WORKSPACE|session-[a-z0-9]|sk-[a-zA-Z0-9]{12}|Bearer\s+[a-zA-Z0-9]/i.test(text), 'Private content appeared in the capture.');
      assert.equal(await page.getByRole('alert').count(), 0, 'An application error is visible.');
      assert.deepEqual(errors, [], 'Renderer errors occurred.');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), 'Capture viewport overflows.');
    };
    const shouldCapture = (id) => !selected || selected === id;
    const capture = async (id, action) => {
      if (!shouldCapture(id)) { await action(); return; }
      await privacyCheck();
      const file = path.join(demo, 'recordings/raw', `${id}.webm`);
      const start = Date.now();
      activeStartedAt = start; activeEvents = [];
      if (useScreencast) {
        await page.screencast.start({ path: file, size: { width: 1600, height: 820 } });
        capturing = true;
      }
      await delay(650);
      await action();
      await privacyCheck();
      await page.screenshot({ path: path.join(demo, 'output/qa', `${id}-source.png`) });
      await delay(1800);
      if (useScreencast) { await page.screencast.stop(); capturing = false; }
      captures.push({ id, elapsedSeconds: (Date.now() - start) / 1000, startSeconds: (start - contextStartedAt) / 1000, recording: `recordings/raw/${id}.webm`, events: activeEvents });
      activeEvents = undefined;
      console.log(`Recorded ${id}.`);
    };
    await capture('01-discovery', async () => {
      await click(page.getByRole('button', { name: '+ Add folder', exact: true }));
      await until(async () => (await snapshot()).projects.length === names.length, 'fictional project discovery');
      assert.deepEqual((await snapshot()).projects.map((item) => item.name).sort(), names);
      await delay(2300);
    });
    const startProject = async (name) => {
      if ((await snapshot()).projects.find((item) => item.name === name)?.status === 'running') return;
      await click(row(name).getByRole('button', { name: 'Start', exact: true }));
      await until(async () => (await snapshot()).projects.find((item) => item.name === name)?.status === 'running', `${name} verified local server`);
      if (activeEvents) activeEvents.push({ type: 'ready', time: (Date.now() - activeStartedAt) / 1000 });
    };
    // Real Open actions, with OS browser launch intercepted to avoid touching user tabs.
    await application.evaluate(({ shell }) => { shell.openExternal = async () => {}; });
    const captureWebPreview = async (name, filename) => {
      const project = (await snapshot()).projects.find((item) => item.name === name);
      assert(project?.status === 'running' && project.localUrl);
      const browser = await chromium.launch();
      try {
        const preview = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await preview.goto(project.localUrl, { waitUntil: 'networkidle' });
        await preview.evaluate(() => document.fonts.ready);
        assert.equal(await preview.title(), `${name} · Demo`);
        await preview.screenshot({ path: path.join(demo, 'public/assets', filename) });
      } finally { await browser.close(); }
    };
    await capture('02-start', async () => {
      await startProject('atlas-dashboard');
      await click(row('atlas-dashboard').getByRole('button', {name:'Open ↗',exact:true}));
      await captureWebPreview('atlas-dashboard', 'demo-npm.png');
      await delay(1500);
    });
    await capture('07-html', async () => {
      await startProject('canvas-studio');
      await click(row('canvas-studio').getByRole('button', {name:'Open ↗',exact:true}));
      await captureWebPreview('canvas-studio', 'demo-html.png');
      await delay(1800);
    });
    await capture('03-logs', async () => {
      await click(row('atlas-dashboard').getByRole('button', { name: 'View logs for atlas-dashboard', exact: true }));
      await page.getByLabel('Project logs', { exact: true }).getByText(/^Ready · http:\/\/127\.0\.0\.1:\d+ · HTTP 200$/).waitFor();
      await page.getByLabel('Project logs', { exact: true }).scrollIntoViewIfNeeded();
      await delay(3500);
    });
    await page.getByRole('button', { name: 'Close project details', exact: true }).click();
    await startProject('beacon-api');
    await startProject('canvas-studio');
    await capture('04-focus', async () => {
      const search = page.getByRole('textbox', { name: 'Search projects' });
      await click(search);
      await search.pressSequentially('canvas', { delay: 125 });
      if (activeEvents) activeEvents.push({ type: 'typing', time: (Date.now() - activeStartedAt) / 1000 - .7 });
      await page.getByRole('button', { name: 'View canvas-studio', exact: true }).waitFor();
      assert.equal(await page.locator('article.project-row').count(), 1);
      await delay(1600);
      await search.fill('');
      await click(page.getByRole('button', { name: /^Active/ }));
      await until(async () => await page.locator('article.project-row').count() === 3, 'three active projects');
      await delay(1600);
    });
    await page.getByRole('button', { name: /^All projects/ }).click();
    await capture('05-preview', async () => {
      await click(row('atlas-dashboard').getByRole('button', { name: 'Share Online', exact: true }));
      const confirm = page.getByRole('button', { name: 'Start sharing', exact: true });
      await until(async () => await confirm.isEnabled(), 'sharing compatibility confirmation');
      await delay(4200);
    });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await capture('06-theme', async () => {
      await click(page.getByRole('switch', { name: 'Dark mode' }));
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await delay(4200);
    });
    if (shouldCapture('06-theme')) await copyFile(path.join(demo, 'output/qa/06-theme-source.png'), path.join(demo, 'public/assets/hero-dashboard.png'));
    const state = await snapshot();
    assert(state.projects.every((item) => item.sharing.status === 'disabled'), 'A public tunnel was unexpectedly started.');
    assert.equal(state.projects.filter((item) => item.status === 'running').length, 3);
    for (const url of urls) { const response = await fetch(url); assert(response.ok); await response.body?.cancel(); }
    const contextEndedAt = Date.now();
    await application.close(); application = undefined;
    if (contextVideo) {
      const fullVideo = await contextVideo.path();
      const metadata = await probe(fullVideo);
      const offset = Math.max(0, Number(metadata.format.duration) - (contextEndedAt - contextStartedAt) / 1000);
      for (const capture of captures) {
        await run(await findTool('ffmpeg'), ['-y', '-ss', String(offset + capture.startSeconds), '-i', fullVideo, '-t', String(capture.elapsedSeconds), '-an', '-c:v', 'libvpx-vp9', '-crf', '18', '-b:v', '0', path.join(demo, capture.recording)]);
      }
      await rm(fullVideo, { force: true });
    }
    for (const url of urls) await until(async () => {
      try { const response = await fetch(url, { signal: AbortSignal.timeout(500) }); await response.body?.cancel(); return false; }
      catch { return true; }
    }, 'normal quit server cleanup');
    await writeFile(path.join(demo, 'output', selected ? `recording-${selected}.json` : 'recording-report.json'), JSON.stringify({
      capturedAt: new Date().toISOString(), renderer: 'real Electron / compiled ldm://manager', fictionalProjects: names,
      realLocalServers: ['atlas-dashboard (Vite)', 'beacon-api (Node)', 'canvas-studio (Static HTML)'],
      isolatedUserData: true, normalUserCatalogRead: false, publicTunnelsStarted: false, normalQuitCleanupVerified: true,
      presentation: 'Paths redacted to C:\\Demo Projects; genuine state, logs, IPC and Windows ownership verification.', captures,
    }, null, 2) + '\n');
  } finally {
    if (application) {
      if (capturing) await application.firstWindow().then((page) => page.screencast.stop()).catch(() => {});
      await application.close();
    }
    const relative = path.relative(path.join(root, '.test-artifacts'), fixture.directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe fixture cleanup target.');
    await rm(fixture.directory, { recursive: true, force: true });
  }
}
if (process.argv[1]?.endsWith('record.mjs')) {
  const selected = process.argv.find((arg) => arg.startsWith('--scene='))?.split('=')[1];
  await record(selected);
}
