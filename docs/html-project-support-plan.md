# HTML project discovery and local serving

Date: 2026-10-02 (Asia/Taipei)

Status: **Implementation approved by the user's “Proceed!” on 2026-10-02 and completed locally.** Local version: **v0.2.0**; release remains a draft. Current behavior and validation are in `docs/html-project-support.md`. The release draft is in `docs/releases/v0.2.0-draft.md`.

This was originally a plan-only request, subsequently approved for implementation. The implementation preserves the pre-existing working-tree changes and tests isolated fixtures. Existing user-project launches, Git commits, tags, and publication remain outside this feature work.

## Goal and acceptance contract

Discover plain HTML websites alongside existing development applications. A static website receives one managed HTTP server and one localhost origin. A React, Vite, Next.js, or other application continues to use its existing development server; its HTML files do not become additional static projects.

The guarantee applies to servers launched by this manager. It cannot prevent users or custom application scripts from starting other servers independently.

- One canonical project directory has one project ID, one launch mode, and at most one pending or active managed server.
- Multiple HTML pages belong to the same website and share its server.
- Application detection takes precedence over HTML detection, including when the application cannot currently launch.
- Discovery only reads metadata and directory entries. It never runs scripts, installs dependencies, or changes managed project files.
- Start, Stop, Restart, Open, logs, exclusions, and normal app-exit cleanup work for static projects through the existing controls.
- Static serving is local and read-only, with no required package.json or project dependencies.

## Current implementation and required integration

| Existing file | Observed behavior | Planned change |
| --- | --- | --- |
| `src/main/services/projectScanner.ts` | Recursively finds package.json files with nonempty scripts.dev; skips generated folders and directory links; deduplicates visited real paths | Collect application ownership and HTML candidates separately, then resolve precedence across all roots |
| `src/main/services/detection.ts` | Classifies package managers and frameworks from package metadata/scripts | Separate framework evidence from the generic Node display fallback; add conservative static eligibility rules |
| `src/shared/contracts.ts` | Every project requires devScript and a package manager; saved schema is version 1 | Introduce distinct script/static launch metadata and a versioned state migration |
| `src/main/services/persistence.ts` | Validates version-1 script projects and registered-root membership | Load v1/v2 safely, migrate v1 projects to script mode, preserve roots/theme/exclusions/backup |
| `src/main/services/appService.ts` | Merges scan results with cached entries and retains undiscovered projects as missing | Handle superseded static entries and active runtime mode changes explicitly |
| `src/main/ports/NativePortProvider.ts` | Starts installed Node/npm and project scripts through the provider interface | Retain script behavior; add a static provider and dispatch by launch mode |
| `src/main/services/processManager.ts` | Owns one child per ID; verifies logged HTTP origins and Windows listener ownership | Reuse lifecycle/ownership checks; support truthful launch labels and a separate entry-page URL |
| `scripts/build-main.mjs` | Builds main/preload bundles only | Bundle the trusted static-server child entry into the application output |
| `src/renderer/App.tsx` | Displays dev command/package manager; enables Start/Restart only for npm | Show Static HTML/entry page and use launch capability rather than npm-only checks |

Keep the existing UI layout and discovery exclusions. No database or cloud service is needed.

## Detection and project boundaries

Use a two-phase scan. Resolve all application ownership boundaries before emitting static candidates, regardless of root order or overlapping registered roots. Retain cancellation, scan limits, unreadable-directory diagnostics, generated-folder skips, and no-link traversal.

### 1. Establish application ownership

- A valid package.json with a nonempty dev script is an application project and owns its HTML descendants.
- Recognized framework dependencies, framework configurations, or an evident existing server command also block automatic static fallback, even without scripts.dev. Report an unsupported/incomplete application diagnostic instead of serving a framework shell as a website.
- A pnpm/Yarn/Bun application remains an application when its launch adapter is unavailable. Do not substitute a static server for it.
- A package.json containing only formatting/lint tools does not by itself block static detection. For ambiguous scripts, unknown server configurations, or invalid/unreadable manifests, skip automatic fallback and explain the uncertainty.
- Package boundaries for explicit child applications remain discoverable in monorepos. Do not stop the application scan at the first parent project.

The framework helper currently returns Node when no framework matches; that display fallback must not be treated as proof that every package.json is a server project.

### 2. Select static roots conservatively

