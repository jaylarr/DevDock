# DevDock

## 0. Review Status and Agreed Constraints

Updated: 2026-10-02 (Asia/Taipei).

Status: **Development approved on 2026-10-02; milestone 1 implemented and locally validated, ready for review.**

The user subsequently gave explicit development approval: “Okay, proceed.” The first local vertical slice is authorized. Review that milestone before expansion. Implementation approval does not automatically authorize starting existing user projects or creating public tunnels. Current implementation evidence and remaining limits are documented in `docs/milestone-1.md`.

The following decisions consolidate the planning discussion and take precedence over older examples or optional suggestions elsewhere in this document:

- Build a local Windows desktop application using Electron, React, TypeScript, and Vite.
- Use free, open-source local dependencies. No paid application, subscription, trial, account requirement, or metered cloud backend is part of the manager's core functionality.
- Initial dependency and build-tool downloads are acceptable during approved setup. Offline rebuilding requires retaining the downloaded packages and required binary caches.
- The installed manager must support discovery, process controls, logs, settings, and local URLs without internet access. Bundle fonts, icons, scripts, and styles locally; use system fonts initially. No telemetry, remote assets, automatic update checks, or automatic downloads at runtime.
- Projects launched by the manager retain their own requirements. The manager does not convert cloud-dependent projects into offline applications or enforce an operating-system network sandbox around their processes.
- Public sharing is an explicit, optional online feature using Cloudflare Quick Tunnels. It is the limited exception to the offline/no-cloud-service rule, not a dependency of normal local operation. Details and limitations are in section 97.
- Validate native Windows behavior on the user's current computer first. Windows 10 and other Windows installations are additional compatibility targets, not tested claims.
- Prove npm projects using Vite and Next.js first. Add installed pnpm, Yarn, Bun, Nuxt, and Astro support incrementally; do not claim compatibility before testing it.
- Discover `scripts.dev` initially. Advanced custom scripts, commands, runtime switching, and workspace orchestration remain deferred.
- Use ordinary HTTP localhost URLs for the first working milestone. Integrate Portless afterward, retain a direct-launch fallback, and test named local URLs before making compatibility claims. Local HTTPS requires a separate explicit certificate-trust setup and is not required for the first milestone.
- Manage only processes launched by this application. Do not adopt, terminate, or replace independently started development servers automatically.
- Show cached projects on launch and scan in the background. Do not automatically start projects or restore public sharing.
- Close the application by stopping its managed tunnels and project process trees. Tray mode, keep-running mode, and launch at login are deferred.
- Default startup concurrency is three. This limits simultaneous startups, not the total number of running projects. Bulk actions must identify their scope and display the target count.
- Removing a root removes its registration only, never files. Retain missing projects until explicitly dismissed; a moved path is a new identity initially.
- Never edit managed project source, `package.json`, `.env`, or framework configuration automatically. A project's own development script may generate normal cache/build files; document this distinction.
- Missing project dependencies produce a diagnostic; V1 does not install them automatically. Package managers must not be bootstrapped through a runtime network download.
- Prefer compact project rows and a details/log panel, with search, status filters, and system/light/dark themes. Rich cards are optional presentation guidance.
- Store configuration and project metadata as local JSON in Electron's user-data directory. Use atomic writes and a recoverable backup. Portable settings storage and SQLite are deferred.
- Keep bounded logs in memory by default, with line and byte limits. Copy/manual export may be provided; persistent project logs are deferred.
- Prioritize Open Browser and Open Folder. Open VS Code and Open Terminal follow the core controls and must remain optional.
- Start tests with isolated fixtures. Existing projects used for integration testing must be explicitly identified by the user. Creating a live public preview during development requires explicit authorization; approving implementation alone does not start sharing.
- Deliver a local unsigned Windows package without purchasing a signing certificate. Document possible Windows trust warnings and manual update instructions.
- Retain license notices for bundled dependencies and review their transitive dependencies before packaging. Free hosted services are not promises of permanent availability or unrestricted use.

Recommended supporting dependencies are Tailwind CSS, a small Zustand store, optional locally bundled Lucide icons, Vitest for meaningful backend tests, and electron-builder for later packaging. Prefer Node.js built-in filesystem, process, networking, and hashing APIs over unnecessary libraries. Do not add a database, account system, hosted backend, or UI component framework unless needed for the agreed scope.

The implementation should proceed by milestones after final approval, with a review of the first complete discovery/start/logs/stop slice before expanding it. Remaining machine-specific facts such as selected root paths, project counts, memory capacity, Node version requirements, and actual framework compatibility must be established during approved discovery; no arbitrary project root should be selected automatically.

---

## 1. Project Overview

Build a local desktop application called **DevDock** that acts as a centralized control panel for development projects stored across one or more folders on the user's computer.

The application should automatically discover development projects that contain a runnable `dev` script, display them in a dashboard, and allow the user to start, stop, restart, inspect, and open those projects without manually opening VS Code terminals and running commands individually.

The application must also solve local development port conflicts without requiring permanent edits to the projects themselves.

Primary V1 target:

- Node.js / JavaScript / TypeScript projects
- Projects containing `package.json`
- Projects with `scripts.dev`
- npm
- pnpm
- yarn
- Bun where practical
- Next.js
- Vite
- Nuxt
- Astro
- other standard Node dev servers where possible

The application should run locally and should not require any cloud backend for its core workflow. Optional public sharing connects a selected project to Cloudflare only when the user explicitly requests it; see section 97.

---

# 2. Main User Problem

A developer may have a directory like:

```text
C:\Development
├── portfolio
├── automation-dashboard
├── clients
│   ├── client-a
│   ├── client-b
│   └── client-c
├── experiments
│   ├── app-one
│   └── app-two
└── old-projects
```

Currently, starting projects requires:

1. Find the folder.
2. Open it in VS Code.
3. Open terminal.
4. Run `npm run dev`.
5. Remember which port it started on.
6. Repeat for every other project.
7. Handle duplicate ports manually.
8. Keep many terminals open.

DevDock should replace this workflow.

The desired workflow is:

```text
Open DevDock

↓

All projects are already visible

↓

Click Start

↓

Project starts

↓

Dashboard displays:

Running
http://localhost:<assigned-port>

↓

Click Open
```

---

# 3. Core Product Goals

The application must:

1. Allow the user to select one or more root directories.
2. Recursively scan those directories.
3. Find valid Node.js projects.
4. Detect projects containing a `dev` script.
5. Detect the appropriate package manager.
6. Display all discovered projects in one dashboard.
7. Start projects without opening VS Code.
8. Stop running projects.
9. Restart projects.
10. Display live terminal output.
11. Detect startup failures.
12. Display the URL of running applications.
13. Avoid port conflicts.
14. Avoid modifying the project's source files.
15. Remember selected root directories.
16. Remember project metadata between application launches.
17. Rescan directories manually.
18. Detect deleted/moved projects.
19. Support multiple projects running simultaneously.
20. Provide a clean desktop UI.
21. Optionally share a selected running project through a temporary public HTTPS link.
22. Stop sharing independently from stopping the local project.
23. Preserve offline core functionality when sharing is unavailable or disabled.

---

# 4. Important Architectural Rule

This must NOT be implemented as a browser-only web application.

Use:

```text
Electron
+
React
+
TypeScript
+
Vite
```

Reason:

The application needs access to:

- local filesystem
- directories
- child processes
- stdout
- stderr
- ports
- OS commands
- native folder selection
- opening browsers
- opening VS Code
- process termination

