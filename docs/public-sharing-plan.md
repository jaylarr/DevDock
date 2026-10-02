# Temporary public URLs for running projects

Date: 2026-10-02 (Asia/Taipei)  
Status: **Implementation and generated-fixture public testing approved by the user's “Yes, you can proceed” on 2026-10-02. Implemented locally as v0.3.0; see `docs/public-sharing.md` for evidence and limits. Independent visitor-network verification remains pending.**

This feature expands section 97 of `plan.md` into an implementation plan for the current Local Dev Manager. The user requested temporary internet access for several running projects, including plain HTML, with access for anyone who has the generated link. That access mode is already established; the remaining decisions are recorded below.

## 1. Current stage and goal

At planning time the local app was version 0.2.0, with static HTML and a release draft but no tunnel provider, sharing IPC, or public controls. This document preserves the reviewed design; implemented behavior and evidence are tracked in `docs/public-sharing.md`. Public sharing uses the verified local server with a fresh ownership check.

Goal: start a project locally, choose **Share Online**, receive a temporary HTTPS link, and let visitors access that project while the sharing session remains active. Several projects can be shared independently. Stopping sharing leaves the local project running.

The initial request was plan-only, followed by explicit implementation approval after review. Preserve the pre-existing HTML and earlier local-manager changes. This milestone is prioritized ahead of Portless, other package-manager adapters, bulk startup, and packaging; those are not prerequisites for sharing verified HTTP origins.

## 2. Proposed scope

Included:

- Per-project Share Online, Copy Public Link, Open Public Link, and Stop Sharing.
- Separate local-server and public-sharing statuses.
- Static HTML/HTM, including a non-index entry page, multiple pages, assets, filenames with spaces, and Unicode.
- Currently launchable npm projects; common Vite and Next.js cases get specific compatibility checks.
- Simultaneous independent sharing sessions; at most one tunnel per project.
- Managed Windows cloudflared setup, diagnostics, bounded output, lifecycle cleanup, and offline regression checks.
- An optional **Stop All Sharing** action with an explicit scope: every tunnel owned by this manager, while local servers continue running.
- Documentation, validation evidence, and a local release draft after implementation.

Deferred unless the user changes scope:

- Persistent domains, permanent hosting, named local URLs, cloud deployment, and login-required access.
- Automatic public sharing on project startup or app launch.
- Serving projects that the manager does not own, arbitrary port forwarding, and sharing the manager itself.
- New pnpm/Yarn/Bun launch adapters, PHP execution, and automatic dependency installation.
- Automatically combining a frontend and a separate backend into one public origin.
- Running after the manager closes, system services, startup-at-login, and OS job-object recovery for forced crashes.

## 3. Provider, setup, and costs

