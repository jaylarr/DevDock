# DevDock montage

A repeatable **60-second advertising cut, LOCALHOST: LEVEL UP**, showing the actual Electron app. Named output: **`project-demo/output/project-montage-level-up.mp4`**, H.264/AAC, 1920 × 1080, 30 FPS, with burned-in sentence subtitles. The capture source is about 25 FPS, so rendering 60 FPS would primarily duplicate frames.

Rendering also writes `output/project-montage.mp4` and `output/project-montage-marketing.mp4` as copies of the current cut. The earlier marketing video and SRT are preserved at `output/project-montage-marketing-r3.*`. Earlier source is snapshotted under `archives/revision-3/` for reference. The earlier narrated revision remains at `output/project-montage-narrated.mp4` when present.

The new cut adds a playful terminal/port hook, kinetic title, actual npm/HTML local-page screenshots, mint cursor and click ripples, captured hover styling, a seven-part progress rail, benefit layouts, and a new 112 BPM original electronic score with synthesized sound effects. The creative brief is [creative-ad-script.md](../docs/showcase/creative-ad-script.md). Motion/hover treatments are editorial presentation, not changes to the application's product UI. Browser Open actions are intercepted during capture, and the actual served fixture pages are captured in isolated headless Chromium; the user's ordinary browser is not opened.

## Regenerate

From the application repository:

```powershell
npm.cmd ci --prefix project-demo
npm.cmd run montage
```

The application's existing dependencies, Playwright Chromium, Electron runtime, Node 24+ and FFmpeg/FFprobe must already be available. No tool is silently installed by the pipeline. The Remotion versions are pinned together in this folder's lockfile. All dependencies are isolated here except the existing application Playwright and TypeScript toolchains.

The full command verifies prerequisites, builds the app, starts a dedicated Electron session, waits for the real preload/UI, generates fictional fixtures, records seven scenes, closes the app and verifies server cleanup, processes clips, generates narration/music/subtitles, renders Remotion, then checks audio/video properties and fully decodes the result. It creates no extra Vite development server: the actual compiled app uses `ldm://manager/index.html`. Existing user sessions/catalogs are neither adopted nor read. The recorded Vite/Node/static servers belong only to disposable fixtures.

## Partial commands

```powershell
npm.cmd run montage:record
npm.cmd run montage:record -- --scene=03-logs
npm.cmd run montage:process
npm.cmd run montage:process -- --scene=03-logs
npm.cmd run montage:audio
npm.cmd run montage:render
npm.cmd run montage:finalize
npm.cmd run montage:qa
npm.cmd run montage:check
npm.cmd run montage:clean
```

Recording one scene reconstructs its prerequisite app state without overwriting other scene files. Run processing for that scene and then render/QA. The record command expects a current application build; run `npm.cmd run build` first after changing the application. Partial render needs all seven processed clips and generated audio/captions. Clean deletes generated captures, clips, audio, reports, video and temporary bundle; it preserves source, dependencies and the cached voice model.

The same pipeline can be run inside this folder using `npm.cmd run montage`. `node project-demo/scripts/inspect-app.mjs` checks the isolated renderer viewport and saves an inspection screenshot.

## Architecture

- `storyboard/storyboard.md`: product evidence, scene selection and timing.
- `storyboard/scenes.json`: shared scene IDs, durations and captions.
- `scripts/fixtures.mjs`: generated fictional Vite, Node and static projects under the app's existing `.test-artifacts` boundary; dedicated user data.
- `scripts/record.mjs`: semantic Playwright interactions against real Electron. Only the native folder-picker result is stubbed. Uses `page.screencast` when available; older versions use Electron context video and split the saved recording into separate scene files.
- `scripts/process.mjs`: FFmpeg normalizes source dimensions/frame rate, accelerates only clips longer than their editorial slot and holds the last frame when shorter. High-quality source clips use CRF 16.
- `storyboard/narration.json` / `narration-script.md`: editable spoken script and segment timing.
- `scripts/audio.mjs`: local Kokoro neural speech, measured sentence timing, balanced captions and an original 112 BPM backing track ducked under speech. Exports a mixed WAV, SRT and audio report.
- `src/Root.tsx` / `ProjectMontage.tsx`: one 60-second Remotion composition with synchronized subtitles outside the application. `components/LevelUp.tsx` provides the new hook, title, background, real-footage layouts, browser-preview cards and closing identity. Footage shrinks for short benefit moments; actual local-page screenshots move forward for the npm/HTML previews. The earlier motion components remain as source references.
- `scripts/render.mjs`: Remotion bundler/renderer APIs, existing Playwright Chromium, H.264 CRF 18, 30 FPS, 2 render workers. `finalize.mjs` normalizes full-range output to delivery-compatible limited-range `yuv420p` with FFmpeg CRF 17 and fast-start metadata when necessary; it is included in rendering and can also repair an existing render independently.
- `scripts/qa.mjs`: video/audio stream assertions, audible audio with headroom, subtitle timing/line checks, complete FFmpeg decode, final PNGs and contact sheet. `scripts/preview.mjs` renders representative stills before a full render.