The UI can be built using normal web technologies, but privileged operations must run in the Electron main process.

---

# 5. Recommended Technology Stack

## Desktop Runtime

Electron

## Frontend

React

TypeScript

Vite

## Styling

Tailwind CSS

Optional:

shadcn/ui

Lucide icons

## State Management

Prefer lightweight state management.

Recommended:

Zustand

Do not introduce Redux unless clearly necessary.

## Process Execution

Node.js:

```text
child_process.spawn
```

## Storage

V1:

JSON-based local persistence.

Potential later migration:

SQLite.

## Port Management

First milestone adapter:

NativePortProvider (direct local launch).

Named local URL adapter after the first milestone:

PortlessProvider (subject to Windows compatibility validation).

Design the system so Portless can later be replaced.

Do NOT tightly couple process management directly to Portless.

Create an abstraction.

Example:

```ts
interface PortProvider {
  startProject(project: Project): Promise<RunningInstance>;
  stopProject(projectId: string): Promise<void>;
}
```

Implement both adapters incrementally. Start with direct process control, then add temporary port overrides for supported frameworks and Portless integration. Unknown/custom scripts may retain their normal port and report conflicts; universal conflict-free behavior is not guaranteed.

Public sharing uses a separate TunnelProvider abstraction; it does not replace local port management.

---

# 6. Security Model

Electron security must be treated seriously.

Use:

```text
contextIsolation: true
nodeIntegration: false
sandbox where reasonable
```

The React renderer must NOT receive unrestricted Node.js access.

Use:

```text
preload.ts
```

to expose a restricted API.

Example:

```ts
window.devManager = {
  projects: {
    list(),
    scan(),
    start(id),
    stop(id),
    restart(id)
  },

  roots: {
    list(),
    add(),
    remove(id)
  }
}
```

Do not expose:

```text
fs
child_process
shell
exec
require
```

directly to the renderer.

---

# 7. High-Level Architecture

```text
┌────────────────────────────────────────────┐
│            Electron Renderer               │
│                                            │
│ React                                      │
│ Dashboard                                  │
│ Project Cards                              │
│ Logs                                       │
│ Settings                                   │
└─────────────────────┬──────────────────────┘
                      │
                      │ Secure IPC
                      │
┌─────────────────────▼──────────────────────┐
│            Electron Main Process           │
│                                            │
│ Root Manager                               │
│ Project Scanner                            │
│ Project Registry                           │
│ Package Manager Detector                   │
│ Framework Detector                         │
│ Process Manager                            │
│ Port Manager                               │
│ Log Manager                                │
│ Persistence Manager                        │
└─────────────────────┬──────────────────────┘
                      │
                      │ spawn()
                      │
          ┌───────────┼───────────┐
          │           │           │
          ▼           ▼           ▼
       Project A   Project B   Project C
```

---

# 8. Suggested Application Modules

Create separate modules rather than placing everything inside Electron's main file.

Suggested backend structure:

```text
src/
├── main/
│   ├── index.ts
│   │
│   ├── ipc/
│   │   ├── project.ipc.ts
│   │   ├── roots.ipc.ts
│   │   ├── settings.ipc.ts
│   │   ├── system.ipc.ts
│   │   └── sharing.ipc.ts
│   │
│   ├── services/
│   │   ├── projectScanner.ts
│   │   ├── projectRegistry.ts
│   │   ├── rootManager.ts
│   │   ├── processManager.ts
│   │   ├── logManager.ts
│   │   ├── packageManagerDetector.ts
│   │   ├── frameworkDetector.ts
│   │   ├── portManager.ts
│   │   ├── tunnelManager.ts
│   │   └── persistence.ts
│   │
│   ├── ports/
│   │   ├── PortProvider.ts
│   │   ├── PortlessProvider.ts
│   │   └── NativePortProvider.ts
│   │
│   ├── tunnels/
│   │   ├── TunnelProvider.ts
│   │   └── CloudflareQuickTunnelProvider.ts
│   │
│   └── utils/
│       ├── filesystem.ts
│       ├── hashing.ts
│       ├── slug.ts
│       └── process.ts
│
├── preload/
│   └── index.ts
│
├── renderer/
│   ├── App.tsx
│   │
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── ProjectDetails.tsx
│   │   └── Settings.tsx
│   │
│   ├── components/
│   │   ├── ProjectCard.tsx
│   │   ├── ProjectList.tsx
│   │   ├── ProjectStatus.tsx
│   │   ├── ProjectActions.tsx
│   │   ├── LogViewer.tsx
│   │   ├── RootFolderList.tsx
│   │   ├── SearchBar.tsx
│   │   ├── Sidebar.tsx
│   │   └── EmptyState.tsx
│   │
│   ├── stores/
│   │   ├── projectStore.ts
│   │   └── settingsStore.ts
│   │
│   └── types/
│       └── api.ts
│
└── shared/
    ├── types/
    │   ├── Project.ts
    │   ├── RootFolder.ts
    │   ├── ProcessState.ts
    │   └── Settings.ts
    │
    └── constants.ts
```

Codex may adjust this structure if needed, but maintain separation of concerns.

---

# 9. Root Folder Management

Users must be able to add multiple root folders.

Example:

```text
C:\Development
D:\Clients
C:\Users\User\Documents\Experiments
```

Use Electron's native directory picker.

Features:

```text
Add Root
Remove Root
Enable/Disable Root
Rescan Root
```

Persist roots locally.

Example model:

```ts
interface RootFolder {
  id: string;
  path: string;
  name: string;
  enabled: boolean;
  addedAt: string;
  lastScannedAt?: string;
}
```

Prevent duplicate root directories.

Normalize Windows paths before comparison.

---

# 10. Project Discovery

When scanning a root:

Recursively find:

```text
package.json
```

Ignore directories such as:

```text
node_modules
.git
.next
dist
build
coverage
.cache
.output
.nuxt
.vercel
.turbo
out
tmp
temp
vendor
```

Do not recursively scan `node_modules`.

For every discovered `package.json`:

Parse safely.

If:

```ts
packageJson.scripts?.dev
```

exists and is a string, register it as a runnable project.

---

# 11. Project Model

Use a model similar to:

```ts
interface Project {
  id: string;

  name: string;

  displayName: string;

  path: string;

  packageJsonPath: string;

  rootId: string;

  devScript: string;

  packageManager:
    | "npm"
    | "pnpm"
    | "yarn"
    | "bun"
    | "unknown";

  framework:
    | "next"
    | "vite"
    | "nuxt"
    | "astro"
    | "react"
    | "svelte"
    | "angular"
    | "node"
    | "unknown";

  status:
    | "stopped"
    | "queued"
    | "starting"
    | "unverified"
    | "running"
    | "stopping"
    | "crashed"
    | "error";

  pid?: number;

  port?: number;

  localUrl?: string;

  portlessUrl?: string;

  slug: string;

  discoveredAt: string;

  lastStartedAt?: string;

  lastStoppedAt?: string;

  favorite?: boolean;
}
```

Do not store process objects inside persistent JSON.

Runtime process information should remain in memory.

The model above combines metadata with a runtime view. Persist metadata and user preferences only; never restore `pid`, active status, ports, or active URLs as proof of a running process. Public sharing state is separate, ephemeral runtime information as described in section 97.

---

# 12. Stable Project IDs

Project identity must remain stable across rescans.

Generate project ID from:

```text
absolute normalized project path
```

For example:

```text
SHA256(projectPath)
```

A short form may be used internally:

```text
first 12–16 characters
```

Do not use an array index.

Do not use only the package name.

---

# 13. Duplicate Project Names

Two folders may contain:

```text
dashboard
dashboard
dashboard
```

Therefore the displayed URL cannot rely only on project name.

Create a deterministic project slug.

Example:

```text
dashboard-a83f
dashboard-f12c
dashboard-92da
```

Use:

```text
sanitizedProjectName + shortHash(projectPath)
```

The same project must receive the same slug after restarting the application.

---

# 14. Package Manager Detection

Use the following priority.

First inspect:

```text
package.json → packageManager
```

If not provided, inspect lockfiles.

```text
pnpm-lock.yaml
→ pnpm

yarn.lock
→ yarn

bun.lock
bun.lockb
→ bun

package-lock.json
npm-shrinkwrap.json
→ npm
```

Fallback:

```text
npm
```

Commands:

npm:

```text
npm run dev
```

pnpm:

```text
pnpm dev
```

yarn:

```text
yarn dev
```

bun:

```text
bun run dev
```

---

# 15. Framework Detection

Framework detection is useful for icons, labels, diagnostics, and eventual native port management.

Inspect:

```text
dependencies
devDependencies
devScript
```

Detection examples:

Next.js:

```text
next
```

Vite:

```text
vite
```

Nuxt:

```text
nuxt
```

Astro:

```text
astro
```

SvelteKit:

```text
@sveltejs/kit
```

Angular:

```text
@angular/core
```

React:

```text
react
```

Framework detection must never prevent a project from running.

Unknown projects should still be allowed.

---

# 16. Process Manager

Create a centralized process manager.

Responsibilities:

```text
start
stop
restart
track
capture stdout
capture stderr
detect exit
detect crashes
cleanup on app shutdown
```

Maintain an in-memory map:

```ts
Map<ProjectId, RunningProcess>
```

Example:

```ts
interface RunningProcess {
  pid: number;
  child: ChildProcess;
  startedAt: Date;
  state: ProcessState;
}
```

---

# 17. Process Startup

Use:

```text
child_process.spawn()
```

Important options:

```ts
{
  cwd: project.path,
  shell: true,
  env: {
    ...process.env
  }
}
```

On Windows, carefully test spawning npm/pnpm/yarn/Bun commands.

Do not use `exec()` for long-running dev servers unless absolutely necessary.

Prefer `spawn()`.

---

# 18. Process Status Lifecycle

Implement:

```text
STOPPED
   ↓
QUEUED
   ↓
STARTING
   ↓
RUNNING
```

If a process remains alive but server readiness cannot be confirmed, use `UNVERIFIED` with a clear diagnostic rather than declaring it `RUNNING`. A later successful readiness check can transition it to `RUNNING`.

Failure:

```text
STARTING
   ↓
ERROR
```

Unexpected process termination:

```text
RUNNING
   ↓
CRASHED
```

Manual stop:

```text
RUNNING
   ↓
STOPPING
   ↓
STOPPED
```

The UI should update immediately.

---

# 19. Stop Process Correctly

Stopping Node development servers on Windows can be tricky because npm may spawn subprocesses.

Do not merely kill the parent PID if child processes remain.

Implement process-tree termination.

On Windows consider:

```text
taskkill /PID <pid> /T /F
```

Use graceful termination first where practical.

Suggested strategy:

1. attempt normal termination;
2. wait briefly;
3. terminate the process tree if still running.

Ensure stopping Next.js/Vite does not leave zombie processes.

---

# 20. Application Shutdown Cleanup

When DevDock closes, stop all tunnels and project processes launched by DevDock. Stop tunnels before their associated servers, await bounded cleanup, and report failures.

Before quit:

```text
for each managed process
→ terminate process tree
```

Later a setting may support:

```text
Keep projects running after Dev Manager closes
```

Keep-running mode is deferred beyond V1.

Normal quit cleanup is not proof of cleanup after a forced application crash or power loss. Test those separately, use safe process ownership checks for recovery, and never kill an unrelated process merely because a saved PID or port matches.

---

# 21. Port Management Architecture

Do NOT embed Portless-specific logic inside `processManager`.

Create:

```ts
interface PortProvider {
  start(
    project: Project,
    command: StartCommand
  ): Promise<PortStartResult>;

  stop(projectId: string): Promise<void>;
}
```

Example result:

```ts
interface PortStartResult {
  process: ChildProcess;
  url?: string;
  port?: number;
}
```

First milestone provider:

```text
NativePortProvider
```

Additional named-URL provider after process control is stable:

```text
PortlessProvider
```

Keep public sharing outside this interface. A tunnel consumes the actual verified local origin selected by the port provider, not an assumed framework default port.

---

# 22. Portless Integration

Use Portless to avoid:

```text
localhost:3000
localhost:3001
localhost:3002
```

Provide stable names such as:

```text
portfolio-a32f.localhost

crm-c19a.localhost

client-dashboard-82bb.localhost
```

Desired behavior:

```text
portless <project-slug> npm run dev
```

or equivalent invocation depending on Portless CLI behavior.

Pin a tested Portless version and verify its current CLI rather than copying a hypothetical command. Validate plain HTTP named URLs first. HTTPS is optional and must explain and obtain approval for local certificate-trust changes before applying them. Do not install an OS startup service.

Portless may not inject ports into compound scripts, wrapper scripts, or custom servers. Surface compatibility failures and retain direct local launch; never fix them by silently editing the project.

The Portless integration should:

1. verify Portless exists;
2. provide a helpful error if unavailable;
3. detect compatibility issues;
4. capture Portless stdout/stderr;
5. surface generated URL;
6. terminate correctly.

Do not automatically edit:

```text
package.json
.env
vite.config.ts
next.config.js
nuxt.config.ts
```

---

# 23. Portless Availability

On application initialization:

Check:

```text
node
npm
portless
```

Potential command:

```text
portless --version
```

If unavailable, display:

```text
Named local URLs are unavailable. Direct localhost launch remains available; conflicts are reported where temporary overrides are unsupported.
```

During approved development setup, Codex should prepare the pinned dependency and document it. Prefer a bundled, tested copy for the final offline package where licensing and technical requirements permit. Do not download it silently at application startup.

---

# 24. Fallback Port Strategy

Design the data model now even if full fallback support is implemented later.

Possible per-project modes:

```ts
type PortStrategy =
  | "portless"
  | "env-port"
  | "cli-port"
  | "default"
  | "custom";
```

Example project override:

```ts
interface ProjectOverride {
  projectId: string;

  portStrategy?: PortStrategy;

  customCommand?: string;

  customArgs?: string[];

  environment?: Record<string, string>;
}
```

Examples:

Environment:

```text
PORT=4211 npm run dev
```

CLI:

```text
npm run dev -- --port 4211
```

Never permanently alter the original project to change ports.

---

# 25. URL Detection

The application should understand when a project becomes available.

Possible sources:

1. Portless output.
2. Dev server stdout.
3. allocated port.
4. predefined Portless hostname.

Parse common output patterns like:

```text
Local: http://localhost:3000

Local: http://localhost:5173

Ready on http://localhost:3000
```

However URL parsing should not be required if Portless gives a deterministic URL.

---

# 26. Startup Readiness

Do not mark a project as `RUNNING` immediately when `spawn()` succeeds.

Use one or more conditions:

- Portless reports ready.
- stdout contains a recognized ready indication.
- expected localhost endpoint responds.

