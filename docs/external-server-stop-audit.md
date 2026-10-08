**DevDock external-server stop audit — 8 October 2026, Asia/Taipei**

This work covers only the failure to stop development servers started through Codex, with VS Code as the comparison. It does not audit sharing, discovery generally, unrelated projects, or other application features. The initial audit left application source and the user's server unchanged. Following authorization to fix the issue, the stop helper was repaired and the user's exact reported server was successfully stopped. Repair evidence follows the initial audit below.

**Current assessment:** fixed in the local source and rebuilt application. Windows PowerShell 5.1 decoded the target list as a nested array because the helper wrapped `ConvertFrom-Json` output in `@()`. With two processes, resolving the PID attempted to cast an array to an integer and failed before termination. Removing the extra wrapper corrected the failure on the actual Vite runtime and esbuild worker from the user's logs. The following numbered sections record the initial audit, before that cause was established.

1. **What the reported message establishes**

   The reported message is: “The external server could not be stopped safely. Refresh and retry, or stop it in its original terminal.” It is constructed in `src/main/services/externalServerStop.ts:31`.

   The button passes the displayed server PID, creation timestamp, and port through IPC to `AppService.stopExternal()`. `ExternalServers.stop()` refreshes native process and listener metadata, rejects unavailable verification, and runs `planExternalStop()` before invoking the native helper. These earlier failures have different messages.

   Under this code path, the reported message means the request reached the Windows stop helper. It does not establish that Windows denied permission, that a safety rule rejected Codex, or even that termination began: starting PowerShell can itself fail and produce this message.

2. **What the native helper does**

   `src/main/services/externalServerStop.ts:19` builds a Windows PowerShell script. The script resolves every target process, opens its handle, reads its creation time and executable name, and compares those values with the refreshed inventory. Creation-time differences of one millisecond or more are rejected.

   Only after all targets pass those checks does the script attempt to kill them. It then waits up to two seconds per process for exit. The entire PowerShell child has a ten-second timeout. The stop plan normally places listening runtimes first and their workers afterward; editor and terminal ancestors are excluded.

   Therefore, a failure while opening or validating any target prevents the kill loop from starting. A failure during the kill loop can occur after an earlier target was already stopped. Both cases produce the same generic error. The application refreshes server state after a stop failure, but that refresh does not recover the discarded native exception.

3. **Confirmed finding: the underlying reason is discarded**

   The PowerShell process is launched with `stdio: 'ignore'` at `src/main/services/externalServerStop.ts:30`. Its error output is not collected. The JavaScript failure callback also ignores the spawn error details, and a nonzero exit status becomes the same generic message.

   Consequently, DevDock cannot tell the user whether the failure occurred while starting PowerShell, resolving a process, opening a handle, reading identity metadata, comparing identity, requesting termination, waiting for exit, or reaching the overall timeout.

   This is a confirmed diagnostic defect. It is directly relevant to the report because the precise cause cannot be recovered from the displayed message or existing project logs. It is not proof of the underlying termination defect.

4. **Confirmed finding: the existing native test does not cover the reported Codex workflow**

   `scripts/external-servers-smoke.mjs` starts Vite inside an isolated VS Code terminal and clicks Stop external server in an isolated DevDock instance. It checks that the real port closes while the editor and terminal remain open. That is useful VS Code coverage.

   It does not start a server through a native Codex session and then stop it through the DevDock UI after the agent task finishes. Several unit tests inject a fake `stopProcesses` function; they validate planning, service state, failures, and serialization without exercising native termination.

   The previous native VS Code pass is historical evidence, not a fresh VS Code smoke run during this audit. The source of that test was inspected during this audit.

