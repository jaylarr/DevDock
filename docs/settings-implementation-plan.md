# DevDock Settings implementation plan

Date: 2026-10-03, Asia/Taipei.

Status: implemented locally on 2026-10-03 after the user approved proceeding. All five sections are complete; see [implementation and validation](settings.md).

This document specifies the Settings feature proposed in the current discussion. It covers the initial delivery and later phases needed to deliver all five sections. Creating this plan does not authorize launching existing user projects, creating public previews, publishing, or deploying. Implementation should use isolated fixtures for verification.

## 1. Intended outcome

DevDock gains one Settings destination for appearance, discovery, behavior, local data, and diagnostics. Existing Discovery settings move into that destination with their saved exclusions intact. Frequent project actions remain on the dashboard.

The initial delivery provides the Settings navigation, Appearance, Discovery, and About & diagnostics. Subsequent phases provide behavior preferences and local data tools. Build the shared persistence model once so later phases extend the same system.

The experience should remain compact, offline-capable, and consistent with the current interface. Settings changes must have clear effects, survive reopening where appropriate, and never silently alter managed project files.

## 2. Verified starting point

These findings come from the working tree inspected for this plan, rather than assumptions about a future release.

| Area | Current behavior | Implementation consequence |
| --- | --- | --- |
| App shell | Dashboard and sidebar are rendered in `src/renderer/App.tsx`. | Add a view switch without replacing the application shell or process controls. |
| Discovery UI | Toolbar button opens a modal containing exclusions and Include again. | Move those controls into the Discovery section and remove the old modal. |
| Roots | Sidebar contains root filters and removal controls; Add folder exists on the dashboard. | Keep filtering and quick addition; consolidate removal and detailed management in Settings. |
| Theme | Main-process persistence stores one theme; the header exposes seven themes. | Preserve all seven options and move the selector into Appearance. |
| Page size | Renderer state starts at 10; choices are 5, 10, and 20. | Persist one page-size preference used by both Settings and dashboard pagination. |
| Log scrolling | Renderer state starts with auto-scroll enabled. | Add a saved default while retaining the per-view control. |
| Filters/search | Zustand stores current filter, search, and selected project in memory. | Preserve dashboard context while navigating; persist only the filter when explicitly enabled. |
| Startup discovery | Main process starts a background scan after loading the window. | Gate that call with a scan-on-launch preference, defaulting to the current behavior. |
| Launch readiness | Process start resolves after spawning; verification happens later in ProcessManager. | Automatic browser opening needs a verified-ready event, not an await of the existing start call. |
| Saved state | Version 2 stores roots, cached metadata, theme, and exclusions. | Introduce version 3 with explicit preference groups and migration. |
| State writes | Persistence serializes disk saves and uses temporary files and backups. | Also serialize service-level state commits to prevent stale full-state writes. |
| Save failures | Several service methods modify in-memory state before awaiting a save. | Settings must commit after durable save; affected discovery methods should follow the same pattern. |
| Fresh defaults | Source contains a machine-specific default exclusion. | Use an empty default for new installs; preserve explicit saved exclusions. |
| App data path | Main keeps the legacy Local Dev Manager user-data directory. | Retain that location; Settings must resolve the actual directory rather than reconstructing a guessed path. |
| Sharing | Snapshot already includes local sharing runtime availability. | Display this information without creating a tunnel or testing internet connectivity. |
| Validation | Vitest backend suites and a Playwright Electron smoke script exist. | Extend them for meaningful settings, migration, and lifecycle cases. |

Relevant existing files:

- `src/shared/contracts.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/main/services/appService.ts`
- `src/main/services/persistence.ts`
- `src/main/services/processManager.ts`
- `src/main/ports/NativePortProvider.ts`
- `src/renderer/App.tsx`, `store.ts`, and `styles.css`
- `tests/state.test.ts`, `html.test.ts`, `process.test.ts`, and `sharing.test.ts`
- `scripts/desktop-smoke.mjs` and `scripts/capture-showcase.mjs`

The working tree already contains modifications to several of these files. Implementation must inspect the latest diff and preserve unrelated work. This plan changes documentation only.

## 3. Scope and delivery boundaries

| Phase | Delivered features |
| --- | --- |
| Foundation | Settings schema, validation, state migration, reliable mutation handling, renderer view state. |
| Initial feature delivery | Settings navigation; all existing themes; persisted page size; compact density; root/exclusion management; scan-on-launch; About and local diagnostics. |
| Behavior delivery | Auto-open after verified startup; optional remembered filter; default log auto-scroll. |
| Local data delivery | Open data folder; preferences reset; settings export/import; clear discovery cache. |
| Completion | Regression tests, keyboard/layout verification, documentation and fictional screenshots. |

The initial feature delivery is reviewable on its own. All phases are part of this plan; unfinished phases must be reported as pending rather than presented as delivered.

Excluded from this feature: launch at login, tray/keep-running mode, automatic project startup, automatic sharing restoration, runtime installation, automatic update checks, arbitrary executable paths, custom launch commands, environment-variable editing, per-project runtime overrides, new package-manager execution adapters, cloud sync, accounts, telemetry, persistent logs, and local HTTPS certificate setup.