Correlate readiness evidence with the launched process and actual origin. Logs can be stale or misleading, and a response on an occupied port may belong to a different process. Authentication/error HTTP responses need framework-aware interpretation; do not require every healthy application route to return 200.

Potential recognized strings:

```text
Ready
ready in
Local:
started server
listening
```

Do not create overly framework-specific assumptions.

If exact readiness cannot be detected:

After a bounded startup period, use `status = unverified` and explain that the process is alive but readiness is unknown. The queue must release its startup slot at the deadline instead of blocking indefinitely. Public sharing remains unavailable until the selected project's local origin is verified.

---

# 27. Logging System

Capture:

```text
stdout
stderr
system messages
```

Each log event:

```ts
interface LogEntry {
  id: string;
  projectId: string;
  timestamp: string;

  stream:
    | "stdout"
    | "stderr"
    | "system";

  text: string;
}
```

Maintain an in-memory rolling log buffer.

Example:

```text
maximum 5,000 lines per project
```

Do not let unlimited terminal output consume memory.

---

# 28. Log Viewer

Project detail view should contain:

```text
Logs

[Clear] [Copy] [Auto-scroll ✓]

-------------------------------------------------

11:53:22  > npm run dev

11:53:23  ▲ Next.js

11:53:23  Local:
           http://crm-a9d3.localhost

11:53:24  ✓ Ready
```

Features:

```text
automatic scrolling
manual scroll
clear UI logs
copy selected logs
stderr differentiation
timestamps
```

Do not overcomplicate terminal emulation in V1.

A text-based stream viewer is sufficient.

---

# 29. Dashboard

The main dashboard is the core screen.

Recommended layout:

```text
┌───────────────────────────────────────────────┐
│ DevDock                     Settings│
├─────────────┬─────────────────────────────────┤
│             │ Search projects...              │
│ All         │                                 │
│ Running     │  PROJECT CARDS                  │
│ Stopped     │                                 │
│ Favorites   │                                 │
│             │                                 │
│ Roots       │                                 │
│ Development │                                 │
│ Clients     │                                 │
│             │                                 │
└─────────────┴─────────────────────────────────┘
```

---

# 30. Project Card

Each project should show only the most useful information.

Example:

```text
CRM Dashboard

Next.js • pnpm

C:\Development\crm-dashboard

● Running

http://crm-dashboard-a83f.localhost

[Open] [Restart] [Stop]

Logs
```

Stopped:

```text
Portfolio

Vite • npm

○ Stopped

[Start]
```

Error:

```text
Invoice App

Next.js • npm

⚠ Startup failed

Portless command failed

[Retry] [Logs]
```

---

# 31. Dashboard Features

Implement:

```text
Search

Filter:
All
Running
Stopped
Errors

Sort:
Name
Recently started
Folder
Framework

Favorites
```

Favorites may be V1.1 if necessary.

---

# 32. Project Actions

Each project should support:

```text
Start

Stop

Restart

Open App

Copy URL

Open Folder

Open Terminal

Open in VS Code

View Logs

Share Online (optional, requires verified running server and internet)

Copy Public Link (only while sharing)

Stop Sharing (leaves local project running)
```

Keep the local Open App/Copy URL actions distinct from public sharing actions. Never expose the manager's own UI or IPC capabilities through a project tunnel.

---

# 33. Open App

Use Electron:

```text
shell.openExternal(project.localUrl)
```

Do not manually invoke Chrome.

Use the user's default browser.

---

# 34. Open Folder

Use OS file manager.

For example:

```text
shell.showItemInFolder(...)
```

or equivalent.

---

# 35. Open in VS Code

If `code` CLI exists:

```text
code "<project path>"
```

Otherwise show a non-fatal error.

Do not make VS Code required for the application.

---

# 36. Open Terminal

Open a terminal at:

```text
project.path
```

On Windows support PowerShell or Windows Terminal where practical.

This is a convenience function, not a core dependency.

---

# 37. Project Discovery Refresh

Provide:

```text
Rescan All
```

and optionally:

```text
Rescan Root
```

On rescan:

- discover new projects;
- update existing projects;
- mark missing projects;
- retain missing projects until explicitly dismissed; do not delete their files.

Normalize and deduplicate overlapping roots. Skip directory junctions/symbolic links by default to avoid cycles and unintended traversal. Continue past unreadable directories and invalid manifests, recording diagnostics. Removing a root must not implicitly destroy active runtime information or delete a project.

If a project is currently running, do not accidentally delete its runtime information during scanning.

---

# 38. Initial Scan

When app launches:

1. load configuration;
2. load registered roots;
3. load cached projects;
4. show dashboard quickly;
5. scan roots in background;
6. update results.

Do not block the UI until the entire filesystem scan finishes.

---

# 39. Scan Performance

Avoid scanning huge useless directories.

Ignore known generated folders.

Support cancellation if scanning takes too long.

Potential future optimization:

Filesystem watcher.

Do not make filesystem watching mandatory for MVP.

Manual refresh + launch scan is enough.

---

# 40. Start All

Implement a global:

```text
Start All
```

but do NOT launch every project simultaneously.

Define the action's scope explicitly: all registered projects, a selected root, or the current filtered list. Display the count and exclude already managed/running projects, missing entries, and workspace roots known to duplicate selected child launches. Bulk startup never starts public sharing.

Use a startup queue.

Default concurrency:

```text
3
```

Example:

```text
Project A → Starting
Project B → Starting
Project C → Starting
Project D → Queued
Project E → Queued
```

Once a startup completes/fails, start the next queued project.

---

# 41. Stop All

Implement:

```text
Stop All
```

Terminate all processes managed by the app.

---

# 42. Restart All

Optional for V1.

If implemented, use controlled concurrency.

---

# 43. Settings

Settings page should initially include:

```text
General

Start app at login
Optional, can defer

Scan projects on launch
Default: ON

Confirm before Stop All
Default: ON

Startup concurrency
Default: 3


Port Management

Provider:
Native / Portless (when available)

Public Sharing

Provider: Cloudflare Quick Tunnels
Start only through an explicit Share Online action
Do not restore previous sharing sessions


Logs

Max buffered lines per project:
5000
Also enforce per-project byte limits and a global buffer budget


Appearance

System
Light
Dark
```

Do not add unnecessary settings.

---

# 44. Local Persistence

Store configuration inside Electron's user data directory.

Use:

```text
app.getPath("userData")
```

Example:

```text
LocalDevManager/
├── config.json
├── projects.json
└── overrides.json
```

Write JSON atomically with a backup and schema version. Logs are in memory by default; create exported files only through an explicit export action. Never persist tunnel process objects, active sharing state, or old public links as resumable sessions.

V1 does not need Supabase.

V1 does not need authentication.

V1 does not need a server database.

---

# 45. Config Model

Example:

```ts
interface AppSettings {
  scanOnLaunch: boolean;

  startupConcurrency: number;

  stopAllConfirmation: boolean;

  theme:
    | "system"
    | "light"
    | "dark";

  maxLogLines: number;

  portProvider:
    | "native"
    | "portless";
}
```

---

# 46. Error Handling

All service operations should return structured errors.

Example:

```ts
interface AppError {
  code: string;
  message: string;
  details?: string;
}
```

Useful errors:

```text
PROJECT_NOT_FOUND

PACKAGE_MANAGER_NOT_FOUND

PORTLESS_NOT_FOUND

START_FAILED

STOP_FAILED

PROJECT_ALREADY_RUNNING

PROJECT_NOT_RUNNING

INVALID_PACKAGE_JSON

ROOT_NOT_FOUND

PERMISSION_DENIED
```