5. **What was verified on the live Codex-started server**

   The earlier audit snapshot found `sharpened-website`, listening on port 4173, with Node PID 17804 and esbuild worker PID 22088. Its recorded ancestry was `ChatGPT.exe → codex.exe → pwsh.exe → cmd.exe → npm's node.exe → cmd.exe → Vite's node.exe`. This is a snapshot, not a promise that the same PIDs or port remain current.

   The planner selected the Vite runtime and esbuild worker. It did not select Codex, ChatGPT, the shell, or npm ancestors. Planning also passed with the observed DevDock main-process PID.

   A read-only check using the exact Windows PowerShell executable used by DevDock opened both process handles and passed the birth-time/name checks. The birth-time differences were approximately 0.5772 ms for Node and 0.8566 ms for esbuild, both below the one-millisecond threshold.

   These checks establish that this snapshot could be detected and planned, and that the read-only identity checks passed from the audit context. They do not establish that termination succeeds from the running DevDock process. The user's server was deliberately left running.

   An initial check in a different PowerShell runtime showed an eight-hour discrepancy. Repeating it with DevDock's actual Windows PowerShell executable resolved that discrepancy and passed. The audit does not identify a timezone bug in the application's stop helper.

6. **What the test results establish, and their limits**

   The focused suite, `tests/external-servers.test.ts`, passed all 17 tests outside the restricted tool sandbox. The first run passed 15 and failed two due to fixture `realpath` EPERM restrictions. The successful rerun distinguishes those audit-environment failures from application behavior; it does not reproduce the user's click.

   A temporary, simple Node HTTP server launched through a Codex tool command was detected, planned, stopped through the native helper, and verified no longer listening. Only that fixture was terminated.

   This temporary check invoked the source helper through a command-line harness outside the restricted tool sandbox. It did not invoke the button in the user's running Electron application and did not include a Vite/esbuild worker tree. It demonstrates that a simple Codex tool-started process can be stopped under the tested conditions. It does not establish that every Codex-started project works.

7. **Possible causes that remain unconfirmed**

   A permission or execution-context difference could explain why the same helper succeeds in a harness but fails in the application. However, the current evidence does not establish a Windows access-denied failure.

   A worker could exit between inventory refresh and native handle acquisition. Because the script validates every planned target before killing anything, an already-exited worker can abort the request before the listening server is stopped. This is a concrete failure path in the implementation, but it was not observed as the cause of the user's report.

   An identity mismatch, failure while killing a process, an exit-wait failure, or the overall timeout can also generate the reported message. No one of these should be called the root cause without the native diagnostic.

8. **Why task completion and terminal availability matter**

   The external stop implementation is driven by native listening processes and verified identities, rather than by whether an agent is currently working. Finishing a Codex task does not itself guarantee that its server process exits. For a project-local runtime entry path, detection can still work without a live Codex terminal report.

   DevDock's stop helper does not send Ctrl+C through an editor integration; it forcefully terminates verified server processes. Its error text nevertheless tells the user to use the original terminal. That fallback is inadequate for the reported workflow because the user cannot access or stop the server there. This is a user-facing recovery gap, separate from the unknown native failure.

9. **Recommended repair sequence, not implemented by this audit**

   First, preserve a bounded, sanitized native diagnostic containing the stage, target PID, executable name, exit or Windows error code when available, and timeout status. Avoid recording full process command lines or environment values. Distinguish launch failure, access failure, identity change, already-exited target, termination failure, and timeout in the user-visible explanation.

   Second, reproduce the actual failing workflow through the Electron UI with a Codex-started server and worker tree, including after task completion. Capture the diagnostic from that context. A simple command-line fixture is insufficient acceptance evidence for the reported defect.

   Third, fix the evidenced cause while retaining PID-reuse validation and protection of editors, shells, DevDock, and unrelated projects. If an already-exited worker is the cause, handle that specific situation without treating identity mismatches or arbitrary permission failures as safe to ignore. If access rights are the cause, inspect the actual runtime context before choosing a remedy.

   Finally, add a native Codex regression test and make the failure message useful when no interactive original terminal is available. Do not prescribe running everything as administrator, kill the entire Codex process tree, or weaken identity checks based solely on the current generic message.

**Initial audit status:** the failure boundary, diagnostic defect, test-coverage gap, and recovery-message gap were identified; the exact native failure was not yet established at this stage.