Those capabilities introduce separate lifecycle or execution changes and should receive their own design if requested.

## 4. Navigation and layout

### 4.1 Entry and return behavior

1. Add a labeled Settings button above the existing sidebar footer.
2. Opening it changes the workspace destination to Settings while retaining the sidebar and global application connection.
3. Settings defaults to Appearance on the first visit. Subsequent visits in the same session retain the last settings section.
4. The header reads DEVELOPMENT / SETTINGS and contains a Back to projects action.
5. Project filter buttons and root filter buttons navigate back to Projects and apply the selected filter.
6. Preserve search, filter, page, selected project, dashboard scroll, and current log follow state when entering and leaving Settings within a session.
7. If catalog changes remove the selected project or root, clear that selection or fall back to All projects. Clamp page to the available range.
8. Ordinary settings navigation never stops a server, cancels a scan, or ends sharing.

Use a simple typed view state such as `projects | settings`; a routing library is unnecessary for these two local destinations.

### 4.2 Section navigation

Final navigation order:

1. Appearance
2. Discovery
3. Behavior
4. Local data
5. About & diagnostics

During the first delivery, display only sections that work. Do not add disabled future controls. At the app's current minimum window size of 850 × 600, use a compact horizontal section navigation if an additional vertical navigation column crowds the content. At wider widths, a narrow section column is acceptable. Settings content scrolls independently and long paths wrap without displacing actions.

### 4.3 Visual and accessible interaction

- Match current type, borders, spacing, buttons, and theme tokens.
- Use short section introductions and concrete helper text only where effects need explanation.
- Every control has a visible label; switches expose their state to assistive technology.
- Section navigation uses ordinary navigation buttons with current-page semantics. Avoid partial tab semantics unless the complete keyboard tab pattern is implemented.
- Focus moves to the Settings heading on entry and returns to the entry button on Back to projects.
- Modal confirmations trap focus, support Escape cancellation, and restore focus to their initiating control.
- Save progress and outcomes use a polite live region; errors use an alert associated with the affected control or section.
- Support high contrast and existing reduced-motion rules. Density changes must preserve readable text and practical action targets.
- Keep a way to reach Stop All Sharing from Settings while sharing is active, preferably a compact global action in the shared header.

## 5. Complete preference specification

| Preference | Values | Default | Applies |
| --- | --- | --- | --- |
| Theme | System, Light, Dark, High Contrast, Matrix, Midnight, Sepia | System for new installs; retain existing saved value | Entire interface after successful save |
| Projects per page | 5, 10, 20 | 10 | Dashboard immediately; resets to page 1 |
| Project row density | Standard, Compact | Standard, matching current layout | Dashboard rows and expanded details spacing |
| Scan when DevDock opens | Boolean | On | Next app launch; manual/add-folder scans remain available |
| Open browser after verified startup | Boolean | Off | Launches begun after enabling it, including explicit Restart |
| Remember last project filter | Boolean | Off | Across future launches; session navigation always remembers context |
| Follow logs by default | Boolean | On | Next project-details opening and next launch |

Density is global appearance, not a second list mode. Page size is a single saved preference: changing pagination updates the same value exposed in Appearance. Log Follow remains a temporary view override and does not rewrite the default.

All controls save individually on change. There is no page-wide Save button and no unsaved form to abandon. A control remains pending until the main process confirms persistence. On failure, retain the last confirmed value and show a local error. Prevent overlapping writes to the same control; the service serializes different controls too.

## 6. Appearance section

### Contents

- Theme selector containing the existing seven theme names and values.
- Projects per page selector with existing values.
- Standard/Compact density selector with concise descriptions.

### Behavior

- Remove the header theme dropdown after Settings can provide it.
- Apply theme through the same root `data-theme` mechanism and existing CSS tokens.
- Do not duplicate saved theme into renderer local storage.
- Retain the system-theme media-query behavior without requiring an app restart.
- Theme changes inside Settings should visibly affect the entire view after confirmation.
- Standard density should reproduce current spacing. Compact reduces row padding and gaps, with no loss of project path access, status, launch, sharing, or detail controls.
- Use one density attribute or class on the app shell; avoid separate layout implementations.
- A page-size change invalidates the previous page selection, but opening Settings alone does not.

### Acceptance

Every theme, page-size choice, and density survives reopening. Theme and density remain usable at minimum size. Changing page size from either destination keeps both selectors consistent.

## 7. Discovery section and migration of existing controls

### 7.1 Registered folders

Show each registered root's name and full path, with Add folder and Remove registration controls. Full paths must remain selectable and accessible even if the summary is shortened.

Keep Add folder on the project dashboard and existing sidebar quick-add if appropriate. Move sidebar root removal into Settings so the sidebar focuses on filtering. Both addition entry points use the existing folder picker and service method.

Before removal, show the root path and number of cached projects affected. Explain that registration and catalog entries are removed while files stay intact. If any child project has a pending start, managed process, or managed sharing session, block removal with a useful message. Recheck this in the main process when applying, even if the UI showed the action enabled.