- A directory outside application ownership is eligible when it directly contains a regular `.html` or `.htm` file, case-insensitively, and has no conflicting application evidence.
- Prefer `index.html`, then `index.htm`. Otherwise select the single HTML file, or the first filename in a stable sorted order when several exist. Show the selected entry page in the details panel.
- The highest eligible static directory owns its descendant HTML pages. A `pages/about/index.html` beneath it is a route, not a new project.
- A registered container with sibling `site-a/index.html` and `site-b/index.html` discovers two websites. The container itself has no entry and is not a project.
- An HTML candidate that contains an independent application project below it is ambiguous: skip automatic static registration and report a diagnostic. This avoids serving a container that includes another application's source.
- Skip generated output directories already ignored today, including dist/build/out/.next, and do not automatically create projects from conventional documentation/example/asset subtrees such as docs/documentation/examples/public/assets. Apply these additional skips only to static discovery, preserving existing application discovery.
- A user can explicitly add a standalone documentation/example/site directory as a root to make it eligible. Explicit root selection never overrides application ownership or exclusions.
- An independent static site nested inside another static site requires explicitly registering its own root. Prefer that explicit boundary, while keeping ordinary descendant pages grouped under their parent. Stop affected active servers before adopting a new overlapping ownership boundary.
- Normalize identities from real paths, deduplicate overlapping roots, and resolve aliases before classification. Do not use one ID per HTML file.

HTML presence is a heuristic, not proof of project intent. Exclusions remain the correction mechanism for false positives. No automatic content analysis or execution is required.

### Expected outcomes

| Folder contents / context | Result |
| --- | --- |
| index.html alone | One Static HTML project |
| index.html plus CSS, JS, images, nested HTML pages | One Static HTML project; all pages share the origin |
| landing.html without index.html | One Static HTML project; Open targets landing.html |
| Several top-level HTML files without an index | One project with a deterministic visible entry page |
| package.json with formatting tools plus index.html | Static HTML if no application/server evidence exists |
| Vite dev script plus index.html and public HTML | Vite only |
| Next.js dependencies/configuration without a dev script | Diagnostic; no automatic static project |
| Node dev script plus public/index.html | Node application only |
| Unsupported package manager plus HTML | Existing application registration; no static fallback |
| Invalid package.json plus HTML | Diagnostic; no automatic static fallback |
| dist/index.html or excluded subtree | Not discovered automatically |
| Overlapping roots visiting the same website | One canonical project registration |

## Proposed metadata and migration

Keep shared identity fields (`id`, `name`, `path`, `rootId`, `slug`, `missing`) and use a discriminated project union:

```ts
type LaunchMetadata =
  | { kind: 'script'; devScript: string; manager: Manager; framework: string }
  | { kind: 'static'; entryFile: string; framework: 'Static HTML' };
```

`entryFile` is a validated filename relative to the project root, not an absolute user-supplied path. Static projects have no fictitious npm manager or dev script. Compute launch capability from metadata; do not persist runtime availability as a fact.

Data flow:

```text
Registered roots + exclusions
  -> read-only inventory -> application boundaries -> resolved project metadata
  -> AppService reconciliation -> validated atomic saved state
  -> typed snapshot -> existing project list/details
Start -> revalidate files/classification -> launch provider -> owned child server
  -> actual bound loopback origin -> HTTP + PID verification -> Running/Open
Stop/Restart/Quit -> existing managed lifecycle -> close owned server/process
```

Use saved-state version 2 for the union. Load version 1 through the existing validation rules, then add `kind: 'script'` to its projects. Preserve registered roots, IDs, names, theme, exclusions (including removed default exclusions), and valid recovery backups. Seed no new roots/projects and run no servers during migration. Unknown versions or invalid metadata must use the existing recovery/diagnostic path.

Never persist active URLs, ports, PIDs, or a running status. Do not clear all saved state just because static metadata is introduced. Older binaries will not understand v2: document rollback with a preserved v1 backup rather than promising downgrade compatibility. Retain that backup separately from the rotating backup when the first v2 write occurs.

A rescan may change a root from static to script or the reverse. Keep the canonical ID, but retain the active runtime's launch metadata and require Stop before switching modes. Before Start, recheck classification so a newly added framework manifest cannot launch through a stale static record.

Existing cached HTML descendants superseded by application ownership must not remain startable as missing static projects. Remove inactive superseded entries; retain active ones with Stop available and a diagnostic until stopped. Guard pending as well as active starts by canonical identity and resolved ownership boundaries so an application and its superseded static child cannot run together.

## Static runtime design

Implement a small trusted Node HTTP server bundled with the manager, launched as a child via a new StaticPortProvider behind a launch-mode dispatcher. Use the already required installed Node runtime for this milestone; document that requirement. Do not execute JavaScript from the project in the server process or install a third-party CLI into the project.