`recordings/raw/` contains separately recorded WebM clips. `public/recordings/` contains processed MP4s. `output/` contains the final video and evidence reports. Generated media, private fixture state and render bundles are ignored by Git. Source, storyboard and lockfile are reusable deliverables.

## Evidence and presentation

The app's discovery, IPC, process startup, Windows listener ownership, real local HTTP availability, logs, filtering and appearance are exercised. Fictional paths are displayed as `C:\Demo Projects`; no status, metric, runtime result or log is fabricated. Capture-only styles center the confirmation dialog and reduce scrollbar width. No production database, account, credential, AI or analytics feature is involved. Sharing shows the compatibility/access confirmation and cancels it; **no public tunnel is started**. The scene labels make this boundary visible.

The native app capture is 1600 × 820 and occupies most of the frame during demonstrations. Explicit viewport emulation prevents Windows DPI/zoom clipping. Opening terminal cards, chapter icons and benefit headlines are editorial motion graphics. Narration uses a generic synthetic English voice (`af_heart`), not a real person's recording. The quiet backing music and transition accents are generated from original procedural compositions; no third-party recording is used. An external subtitle file is also exported at `output/project-montage.srt`.

Edit `storyboard/narration.json`, then run audio/render/QA. Set `MONTAGE_VOICE` to a supported Kokoro voice to change the speaker. The first audio run downloads the roughly 92 MB q8 voice model from Hugging Face; subsequent runs reuse `.cache/tts-model` and sentence clips. Vite is spoken as “veet” while the subtitles preserve its spelling. The audio generator rejects scripts that require excessive acceleration. Captions are sentence timed, not word-by-word karaoke. FFmpeg delivery normalization preserves the AAC soundtrack.

## Troubleshooting and review

- **FFmpeg missing on PATH:** the script checks existing Winget package locations. Set `MONTAGE_FFMPEG` and `MONTAGE_FFPROBE` to the installed executables if needed; it does not reinstall them.
- **Chromium/Electron unavailable:** use the existing documented project setup to repair the missing runtime. Verification fails early rather than downloading replacements.
- **Permission failures in esbuild, CIM or process cleanup:** use a policy-permitted normal Windows terminal. Server verification remains enabled; a sandbox can block required native process queries.
- **Share Online disabled:** run the app's existing `npm.cmd run setup:sharing` if the optional pinned runtime is absent. This download is separate from montage generation and starts no tunnel.
- **Capture locator failed after a UI change:** update semantic locators in `record.mjs` and inspect `output/qa/*-source.png`; do not disable readiness or privacy assertions.
- **Render timeout/missing clip:** run record/process, confirm all scene MP4s exist, and retry. Keep render concurrency low on machines with limited memory.

After generating, inspect `output/qa/contact-sheet.jpg` and representative final/source PNGs, then watch the MP4 for timing and cursor behavior. Automated decode checks do not replace visual review. Reports distinguish real local-server evidence from the unstarted public-preview flow. Future regenerations always need a fresh visual review.

Implementation APIs: [Playwright Screencast](https://playwright.dev/docs/api/class-screencast), [Electron automation](https://playwright.dev/docs/api/class-electron), [Remotion rendering](https://www.remotion.dev/docs/renderer/render-media), [Kokoro.js](https://github.com/hexgrad/kokoro/blob/main/kokoro.js/README.md), [Vite pronunciation](https://vite.dev/guide/).