If the removed root was the active filter, return to All projects. Exclusions are independent saved configuration: removing a root does not delete exclusions beneath it.

### 7.2 Excluded folders

Reuse the current exclusion list, native folder picker, and Include again action. Existing saved exclusions appear automatically in Settings; moving the UI does not recreate them.

- Exclusion applies to a folder and its descendants using existing normalized containment rules.
- Distinct folders with the same name remain distinct projects.
- New exclusions reconcile cached results through the existing rescan.
- An excluded managed project remains reachable for stopping until it is inactive.
- Launch and new sharing remain blocked for excluded projects.
- Include again removes the exclusion and triggers the existing scan.
- Display an explanatory badge for an exclusion outside current roots; retain it because a future root can make it relevant.
- An exclusion covering an entire root remains valid. Explain its effect rather than silently discarding it.
- Disable root/exclusion mutations during an active scan and retain the service checks.
- Do not change generated-folder, symlink, application ownership, or static HTML detection policies as part of moving these controls.

### 7.3 Scan controls and notes

Add Scan when DevDock opens. Its initial value is On to preserve current behavior. Turning it off takes effect on the next launch; it does not cancel the current scan.

Keep Rescan/Cancel scan on the dashboard and expose the same action in Discovery. Adding roots and changing exclusions still scan immediately because the user explicitly changed discovery configuration, regardless of the startup toggle.

Show scan status and the latest bounded scan notes here. Retain dashboard scan notes for actionable issues. Track a last-scan completion timestamp in memory; label whether the outcome was completed, cancelled, or failed. Do not promise a previous-session timestamp unless it is actually persisted.

For startup scanning disabled, show cached entries normally and explain that the catalog has not been refreshed this session. Existing launch eligibility checks must still revalidate a project before starting it.

### 7.4 New-install exclusion policy

Remove the personal path from `initialExclusions`. New installs and legacy records without an exclusion field receive an empty list. Explicit saved arrays, including `[]` and any user-specific path, are retained. Do not silently delete an existing exclusion merely because it resembles the former source default.

This deliberately updates the old legacy-default behavior documented in the publication audit. Replace tests asserting the author's path with generic assertions. Never place that private path in new showcase fixtures or public documentation.

## 8. Behavior section

### 8.1 Automatic browser opening

Default Off. Helper text: Open the local site after a project you start becomes ready.

Implementation must subscribe to a verified-ready lifecycle event. `ProcessManager.start()` currently returns before readiness, so adding browser opening after that await would be incorrect.

Recommended event payload: project ID, a launch-generation token, and the verified local URL. Mark the launch generation as handled before invoking the browser opener, ensuring one automatic attempt per launch. Read the preference when the explicit launch begins; a setting change does not retroactively open already-running projects. A late transition from Unverified to Running can open once if the original launch opted in and is still current.

The main process handles opening and checks that the generation is current, the server is still Running, the URL matches the current verified local URL, and shutdown has not begun. Preserve static HTML entry filenames. Reuse the loopback validation and opening policy from the existing Open command. Never open a public link through this preference.

If Stop/Restart occurs before readiness, discard the obsolete generation. Explicit Restart creates a new generation and may open once. A browser-opening failure records a bounded system log and actionable notice while leaving the project Running; it must not mark the project launch as failed or retry indefinitely.

Keep manual Open available. A manual open during the brief ready-event interval should suppress a duplicate automatic attempt for that generation when practical.

### 8.2 Remember last filter

Allow only All projects, Active, Stopped, Needs attention, or a currently registered root ID. Persist a typed filter rather than arbitrary renderer strings.

- When Off, each app launch starts at All projects. Settings navigation within the same session still preserves the current filter.
- Enabling it records the current valid filter immediately.
- When On, subsequent filter selections persist through the narrow settings/view API.
- Turning it Off clears the persisted remembered filter to All projects and leaves the current session filter unchanged.
- Removing a remembered root normalizes the saved filter to All projects in the same commit.
- Do not persist search text, selected project, logs, current page, or Settings destination across launches.

### 8.3 Default log follow

The saved boolean initializes follow behavior when opening details for a project. The in-panel Follow toggle remains a session/view override. Settings navigation preserves that override for the current details view; selecting a different project applies the default anew.

Changing the default does not forcibly scroll an already-open log view. Keep fetching/rendering bounded logs using the existing log manager. This preference adds no disk logging.

## 9. Local data section

Separate actions according to what they affect. Avoid a single ambiguous Reset everything button.

### 9.1 Open app data folder

The main process opens the active user-data directory with `shell.openPath`. It respects any configured test/development data-directory override and the legacy production location. The renderer sends no arbitrary filesystem path.

Display a concise description of stored registration, cached metadata, preferences, and backups. This operation opens Explorer without deleting or rewriting files.

### 9.2 Restore preference defaults

Reset only appearance and behavior preferences, plus scan-on-launch. Restore System, 10 per page, Standard density, scan-on-launch On, auto-open Off, remembered filter Off/All, and default log follow On.

