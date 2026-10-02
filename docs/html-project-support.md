# HTML project support — local v0.2.0 evidence

Date: 2026-10-02 (Asia/Taipei).

Status: implemented locally following the user's **“Proceed!”**. The release remains a local draft; no commit, tag, GitHub release, public server, or installer was created. Pre-existing changes for exclusions, pagination, inline details, and IPv6 ownership verification were retained.

## Result

The scanner discovers standalone HTML/HTM websites and the existing package-script applications. It resolves application ownership before static candidates, so Vite/React/Next.js/Node HTML files do not create an additional static launch. Application evidence blocks fallback even when a dev script is missing or its package manager is unsupported. A package containing formatting/lint tools alone can still be a static website; ordinary client-side `app.js` is supported.

Each static project has one canonical ID and one selected entry file. Index pages are preferred, otherwise selection is deterministic and shown in details. Descendant pages share the same server. Explicit nested static roots remain separate entries, but overlapping static/static or static/script entries cannot run together. Script-only monorepo behavior remains as before; the manager does not analyze arbitrary script commands to deduplicate independently declared application launch targets.

Automatic static discovery skips docs/documentation/examples/public/assets subtrees and the existing generated-folder exclusions. An explicit standalone docs/example root can be discovered, but selecting an application's public folder alone still checks parent application evidence. Generated-directory boundaries separate intentionally selected exports/fixtures from parent application ownership. Invalid/ambiguous packages and unverifiable ancestry produce scan notes.

## Runtime and saved state

- A bundled trusted helper uses installed Node.js 24+, binds only to `127.0.0.1`, and obtains an actual free port by listening on port 0. A private child IPC message reports that port; HTTP and Windows listener ownership are still checked before Running.
- The helper serves HTML, CSS, browser JavaScript, images, fonts, and common web assets. It supports GET/HEAD, ordinary relative links, queries, nested index pages, 404/405 responses, and directory-slash redirects. Open preserves the selected entry-page path.
- Hidden/package/tool-configuration/credential paths, unknown asset types, traversal, malformed paths, symlink/junction paths, and non-loopback Host headers are rejected. Requests recheck application boundaries and opened-file identity. This is focused protection for local serving, not an OS sandbox or comprehensive security audit.
- The existing bounded logs and managed lifecycle apply to both modes. Static Stop uses graceful child IPC before the owned-process fallback; parent IPC disconnection also closes its server. Start reserves pending ownership before revalidation, preventing duplicate or overlapping launches and root removal during validation.
- Rescans preserve active launch metadata through a mode change and keep Stop available. Inactive static entries superseded by application ownership are removed. Current ownership is rechecked before launching stale cached records.
- State schema v2 distinguishes script metadata from static entry filenames. Version-1 state migrates without seeding roots or starting servers. Roots, theme, exclusions, and recovery behavior are preserved. `state.json.v1.bak` retains the first valid available v1 primary/recovery state outside the rotating backup for manual rollback. Runtime facts remain transient.

No new dependency was added. The helper is included in `scripts/build-main.mjs`; the UI keeps the existing row/details layout and uses launch capability instead of requiring npm for every Start button.

## Validation

| Check | Result |
| --- | --- |
| `npm.cmd run typecheck` | Passed, also executed by the final build |
| `npm.cmd run lint` | Passed |
| `npm.cmd test -- --reporter=dot` | 63 tests passed across 4 files; 30 are HTML-feature tests |
| `npm.cmd run build` | Passed; static helper, main, preload, renderer built |
| `npm.cmd run test:desktop` | Passed against the final compiled v0.2.0 code |
| `npm.cmd run test:desktop:dev` | Passed against the final v0.2.0 build using the loopback Vite development interface |
| Version metadata / `git diff --check` | package.json and both lockfile version fields match 0.2.0; no whitespace errors |

HTML fixtures cover pure HTML, client assets, upper-case extensions, non-index entries, multiple pages, formatter-only manifests, app precedence, unsupported managers, invalid manifests/configs, explicit/overlapping roots, generated/documentation/excluded folders, cancellation, parent ownership, v1 migration/recovery, unsafe persisted entries, stale caches, pending-start guards, and active reclassification. Real HTTP/process tests cover MIME types, HEAD, redirects, blocked requests, symlink escapes, newly added application files, concurrent sibling ports, Stop/restart, and quit cleanup.

Electron automation uses 24 isolated projects through real IPC/scanning/persistence and managed child processes. It checks the existing pagination, exclusion, layout, theme, npm startup/restart, and offline renderer behavior, plus Static HTML labels/details, non-index URLs, the Open IPC target, Stop/start, normal quit, and stopped state after relaunch. The folder picker response and external browser-launch function are stubbed; no real user project or browser session is launched by these checks.

Screenshots: `.test-artifacts/desktop-html.png` and `.test-artifacts/dev-html.png`, plus the existing light/dark/small-window captures. The compiled HTML details screenshot was visually reviewed. Renderer network emulation does not prove a physically disconnected computer or offline assets inside arbitrary websites.

## Verification incidents and limits

The initial sandboxed process tests could not reliably verify/terminate Windows child trees; the local build also needed access outside the restrictive filesystem sandbox. These checks were rerun with normal Windows access. Leftover fixture listeners were identified by PID/time/command and exact fixture response before cleanup. Automatic approval initially rejected broad tree cleanup; the remaining four workers were stopped after explicit user approval. Their fixture directories were then removed with validated paths inside `.test-artifacts`.

A test-helper path error was fixed before the successful runtime suite. Development-mode smoke runs encountered page closure/navigation interruptions. The HTML extension had restored renderer networking mid-test, allowing Vite reconnection to reload the page; the final smoke keeps the renderer offline through HTML controls and passed. A suite run also had one existing npm-readiness timeout during concurrent build/lint activity; the final full suite passed on rerun. These incidents are not omitted from the evidence.

Static sites refresh manually. PHP/backend execution, arbitrary file extensions, automatic SPA fallback, directory listing, live reload, package-manager expansion, public sharing, packaging, and abnormal-exit OS job-object guarantees are outside this feature. No actual Next.js application launch was added to the test evidence; its discovery precedence is tested with manifests/configuration fixtures.

To review locally, rebuild/restart the manager, add or rescan a folder containing a standalone website, and use its existing controls. Git commits and GitHub release creation/publication remain the user's later steps.
