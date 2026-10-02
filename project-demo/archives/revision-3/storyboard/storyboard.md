# Local Dev Manager — a calmer development workspace

50 seconds, 1920 × 1080, 30 FPS. The UI capture source is approximately 25 FPS. Dark navy framing with mint/violet accents, kinetic Segoe UI typography, floating perspective cards, animated orbit/grid backgrounds, chapter markers and focused camera movement. Generic synthetic English narration, sentence subtitles, quiet original music and synthesized motion accents. The exact spoken copy is in `narration-script.md` and the generator reads `narration.json`.

| Time | Moment | Visible evidence |
| --- | --- | --- |
| 00–04 | Still juggling terminals? Meet Local Dev Manager. | Animated illustrative terminal cards, then product identity |
| 04–11 | One folder. Your whole workspace. | Add a fictional folder; six projects appear through real discovery |
| 11–19 | Pick. Start. Build. | Start an actual Vite fixture; wait for HTTP and Windows ownership verification |
| 19–26 | See exactly what's happening. | Open real process output and runtime details |
| 26–32 | Find it. Focus on it. | Search a static HTML project, then filter active servers |
| 32–39 | Your project. Your choice. | Open compatibility/access confirmation, then cancel; no public tunnel |
| 39–46 | A calmer development day. | Switch to dark mode with three real local servers |
| 46–50 | Less terminal juggling. More building. | Local Dev Manager; Windows source-build preview |

## Repository inspection

The product is an Electron desktop application, not a standalone website. The renderer requires its secure preload bridge and validated main-frame IPC. Capture therefore uses Playwright's Electron API with the compiled `ldm://manager/index.html` UI, not a mocked browser page or a redundant Vite server. Dedicated user data prevents touching the ordinary catalog. The native picker response is stubbed to select generated fixtures; scanning, process management, logs, theme and search remain real.

Reviewed README, package scripts, architecture, main/preload IPC, renderer/store/styles, scanner, process lifecycle and existing showcase/test patterns. No AI, hosted database, analytics dashboard, or automation service is present; these are deliberately not claimed. Sharing is demonstrated only through its implemented confirmation UI. Fixture paths are presentation-redacted to `C:\Demo Projects`; no status or log result is fabricated.

## Recording plan

Separate scenes use semantic locators and readiness assertions. Each is independently replayable by reconstructing its required state. Source timing is normalized to the scene duration; long verification waits are accelerated in the startup scene. The final second is held when needed. The application occupies most of the frame, with a compact editorial header outside its viewport. QA extracts frames from each scene and all transitions, checks stream properties, and runs a full decode.

## Marketing motion design — revision 3

The approved narration and 50-second timing are preserved. Terminal illustrations enter with staggered springs and perspective tilt, float, then converge before the product identity. Discovery/start/logs icons enter beneath the title. A six-icon rail tracks the demonstration chapters, and the lower line shows total chapter progress. Subtitles remain outside the application throughout.

The final 1.33 seconds of each feature scene introduces a concise benefit headline as the footage shrinks to 68% and moves right: One workspace / Ready. Set. Build. / Full visibility / Find your focus / Share deliberately / Make it yours. Full-size demonstrations precede these editorial summaries. The sharing confirmation boundary stays visible. The closing card emphasizes More building with staggered technology chips and the source-build preview label.

Motion accents are quiet synthesized sweeps in the backing score, timed to the title convergence, chapter entrances and benefit transitions. No downloaded sound effects, stock footage or production UI changes are involved. Still previews and final QA include the benefit layouts and opening convergence as well as ordinary demonstration frames.