Preserve roots, exclusions, cached metadata, active processes, sharing, logs, and backup files. Explain this in the confirmation. Reset is a single persisted transaction; failed persistence restores nothing. The current filter remains a session choice, while the remembered filter resets. Page-size changes follow normal page-reset behavior.

This action may run while projects are active because it changes preferences only. It must not open existing servers or trigger an immediate scan.

### 9.3 Clear discovery cache

Remove only cached project metadata. Retain registered folders, exclusions, preferences, and all project files. Keep recovery backups; explain that a later scan rebuilds the list and may remove historical Missing entries from the catalog.

For the first implementation, block this action if a scan, pending launch, managed server, or managed tunnel exists. Count and describe the blocker. This avoids losing the catalog entries needed to stop managed resources. Do not offer an implicit Stop all action.

Recheck blockers in the main process and prevent launch/configuration operations from entering while the cache-clear commit is in progress. After success, show an empty catalog with a Rescan action. Do not scan automatically, which would immediately undo the visible cache clear. A future app launch still follows scan-on-launch.

### 9.4 Export settings

Use a native save dialog with a suggested filename such as `devdock-settings-2026-10-03.json`. Cancellation is a normal result.

The portable export is not a copy of `state.json`. Define its own format:

```ts
interface SettingsExportV1 {
  format: 'devdock-settings';
  version: 1;
  exportedAt: string;
  settings: AppSettings;
  rememberedFilter?:
    | { kind: 'status'; value: 'all' | 'running' | 'stopped' | 'errors' }
    | { kind: 'root'; path: string };
  discovery?: {
    roots: { path: string }[];
    exclusions: string[];
  };
}
```

By default export preferences only. Offer Include project folder registrations and exclusions, with concise text that these contain local paths. Never export cached project metadata, scripts, active URLs, public links, process IDs, logs, environment variables, or credentials.

Include `rememberedFilter` only while Remember last project filter is enabled; an omitted field imports as All projects. Remembered root filters are machine-specific: preference-only export converts a root filter to All projects; an export including discovery represents the remembered root by its registered path in the validated portable field. The import mapper recomputes root IDs. Do not treat source IDs as portable identity. A root-filter path must correspond to a root in the exported discovery list.

Write only to the destination selected through the main-process dialog. Use a temporary sibling and an appropriate replace strategy so failure does not leave a partially written export. Require ordinary native overwrite confirmation for an existing destination. Export never changes app configuration.

### 9.5 Import settings

Use a native file picker and bounded main-process reading, with an initial maximum of 1 MiB. Accept only the explicit portable format/version. Do not accept raw saved-state backups as imports, and do not execute anything from the file.

Import flow:

1. Choose file; cancellation changes nothing.
2. Main parses and validates it, creates an immutable normalized draft, and returns a sanitized preview plus an opaque short-lived token.
3. Preview lists changed preferences. If discovery data exists, show it separately and leave Apply folder registrations and exclusions unchecked by default.
4. Applying discovery replaces roots and exclusions as a set; the preview shows additions, removals, affected cached entry count, and unavailable paths. Do not silently merge registrations.
5. Reject a selected discovery import if a scan or managed/pending resource exists. Preference-only import can proceed while resources are active.
6. Applying requires the preview token and selected mode. Recheck blockers and configuration revision; expire stale previews rather than applying against changed state.
7. Save one candidate state, publish it after success, then report applied. Replacing discovery clears the old cache and resets invalid selections.
8. Provide Rescan after discovery import. Scanning is a separate follow-up action, so a scan failure cannot be confused with import failure.

Keep at most one preview draft per app window, expire it after a short defined interval such as five minutes, and discard it on cancellation, successful application, a new preview, or shutdown. Opening Settings alone does not create a token.

Imported preferences are strict: unknown versions, keys, invalid enum values, and wrong types fail with specific messages. Validate discovery path lists, recompute IDs, and deduplicate normalized paths. Initial conservative limits: 200 roots, 2,000 exclusions, and 32 KiB maximum per path string; document these as input bounds, not promised scale targets.

Imported paths must be absolute native Windows paths with no NUL characters. Reject device namespace paths and unsupported network roots for new imports; retain already-saved legacy registrations during ordinary migration. Canonicalize existing directories; keep unavailable ordinary local paths marked unavailable in the preview rather than silently dropping them. Imported missing roots can remain registered, and a scan can later report them. Folder registration never launches a project.

If a remembered root cannot be resolved in the selected import mode, normalize to All projects and show that in the preview. Use allowlisted field-by-field construction; do not spread arbitrary JSON into application state.

## 10. About & diagnostics section

### Display

- Product name and application version from Electron/package metadata, replacing additional hardcoded version strings where touched.
- Platform and architecture, with current Windows support limitations.
- DevDock/Electron runtime versions distinguished from the installed project Node runtime.
- Project Node and npm availability/version using the same executable/CLI resolution as launching.
- Optional sharing runtime availability/version/error already provided by the tunnel system.
- State schema version and whether startup recovered a backup.
- Registered-root and cached-project counts, active project/share counts, scan state and latest session outcome.
- Locally available usage/troubleshooting guidance.