Use **Cloudflare Quick Tunnels**. Cloudflare documents temporary `trycloudflare.com` URLs with no account or domain requirement. Anyone with the link can access the service; the hostname changes for a new tunnel. This is suited to development previews. [Official Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

Proposed setup during approved implementation:

1. Select a current supported official Windows executable matching this machine's architecture. Record the exact release, download URL, SHA-256, and source of the published verification data. Do not select a floating latest version at runtime.
2. Add a separate explicit setup script, proposed `npm.cmd run setup:sharing`, that prepares an app-owned runtime directory. Include the required license and notices. A locally calculated hash alone is not proof against a separately published official hash; report what verification is actually available.
3. Use that known executable path with an argument array, no shell interpolation, and a hidden process window. Verify the pinned executable's help/version before finalizing CLI flags, update suppression, origin Host handling, and connection-status parsing. Prefer structured output if the pinned version supports the officially documented JSON output; test its actual schema and readiness meaning rather than assuming a printed URL proves connection.
4. Isolate its working/configuration directory from the user's existing cloudflared account configuration. Test that existing user configuration cannot silently switch the intended Quick Tunnel behavior. Do not edit or delete the user's configuration.
5. Validate the expected version/integrity before use. Missing, corrupt, or unsupported binaries produce a useful setup error. A broken sharing runtime must not prevent offline startup or local project controls.
6. Retain the runtime for subsequent offline launches. Share Online itself will not download or replace software. Updates are an explicit maintenance operation using a newly pinned version.

No service installation, Cloudflare account setup, domain purchase, router change, or firewall-rule change is part of this implementation. Initial setup and active tunnels require internet. The proposed route uses the account-free development service and requires no purchased domain or subscription setup; future service terms and availability cannot be guaranteed. [Official provider site](https://try.cloudflare.com/), [Windows downloads and version support](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)

An installer does not exist yet. For this workspace, prepare the runtime locally after approval. Future packaging must explicitly include the binary and notices, validate its resource path, and recheck redistribution requirements before any distribution.

## 4. User experience

Keep the existing paginated project list, inline details panel, visual language, theme behavior, and compact layout.

Recommended flow:

1. **Start** the project and wait for verified **Running** status.
2. Choose **Share Online** in that project's row or details.
3. The sharing panel states: “Anyone with this link can access this project's web server. Keep this app, the project, and your internet connection running.” The initiating button is explicit: **Start sharing**.
4. Display **Connecting**, then **Sharing** with the public URL once the provider connection is established.
5. **Copy Public Link** copies the complete URL. **Open Public Link** opens the system browser. Opening/copying does not happen automatically.
6. **Stop Sharing** ends public access while the local server remains available.

Recommend a short confirmation for every new sharing session because each may expose a different project. The user may choose a direct action with the same notice visible in details instead. No repeated confirmation for copy, open, or stop.

Show local and sharing information separately: “Running locally · Connecting”, “Running locally · Sharing”, or “Running locally · Sharing error”. Add an accessible sharing badge and active-session count. Local Open remains clearly distinct from Open Public Link. Long URLs must wrap or truncate visually while copying their complete value. Validate layout at the existing minimum window size and in both themes.

Disabled Share Online explains why: project stopped, starting, unverified, missing, excluded, stopping, already sharing, or sharing runtime unavailable. A sharing error has its own message and diagnostics; it must not replace the project's local status. Stop remains available during connection startup and after a cleanup failure.

## 5. Data model and data flow

Traffic: visitor browser -> public HTTPS address -> Cloudflare -> this manager's cloudflared process -> the selected project's verified loopback HTTP server.

The public URL does not upload a website for permanent storage or move execution to Cloudflare. Cloudflare handles visitor traffic. A tunnel exposes the routes already served by that project; it does not limit access to the selected landing page or automatically remove admin/debug routes.

Proposed runtime contract:

```ts
type SharingStatus = 'disabled' | 'connecting' | 'sharing' | 'stopping' | 'error';

interface SharingView {
  status: SharingStatus;
  publicUrl?: string; // Active copy/open target, including the HTML entry path.
  startedAt?: string;
  error?: { code: string; message: string };
}
```

The backend additionally owns the project ID, verified origin, raw provider hostname, local process identity/generation, tunnel handle/PID, connection evidence, pending operation, startup deadline, and bounded log-parser state. Those internals never become commands supplied by the renderer.

Add `sharing: SharingView` to each project's runtime snapshot and a snapshot-level availability summary for the prepared sharing runtime. Schema names can be finalized during implementation without changing this behavior.

**Persistence:** no database, seed data, or saved-state migration is needed for the recommended scope. SavedState remains version 2. Active sharing statuses, tunnel PIDs, public links, session timestamps, and runtime errors are in memory only. A pinned binary manifest and notices are app runtime assets. No visitor analytics or access-log retention is added. Existing bounded project logs may include tunnel diagnostics, marked with a sharing prefix; copying logs may therefore include public links.

## 6. Implementation boundaries

| Module | Planned responsibility |
| --- | --- |
| `src/main/tunnels/TunnelProvider.ts` | Narrow provider contract with injectable process/session events for tests |
| `src/main/tunnels/CloudflareQuickTunnelProvider.ts` | Trusted executable, validated arguments, bounded output parsing, connection/exit signals |
| `src/main/services/tunnelManager.ts` | Per-project sessions, transitions, duplicate prevention, cancellation, deadlines, stop/all-stop |
| `src/main/services/processManager.ts` | Revalidate an owned origin; expose lifecycle notifications and session identity |
| `src/main/services/appService.ts` | Combine local/sharing snapshots, enforce eligibility, order cleanup, handle project exits |
| `src/shared/contracts.ts`, preload, main IPC | Typed share/stop/copy/open/all-stop actions using project IDs only |
| Renderer and styles | Sharing controls, statuses, notice, URL, diagnostics, availability |
| Setup/build scripts | Pin/download/verify runtime, notices, executable resource path |
| Tests and docs | State/race/cleanup tests, Electron flows, compatibility and external evidence |

Add proposed bridge methods `share(id)`, `stopSharing(id)`, `copyPublicLink(id)`, `openPublicLink(id)`, and, if selected, `stopAllSharing()`. Main-process handlers validate the sender and ID as existing controls do. Copy/open look up the current active URL in the backend; they do not accept a renderer-provided URL.

A fixed app-owned executable path, shell-free spawn, strict loopback origin validation, and rechecked process ownership prevent tunneling a stale port or unrelated service. Reject the manager's renderer origin/control surface explicitly, even if a registration appears to point to it. Recheck process generation after asynchronous validation so project restart or port reuse cannot attach a tunnel to a replacement server.

Accept only provider-issued HTTPS URLs under the expected Quick Tunnel hostname structure, with no credentials or unexpected ports. Never open arbitrary URLs extracted from general log text. Treat provider output as data, including malformed/chunked/very long text. Apply parser bounds before appending to logs, using the existing per-project/global log budgets.

## 7. Lifecycle and failure behavior

| Event | Expected result |
| --- | --- |
| Share Online | Fresh ownership validation, one reserved session, Connecting |
| Duplicate click / concurrent IPC | Reuse/reject the existing operation; never spawn a duplicate |
| Provider prints URL | Record candidate internally; printed URL alone is insufficient to show Sharing |
| Provider confirms connection | Publish active URL and Sharing after confirming local process generation is unchanged |
| Stop during Connecting | Cancel startup, stop owned tunnel, ignore late URL/connection events |
| Stop Sharing | Immediately disable copy/open, stop tunnel, clear active link; local project continues |
| Project Stop | Block concurrent sharing, stop tunnel first, then stop local project |
| Project Restart | End sharing before restart; require a new sharing action afterward |
| Project crash/exit | Clear active link immediately and stop the associated tunnel |
| Origin ownership lost | Stop tunnel rather than forwarding to a service that reused its port |
| Tunnel exits/disconnects | Clear active-sharing indication; show sharing error; local project remains running |
| Retry | Explicit user action creates a new session and potentially a new hostname |
| App close | Block new operations, cancel pending shares, stop all tunnels before project cleanup |
| Relaunch | No restored public URLs or automatic tunnels |
| Remove root / exclusion / changed detection | Apply existing registration rules; active/missing/excluded entries remain stoppable; ineligible entries cannot begin new sharing |

Use a proposed 60-second startup deadline and bounded graceful/forced Windows cleanup. Stop only owned process trees, using exact process handles/PIDs and existing ownership principles; never terminate by executable name or port. Cleanup failures retain ownership bookkeeping and an actionable error. Do not falsely report Disabled while an owned tunnel may remain alive. Attempt all independent cleanup operations and report aggregate failures so one failure cannot bypass the others.

Detect disconnects from tested provider signals with a short grace period to avoid toggling on individual connection messages. Also periodically revalidate local origin ownership while sharing. Final intervals and the pinned version's signal behavior are implementation choices to validate, not user-facing promises of instant detection. Do not automatically create a replacement session after persistent connection loss. Test cloudflared's own reconnect behavior and stop the process when the manager declares a failed session.

Sharing means the provider reports an active connection, not that every application route has been externally tested. Do not add repeated public HTTP probes by default: GET requests can trigger project behavior and periodic monitoring would add traffic. External functional validation is a separate controlled test.

Forced manager termination, system shutdown, sleep/resume, and independent descendants need explicit test coverage and recorded limitations. Normal cleanup is required; universal cleanup after power loss or a forced crash is not claimed. Tray/background support would require a separate design.

## 8. HTML and framework compatibility

| Project type | Planned behavior and checks |
| --- | --- |
| Static HTML with index | Tunnel the existing static origin; retain its file-serving restrictions |
| Static HTML without index | Public copy/open targets the encoded selected entry path, e.g. `/landing%20page.html` |
| Multiple HTML pages/assets | Same public origin, normal relative links; test CSS, JS, images, nested routes, GET/HEAD |
| Vite | Validate HTML/assets, Host handling, WebSocket connection and live reload |
| Next.js | Validate pages, assets, dev-origin rules, WebSocket reload and ordinary route handlers with a real isolated fixture |
| Custom npm server | Share its one verified HTTP endpoint; describe custom requirements if it rejects the public request |
| Separate frontend/API ports | Frontend sharing alone does not expose the API; scope needs the user's project details |
| Login/OAuth/cookies/redirects | Test where relevant; provider URL changes may require application allowlists or cookie/redirect configuration |
| AI streaming using SSE | Unsupported by this provider; another approach needs review |

Prefer a tunnel-only origin Host override where supported and compatible, rather than restarting the user's already-running server or disabling host checks globally. Cloudflare documents an origin Host-header option; the actual Quick Tunnel flag and its effects must be verified on the pinned executable. An override may help HTTP host validation but does not automatically fix browser Origin checks, redirects, cookies, or HMR. [Official origin parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/)

Do not modify managed source/configuration automatically. If a project needs a change, show the exact requirement for review. The implementation may use tested temporary launch options for future starts where appropriate, but must not silently restart an already-running user project. HTML sites containing absolute `localhost`, `file://`, or local-drive links also need project changes for external visitors.

The feature shares existing server behavior. It does not make admin routes read-only, prevent form submissions, scrub source maps, or disconnect development credentials. Choose safe demo projects for live tests. Static-server restrictions reduce common file exposure but are not a full audit of that site's content.

## 9. Provider limits and practical expectations

Cloudflare documentation checked 2026-10-02 states:

- Hostnames change when a new Quick Tunnel is created.
- There is no uptime guarantee; the service is intended for testing/development.
- Each tunnel supports up to 200 simultaneous in-flight requests; excess requests get HTTP 429.
- Server-Sent Events are unsupported.
- Optional email restrictions exist, but are outside the requested open-link access scope.

[Official limits and access behavior](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

The request limit is not a monthly visitor allowance or a documented simultaneous-project quota. Do not infer unlimited tunnel count from it. Start with the number of simultaneous projects the user expects, validate resource/provider behavior, and record any actual limits found. PC CPU/RAM, upload bandwidth, provider availability, and project dependencies determine practical performance. Sleep, shutdown, stopping the server/tunnel, or losing internet can interrupt access. This feature does not keep a PC awake.

## 10. Implementation sequence after approval

1. Record the user's decisions, intended project types, concurrency target, and exact live-test authorization. Review the pre-existing diff; preserve unrelated work.
2. Prepare the pinned cloudflared runtime and notices. Validate version/help/config isolation without starting a public tunnel.
3. Implement and test the provider/session manager, strict URL/origin handling, concurrency, cancellation, timeout, and bounded diagnostics using mock provider events and isolated child processes.
4. Add ProcessManager ownership/session hooks and AppService cleanup ordering. Exercise stop, crash, restart, exclusion/removal, and quit races.
5. Add IPC/preload/snapshot contracts and the agreed UI. Verify light/dark, small-window layout, accessibility, and public/local action distinctions.
6. Run the existing local regression suite plus sharing tests. Use real local HTML/Vite/Next fixtures where prepared; downloading Next dependencies belongs to the approved test setup, not automatic installation into a user project.
7. Run controlled public validation only within the user's explicit authorization. Start with a harmless generated HTML fixture; use additional fixture/user projects only as authorized. Stop every test tunnel and server afterward.
8. Update README, architecture, feature evidence, troubleshooting, and local release notes. Recommend v0.3.0 for this feature, subject to the user's release choice. No Git commit, tag, release publication, or installer distribution is implied.

## 11. Validation and evidence required

Local/mock tests must verify:

- Invalid sender/IDs/origins/public URLs cannot start sharing or open/copy arbitrary targets.
- Stopped, unverified, missing, excluded, unrelated, or manager-owned UI endpoints cannot be shared.
- Fresh ownership/session validation catches port reuse and stop/restart races.
- Duplicate start and start/stop/quit races create one session, with no surviving abandoned child.
- Chunked URL output, Unicode, malformed output, missing/corrupt binary, no connection event, exit, disconnect, and timeout yield bounded correct states.
- A printed URL without connection evidence never becomes Sharing.
- Stop Sharing preserves the local server; project stop/restart/crash and manager quit clean up tunnels appropriately.
- Failed cleanup remains visible and retryable, including quit failure.
- Several concurrent projects have distinct links and independent stops.
- Non-index HTML entry URLs are encoded correctly; other pages/assets retain working relative paths.
- Saved-state read/write and application relaunch never restore sharing.
- No sharing-provider contact or automatic download occurs when sharing is disabled. Offline local discovery/start/stop remain usable.

Run `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`, `npm.cmd run build`, `npm.cmd run test:desktop`, and `npm.cmd run test:desktop:dev` as appropriate. Add meaningful provider/lifecycle tests and compiled Electron sharing flows. A mock executable stays isolated in test-only dependency injection; production IPC never accepts executable paths. Record actual counts/results after implementation, not predicted passes.

Live acceptance, separately authorized:

1. A harmless isolated HTML fixture is reachable through public HTTPS from an independent external connection.
2. Verify its selected page, secondary page, and assets, then multiple simultaneous fixture links.
3. Validate isolated Vite and Next.js pages/assets and WebSocket reload if those cases are in the agreed scope.
4. Stop one tunnel; its public content stops being served while the local project and other public links remain working.
5. Test restart, quit, and connection loss/retry, documenting actual recovery and failure timing.

A same-PC public-URL fetch is useful evidence of the provider path but is not proof from an independent visitor network. If an external test environment is unavailable, explicitly leave that acceptance item pending and provide a phone-on-mobile-data checklist for the user. Do not claim full external acceptance from mocks or localhost checks.

## 12. Rollout and rollback

The feature adds optional runtime assets and controls to the existing app. Keep local controls functioning when the runtime is missing or sharing fails. Stop sharing before replacing or removing a binary. With no saved-state migration, rollback can return to the current local-only build using the same version-2 metadata; preserve the user's current state and project files. Old links cannot be restored.

Before a local release, verify binary availability in both dev and compiled launch paths, version alignment, notices, documentation, and normal cleanup. Before future packaging, validate packaged-resource paths and license notices separately. Publication and existing private-project exposure require their own explicit scope.

## 13. Decisions and questions for the user

Already specified: anyone with the generated link may visit; several projects, including HTML, must be supported. No account restriction needs to be chosen again.

| # | Question | Recommendation / effect |
| --- | --- | --- |
| 1 | Are temporary changing URLs acceptable, with access requiring your PC, manager, server, and internet to remain running? | Yes: proceed with Quick Tunnels. If you need stable links or access with the PC off, this requires a different hosting plan. |
| 2 | Which project types and names matter first? Do any use a separate API port, login/OAuth, or streamed AI responses? | HTML and Vite first, plus Next.js if used. Provide names/paths for assessment only; this does not authorize starting or exposing them. SSE needs another approach. |
| 3 | How many projects should be shared simultaneously in your normal use? | Give the expected number; use it for concurrency tests. No arbitrary provider quota is assumed. |
| 4 | Should Share Online show a short confirmation for each new session, or start directly with the notice visible in details? | Short confirmation per session; copy/open/stop stay immediate. |
| 5 | Are row/details controls enough, or do you also want Stop All Sharing? | Add Stop All Sharing; keep sharing startup per project. No Share All in this milestone. |
| 6 | Is it acceptable that project restart, persistent connection failure, and app close end sharing, and that retry is manual? | Yes: clear lifecycle with no restored sessions. Background/tray operation is a separate feature if needed. |
| 7 | After implementation approval, may setup download and prepare the pinned official Windows cloudflared runtime locally? | Yes: app-owned portable binary and notices, no service or account setup. Without it, implementation can be locally tested but real sharing remains unavailable. |
| 8 | Which controlled public tests do you authorize after local checks pass? | Harmless generated HTML and Vite fixtures, plus Next.js if selected; no existing private project. You may defer all live tests. An independent network check may require your phone/mobile data. |
| 9 | Should the validated feature get a v0.3.0 local release draft, or remain in the current unreleased version? | v0.3.0 local draft. No commit/tag/publication implied. |

The user may accept the recommendations together and supply project types/names and a concurrency count. Missing authorization for live testing is never treated as consent. After answers are recorded, implementation approval should cover the agreed feature and runtime setup; live testing covers only the explicitly chosen targets.

### Review responses recorded 2026-10-02

- **Purpose:** temporary previews for visitors; permanent deployment and background hosting are unnecessary. Preview intent does not technically disable application writes or restrict visitors to viewing; existing app behavior still applies.
- **1:** changing temporary links accepted. Clarification supplied: Quick Tunnels forward to the PC, so it must remain on with the local project and manager running. A deployed cloud copy would have a different lifecycle.
- **2:** user requested an explanation of project/framework, separate backend, login/OAuth, and streaming compatibility. No specific project names/types or additional application changes have been selected. HTML and currently supported npm servers remain the baseline; framework-specific compatibility must be verified rather than presumed.
- **3:** target at least three simultaneous independent sharing sessions, with typical use of one. Validate three; this is a capability/test target, not a provider quota or requested hard maximum. Explain bandwidth/process cost and lifecycle complexity before implementation.
- **4:** short confirmation accepted for each new sharing session.
- **5:** Stop All Sharing accepted; local servers remain running.
- **6:** simple lifecycle accepted: restart, persistent connection failure, and manager close end sharing; retry remains manual. No background/tray behavior requested.
- **7:** permission granted to prepare/download the official Windows executable as part of approved implementation. No additional download permission is needed later within this scope. The user called it proprietary; cloudflared's official repository identifies it as Apache-2.0 open source. Setup remains portable/app-owned, without service/account setup.
- **8:** user requested an explanation of controlled public testing. Public test authorization remains pending. Recommend publicly exposing only generated harmless HTML/Vite fixtures, validating reachability and cleanup, and explicitly leaving existing projects out of those tests. Next.js fixtures are conditional on the agreed compatibility scope.
- **9:** user accepted the proposed next release, described verbally as “3.0”. Record the intended next local draft as **v0.3.0**, consistent with the question and current v0.2.0; a literal major-version v3.0.0 would require correction from the user. Publication is not authorized by this choice.

This turn continues plan review. No tunnel was started, runtime downloaded, existing project launched, or implementation performed. Once the remaining questions are answered, obtain explicit implementation approval for the agreed plan; do not request runtime download permission again.

### Final authorization and result

The user authorized compatibility inspection during implementation and temporary public tests after the explanation, then said “Yes, you can proceed.” Implementation and runtime setup are approved. Live tests are restricted to generated harmless demo projects, including HTML/Vite/Next.js; existing projects may be inspected read-only but are not authorized for launch/exposure by this approval.

The feature is implemented as v0.3.0 with three simultaneous generated previews, short confirmation, compatibility hints, Stop All Sharing, simple cleanup/manual retry, and a local release draft. No existing project was launched/shared, no project configuration rewritten, and no Git commit/tag/publication performed. Actual behavior differs from speculative schema examples where needed: errors follow the existing typed Result/message style, and SavedState stays v2. See `docs/public-sharing.md` for validation and remaining limitations.

## 14. References

- Existing workspace scope and approval boundaries: `plan.md`, section 97; current `README.md`, `docs/architecture.md`, and `docs/releases/v0.2.0-draft.md`.
- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/): temporary URLs, access, lifecycle, limitations.
- [Cloudflare Quick Tunnel site](https://try.cloudflare.com/): development-preview service offering.
- [Cloudflared official repository](https://github.com/cloudflare/cloudflared): releases, source, license, and notices; recheck the selected version during setup.
- [Cloudflare Windows downloads/version support](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/): official runtime distribution and manual updates.
- [Cloudflare origin parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/): origin Host header; CLI compatibility remains to be tested.

Provider facts were reviewed on the date above. Recheck them before runtime selection and before a future provider/version change. Everything described as proposed remains unimplemented until approved and validated.