The UI must show understandable error messages.

Do not expose giant Node stack traces to normal users.

Stack traces may be logged internally during development.

---

# 47. Missing Dependencies

The app should detect common problems such as:

```text
node_modules missing

npm unavailable

pnpm unavailable

Portless unavailable
```

A project with no `node_modules` should not automatically run `npm install` without user approval.

Missing `node_modules` is a heuristic, not a universal failure: Yarn Plug'n'Play and monorepo dependencies may live elsewhere. Detect declared runtime/package-manager requirements and report mismatches. Do not invoke a package-manager bootstrapper that downloads an unavailable version at runtime.

Display:

```text
Dependencies appear to be missing.
```

Potential action:

```text
Install Dependencies
```

Dependency installation is deferred beyond V1. Give manual instructions without executing an installation automatically.

---

# 48. IPC Contract

Renderer should communicate only through typed IPC methods.

Example:

```ts
interface DevManagerAPI {

  roots: {
    list(): Promise<RootFolder[]>;

    add(): Promise<RootFolder | null>;

    remove(id: string): Promise<void>;

    scan(id?: string): Promise<ScanResult>;
  };

  projects: {
    list(): Promise<Project[]>;

    start(id: string): Promise<Project>;

    stop(id: string): Promise<Project>;

    restart(id: string): Promise<Project>;

    openBrowser(id: string): Promise<void>;

    openFolder(id: string): Promise<void>;

    openVSCode(id: string): Promise<void>;
  };

  logs: {
    get(projectId: string): Promise<LogEntry[]>;

    clear(projectId: string): Promise<void>;

    subscribe(callback): UnsubscribeFunction;
  };
}
```

Keep IPC channel names centralized.

Example:

```text
projects:list
projects:start
projects:stop
projects:restart

roots:list
roots:add
roots:remove
roots:scan

logs:get
logs:clear
logs:event
```

---

# 49. Real-Time Renderer Updates

Use IPC events for:

```text
project status changes

new log line

URL detected

process crash

scan updates
```

Do not constantly poll Electron from React.

Example event:

```ts
{
  type: "PROJECT_STATUS_CHANGED",
  projectId,
  status: "running"
}
```

---

# 50. UI State Management

Use Zustand or another lightweight store.

Example store:

```ts
projects

selectedProjectId

filters

searchQuery

loading

scanStatus
```

IPC remains the source of truth for running processes.

React should not independently invent process states.

---

# 51. MVP Screens

Required screens:

## Dashboard

Main project overview.

## Project Details

Logs and complete project information.

## Root Management

Can exist inside Settings.

## Settings

Basic configuration.

Avoid adding many pages.

---

# 52. First-Run Experience

If no roots exist:

Display:

```text
Welcome to DevDock

Manage all your local development projects
from one place.

[Add Project Folder]
```

After folder selection:

```text
Scanning C:\Development...

17 projects discovered.
```

Then show dashboard.

---

# 53. Empty States

No projects found:

```text
No runnable projects found.

A project must contain package.json
with a "dev" script.
```

No running projects:

```text
Nothing is currently running.
```

No search results:

```text
No projects match your search.
```

---

# 54. UX Philosophy

The application should feel like:

```text
Raycast
+
Vercel dashboard
+
Docker Desktop
+
a process manager
```

but simpler.

Prioritize:

```text
clarity
speed
low text density
clear status
few clicks
```

Avoid:

```text
huge cards
unnecessary gradients
excessive animations
too much explanatory copy
```

---

# 55. UI Visual Direction

Recommended:

Neutral developer-focused design.

Light and dark mode.

Cards with subtle borders.

Minimal shadow.

Compact typography.

Status indicators.

Possible palette:

```text
background:
neutral

running:
green indicator

starting:
yellow indicator

error:
red indicator

stopped:
gray indicator
```

This is UI guidance, not a strict requirement.

---

# 56. Project Status Color Semantics

Use consistent status meanings.

```text
Green:
Running

Yellow:
Starting / queued

Red:
Error / crashed

Gray:
Stopped

Yellow:
Readiness unverified (process alive; server not yet confirmed)

Blue:
optional active operation
```

---

# 57. Performance Expectations

With approximately:

```text
100–300 projects
```

the dashboard should remain responsive.

Filesystem scanning may take longer, but UI should not freeze.

Do not perform synchronous recursive scans on the renderer thread.

---

# 58. Logging Limits

Protect memory.

Apply both line and byte limits per project, plus a global memory budget across project and tunnel buffers. Split long/chunked output safely and batch renderer updates so noisy servers cannot monopolize memory or freeze the UI.

Recommended:

```text
5000 lines per project
```

When over limit:

Remove oldest lines.

Potential future setting:

```text
1000
5000
10000
```

---

# 59. Testing Strategy

Implement tests for core backend services.

Prioritize:

```text
projectScanner

packageManagerDetector

frameworkDetector

slug generation

project ID generation

project registry

port abstraction

process state transitions
```

---

# 60. Scanner Tests

Create fixtures.

Example:

```text
fixtures/
├── next-app/
│   └── package.json
├── vite-app/
│   └── package.json
├── no-dev-script/
│   └── package.json
├── broken-package-json/
│   └── package.json
└── nested/
    └── another-app/
        └── package.json
```

Tests:

```text
find valid projects

ignore node_modules

ignore package without dev

survive invalid JSON

detect nested projects

avoid duplicates
```

---

# 61. Package Manager Tests

Test:

```text
packageManager field

pnpm-lock.yaml

yarn.lock

package-lock.json

bun lockfile

fallback npm
```

---

# 62. Process Manager Tests

Test using fixture scripts instead of full Next.js apps when possible.

Fixture:

```text
node mock-dev-server.js
```

Test:

```text
start

capture stdout

detect exit

stop

restart

crash

duplicate start prevention
```

---

# 63. Manual Integration Testing

Test actual:

```text
Next.js app

Vite app

Nuxt app

Astro app
```

Start several simultaneously.

Confirm:

```text
no port conflicts

correct URLs

HMR works

restart works

stop works

browser opening works
```

---

# 64. Windows Priority

Primary development target:

```text
Windows 10 / Windows 11
```

Test:

```text
npm.cmd behavior

pnpm

PowerShell

process tree termination

paths containing spaces

paths containing parentheses

different drives

long paths
```

Example:

```text
C:\Users\User\My Projects\Client App
```

must work.

Do not assume Unix shell behavior.

---

# 65. Path Handling

Use Node:

```text
path.resolve
path.normalize
```

Never concatenate paths manually using:

```text
"/"
```

Support Windows drive letters.

---

# 66. Potential Monorepo Support

Basic monorepo support should be considered.

Example:

```text
my-platform
├── package.json
├── apps
│   ├── frontend
│   └── admin
└── packages
```

If nested package files have `dev` scripts, register them.

However avoid duplicate representation where a workspace root already manages all services.

For V1 it is acceptable to list independently runnable workspace apps separately. Label workspace roots and children, detect inherited package-manager/runtime declarations where relevant, and avoid bulk-starting both a known orchestrating root and its managed children. Do not rewrite workspace scripts or invent advanced dependency ordering.

Advanced workspace grouping can be V2.

---

# 67. Avoid Scope Creep in V1

Do NOT initially implement:

```text
Docker management

Python projects

Go projects

Laravel

Supabase CLI

n8n management

database orchestration

remote servers

cloud deployment

Git management

AI assistant

team collaboration

authentication

account system

cloud sync

remote execution
```