Do not claim that detecting a runtime proves every project is compatible. Distinguish Not checked, Checking, Available, and Unavailable where applicable.

### Diagnostic execution

Collect static app metadata without subprocesses. Reuse sharing availability instead of rehashing its binary on every snapshot or log update. For Node/npm, factor the existing runtime resolver for reuse and run only fixed version commands with an explicit executable, fixed arguments, no shell, a controlled working directory, hidden Windows subprocesses, bounded output, and a timeout (initially three seconds per command).

Cache runtime diagnostics for the current app session and provide Refresh diagnostics. Opening the page may perform the first local check, but state-change notifications must not repeatedly spawn diagnostic commands. Handle missing tools and timeouts without blocking project controls. Verify resolver availability locally; do not run package installation, invoke a managed project's scripts, or make provider connectivity checks.

### Copy diagnostics

Generate a bounded text report in the main process using structured allowlisted values. Include versions, platform, schema/recovery summary, runtime status codes, counts, and scan summary. Omit absolute paths, project/root names, URLs, raw project logs, environment variables, full arbitrary error strings, and timestamps of private project activity.

Use sanitized diagnostic error codes/messages because OS errors can contain paths. Preview exactly the report that will be copied; clipboard writing requires the explicit Copy diagnostics action. Copying sends no report to an external service.

The ordinary Discovery view may show actual local scan notes; those do not automatically enter the copied report.

For documentation in the first version, render a bundled help panel or open a fixed app-owned documentation artifact if packaging supports it. Do not guess a public repository URL. Any later external links must be explicitly configured, allowlisted, and user-initiated.

## 11. Saved-state version 3

Recommended target model:

```ts
type PageSize = 5 | 10 | 20;
type Density = 'standard' | 'compact';
type SavedProjectFilter =
  | { kind: 'status'; value: 'all' | 'running' | 'stopped' | 'errors' }
  | { kind: 'root'; rootId: string };

interface AppSettings {
  appearance: { theme: Theme; pageSize: PageSize; density: Density };
  discovery: { scanOnLaunch: boolean };
  behavior: {
    autoOpenBrowser: boolean;
    rememberLastFilter: boolean;
    logAutoScroll: boolean;
  };
}

interface SavedStateV3 {
  version: 3;
  roots: RootFolder[];
  projects: ProjectMetadata[];
  exclusions: string[];
  settings: AppSettings;
  view: { lastFilter: SavedProjectFilter };
}
```

Roots and exclusions remain first-class discovery configuration, rather than being copied into `settings.discovery`. The main process remains the sole persisted-state authority.

Add `settings` and a monotonically increasing in-memory configuration revision to Snapshot. Include the effective startup filter or validated remembered view so the renderer can hydrate once. Do not persist the revision or runtime diagnostics as user preferences.

Remove duplicate top-level theme storage from the v3 model and migrate all renderer/main usages to `settings.appearance.theme`. A temporary `theme()` API wrapper may delegate to the new patch method while harnesses are updated; it must never maintain a second theme value. Remove the wrapper when all repository callers have migrated within the completed change.

Defaults come from one shared pure factory returning fresh nested objects. Validation should use allowlists and explicit construction, not a loose deep merge.

## 12. Migration, backup, and recovery rules

### 12.1 Version mapping

| Input | Required result |
| --- | --- |
| No state file | Fresh v3 defaults, empty roots/projects/exclusions |
| Valid v1 | Preserve registration and metadata; use existing script-project conversion; map saved theme; fill new defaults |
| Valid v2 | Preserve both script and static metadata, entry filenames, roots, exclusions, and theme; fill new defaults |
| Explicit empty exclusions | Preserve `[]` exactly |
| Omitted legacy exclusions | Use empty list, with no personal path injection |
| Valid v3 | Validate and load; normalize remembered filter against roots |
| Malformed individual optional preference on disk | Default that field and report a bounded warning, preserving valid catalog data |
| Invalid structural catalog/root data or damaged JSON | Use existing validated backup recovery with explicit warning |
| Future schema version | Stop writable initialization with an unsupported-version message; do not fall back to empty state or overwrite the file |

Saved disk preferences may be repaired field by field to avoid discarding the catalog for one malformed setting. IPC updates and imports remain strict and reject invalid requested values. Keep these modes explicit in validation code and tests.

### 12.2 Durability

Preserve existing `state.json.bak` and `state.json.v1.bak` behavior. Add a write-once `state.json.v2.bak` when first replacing a valid v2 primary or recovery file. A direct v1-to-v3 migration needs the v1 backup, not a synthetic v2 backup.

Validate the legacy source before making a rollback backup. Migration should persist successfully before the app enters its normal writable mode. If backup creation or migration save fails, retain the original file and show an actionable startup error. Do not continue with an apparently saved v3 configuration.

Unsupported future primary or backup formats need explicit treatment; distinguish unsupported version from corruption so ordinary recovery cannot downgrade and overwrite newer state. Restoring a legacy backup is a manual rollback operation, not an import operation. Existing older binaries do not acquire the new future-version guard: do not launch them against the migrated v3 data directory. Document rollback using the appropriate legacy backup in a separate data directory and explain that it cannot contain settings/catalog changes made after that backup.