- Bind explicitly to `127.0.0.1`, using port 0 so the actual listener chooses a free port. Emit the actual assigned origin after successful listen; adapt the provider/result handshake to that actual port rather than reserving and releasing a candidate port.
- Invoke the bundled helper with an argument array, `shell: false`, and hidden Windows process windows. Use a trusted application-owned helper path; account for compiled output and future packaging.
- Reuse the process manager's duplicate-start, status, bounded-log, ownership verification, stop/restart, and normal-quit behavior. Logs identify static serving rather than claiming `npm run dev`.
- Keep the verified origin separate from the browser entry URL. The current localOrigin helper drops paths; extend the runtime contract so Open can use a validated entry path on that verified origin. Verify readiness against the selected entry, not just `/`.
- Serve existing HTML/CSS/JS/images/fonts and common static web assets with appropriate MIME types. Support GET and HEAD, query strings, normal relative links, and directory index pages. Unsupported methods return 405; missing assets return 404.
- No directory listings, uploads, API execution, PHP execution, server-side rendering, automatic SPA fallback, public tunnel, or live-reload watcher in this feature. Changes appear after browser refresh.
- Reject malformed URL encoding, null bytes, path traversal (including encoded separators/backslashes), hidden/configuration/credential paths, and paths outside the root. Define and test the blocked-file policy, including package/lock files, `.env`, Git files, and private keys.
- Resolve requested filesystem paths and verify containment before serving. Reject symlink/junction paths that escape the root and handle unreadable/deleted files without crashing the helper. Do not follow arbitrary project links into unrelated folders.
- Stream files with bounded request handling. Shut down the HTTP listener/connections on normal termination; retain the existing owned-process fallback for cleanup.

Serving localhost does not guarantee every page works offline: pages may reference external assets/APIs. Application-level cleanup does not gain an OS job-object guarantee through this feature.

## Implementation sequence after approval

1. Reconcile with the other agent's completed scanner/exclusion/runtime work. Confirm release numbering and freeze the final detection rules before coding.
2. Add the project union, schema migration, launch capability, and AppService reconciliation with focused state tests.
3. Add application ownership inventory and static discovery resolution with table-driven scanner fixtures.
4. Add the bundled static helper/provider and build entry; integrate entry URLs, labels, owned readiness, and cleanup.
5. Update existing row/details actions and messages for both project types. Preserve the approved layout.
6. Validate isolated fixtures, then update architecture/README/milestone evidence and finalize the local release draft. Existing user-project launches require separately identified test scope.

No commit-message/history files or Git commits are part of this request. The user will use the app's auto-commit flow later.

## Required validation before release

| Area | Meaningful checks |
| --- | --- |
| Scanner | HTML-only; HTML/CSS/JS; non-index entry; multiple pages; upper-case extensions; formatter-only package; application precedence; invalid/incomplete packages; nested apps; explicit static roots; root-order independence; exclusions; unreadable folders; cancellation; canonical deduplication |
| State | v1-to-v2 migration; removed exclusions preserved; corrupted-primary recovery; retained v1 rollback backup; bad static paths rejected; mode changes while active; superseded cached entries cannot start |
| HTTP helper | Real fixture requests for HTML/assets/HEAD/index links; query strings; MIME types; 404/405; missing entry; malformed paths; traversal; hidden/config files; symlink escape; readable sibling-prefix path cannot escape containment |
| Lifecycle | Real child listener/PID ownership; distinct ports for concurrent sites; repeated Start; pending/active overlap guards; crash/error reporting; Stop; Restart; quit leaves no fixture listener |
| Desktop | Add fixture root, scan, start/open non-index page, inspect label/URL/logs, stop/restart, rescan app precedence, reload stopped cached state, normal quit; existing npm project controls regressions |
| Offline | Start static fixture without package.json/node_modules and without fetching runtime dependencies; report external page assets as project dependencies |

Run `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`, `npm.cmd run build`, `npm.cmd run test:desktop`, and `npm.cmd run test:desktop:dev` after implementation. Record failures and evidence boundaries rather than carrying prior milestone results forward as feature proof.

Done means the acceptance contract and these relevant checks pass, UI evidence is reviewed, and the release notes describe implemented behavior. Writing this plan alone does not satisfy that release gate.

## Decisions for implementation review

Recommended defaults are specified above so the plan is implementable: automatic static discovery within selected roots; HTML/HTM support; deterministic visible entry page; no live reload or directory listing; one server per canonical project; conservative application precedence; schema v2; existing Node requirement; proposed v0.2.0.

Before implementation approval, review the conservative documentation/example skips, explicit nested-static-root behavior, and non-index entry selection. An entry-page picker can be a later feature if the default is insufficient. Reconfirm version numbering after the concurrent agent finishes; publication remains the user's later GitHub action.