Those belong after V1 is stable.

The explicitly agreed exception is temporary public sharing of an already-running local project (section 97). This is not cloud deployment, remote execution, or remote control of the manager.

---

# 68. V1 Development Phases

## Phase 1 — Project Foundation

Goal:

Electron + React application launches.

Tasks:

```text
Initialize project

Configure Electron

Configure Vite

Configure React

Configure TypeScript

Configure Tailwind

Create preload bridge

Enable context isolation

Create basic dashboard
```

Acceptance:

```text
npm run dev

opens Electron window

React renders successfully
```

---

# 69. Phase 2 — Root Folder Management

Implement:

```text
native folder picker

add root

remove root

list roots

persist roots
```

Acceptance:

```text
user adds C:\Development

application remembers it after restart
```

---

# 70. Phase 3 — Project Scanner

Implement recursive scanning.

Acceptance:

Given:

```text
root
├── app-a/package.json
├── app-b/package.json
└── node_modules/example/package.json
```

Only valid project folders with `scripts.dev` appear.

---

# 71. Phase 4 — Project Metadata Detection

Implement:

```text
package manager detection

framework detection

stable project ID

stable slug

display metadata
```

Acceptance:

Dashboard displays:

```text
Portfolio

Vite

npm

C:\Development\portfolio
```

---

# 72. Phase 5 — Process Manager

Implement:

```text
start

stop

restart

status tracking

stdout

stderr
```

Do not add Portless yet if it blocks progress.

Initially prove:

```text
npm run dev
```

can be controlled correctly.

Acceptance:

A Vite/Next project starts and stops from UI.

---

# 73. Phase 6 — Logging

Implement real-time logs.

Acceptance:

Terminal output appears inside project view while the process runs.

---

# 74. Phase 7 — Portless Integration

Implement PortProvider abstraction.

Implement:

```text
PortlessProvider
```

Acceptance:

Two projects that normally use the same port can run simultaneously.

Example:

```text
app-a.localhost
app-b.localhost
```

No project files are modified.

Validate HTTP named URLs first; optional HTTPS requires an explicit certificate setup. Test common framework patterns and document custom-script limitations. Keep direct launch available when Portless is absent or incompatible.

---

# 75. Phase 8 — URL Actions

Implement:

```text
Open Website

Copy URL
```

Acceptance:

Clicking Open Website opens the correct project in the default browser.

---

# 76. Phase 9 — Developer Convenience Actions

Implement:

```text
Open Folder

Open in VS Code

Open Terminal
```

Failure of optional tools must not crash the app.

---

# 77. Phase 10 — Start All / Stop All

Implement queue.

Default:

```text
3 simultaneous startups
```

Acceptance:

10 projects can be started without all 10 launching at once.

---

# 78. Phase 11 — Dashboard Polish

Implement:

```text
search

filters

status grouping

loading states

empty states

responsive desktop layout

light/dark mode
```

---

# 79. Phase 12 — Reliability Pass

Test:

```text
crashed process

missing folder

folder deleted

invalid package.json

missing npm

missing pnpm

missing Portless

duplicate project names

project paths with spaces

process killed externally
```

---

# 80. Phase 13 — Packaging

Complete the optional public-sharing milestone in section 97 after core local controls and port management are stable, and before final packaging. A sharing failure must not break or postpone acceptance of the working offline core.

Create a Windows development build.

Eventually package installer using:

```text
electron-builder
```

or suitable alternative.

Create:

```text
.exe installer
```

Do not make packaging the first priority.

---

# 81. Definition of MVP Complete

V1 is considered complete when the following scenario works reliably.

User opens application.

User selects:

```text
C:\Development
```

Application discovers:

```text
15 projects
```

Dashboard lists them.

User clicks:

```text
Start
```

on three projects.

All three run simultaneously.

Dashboard shows:

```text
● Portfolio
http://portfolio-a82d.localhost

● CRM
http://crm-981c.localhost

● Automation Dashboard
http://automation-dashboard-b32f.localhost
```

User can:

```text
open project

view logs

restart project

stop project
```

No project config files are modified.

Closing the app cleans up launched processes.

Reopening the app remembers the configured root folders.

That is the core definition of success.

Also verify this complete core scenario with internet access disabled and all required project dependencies already present. The optional sharing feature has its own acceptance criteria in section 97 and is not required to operate the offline manager.

---

# 82. Code Quality Requirements

Codex must:

```text
use TypeScript

avoid any where possible

keep services modular

use shared types

use meaningful error handling

avoid giant files

avoid duplicated process logic

document non-obvious Windows behavior

use async filesystem APIs

keep renderer separated from Node privileges
```

---

# 83. Git Strategy

Create commits by meaningful milestone.

Examples:

```text
feat: initialize electron react application

feat: add root directory management

feat: implement project scanner

feat: detect package managers and frameworks

feat: add local process manager

feat: add live log streaming

feat: integrate portless provider

feat: add project controls

feat: add global project actions

test: add scanner and process manager tests

chore: configure windows packaging
```

Do not create one giant final commit.

---

# 84. Suggested Issue Breakdown

## EPIC: Application Foundation

```text
DEV-001
Initialize Electron + React + TypeScript

DEV-002
Create secure preload IPC bridge

DEV-003
Create application layout
```

## EPIC: Project Discovery

```text
DEV-010
Add root folder picker

DEV-011
Persist project roots

DEV-012
Create recursive scanner

DEV-013
Ignore generated folders

DEV-014
Detect dev scripts
```

## EPIC: Project Metadata

```text
DEV-020
Generate stable project IDs

DEV-021
Generate stable project slugs

DEV-022
Detect package manager

DEV-023
Detect framework
```

## EPIC: Process Management

```text
DEV-030
Create process manager

DEV-031
Implement start

DEV-032
Implement stop

DEV-033
Implement restart

DEV-034
Implement Windows process-tree termination

DEV-035
Handle process crashes
```

## EPIC: Logs

```text
DEV-040
Capture stdout

DEV-041
Capture stderr

DEV-042
Stream logs through IPC

DEV-043
Create log viewer

DEV-044
Limit log buffer
```

## EPIC: Ports

```text
DEV-050
Create PortProvider interface

DEV-051
Create Portless provider

DEV-052
Detect Portless installation

DEV-053
Generate local project URLs

DEV-054
Handle Portless errors
```

## EPIC: Dashboard

```text
DEV-060
Create project card

DEV-061
Add project actions

DEV-062
Add search

DEV-063
Add status filters

DEV-064
Add status updates
```

## EPIC: Global Controls

```text
DEV-070
Implement startup queue

DEV-071
Implement Start All

DEV-072
Implement Stop All
```

## EPIC: Convenience Actions

```text
DEV-080
Open in browser

DEV-081
Open folder

DEV-082
Open VS Code

DEV-083
Open terminal
```

## EPIC: Quality

```text
DEV-090
Scanner tests

DEV-091
Detector tests

DEV-092
Process tests

DEV-093
Windows integration testing

DEV-094
Error handling pass
```

## EPIC: Optional Public Sharing

```text
DEV-100
Create independent TunnelProvider/TunnelManager boundary

DEV-101
Prepare a pinned Windows cloudflared executable and license notices

DEV-102
Add Share Online, Copy Public Link, and Stop Sharing actions

DEV-103
Track tunnel lifecycle, failures, and cleanup separately from project status

DEV-104
Test provider behavior with mocked output and local fixtures

DEV-105
Perform explicitly authorized public preview checks and document limits
```