Keep the actual app user-data directory unchanged. Never move settings into the source tree or managed project folders.

## 13. State mutation and concurrency design

Persistence's existing write queue protects file operations, but it does not prevent two service operations from creating candidates from different in-memory versions. Add an AppService commit queue for persisted configuration.

For each mutation:

1. Validate requested fields and any current-state preconditions.
2. At the serialized commit boundary, reread the latest committed state and recheck relevant guards.
3. Construct an immutable candidate from that state, updating only allowed fields.
4. Normalize dependent values, such as a remembered root filter.
5. Await atomic persistence of the candidate.
6. Publish candidate as the new state, increment configuration revision, and emit changed.
7. Perform explicitly defined follow-up work, such as a discovery scan, outside the commit queue.

Do not hold the queue for an entire scan, browser open, native picker, diagnostic subprocess, or import-preview dialog. Scan completion commits only its catalog result into the latest state, preserving preferences saved while it ran. Root/exclusion operations retain the active-scan guards, so scan input configuration remains stable.

Catalog-replacing actions need a short operation barrier covering eligibility checks through save/publication; launches and configuration operations must observe it. Guard pending startup as well as already spawned processes. UI disabled states are helpful but cannot provide the sole barrier.

If saving fails, preserve the previous state and renderer value. If a configuration save succeeds but a follow-up scan fails, return a structured outcome such as configuration applied / scan failed and show Retry scan. Do not describe the entire mutation as unsaved or silently roll back a committed exclusion.

Shutdown stops accepting new mutations, drains or rejects queued configuration work predictably, cancels/settles scans, and preserves the current process/tunnel cleanup behavior. Capture final state after committed operations; do not queue an old full-state snapshot that overwrites newer preferences.

Repeated state notifications must not rehydrate renderer view state, reset pagination, overwrite session Follow, or recreate saved filters. Hydrate once on initial load; react only to preference fields that actually changed.

## 14. IPC and preload surface

Continue the existing trusted-window/frame checks, shutdown checks, Result responses, and frozen preload bridge. No generic filesystem, shell, or arbitrary setting-path endpoint.

Proposed semantic operations; final channel spelling can follow the existing naming convention:

| Operation | Input / output | Main responsibility |
| --- | --- | --- |
| Update settings | Typed grouped patch → applied settings/revision | Strict validation and serialized commit |
| Save remembered filter | Typed filter → void | Only persist while rememberLastFilter is enabled |
| Reset preferences | Explicit action → applied settings | Atomic preferences-only reset |
| Open data folder | No path input → void | Open configured user-data directory |
| Export settings | Include-discovery boolean → cancelled/exported | Native picker, portable serialization, bounded file write |
| Preview settings import | No path input → cancelled/preview+token | Native picker, bounded parse, immutable draft |
| Apply settings import | Token, discovery choice → applied | Revision/precondition recheck and commit |
| Cancel import preview | Token → void | Dispose pending draft |
| Clear discovery cache | Explicit action → void | Recheck no active resources; replace cache only |
| Get diagnostics | Optional force-refresh boolean → structured diagnostics | Cached metadata and bounded local runtime checks |
| Copy diagnostics | Preview/report token or current report ID → void | Copy the exact previewed sanitized report |

Retain existing addRoot/removeRoot/addExclusion/removeExclusion/scan/cancelScan operations. Add explicit cancelled outcomes for new native file dialogs instead of treating cancellation as failure. Avoid inferring success from a void return when the user cancelled.

Bound all incoming string/token lengths, validate booleans literally, reject unknown patch keys, and treat input as `unknown` at the main-process boundary. Renderer TypeScript types are not runtime validation.

## 15. Renderer architecture and component boundaries

Recommended organization, without adding dependencies:

```text
src/shared/settings.ts                     defaults, types, pure preference validation
src/shared/contracts.ts                    snapshot and narrow bridge contracts
src/main/services/settingsTransfer.ts      export/import validation and portable mapping
src/main/services/diagnostics.ts           local runtime inspection and sanitized reporting
src/main/services/persistence.ts           v1/v2/v3 loading, migration, backups
src/main/services/appService.ts            serialized configuration and catalog operations
src/main/services/processManager.ts        verified-ready launch event
src/main/index.ts                          native dialogs, browser/clipboard/path operations
src/preload/index.ts                       typed bridge
src/renderer/settings/SettingsView.tsx     layout, section navigation, operation notices
src/renderer/settings/Appearance.tsx       preferences
src/renderer/settings/Discovery.tsx        root/exclusion management and scan notes
src/renderer/settings/Behavior.tsx         launch/filter/log defaults
src/renderer/settings/LocalData.tsx        bounded data actions and import preview
src/renderer/settings/About.tsx            metadata/diagnostic preview
src/renderer/store.ts                      session view and dashboard context
src/renderer/App.tsx                       shared shell and destination composition
```

Extract reusable confirmation and setting-row components only where repetition merits them. Avoid introducing a large UI framework or a generic configurable settings engine.

