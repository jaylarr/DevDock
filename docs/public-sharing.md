# Public previews in DevDock v0.3.0

Prepared: 2026-10-02 (Asia/Taipei). Local release draft; publication and packaging are separate.

## Using it

Restart the manager after upgrading its main/preload build. Your projects are never shared automatically.

1. Start a project and wait for **Running**.
2. Click **Share Online** in its row or expanded details.
3. Review the compatibility hints/public-access notice and click **Start sharing**.
4. Expand details for **Copy Public Link**, **Open Public Link**, and **Stop Sharing**.
5. Share other projects independently; each gets its own URL. At least three simultaneous sessions are supported and tested.

**Stop Sharing** preserves the local server. **Stop All Sharing** stops every public preview owned by this manager while preserving local servers. Stopping/restarting a project ends its session. Closing the manager stops its tunnels and servers; reopening restores neither. Retry is manual after persistent connection failure.

Anyone with the link can access routes/actions already served by the project, including accessible admin/debug endpoints. Preview intent does not make a site read-only. The PC, manager, server, and internet connection must remain available.

## Runtime setup

The optional official portable Windows x64 runtime belongs at `.sharing-runtime/2026.9.3/cloudflared.exe`. After completing the [main installation steps](../README.md#install-and-launch), prepare sharing explicitly:

```powershell
npm.cmd run setup:sharing
npm.cmd run build
npm.cmd start
```

Setup downloads the pinned official executable and license. Its SHA-256 matches the GitHub-published asset digest pinned in `src/main/tunnels/cloudflared-pin.json`:

```text
Version: 2026.9.3 (Windows x64)
SHA-256: f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2
```

Setup is explicitly online. Normal launch/disabled sharing do not download or update anything. Missing/corrupt binaries affect sharing availability only. Integrity is checked at initialization and before a tunnel launch. Reopen the manager after preparing a missing runtime.

The process uses `--no-autoupdate`, structured output, loopback metrics, and a tunnel-specific local Host header. Its working/home directory and environment are isolated from existing cloudflared credentials/configuration. No account, purchased domain, service installation, router change, or firewall-rule installation occurs. The binary/license are ignored local runtime files; future packaging needs separate resource-path/distribution-notice validation.

## Compatibility inspection

Every new sharing confirmation runs a bounded read-only source inspection. It flags possible local-only URLs, SSE streaming, and login/redirect integrations using filenames rather than source contents. Hidden configuration, credentials/secrets filenames, dependency/build folders, and symlink entries are excluded. At most 200 entries and roughly 1 MB of source are examined; incomplete coverage gets a limit notice.

These are hints, not a security audit or a compatibility guarantee. Server-side localhost URLs and test/config files can be false positives, and generated integrations can be missed. The manager does not rewrite source or expose a separate API port.

Optional saved-catalog inspection produces a machine-local report at `.test-artifacts/project-compatibility.json`. It may contain private project names and must stay out of publication assets. Its hints are not running-app counts or proof that a project is broken. The existing inspection script reads the normal Windows catalog; it is not part of installation or the isolated screenshot workflow. See the [publication audit](publication-audit.md) for that script's reproducibility limits.

## Framework behavior

- **HTML:** the public link preserves the encoded selected entry filename, including non-index names. Relative pages/assets use one origin. Existing static-server restrictions remain in place.
- **Vite:** the tunnel-specific Host override avoids accepting every public hostname in project configuration. The generated fixture's public WebSocket/reload works; custom HMR settings can still need review.
- **Next.js:** a session-owned loopback bridge translates the current preview's `Origin`/`Referer` for Next dev assets/HMR under `/_next/`, `__nextjs/`, and `__nextjs_font/`, including base paths. Foreign, null, malformed, and previous-session origins are rejected on those paths. Application authentication, cookies, forwarding headers, and custom WebSockets retain their existing headers. Project source/configuration is unchanged. Next validates dev origins independently of the Host header; see [official Next.js guidance](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins).
- **Separate API:** browser `localhost` URLs refer to the visitor's computer. A same-origin proxy/public API is a separate project change.
- **Login/cookies/redirects:** temporary hostnames can need callback/origin allowlist or HTTPS cookie changes.
- **SSE:** unsupported by Quick Tunnels; some AI streaming needs another reviewed approach.
- **Node/Astro/custom servers:** an owned verified HTTP endpoint can be shared, but application-specific functionality is not universally tested.

No new package-manager adapter, PHP runtime, permanent hosting, tray mode, or named local URL is added.

## Status, security, and cleanup

Local status and sharing status are independent. Sharing reports disabled, connecting, sharing, stopping, or error. An announced URL alone is insufficient: connection evidence must come from the pinned owned process.

Startup is bounded to 60 seconds. The provider's loopback `/ready` endpoint is checked every three seconds after connection. Readiness loss clears active copy/open targets; a 15-second grace period permits recovery inside the same session. Persistent failure stops the tunnel and requires explicit retry. Local port ownership is rechecked every five seconds; detection is periodic, not instantaneous.

Start revalidates registration, local listening PID ownership, and process generation. Missing/excluded/unverified projects, unrelated ports, and the manager's development UI origin are rejected. Copy/open accept project IDs and use the active validated provider link; no renderer-supplied URL/executable is accepted. Reserving sessions before async validation prevents duplicates.

Cancellation ignores late events and stops late-spawned handles. Project Stop blocks sharing, stops the tunnel first, then stops its server. Crash/exit clears the link and stops sharing. Cleanup failures stay visible/retryable; a root with an owned tunnel cannot be removed even after server exit. Quit attempts all cleanup and aggregates failures. Overlapping Stop All requests share one cleanup operation.

Diagnostics use bounded in-memory project logs with a `[Sharing]` prefix. Copied logs may contain public links. Session PIDs, links, timestamps, errors, and processes are never persisted. SavedState stays version 2; no database/migration is added.

Forced app termination, power loss, sleep/resume, independent descendants, and physically disconnected network behavior are not guaranteed by an OS job object; none is added here.

## Validation evidence

Final validation results are recorded below and in `.test-artifacts/public-sharing-evidence.json`. Local mocks, real Electron controls, and live fixture traffic are distinct from untested user-project functionality.

- **90 tests passed across 5 files**, including 27 sharing/compatibility/lifecycle tests and existing scanner, HTML, state, and process regressions.
- Typecheck, lint, production build, version alignment, and whitespace checks passed.
- Compiled and development-mode Electron smoke passed, including 850 × 600 layout, local/npm/HTML controls, normal quit, persistence, and renderer-offline operation.
- Real controlled public run passed three simultaneous HTML/Vite/Next HTTPS pages/assets, Vite and Next browser reload, modal/cancel, compatibility hints, clipboard/public-open target, themes/small-window layout, independent stop, Stop All Sharing, restart, and quit cleanup. All generated test tunnels and local servers were stopped and fixture folders removed.
- Independent visitor-network verification is **pending**. The independent web reader could not access the temporary URLs through its tool; that is not evidence of a visitor-network pass or a general reachability failure.
- Connection-loss/timeout and failed cleanup are covered with mock provider events. This test did not disable the PC's physical internet connection or test sleep/power loss.

The final regression run also exposed a Windows taskkill/exit race. Both project and tunnel cleanup now await the actual owned process exit within the existing deadline before treating a raced command error as a failure; a still-live process remains an error. A focused real-process test covers this case. The final full suite passed after that fix.

Sharing uses a stricter ownership check than the existing local readiness check: every listener on the chosen port must belong to the project process tree. It fails closed when another process owns an address family/interface on the same port, preventing an owned IPv4 listener from being mistaken for an unrelated IPv6 localhost endpoint. A real mixed-family listener regression test passed. Such ambiguous setups may require restarting onto an uncontested port.

The 2026-10-05 ownership checker waits for stdout to finish before parsing JSON, uses an explicit array and terminating PowerShell errors, and permits up to ten seconds per query. Concurrent preview checks share only an in-flight snapshot, with no cached successful ownership verdict. Ownership loss or an unavailable query still ends sharing.

The first 2026-10-02 public run served all three fixture pages/assets and passed Vite reload. Next reload exposed its dev-origin protection. Adding an allowlist only to that disposable Next fixture removed the rejection. The current regression fixture uses Turbopack and no dev-origin allowlist to exercise the preview bridge, and waits for client hydration and a received WebSocket frame before editing the page. The original failure evidence is retained at `.test-artifacts/public-sharing-first-attempt.json`.

The public test uses disposable projects and isolated Electron data. It reuses installed third-party Next.js 16.3.6 dependencies through a fixture-only junction, runs generated scripts/config/source, and builds under the disposable fixture. It never runs an existing project's dev script or serves its source. Folder-picker and external Open responses are stubbed to inspect targets; actual server/tunnel/IPC/clipboard/browser traffic is real.

```powershell
# Explicit opt-in; requires authorization for generated public fixtures.
npm.cmd run test:sharing:live
```

The script prints fixture URLs and an external-check marker, waits up to three minutes for the operator's independent-network result, and then exercises stop/restart/quit. Same-PC HTTPS fetches/browser WebSockets do not prove an independent visitor network. The independent web tool could not access this run's temporary URLs; that check remains pending rather than being presented as a pass.

For an automated same-PC regression, append `-- --skip-external-check`. The evidence explicitly marks independent visitor-network verification as not tested and proceeds through cleanup.

The 2026-10-05 fix passed the full 171-test regression suite, then 49 focused tests after adding the Next development-font route, plus lint and production build. The final generated-fixture live run passed three simultaneous HTML/Vite/Next public pages/assets, Vite and Next.js 16.3.6 Turbopack browser reload without a dev-origin allowlist, no HTTP 403 browser resources, individual/all sharing stops, project restart, and manager-quit cleanup. All fixture tunnels and local servers stopped. Evidence is in `.test-artifacts/public-sharing-evidence.json`; this run explicitly skipped independent visitor-network verification. The initial fixture failed because its linked dependencies were outside Turbopack's inferred root; its retained evidence is `.test-artifacts/public-sharing-turbopack-link-error.json`. The fixture now sets only the filesystem root needed for those linked dependencies.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Share Online disabled | Wait for Running; inspect missing/excluded status and runtime availability |
| Runtime missing/checksum error | Stop sharing, run setup:sharing, reopen the manager |
| Connecting timeout | Check internet/provider availability and diagnostics; retry explicitly |
| Pages load but assets/buttons/login fail | Review API addresses, dev-origin rules, cookies, redirects, and compatibility hints |
| Next reload blocked | Rebuild/reopen DevDock and create a fresh preview; inspect custom base paths, HMR, or application middleware if failures persist |
| Link changed | Expected for a new Quick Tunnel session |
| Stop failed | Retry Stop Sharing/Stop All Sharing; do not assume access ended while an owned tunnel remains |

Cloudflare documents 200 in-flight requests per tunnel, no uptime guarantee, and no SSE. These previews are for development rather than production hosting. [Official behavior/limits](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
