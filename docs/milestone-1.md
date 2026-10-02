# Milestone 1 — local vertical slice

Date: 2026-10-02 (Asia/Taipei).

This document retains milestone-1 evidence. Current v0.2.0 HTML support and validation are documented in [HTML project support](html-project-support.md).

Development was authorized by the user's explicit “Okay, proceed.” after reviewing the revised plan. This milestone is implemented locally and awaiting review before expansion. Nothing was deployed, published, or exposed on the public internet. No existing user project was started or modified.

## Implemented

- Electron/React/TypeScript/Vite foundation with pinned dependencies and explicit Electron runtime setup.
- Sandbox/context isolation, narrow typed IPC, main-frame/ID validation, restricted resources, local protocol, and navigation/permission denial.
- Native folder-picker integration, root registration/removal, duplicate detection, local persistence, backup recovery, background scans, cancellation, and diagnostics.
- Nested project discovery, framework/package-manager metadata, workspace manager inheritance, stable path IDs/slugs, and retained missing entries.
- npm start/stop/restart, live bounded logs, owned HTTP readiness, failure/crash/unverified states, standard Vite/Next temporary launch arguments, and Windows process-tree cleanup.
- Compact dashboard, status/root filters, search, theme persistence, details/log view, browser/folder actions, and log copy/clear.
- Review refinements: viewport-contained scrolling project list, pagination with 5/10/20 projects per page, and expandable inline project details with full URL, folder, command, runtime information, restart/folder controls, and logs. Changing filters/search/page size returns to the first page; changing pages closes the expanded row.

## Evidence

- TypeScript check, ESLint, and production renderer/main/preload build passed.
- Backend tests cover discovery, metadata, persistence/log limits, live npm/Vite startup, Unicode output, duplicate prevention, restart, startup failure, late readiness, unrelated port ownership, nested child cleanup, and simultaneous servers.
- Readiness regression checks cover IPv6 Vite listeners through both `npm --prefix` and `npm --workspace` wrappers, port-conflict fallback, and rejection of unrelated IPv4/IPv6 endpoints. The corrected listener check also confirmed HTTP 200 and owned process ancestry for the user's already-running localhost servers on ports 5173 and 5174, without restarting them.
- Actual Electron smoke checks cover a stubbed folder-picker response through real IPC, process startup, logs, themes, restart, normal quit cleanup, root/theme persistence, runtime reset, and restricted renderer APIs.
- UI refinement checks use 23 isolated projects to verify page boundaries, search/page-size resets, row expansion/collapse, full URL visibility, and independent list scrolling with visible pagination at an 850 × 600 window size.
- Renderer networking was disabled and the compiled local interface reloaded before restarting the test project. No external HTTP UI resources were observed; this is network emulation, not a physically disconnected machine test.
- Screenshots were generated from the actual compiled Electron interface using an isolated test project. Fixture directories/user data were cleaned after tests.
- The dependency install audit reported zero vulnerabilities at setup time; that does not constitute a comprehensive security audit or a permanent vulnerability guarantee.

Final validation results on this Windows computer:

| Check | Result |
|---|---|
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run lint` | Passed |
| `npm.cmd test` | 33 tests passed across 3 files |
| `npm.cmd run build` | Passed; main, preload, and renderer compiled |
| `npm.cmd run test:desktop` | Passed, using the compiled local interface |
| `npm.cmd run test:desktop:dev` | Passed, using the loopback Vite development interface |

Tests used Node.js 24.18.0, Electron 44.5.1, Vite 8.3.2, React 19.3.0, TypeScript 6.0.3, and Vitest 5.0.3. Exact direct versions and transitive dependencies are pinned in `package.json` and `package-lock.json`. Re-run the commands in README for current evidence.

## Remaining work and limits

- Portless is not installed or integrated. Current URLs are ordinary HTTP localhost addresses. Native launch flags are tested with real Vite; an actual Next.js integration remains pending.
- pnpm/Yarn/Bun are metadata only. Node-version enforcement/switching, arbitrary wrapper/compound scripts, and advanced monorepo orchestration remain pending.
- Start All/Stop All UI, a concurrency-controlled queue, VS Code/terminal shortcuts, optional favorites, and explicit missing-entry dismissal remain later work.
- The Windows listener ownership check uses netstat and read-only PowerShell/CIM. Other operating systems and unavailable/localized system utilities are not verified.
- Normal shutdown is tested. Forced termination/power loss and a parent crashing while leaving independent descendants are known limitations; no OS job object or orphan recovery has been implemented.
- The native folder-dialog response was mocked in automation. User interaction with the real picker and actual browser/File Explorer launching still warrant manual review.
- Cloudflare sharing was not part of this original milestone. It is now implemented as the separately approved v0.3.0 feature; see `docs/public-sharing.md` for controlled generated-fixture evidence. No existing user project was publicly exposed.
- A standalone Windows executable/installer, redistribution notices for a packaged app, and a manual-update distribution process are still pending. The current build runs using the installed Electron development runtime.

## Review next

Open the app and review the local flow and current v0.3.0 public-preview controls. Portless, additional managers, bulk startup controls, and packaging remain separate work. Public tests are limited to the targets explicitly authorized; existing private-project exposure is not implied by fixture testing.