Keep the snapshot subscription at the app-shell level so status continues updating while Settings is open. Move page/view state into a stable parent or Zustand so switching destinations cannot discard it. Persist dashboard scroll separately per destination if unmounting the project list.

Separate settings-operation errors from dashboard errors: a failed import should not leave a stale error in project controls. Use the existing refresh sequence protection and avoid late async diagnostics/import responses replacing newer navigation state.

## 16. Ordered implementation work packages

### A. Baseline and design checkpoint

- Inspect current diff, root guidance, plan, and affected harnesses.
- Record current Settings-related behavior and baseline checks without rewriting unrelated changes.
- Confirm the fixed defaults in this document and create fictional v1/v2 fixtures.
- Record any existing failed check independently from feature regressions.

Exit: known baseline and agreed document scope; no project processes or sharing started.

### B. Settings model and migration

- Add types/defaults/validation and v3 state.
- Implement explicit v1/v2 migrations, optional preference repair, future-version protection, and write-once rollback backups.
- Remove fresh-install personal exclusion default while preserving explicit saved values.
- Introduce reliable service commit semantics; update snapshot contracts/preload incrementally.
- Adapt existing persistence/theme fixtures and tests.

Exit: fixture migration and save-failure tests pass; all existing theme values survive migration; application compiles with one settings source.

### C. Settings shell and Appearance

- Add persistent sidebar entry, section navigation, Back to projects, focus behavior, and shared operation notices.
- Preserve dashboard context during view switching.
- Move theme, persist page size, add density styles.
- Update old header selectors and screenshot harness references.

Exit: navigation and appearance work in Electron; settings survive relaunch; dashboard context survives visits.

### D. Discovery migration and startup toggle

- Move exclusions into Discovery and add root management.
- Retain quick Add folder and root filters; remove duplicate sidebar removal and old Discovery modal.
- Add startup scan preference and latest-session scan outcome.
- Normalize selections after root/catalog changes and expose clear applied-but-scan-failed feedback.

Exit: discovery behavior matches existing protections, with generic fresh defaults and all controls reachable at minimum size.

### E. About and diagnostics

- Factor installed Node/npm resolution for reuse without changing launch behavior.
- Add cached bounded diagnostics and app metadata.
- Add exact report preview/copy and local help.
- Ensure opening Settings performs no network/runtime download/public-sharing action.

Exit: initial feature delivery is reviewable; diagnostics are useful without leaking paths into copied text.

### F. Behavior preferences

- Add verified-ready event and launch-generation checks.
- Implement auto-open, optional remembered filters, and default log following.
- Cover stop/restart/shutdown timing and late readiness.

Exit: opt-in behavior works exactly once per eligible launch, with current local URL validation.

### G. Local data tools

- Add Open data folder and preferences-only reset.
- Implement portable export and import preview/apply lifecycle.
- Add catalog-replacement barrier and cache clearing.
- Cover cancellation, stale previews, malformed files, unavailable paths, active resources, and failures.

Exit: data operations have explicit effects and durable outcomes, with no project-file deletion or execution.

### H. Integration, documentation, and review

- Finish backend, IPC, renderer, and desktop coverage; update showcase fixture schema.
- Review layouts in all themes and minimum/wide sizes with fictional paths.
- Update README and publication audit for the new settings location/default policy and v3 backup behavior.
- Document supported limits, import semantics, diagnostics, and rollback caveats.
- Report initial/follow-on features actually completed and any remaining limitations.

Exit: all completion criteria below met with evidence; no publication or live sharing implied.

## 17. Validation matrix

Use focused regression tests for state, lifecycle, and data safety. Avoid tests that merely repeat component markup or mock the exact implementation under test.

| Area | Essential cases |
| --- | --- |
| Migration | v1 scripts, v2 static entry files, all existing themes, omitted/empty/nonempty exclusions, repeated migration, preserved old backups |
| Recovery | Damaged primary, valid backup, damaged both, repaired optional preference, unsupported future version without overwrite |
| Settings validation | Invalid theme/page size/density, nonboolean flags, unknown patch keys, malformed filter IDs |
| Commit behavior | Two different preference writes, preference during scan, disk failure, root-filter normalization, no partial import/reset |
| Discovery | Excluded descendants, similarly named siblings, excluded managed project retention, blocked launch/share, re-inclusion, active root removal guard |
| Startup | Scan enabled/disabled; cached entries available; disabled startup scan still permits explicit scan and guarded launch |
| Navigation | Search/filter/page/selection/scroll retained; deleted root/project fallback; no duplicate subscriptions |
| Appearance | Page-size controls synchronized and saved, all seven themes, Standard/Compact density |
| Auto-open | No open before readiness; once per generation; old event after restart ignored; stop/shutdown blocks; static filename retained; open failure keeps Running |
| Filter/log defaults | Remember Off/On/toggled/root removed; search not persisted; per-view Follow override versus default |
| Reset/cache | Reset retains registration/resources; cache clear blocked for scan/pending process/tunnel; files and backups intact; rescan explicitly available |
| Transfer | Preferences only, opt-in discovery, cancel, malformed JSON, unsupported version, oversized file, invalid paths, unavailable folders, normalized duplicates, stale preview, save failure |
| Diagnostics | Missing Node/npm, timeout, bounded output, sharing unavailable, checks cached, no network request, report omits names/paths/URLs/logs |
| IPC | Trusted renderer/frame checks retained; malformed input rejected; no arbitrary path/command access; quitting rejects new mutations |

