# Local Dev Manager

A local Windows desktop control panel for development projects. Add the folders where your projects live, discover `package.json` files with a `dev` script, and start, stop, restart, and inspect npm development servers from one dashboard.

**Current release: milestone 1, ready for review.** Portless named URLs, Cloudflare sharing, additional package-manager execution, bulk startup queues, and an installer are planned but not implemented. Nothing is published or publicly exposed.

## Setup

Use Node.js 24 or later with a standard npm installation on native Windows. Initial setup needs internet access; normal launch does not download anything.

```powershell
npm.cmd ci
npm.cmd run setup:runtime
npm.cmd run build
npm.cmd start
```

The dependencies and Electron runtime have already been prepared in this workspace. To review the current build, use `npm.cmd start`.

For development:

```powershell
npm.cmd run dev
```

Renderer edits reload through the local Vite server. Main/preload changes require restarting the development command. React Fast Refresh is omitted in development to preserve the strict script policy. The compiled interface uses the secure local `ldm://` protocol instead of a web server.

## Using the application

1. Click **Add folder** and select a root containing development projects.
2. Use search or root/status filters to find a project.
3. Click **Start**. An owned, responding loopback endpoint changes its status to **Running**.
4. Select the project to inspect logs or restart it. **Open** uses your default browser; **Open folder** uses File Explorer.
5. **Stop** terminates the process tree launched by the manager. Closing the app stops its managed projects.

The app starts no projects automatically, and scans never execute project scripts. Removing a root changes registration only; it does not delete project files. Stop its managed projects before removing its registration.

## Offline behavior and cost

All application assets are local, using system fonts. There are no accounts, hosted backend, telemetry, CDN assets, or automatic update downloads. Dependencies and runtime binaries are free open-source software. Keep `node_modules` and the downloaded Electron distribution to build/launch offline; a fresh checkout alone is not an offline installation package.

Project launches inherit the project's own needs. APIs, remote fonts, authentication, and other internet dependencies within a project can still require internet access. Starting a dev script runs code from that project with your user permissions; the manager is not a process or network sandbox. It does not install missing dependencies, rewrite source/configuration, or prevent a project's own script from generating normal caches/build output.

Optional online sharing is planned using Cloudflare Quick Tunnels. It will require an explicit per-project action and an internet connection. Temporary URLs, provider limits, SSE incompatibility, and future provider policy changes are documented in `plan.md`, section 97. It is not available in this milestone.

## Windows/process notes

- npm is invoked using the installed `node.exe` and `npm-cli.js`, without interpolating project paths into a shell command. npm executes the project's existing script normally.
- Simple `vite` and `next dev` scripts receive temporary localhost/port arguments. Custom scripts receive `PORT`/`HOST` process variables but may ignore them; no universal port-conflict guarantee is claimed.
- Readiness requires a URL from the process output, an HTTP response, and Windows listener PID ownership within the launched process tree. It verifies server availability, not application correctness; authenticated/error routes may still respond.
- Windows `netstat.exe` and a read-only PowerShell/CIM process-ID query verify ownership. If unavailable or blocked, a process remains **Unverified** rather than opening an unrelated server.
- Windows cleanup uses `taskkill /PID <owned-pid> /T`, then a forced tree stop if needed. Killing just npm's parent with SIGTERM would lose the child relationship.
- Normal stop/restart/quit cleanup is tested. Forced application termination, computer shutdown, and a parent crashing while leaving independent descendants are not covered by an OS job object and remain limitations. Do not assume abnormal exits always clean up every server.
- Names, spaces, parentheses, duplicate package names, and nested workspace manager declarations are supported by discovery. Advanced monorepo launch orchestration and Node-version switching remain pending.
- pnpm/Yarn/Bun projects are detected, but execution is deliberately unavailable until their adapters are implemented and tested.

## Data, security, and logs

Roots, cached metadata, and theme are saved to `state.json` under Electron's user-data directory (normally `%APPDATA%\Local Dev Manager`). Atomic writes maintain `state.json.bak` for recovery. Process objects, active PIDs/URLs, and log buffers are not restored as running sessions. For isolated tests, `LDM_DATA_DIR` redirects the app's own data; it does not configure managed projects.

The renderer is sandboxed with context isolation, no Node integration, blocked external resources/navigation, denied browser permissions, and a small typed preload API. Main-process IPC validates the sender and IDs. Logs are text, not HTML; buffers are limited to 5,000 lines/1 MB per project and 16 MB globally.

## Validation

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:desktop
npm.cmd run test:desktop:dev
```

Backend tests create isolated fixtures under `.test-artifacts`, run real npm/Vite servers, verify owned nested process cleanup, and remove their fixture directories. Desktop smoke checks launch actual Electron with isolated user data and stub only the native folder picker's response. They exercise real IPC, discovery, server control, logs, theme/persistence, renderer network-offline reload, and normal quit cleanup.

Light/dark screenshots are written to `.test-artifacts/desktop-light.png` and `desktop-dark.png`. Neither mocked folder selection nor renderer network emulation proves a physically disconnected computer or every native Windows dialog interaction; inspect `docs/milestone-1.md` for the evidence boundary.

## Architecture and next milestone

See `docs/architecture.md` for module boundaries and `docs/milestone-1.md` for implemented behavior and remaining work. The first milestone is intentionally reviewable before expanding to named local URLs, broader compatibility, bulk controls, public sharing, and Windows packaging.
