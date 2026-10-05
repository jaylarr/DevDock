# Architecture

```text
Sandboxed Electron renderer (React + Zustand + local CSS)
  → typed contextBridge methods
  → validated main-frame IPC
  → AppService
      ├─ scanner/detection/identity
      ├─ atomic JSON Persistence
      ├─ ProcessManager
      │    └─ NativePortProvider → node.exe → npm-cli.js → project dev script
      │    └─ StaticPortProvider → node.exe → bundled static-server.cjs → loopback HTTP
      ├─ Windows listener/process ancestry verification
      ├─ TunnelManager → CloudflareQuickTunnelProvider → pinned cloudflared → temporary HTTPS
      └─ bounded LogManager
```

## Main process

`src/main/index.ts` sets up the secure local protocol, isolated BrowserWindow, restricted resource policy, permission denial, IPC checks, native folder picker, clipboard, browser/folder actions, and normal quit cleanup.

`AppService` owns roots and cached metadata. Scans are cancellable, deduplicate real paths, skip generated folders and directory symlinks/junctions, continue past errors, and preserve the previous list when cancelled. Inaccessible subtrees retain cached entries without marking them deleted. Missing/no-longer-runnable entries remain visible.

`Persistence` serializes writes, validates registered-root membership, stores a schema version, performs temporary-file replacement, and maintains a recoverable backup without replacing it with a damaged primary. Runtime state is never persisted as proof of an active process.

`NativePortProvider` uses standard Node/npm installations. It checks the current manifest, rejects unsupported managers, identifies likely missing dependencies, and applies temporary framework arguments/process environment values. It never executes installation commands or changes the managed project's configuration.

`ProjectPortProvider` dispatches a discriminated script/static project to the corresponding provider. `StaticPortProvider` starts an application-bundled helper using installed Node, obtains its actual port through private child IPC, and returns its loopback origin. The helper listens on port 0 without a reserve/release race, serves read-only web assets, validates paths/file identities and application boundaries, and closes on Stop or parent IPC disconnection. ProcessManager still verifies an HTTP response and listener ownership before marking it Running.

Discovery inventories application boundaries before resolving HTML candidates across roots. Parent application evidence blocks directly selected public/docs subfolders; generated-directory boundaries allow intentionally selected exports/isolated fixtures. A static root groups descendant pages, with explicit nested roots represented separately. Any overlapping static/script or static/static managed launch is rejected, including pending launches. AppService performs ownership revalidation inside the reserved startup lifecycle, preserves active launch metadata through rescans, and removes inactive superseded static entries.

Saved-state v3 retains the v2 distinction between script metadata and a static entry filename. Persistence validates/migrates v1/v2, preserves separate nonrotating legacy backups (including a valid recovered legacy backup), and continues atomic writes/recovery. The browser entry URL may contain a validated HTML path; readiness checks that page on the verified origin, and Open preserves the path. The renderer uses launch capability rather than a package-manager-only test for static controls.

`ProcessManager` prevents duplicate starts, captures split UTF-8 streams, detects exit/crash, checks readiness, and stops only owned process trees. URL parsing accepts HTTP loopback endpoints with explicit ports. Windows `netstat` and CIM process ancestry prevent a URL logged by one process from falsely identifying an unrelated server as its own.

Readiness states are `starting`, `unverified`, and `running`. A surviving process is not necessarily a ready server. The ready check is bounded and can recover later from `unverified`. A successful owned HTTP response proves transport availability, not a successful business workflow.

`LogManager` strips terminal control sequences and limits lines, per-project bytes, individual line length, and total buffered memory. Renderer invalidation events are batched at 50 ms; the renderer requests current data on these events, not on a constant polling loop.

## Renderer/preload

`src/preload/index.ts` is bundled as one CommonJS file compatible with Electron's sandbox. Only named project/root/settings/log operations cross the bridge. Node primitives and Electron IPC objects are not exposed.

The React dashboard has folder registration, search, status/root filters, compact rows, theme selection, error notes, and a details/log panel. Stop remains available if a managed project becomes missing. Browser and folder opening are validated main-process actions, rather than renderer-provided arbitrary URLs or paths.

Built assets are served using `ldm://manager` with path-boundary checks. During development, only the selected loopback Vite origin is allowed. Scripts use a strict self-only policy; local CSS permits inline styles for development updates. There are no remote fonts or UI assets.

## Planned extensions