Extend `tests/state.test.ts`, `html.test.ts`, and process tests where they own existing behavior. Add focused settings, transfer, and diagnostics suites rather than putting every case in one file.

Extend the Electron smoke script or add a dedicated settings smoke script with isolated `LDM_DATA_DIR`. Required end-to-end journey:

1. Seed a fictional legacy catalog with a theme and exclusion.
2. Launch the compiled app and verify migrated settings.
3. Navigate from page 2 with search/filter context into Settings and back.
4. Change theme/page size/density and verify persisted synchronization.
5. Manage exclusions and a spare inactive root through native-dialog stubs.
6. Disable startup scanning, relaunch, and prove cached projects appear without a new scan.
7. Start only a generated fixture; verify opt-in automatic browser target with a stubbed opener.
8. Export/import through controlled native-dialog paths; compare preview and committed state.
9. Verify reset/cache active-resource safeguards and sanitized clipboard preview.
10. Close normally and confirm fixture process/tunnel cleanup and stopped runtime on reopening.

Use bounded polling for readiness, not fixed long waits. Browser-opening and clipboard stubs should verify the target/report without sending data externally. Sharing lifecycle checks use fake providers; no real tunnel is needed.

Run after application implementation, in this order:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:desktop
```

Run focused suites during individual work packages. Run the development desktop variant only if changes affect development rendering/IPC or the compiled smoke leaves that concern unresolved. Do not run the live sharing script for this feature without separate authorization.

The plan originally specified these checks without executing them. Approved implementation subsequently completed them; current evidence is recorded in [Settings validation](settings.md).

## 18. Documentation and migration communication

Update README references from Discovery settings to Settings → Discovery and describe the sidebar entry. Update appearance instructions for the relocated theme picker and seven supported options.

Document defaults, when settings take effect, single-source pagination, per-view log overrides, and automatic opening after verified readiness. Explain that startup discovery does not start projects.

Document v3 state, retained user-data location, ordinary recovery backup, write-once legacy rollback backups, and the portable export format. Explain the distinction between settings import, clearing discovery cache, and restoring preferences. Do not advise copying raw state across app versions as a substitute for import.

Update the publication audit's personal-default item only after source/tests have changed and verification supports it. Refresh relevant screenshots with fictional roots/exclusions; never use the real catalog to illustrate import or diagnostics.

## 19. Risks and explicit mitigations

| Risk | Mitigation |
| --- | --- |
| Migration loses a saved exclusion or theme | Versioned fixtures, preserve explicit arrays, write-once legacy backups |
| New defaults retain an author's private path | Empty fresh default, generic tests, fictional screenshot seeds |
| Concurrent saves revert a preference | Service commit queue plus existing atomic persistence; scan merges catalog only |
| Disk failure leaves UI claiming a saved change | Publish state only after durable save; retain confirmed value on error |
| Import drops control of a running resource | Main-process barrier and no-active-resource guard for discovery replacement |
| Stale preview applies an outdated replacement | Immutable draft token tied to configuration revision; re-preview on conflict |
| Auto-open runs too early or twice | Verified-ready generation event and once-only handling |
| Diagnostics expose user paths | Allowlisted report with exact preview and sanitized status codes |
| Settings visit resets dashboard context | Stable session state, one-time hydration, explicit selection/page reconciliation |
| New view crowds minimum-size window | Compact section navigation, wrapping paths, independent content scrolling |
| This app overwrites a future schema | Future-version guard before recovery or writable initialization |
| Existing older binary damages v3 state during downgrade | Explicit isolated-data rollback instructions; old binaries cannot be protected by a new loader |

## 20. Completion criteria

The complete feature is finished when:

- All five functional sections are available, with no placeholder controls.
- Existing Discovery exclusions migrate intact; fresh installations have no personal default path.
- Existing themes remain available; page size, density, startup scan, and behavior preferences persist correctly.
- Dashboard context survives Settings navigation and normal catalog changes reconcile it predictably.
- Active resources remain manageable during Settings use; cache clearing/import/root removal cannot orphan them.
- Reset, export, import, and cache clear match their stated scope and handle cancellation/failure explicitly.
- Diagnostics use local bounded checks and copy only the exact sanitized preview.
- Migration, concurrency, lifecycle, IPC, and desktop checks pass or any pre-existing failure is clearly separated with evidence.
- README/audit/help and fictional screenshots accurately reflect implemented behavior.
- Core settings operate offline without added dependencies, accounts, runtime downloads, or cloud writes.

Work packages A–H are now implemented locally. The next step is reviewing the completed feature; launching existing user projects, creating public previews, and publishing remain separate actions.
