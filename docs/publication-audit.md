# Publication and portability audit

Audited 2026-10-02 (Asia/Taipei), working-tree version 0.3.0. Scope: the current source tree, supporting scripts, tests, dependency manifest/lockfile, documentation, and publication assets. This is a source review plus current Windows validation, not certification of every device or project.

**Status update, 2026-10-05:** [Public main at `448f27c`](https://github.com/jaylarr/DevDock/tree/448f27cdb16f9d483fd1fc43dc7cfa7c7441f56e) includes the Next.js preview bridge, improved Windows ownership queries, and generic fresh-install defaults. The earlier finding that sharing fixes were unpublished no longer applies. The original audit and test counts below are historical. Fresh-machine acceptance, independent visitor-network acceptance, live-test reproducibility, packaging, and the project-license decision remain outstanding. See the current [README limitations](../README.md#limitations-and-roadmap) and [sharing requirements](public-sharing.md#requirements-and-remaining-limitations).

## Verdict

**Suitable to present as a Windows development preview, with explicit limits. Not compatible with macOS/Linux as a complete project manager. Public repository preparation still has follow-ups.**

A README and setup/usage documentation already existed. The previous README was substantial but started with a machine-specific exclusion and relied on dependencies/runtimes already prepared in the author's workspace. The revised [README](../README.md) is organized for new users: purpose, platform matrix, prerequisites, installation, first use, project formats, sharing, data/security, troubleshooting, maintenance, developer checks, and license status.

No production application behavior was changed by this audit. The deliverables are documentation, post drafts, four fictional-project screenshots, and a reproducible capture script. Existing uncommitted implementation work was preserved. No Git commit, remote push, tag, installer, repository publication, social post, or new public tunnel was created.

## Findings requiring attention

### 1. macOS/Linux cannot verify project readiness — high priority if advertised as cross-platform

Evidence: `src/main/services/processOwnership.ts:25–42`, especially the non-Windows return at line 27; `src/main/services/processManager.ts:118–144` requires ownership before setting Running.

The renderer/build and several filesystem helpers are portable in shape, and non-Windows process-group cleanup exists, but ownership verification returns false on every non-Windows platform. A process can start and serve traffic while remaining Unverified. The ordinary Open and Share controls require Running. This affects static HTML as well as npm projects.

Sharing also requires Windows x64 in `scripts/setup-sharing.mjs:8` and `src/main/tunnels/CloudflareQuickTunnelProvider.ts:52–56`; its executable name and cleanup call are Windows-specific. `NativePortProvider`'s standard Windows npm-layout assumptions need fresh-platform tests too.

Action: advertise **native Windows x64 preview** now. Before adding support, implement and test OS-specific listener ownership, process ancestry/group cleanup, Node/npm resolution, and cloudflared platform/architecture pins; review renderer path handling and macOS window lifecycle. Run real start/stop/restart/quit and sharing tests on each supported architecture. A platform switch or Electron package alone is insufficient.

### 2. Personal installation data in application defaults — resolved locally 2026-10-03

The original audit found a personal absolute exclusion in source defaults and a test expecting it. Settings implementation removes that source default: fresh installations and legacy records without exclusions now start with an empty list. Explicit saved exclusions are preserved, including those intentionally configured on an existing installation.

Evidence: `src/main/services/persistence.ts` defines generic v3 defaults; `tests/state.test.ts` verifies empty legacy defaults; `tests/settings.test.ts` and `scripts/settings-smoke.mjs` verify existing exclusion preservation and migration backups. Settings uses isolated fictional catalogs for desktop acceptance. This local resolution does not establish public repository/history cleanup or fresh-machine acceptance.

### 3. No project license or release destination — publication decision pending

No root LICENSE, NOTICE, SECURITY, CONTRIBUTING, or `.github` configuration was present in the inspected working tree. The source manifest has `private: true` and no license field. Git has no configured remote in this checkout.

Action: choose and document source reuse terms before inviting others to reuse/contribute, add the selected license and maintainer/repository links, and choose a private vulnerability-reporting channel. Do not describe this preview as licensed open source yet. `private: true` prevents npm publication; it does not prevent publishing a source repository. Do not remove it merely to publish on GitHub.

For future binary distribution, preserve applicable Electron and cloudflared license/notices and validate resource paths. No installer/signing/packaging configuration is present, so the current distribution story is build-from-source.

### 4. Live sharing test depends on the author's saved catalog — medium priority

Evidence: `scripts/sharing-smoke.mjs:42–54` reads `%APPDATA%/Local Dev Manager/state.json`, locates an existing Next project's installed dependencies, and makes a Windows junction. `scripts/inspect-sharing.mjs:10–17` also reads the normal catalog and emits project names in a local report.

A clean checkout with no saved catalog or Next runtime cannot reproduce the live sharing test. The generated fixture serves its own source, but dependency discovery still depends on personal installation state.

Action: give the test a dedicated pinned fixture dependency setup or an explicit fixture-runtime argument; honor isolated test state and remove the normal-catalog dependency. Treat inspection reports as private machine-local output. The sharing guide's author-catalog statistics and already-prepared-runtime assumption were replaced with newcomer setup and privacy guidance; exclude raw `.test-artifacts/` reports and unrelated workspace files from public assets.

This audit did not run either catalog inspection or live sharing. The new screenshot script is independent of normal user data and reuses only this manager's installed Vite library.

### 5. Local Running status is startup evidence, not ongoing health — medium priority

Evidence: `src/main/services/processManager.ts:118–144` clears the readiness timer when Running. Later parent-process exit clears readiness, but a server child can stop responding while its wrapper process remains alive. Local readiness also accepts *some* owned listener on a port; sharing rechecks *exclusive* ownership across all listeners.

Action: document the current status boundary (now done). Consider ongoing local HTTP/ownership checks and address-specific verification before claiming continuous health or complete isolation from unrelated listeners. Sharing already applies the stronger check periodically. A successful HTTP response, including an application's error/redirect response, is not a functional application test.

### 6. Sharing dialog placement needs polish — low priority

The actual 04 screenshot shows the confirmation at the top-left rather than centered. Tailwind's reset and the dialog's current styling leave no explicit centering rule in `src/renderer/styles.css`; the discovery overlay does have its own placement.

Action: center the native dialog explicitly and verify keyboard focus, dismissal, and small-window behavior. The screenshot records current behavior; no styling was changed solely to make a publication image look better.

## Reviewed architecture and safeguards

| Area | Observation / practical limit |
| --- | --- |
| Main/preload/renderer | Sandboxed Electron renderer, context isolation, Node integration off, denied permissions/window navigation, local assets, typed narrow bridge, sender/frame/ID validation. These protect the manager UI; project scripts still run with normal user permissions. |
| Discovery | Read-only scanning, cancellation, deduplicated real paths, generated-directory skips, directory-link skips, ownership-aware HTML fallback, bounded directory traversal and retained inaccessible cached entries. Scan limits favor narrower roots. |
| Launch | Existing npm dev scripts only; no dependency installer or source rewrite. Simple Vite/Next arguments are temporary. Custom scripts may ignore ports/bindings. pnpm/Yarn/Bun are detected but unavailable for execution. |
| Cleanup | Owned tree stop with observed exit, normal quit cleanup, retryable failure states. No Windows job object; abrupt exits, power loss and independent descendants remain limits. |
| Static helper | Loopback binding, GET/HEAD only, MIME/path/config filtering, directory-listing refusal, symlink and file-identity checks. Allowed ordinary assets such as JSON/text/PDF can still contain private material chosen by the project author. |
| State | Validated v2 JSON, atomic writes/backups and v1 migration backup. Absolute paths/metadata are plaintext; no running sessions are restored. Source archives must exclude user state. |
| Logs | Bounded text buffers with terminal-control stripping; no HTML interpretation. Output/clipboard can still contain project secrets and links. |
| Sharing | Explicit user action, pinned/checksum-verified provider, isolated provider config, temporary links, guarded copy/open, lifecycle cancellation and periodic exclusive listener checks. No visitor access control is added by this application. |
| Dependencies | Exact direct versions and lockfile; current npm audit reports zero known vulnerabilities. This is time-specific and does not prove absence of unknown issues or binary-level advisories. |
| Governance | No CI or release packaging found. Historical plans/release drafts contain future ideas and must not be treated as implemented capabilities. |

A pattern scan of the non-generated source/docs found no matching private-key blocks, common OpenAI/GitHub/Google token patterns, or JWT-like strings. This is a narrow working-tree check, not full secret detection or a history audit. The personal default was a confirmed privacy issue at audit time and has since been removed from current source; repository-history review remains separate. Full Git-history review, release-archive inspection, dependency/binary notices, and fresh-machine setup remain release tasks.

## Current verification

Host tooling: native Windows x64, Node 24.18.0, npm 11.16.0, Electron 44.5.1. Version 0.3.0 agrees between the manifest, lockfile, and UI.

| Check performed in this audit | Result |
| --- | --- |
| Typecheck | Passed |
| ESLint | Passed, including the new capture script |
| Existing Vitest suite | 90 tests passed across 5 files with Windows process access available |
| Production build | Passed |
| Compiled Electron smoke | Passed |
| Development Electron smoke | Passed |
| npm audit | 0 known vulnerabilities, including dev dependencies |
| Fictional showcase capture | Passed; six demo entries, three real servers, no user catalog read |
| Screenshot privacy/layout check | Visible text checked, all four images visually reviewed |
| Showcase normal quit | All three local fixture URLs closed; fixtures removed |
| Public traffic during this audit | None; sharing confirmation cancelled |

The first sandboxed run had 24 failures and a denied esbuild parent-directory read. A direct PowerShell/CIM check returned Access denied, and sandbox restrictions also prevented some lifecycle assertions/cleanup. The suite and build passed when rerun outside that restricted context. This is not a requirement to run ordinary installations as administrator: normal user permissions must permit the Windows process APIs. No ownership safeguard was disabled.

Earlier `docs/public-sharing.md` and `.test-artifacts/public-sharing-evidence.json` record controlled generated HTML/Vite/Next tunnel traffic. Those historical results were not rerun here. Independent visitor-network acceptance remains pending. This audit does not establish macOS/Linux support, all Windows versions, ARM, fresh-install downloads, proxy/firewall configurations, sleep/resume, power loss, or every managed application's auth/API correctness.

## Publication checklist

- [x] Generalize the machine-specific default exclusion and its tests (local Settings implementation, 2026-10-03).
- [ ] Choose a project license/reuse policy; add repository, maintainer and reporting links.
- [ ] Commit the complete reviewed implementation: several v0.3.0 runtime files are currently untracked. Publishing only the existing HEAD would omit current functionality.
- [ ] Review the complete source/history for private data and inspect the exact release archive.
- [ ] Verify `npm ci`, runtime setup, build and first use on a clean Windows x64 machine.
- [ ] Make the live-sharing test independently reproducible before advertising it as a contributor check.
- [ ] Run a separately approved generated preview from an independent visitor network if claiming external end-to-end acceptance.
- [ ] Validate binary packaging/notices/signing separately if offering an installer.
- [x] Expand the README for first-time users and state the Windows/support limits.
- [x] Prepare Facebook/LinkedIn drafts using current capability claims.
- [x] Create and review four screenshots with fictional projects and generic displayed paths.

For a project-introduction post now, use the prepared drafts' wording: **preparing for public release**, **Windows source-build preview**, **fictional demo screenshots**. Insert a repository link only after the reviewed repository is actually published.

## Reference material

The app-specific findings come from the inspected local code. Platform availability in a framework does not establish availability in an app: [Electron platform README](https://github.com/electron/electron#platform-support). Its [security guidance](https://www.electronjs.org/docs/latest/tutorial/security) provides the renderer/IPC baseline. [Cloudflare Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) describes temporary links and provider limits, and [Node downloads](https://nodejs.org/en/download) supplies the prerequisite installer. Provider pages were checked during this audit; limits and release advice can change.