PortlessProvider will supply named local URLs through the existing port-provider boundary after compatible versions and script patterns are tested.

TunnelManager/CloudflareQuickTunnelProvider are implemented independently of process/port management in v0.3.0. AppService revalidates the owned loopback endpoint/generation, merges ephemeral sharing snapshots, and stops tunnels before servers. Project exits notify tunnel cleanup; active sessions periodically recheck port ownership. Duplicate/pending/stop-all operations are reserved and cancellation ignores late events. No URLs, tunnel PIDs, or sharing state are saved.

The pinned Windows executable is checksum-verified locally, runs with isolated configuration/environment and loopback readiness metrics, and parses bounded structured output. Copy/open are project-ID-only IPC operations using the backend's current validated link. Read-only bounded source inspection supplies compatibility hints in a native modal confirmation. The renderer's external resource policy is unchanged; visitors use their own browser and project tunnel, not the manager interface. See `docs/public-sharing.md` for behavior and bounded evidence.

Cloudflared connects through a session-owned loopback PreviewBridge to the verified project origin. Only the session's exact public origin is translated to the local origin for Next internal dev requests, including upgrades; other application headers are preserved. Stop, tunnel exit, and launch failure close the bridge and its connections. Windows ownership queries await drained stdout and coalesce simultaneous requests without caching positive verdicts.

Installer/resource-path distribution, Node-version management, and process-recovery job objects remain pending.

## Settings

`src/shared/settings.ts` supplies the single settings model, fresh defaults, strict patches, typed saved filters, and diagnostic/import contracts. `SettingsView` renders six sections in the existing shell. The dashboard remains mounted while hidden so navigation preserves session context. The main process owns persisted settings; renderer storage is not duplicated.

AppService serializes immutable state commits and publishes a new snapshot only after an atomic save succeeds. Scans merge catalog results into the latest preferences. A catalog mutation barrier blocks new launches during root removal, cache clearing, or folder-import replacement; replacement also checks pending processes and managed tunnels.

`SettingsTransfer` handles bounded portable JSON, opt-in registration export, normalized local paths, immutable five-minute preview tokens, and revision checks. It accepts no scripts or runtime state. Native file pickers/writes remain in main; the renderer has no arbitrary file endpoint.

`LocalDiagnostics` reuses Node/npm resolution, caches bounded local version checks, and copies only the exact allowlisted report preview. No runtime download or network probe is part of diagnostics.

ProcessManager emits a once-only callback at verified readiness for each runtime instance. AppService captures auto-open eligibility at launch; the callback rechecks the runtime and shutdown before invoking the main browser opener. Browser errors are logged separately from server status.

## External activity

`ExternalActivity` inspects bounded local file reports every five seconds. A native Windows process query returns only PID, parent PID, and creation time; it validates owner lifetimes and excludes DevDock descendants without reading command lines. Reports match the deepest registered, nonmissing, nonexcluded project path. Generation checks discard late results during toggles/shutdown. Activity timestamps and source are committed through AppService, while source presence remains ephemeral and independent of ProcessManager.

`ExternalServers` correlates native loopback TCP listeners with process ancestry, birth times, selected Node-family entry script paths, and connected terminal metadata. It excludes DevDock descendants, matches registered projects, and probes HTTP readiness. AppService overlays unmanaged server state without adding a ProcessManager runtime. A fresh preflight inside ProcessManager's reserved launch blocks duplicates or unavailable native checks. Open refreshes and validates the current URL; Stop and Restart cannot control an external server. Native checks continue while optional tool reporting is disabled.

The VS Code bridge attaches to the public terminal shell execution API for plain dev commands and atomically writes bounded output snapshots for registered projects. `ExternalServers` validates reporter/terminal births and server descendants, deduplicates sequences and multiport matches, and relays entries into LogManager. Full command lines, environment values, terminal history, and unrelated executions are not transported. Output from before attachment cannot be replayed.

`activitySetup` packages an offline VSIX and merges passive agent hooks or marked PowerShell profile blocks, keeping backup copies and unrelated configuration. Bundled reporters honor a shared local enable policy and allowlisted activity/output schemas. Codex's native hook trust review remains user-controlled. Preload exposes only allowlisted source setup and refresh operations; renderer callers cannot supply commands, config paths, or arbitrary process IDs. See `docs/external-activity.md` for capabilities, expiry rules, and verification boundaries.