**Follow-up evidence supplied on 8 October 2026**

The user supplied project logs showing the detected server as PID 17804 on port 4173. Two stop requests logged “Stopping the verified external development server” before reporting the native helper's generic failure. The first request ran from 03:18:51.561Z to 03:18:56.177Z (4.616 seconds); the second ran from 03:30:05.790Z to 03:30:08.177Z (2.387 seconds). In Asia/Taipei, these started at 11:18:51 and 11:30:05 on 8 October.

These logs confirm that both requests passed fresh verification and planning and reached the native stop helper. Neither recorded interval reaches the configured ten-second timeout. Timing alone does not distinguish a handle/identity failure, a kill failure, or an exit-wait failure. In particular, the second interval is compatible with a two-second wait plus helper startup, but it is not proof that `WaitForExit(2000)` was the failing operation.

An additional controlled check started a temporary Vite server through a Codex tool command, registered only that fixture in a separate DevDock data directory, and clicked Stop external server in an isolated Electron application. The audit harness captured native helper output by wrapping the child-process spawn in memory; production application files were not modified. The helper exited with code 0, without stderr, and the project changed from Unverified to Stopped. This fixture's HTTP readiness was not established; it was verified as a detected listening runtime. The helper took 6.753 seconds. Evidence is saved locally in `.test-artifacts/codex-vite-ui-stop-result.json`.

This extended the audit beyond the initial command-line helper test and exercised the UI, IPC, backend planner, and native termination. It did not reproduce the user's failing runtime or identify its cause at this stage. The user's original server on port 4173 was not targeted during this audit phase.

**Repair and verification after authorization to fix**

The stop helper was first changed to emit bounded structured diagnostics: operation stage, target PID, controlled failure reason, and native Windows error code when available. The original reported process was freshly revalidated as Vite PID 17804, creation time `2026-10-08T02:47:23.473Z`, port 4173, and the registered Sharpened project. Its worker was esbuild PID 22088. Attempting the same stop with diagnostics reproduced failure before process lookup, while handling the decoded target list.

A read-only Windows PowerShell 5.1 reproduction with two sample process records established the exact mechanism. `$wrapped=@($json | ConvertFrom-Json)` produced one outer element of type `System.Object[]`; that element's `.pid` was also an array. Casting it to `[int]` failed with “Cannot convert the System.Object[] value ... to type System.Int32.” Direct assignment, `$targets=$json | ConvertFrom-Json`, produced the two expected process records. The simple one-process fixture had not exposed this defect.

The repair removes the extra array wrapper. It also tolerates a process already absent at native lookup, keeps identity checks for live targets, and replaces the generic failure with a bounded explanation of the failing operation. Process planning and protection of Codex, terminal ancestors, DevDock, and unrelated project trees were retained.

With the corrected helper, the actual Vite PID 17804 and esbuild PID 22088 stopped successfully, and the original PID was verified no longer listening on port 4173. Only the freshly verified stop plan was passed to the native helper; editor and terminal ancestors were excluded.

Regression coverage includes `npm.cmd run test:external-stop`, which creates two known Node identities and verifies native multi-process termination, rejection of a wrong worker birth time before stopping either process, and successful stopping when the worker has already exited. The synthetic test targets only its own server and worker, never console-host processes. The focused external-server unit suite passed 18 tests. Type checking, the production build, and lint passed.

The existing VS Code smoke's native identity-mismatch assertion was updated to expect the new specific message. This repair does not claim a fresh full native VS Code smoke run. The rebuilt app must be reopened to load the new backend code; an already-running DevDock process retains its old implementation.

An isolated Electron UI check against the rebuilt application also passed: Stop external server changed the temporary Codex tool-started Vite fixture from Unverified to Stopped, and the native helper returned `{"ok":true}` with exit code 0. Its captured stop payload contained one live runtime; multi-process behavior is evidenced separately by the actual Vite/esbuild stop and the dedicated native regression. The temporary fixture was cleaned up after the test.