---

# 85. Codex Working Method

Codex should NOT attempt to build the entire application in one uncontrolled pass.

Work in milestones.

For every milestone:

Begin only after the revised plan receives explicit development approval. Review the first complete local vertical slice with the user before expanding it. Do not interpret this document's implementation instructions as authorization by themselves.

1. inspect existing repository;
2. identify affected modules;
3. implement the smallest complete feature;
4. run TypeScript checks;
5. run lint;
6. run tests;
7. manually verify where practical;
8. fix errors before proceeding;
9. update documentation;
10. commit logically.

Never knowingly leave the project broken between major phases.

---

# 86. Codex Decision Rules

If an implementation detail is unclear:

Prefer:

```text
simple

local-first

Windows-compatible

TypeScript-native

low-dependency

secure Electron practices

easy to replace later
```

Avoid premature abstraction except for:

```text
process management

port management

persistence

IPC
```

Those areas require clean boundaries.

---

# 87. Do Not Do These Things

Do not:

```text
edit project package.json files automatically

change project source code

modify project ports permanently

require VS Code

require Supabase

require cloud services for the core local workflow

automatically expose projects or restore public sharing on launch

expose the manager's control API through a public tunnel

use unsafe nodeIntegration

expose arbitrary shell execution to renderer

scan node_modules recursively

use project names as unique identifiers

launch unlimited projects simultaneously

let logs grow without bounds

store ChildProcess objects in JSON

silently install dependencies

silently modify Git repositories
```

The only agreed optional hosted integration is Cloudflare Quick Tunnels. It runs solely during explicit sharing sessions; no account system or cloud backend is added to the manager.

---

# 88. Future V2 Features

Do not build these until MVP works.

Potential features:

```text
project groups

workspace profiles

favorites

custom commands

custom environment variables

project dependencies

startup sequences

workspace startup presets

CPU usage

RAM usage

process uptime

automatic filesystem watching

custom aliases

custom icons

recent project history

SQLite persistence

command palette

system tray

launch at startup
```

Example workspace:

```text
CLIENT A

Start Workspace

↓

Frontend
Backend
Worker
Database
```

---

# 89. Future V3

Possible runtimes:

```text
Docker Compose

Python

FastAPI

Django

Flask

Go

Rust

Laravel

PHP

Supabase local

n8n

Redis

PostgreSQL
```

Eventually DevDock could become a complete:

```text
Local Development Control Center
```

But Node-based dev project management remains the first milestone.

---

# 90. Final Required Deliverables

Codex should eventually provide:

```text
working source code

README.md

installation instructions

development instructions

architecture overview

known limitations

Portless setup instructions

Cloudflare sharing setup, use, restrictions, and troubleshooting

Offline operation and cached-dependency requirements

Bundled dependency license notices

Windows notes

test suite

build instructions
```

README should document:

```text
npm install

npm run dev

npm run build

npm run test
```

or the final commands selected by the project.

---

# 91. README Overview

The README introduction should explain the application roughly as:

DevDock is a desktop control center for local development projects. Select the folders where your projects live, automatically discover applications with development scripts, and start, stop, restart, open, and inspect them from one dashboard.

It provides conflict-free local project URLs and eliminates the need to manually open multiple terminals just to launch development servers.

---

# 92. Final Product Principle

The application must optimize this:

Before:

```text
Find project

Open VS Code

Open terminal

npm run dev

check port

open browser

repeat
```

After:

```text
Open DevDock

Click Start

Click Open
```

Everything in the architecture should serve that simplification.

---

# 93. Immediate Implementation Order

Start development in exactly this general order:

```text
1. Electron foundation
2. Secure IPC bridge
3. Root folder selection
4. Recursive project discovery
5. Project registry
6. Package manager detection
7. Framework detection
8. Dashboard
9. Process manager
10. Start / Stop / Restart
11. Logs
12. PortProvider abstraction
13. Portless integration
14. URL opening
15. Start All queue
16. Convenience actions
17. Optional Cloudflare sharing after local controls are stable
18. Error handling
19. Testing
20. UI polish
21. Windows packaging
```

Do not begin with visual polish.

Prove the process-management architecture first.

---

# 94. First Major Technical Milestone

Before doing advanced UI work, prove this complete vertical slice:

```text
User selects C:\Development

↓

Scanner discovers project

↓

Dashboard shows project

↓

User presses Start

↓

Electron launches npm run dev

↓

stdout appears in dashboard

↓

Status changes to Running

↓

User presses Stop

↓

Process and child processes terminate

↓

Status returns to Stopped
```

Once this works reliably, integrate Portless.

This is the first critical milestone.

---

# 95. Second Major Technical Milestone

After process management is stable:

```text
Project A normally wants :3000

Project B normally wants :3000

↓

User starts both

↓

Both run simultaneously

↓

Project A:
http://project-a-xxxx.localhost

Project B:
http://project-b-yyyy.localhost

↓

HMR works

↓

Neither repository was modified
```

This proves the central product idea.

---

# 96. Final Instruction to Codex

Treat this as a real developer productivity application rather than a quick script.

Build the smallest strong architecture that can grow later.

Prioritize:

```text
reliability
process cleanup
Windows compatibility
safe Electron architecture
clear state management
conflict-free local URLs
maintainable code
```

Do not overengineer V1.

If a feature threatens the stability of the core workflow, defer it.

The core workflow is:

```text
DISCOVER
→ START
→ MONITOR
→ OPEN
→ RESTART
→ STOP
```

Build that exceptionally well first.

---

# 97. Optional Public Sharing — Cloudflare Quick Tunnels

Implementation approved after review on 2026-10-02 and delivered locally as v0.3.0. The reviewed feature plan is `docs/public-sharing-plan.md`; actual behavior/evidence are in `docs/public-sharing.md`. Only generated demo fixtures were publicly tested. Existing user-project exposure, publication, and packaging remain outside that authorization. Independent visitor-network verification remains pending.

## Purpose and Scope

Add a dedicated **Share Online** action to a verified running project. It creates a temporary public HTTPS link that forwards to that project's actual local web server. This is a preview of a service running on the user's computer, not a deployment or permanent hosting service.

Selected provider: Cloudflare Quick Tunnels using the Windows `cloudflared` executable. No Cloudflare account, purchased domain, account token, router port forwarding, or paid-plan trial is needed for this workflow. The service is currently offered at no charge, but it remains third-party hosted infrastructure with limits and no promise of permanent availability or unchanged policies.

The computer, project server, tunnel process, and internet connection must remain available while sharing. Offline discovery, local controls, logs, and saved settings must work whether or not the provider is reachable.

## Minimal User Setup

During approved implementation, Codex should prepare a pinned, tested Windows executable from the official distribution, verify its integrity where official verification data is provided, retain required license notices, and include it with the final package if redistribution requirements permit. No setup has been performed by writing this plan.

Do not depend on downloading `cloudflared` when Share Online is clicked. Do not install a system service, change router settings, purchase infrastructure, or create a Cloudflare account. Disable automatic update checks in the invocation using the pinned version's supported option. Document manual updates and recheck provider documentation before implementing version-specific flags.

Intended normal workflow:

```text
Start project
→ Wait for verified local readiness
→ Share Online
→ Copy Public Link
→ Stop Sharing when finished
```

## Architecture and Data Flow

```text
Visitor's browser
→ Public HTTPS URL on Cloudflare
→ Managed cloudflared tunnel process
→ Verified loopback origin for the selected project
```

