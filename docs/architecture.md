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
      ├─ Windows listener/process ancestry verification
      └─ bounded LogManager
```

## Main process

`src/main/index.ts` sets up the secure local protocol, isolated BrowserWindow, restricted resource policy, permission denial, IPC checks, native folder picker, clipboard, browser/folder actions, and normal quit cleanup.

`AppService` owns roots and cached metadata. Scans are cancellable, deduplicate real paths, skip generated folders and directory symlinks/junctions, continue past errors, and preserve the previous list when cancelled. Inaccessible subtrees retain cached entries without marking them deleted. Missing/no-longer-runnable entries remain visible.

`Persistence` serializes writes, validates registered-root membership, stores a schema version, performs temporary-file replacement, and maintains a recoverable backup without replacing it with a damaged primary. Runtime state is never persisted as proof of an active process.

`NativePortProvider` uses standard Node/npm installations. It checks the current manifest, rejects unsupported managers, identifies likely missing dependencies, and applies temporary framework arguments/process environment values. It never executes installation commands or changes the managed project's configuration.

`ProcessManager` prevents duplicate starts, captures split UTF-8 streams, detects exit/crash, checks readiness, and stops only owned process trees. URL parsing accepts HTTP loopback endpoints with explicit ports. Windows `netstat` and CIM process ancestry prevent a URL logged by one process from falsely identifying an unrelated server as its own.

Readiness states are `starting`, `unverified`, and `running`. A surviving process is not necessarily a ready server. The ready check is bounded and can recover later from `unverified`. A successful owned HTTP response proves transport availability, not a successful business workflow.

`LogManager` strips terminal control sequences and limits lines, per-project bytes, individual line length, and total buffered memory. Renderer invalidation events are batched at 50 ms; the renderer requests current data on these events, not on a constant polling loop.

## Renderer/preload

`src/preload/index.ts` is bundled as one CommonJS file compatible with Electron's sandbox. Only named project/root/settings/log operations cross the bridge. Node primitives and Electron IPC objects are not exposed.

The React dashboard has folder registration, search, status/root filters, compact rows, theme selection, error notes, and a details/log panel. Stop remains available if a managed project becomes missing. Browser and folder opening are validated main-process actions, rather than renderer-provided arbitrary URLs or paths.

Built assets are served using `ldm://manager` with path-boundary checks. During development, only the selected loopback Vite origin is allowed. Scripts use a strict self-only policy; local CSS permits inline styles for development updates. There are no remote fonts or UI assets.

## Planned extensions

PortlessProvider will supply named local URLs through the existing port-provider boundary after compatible versions and script patterns are tested.

TunnelManager/CloudflareQuickTunnelProvider will be separate from process/port management. It will consume an owned verified local origin, track ephemeral public-link state, and clean up independently. No sharing provider, public tunnel, installer, Node-version manager, or process-recovery job object exists in this milestone.