Introduce `TunnelProvider`, `CloudflareQuickTunnelProvider`, and `TunnelManager` in the main process. Keep them separate from `ProcessManager` and `PortProvider` so the hosted provider can be changed later without changing local execution.

The renderer receives only typed project-ID actions through the restricted preload bridge: start sharing, stop sharing, get sharing state, and copy/open the active public URL. Validate IPC senders, project IDs, origins, URLs, and lifecycle transitions in the main process. Do not expose arbitrary executable paths, ports, commands, or shell execution to the renderer.

Use the actual origin reported and verified by local process/port management. Do not assume `3000` or `5173`, and do not tunnel a Portless hostname blindly; named-host routing may require an appropriate origin Host header. Never tunnel Electron's development UI, the manager's IPC/control surface, or unrelated ports.

Per-project sharing state is runtime-only:

| Field | Meaning |
|---|---|
| projectId | The owned project whose server is shared |
| state | disabled, connecting, sharing, stopping, or error |
| origin | Verified loopback address and actual port |
| publicUrl | Current provider-issued HTTPS URL, only valid for this session |
| tunnelPid / process handle | In-memory process ownership information |
| startedAt | Session start time |
| error | Structured failure message and diagnostic code |

Do not serialize process handles or restore active sessions from JSON. Allow at most one managed tunnel per project; repeated clicks must not create duplicates. Impose a finite startup deadline, bound tunnel output buffers, and ignore late events from replaced sessions.

## Controls and Lifecycle

- Share Online is available only for a project with a verified ready local origin. It is always a deliberate per-project action; Start All and ordinary project startup do not share anything.
- Display local status and public-sharing status separately. A project may be running locally while its tunnel is connecting or unavailable.
- Show Copy Public Link, Open Public Link, and Stop Sharing while the tunnel is active. Keep local URL actions distinct.
- Stop Sharing ends the tunnel and clears the active public link without stopping the local project.
- Stopping a project stops its tunnel first. A project crash stops the associated tunnel. Stop All stops all owned tunnels and projects.
- Restarting a project ends its sharing session. Sharing does not resume automatically; the user must request a new session after readiness is verified.
- Closing the manager awaits bounded tunnel cleanup before project cleanup. Reopening never restores sharing.
- On tunnel exit or internet loss, clear the active-sharing indication and explain the failure without changing the local project's status. Do not silently create a replacement public session; retry is an explicit action.
- Track and test abnormal application exits separately from normal cleanup. Never claim that every forced crash or power failure guarantees process cleanup.

## Access and Compatibility

Initial proposed access mode for review: anyone who has the generated URL can access the selected service. A random URL is not authentication. Explain this in the sharing UI without adding an account system to the manager.

Current Cloudflare documentation also describes optional email-restricted previews using one-time PINs. Keep this as a possible follow-up; do not promise it works with the pinned executable until tested. If enabled later, approved visitor addresses are configured locally, and visitors must complete the browser-based email step. The user can choose this mode instead of open-link access during plan review.

The tunnel exposes reachable routes on that project server, potentially including source files, debug endpoints, and actions backed by development credentials. It does not isolate or sanitize the project. Do not automatically expose unrelated services, disable framework host/origin protections globally, or infer consent to share private applications.

Validate common Vite and Next.js cases, host-header handling, WebSockets/live reload, cookies, redirects, and applications with a separate API. Hard-coded frontend `localhost` URLs refer to the visitor's computer and may prevent a preview from working. OAuth redirect allowlists and app-specific origin rules may also require explicit project setup.

Prefer temporary process environment/CLI overrides where supported; do not persistently rewrite managed source or framework configuration to make sharing work. If a project needs changes, report the exact requirement and leave it unshared until an appropriate solution is approved. Universal one-click compatibility is not guaranteed.

## Provider Limits (Checked 2026-10-02)

- The public hostname changes whenever a Quick Tunnel is created; permanent addresses and custom domains are outside this scope.
- Quick Tunnels have no uptime guarantee and are intended for testing/development, not production hosting.
- Each tunnel allows up to 200 in-flight requests. Excess requests receive HTTP 429. This is a concurrent-request limit, not a monthly visitor allowance.
- Server-Sent Events (SSE) are unsupported. Apps requiring SSE, including some streamed AI responses, need another explicitly reviewed approach.
- Email-restricted previews require an interactive browser session and do not suit non-interactive webhook/API clients.
- Public traffic passes through Cloudflare infrastructure, subject to its service policies, availability, and future changes.
- Initial binary setup and every public sharing session require internet access; local-only operation does not.

Do not describe this provider as unlimited, guaranteed free forever, entirely offline, or free of all third-party conditions. Recheck documentation and policy before implementation and before a provider/version change. If these limits are unacceptable, revisit the provider choice rather than silently adding a free tier, trial, paid host, or purchased domain.

## Milestone and Acceptance Criteria

Implement after the complete local discovery/start/logs/stop slice and local port management are stable, before final packaging. Public sharing is an independently testable optional capability; its failure must not disable the accepted offline core.

Use mocked provider output and isolated local fixtures first to verify:

1. Sharing actions use a validated project ID and verified loopback origin.
2. Duplicate requests produce one tunnel, not multiple processes.
3. Connecting, sharing, stopping, exit, failure, and timeout states reach the renderer accurately.
4. Stop Sharing preserves the local server; project stop/crash/quit cleans up its tunnel.
5. Restart and application relaunch do not restore public sharing.
6. Invalid output/URLs, missing executables, failed startup, and network loss produce bounded, useful errors.
7. The installed manager remains usable offline and makes no provider/update requests when sharing is disabled.

After explicit authorization for a controlled public preview, verify from an independent external connection that the chosen project is reachable over HTTPS and that stopping the tunnel ends access. Check at least a Vite and Next.js case where available, verify live reload and expected app behavior, and record actual results and limitations. Do not claim external reachability from a localhost-only check or mocked test.

## Sources

- [Cloudflare Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) — setup, access, lifecycle, and limits.
- [Cloudflare Quick Tunnels overview](https://try.cloudflare.com/) — no-account, outbound-only public previews.
- [Cloudflare free Quick Tunnel announcement](https://blog.cloudflare.com/quick-tunnels-anytime-anywhere/) — free development service.
- [Official cloudflared downloads](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) — Windows distribution and supported versions.
- [Vite server options](https://vite.dev/config/server-options.html) — allowed hosts, reverse proxies, and live-reload compatibility.

---

# 98. Review and Development Gate

The revised plan was reviewed and the user explicitly authorized development on 2026-10-02. The original plan-only gate is satisfied for implementation. Existing-project launches, external publication, and public tunnel creation are separate actions; do not perform them merely because code development was approved.

Development sequence, with the first milestone review boundary retained:

1. Build the smallest complete local vertical slice in section 94, using npm, a controlled fixture, and ordinary HTTP localhost access.
2. Review its process ownership, cleanup, logs, readiness, and persisted roots before expanding it.
3. Prove concurrent projects and temporary port handling, then validate Portless named local URLs with a pinned version.
4. Implement optional Cloudflare sharing against mocked/local fixtures. Perform live public checks only when explicitly authorized.
5. Finish focused reliability checks, verify offline operation, document tested limits, and produce the local Windows package.

The earlier plan-only update created no application code or running/public preview. The subsequent approved milestone creates local source and dependencies, runs isolated local fixtures, and produces a reviewable desktop build. It does not create a public preview or modify/start existing user projects.
