import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { themes, externalSources, externalLabels, type Result, type Snapshot } from '../shared/contracts';
import type { Diagnostics, ImportPreview, SettingsPatch } from '../shared/settings';

const sections = ['Appearance', 'Discovery', 'External activity', 'Behavior', 'Local data', 'About & diagnostics'] as const;
type Section = typeof sections[number];
function contains(parent: string, child: string): boolean {
  const normalize = (value: string) => value.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase();
  const a = normalize(parent); const b = normalize(child); return a === b || b.startsWith(`${a}\\`);
}
function Row({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return <div className="setting-row"><div><strong>{title}</strong>{detail && <p className="muted">{detail}</p>}</div><div className="setting-control">{children}</div></div>;
}
function Toggle({ label, checked, disabled, change }: { label: string; checked: boolean; disabled: boolean; change(value: boolean): void }) {
  const [requested, setRequested] = useState<boolean>();
  useEffect(() => { if (!disabled) setRequested(undefined); }, [disabled, checked]);
  const displayed = requested ?? checked;
  return <label className="settings-toggle"><input type="checkbox" aria-label={label} checked={displayed} disabled={disabled} onChange={(event) => { setRequested(event.target.checked); change(event.target.checked); }} /><span>{displayed ? 'On' : 'Off'}</span></label>;
}
function Confirm({ title, children, label, disabled, working = false, cancel, confirm }: { title: string; children: ReactNode; label: string; disabled: boolean; working?: boolean; cancel(): void; confirm(): void }) {
  const element = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { const dialog = element.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={element} className="settings-confirmation" aria-labelledby="settings-confirm-title" onCancel={(event) => { event.preventDefault(); if (!working) cancel(); }}>
    <h2 id="settings-confirm-title">{title}</h2>{children}<div className="settings-actions"><button autoFocus className="button secondary" disabled={working} onClick={cancel}>Cancel</button><button className="button primary" disabled={disabled} onClick={confirm}>{label}</button></div>
  </dialog>;
}
export function SettingsView({ snapshot, active, filter, refresh }: { snapshot: Snapshot; active: boolean; filter: string; refresh(): Promise<void> }) {
  const [section, setSection] = useState<Section>('Appearance');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; body: ReactNode; label: string; action(): Promise<Result<unknown>> }>();
  const [includeDiscovery, setIncludeDiscovery] = useState(false);
  const [preview, setPreview] = useState<ImportPreview>(); const [applyDiscovery, setApplyDiscovery] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostics>(); const heading = useRef<HTMLHeadingElement>(null); const content = useRef<HTMLDivElement>(null);
  const mounted = useRef(true); const operation = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (active) heading.current?.focus(); }, [active]);
  useLayoutEffect(() => { content.current?.scrollTo({ top: 0 }); }, [section]);
  async function run<T>(action: () => Promise<Result<T>>, success = 'Saved.', receive?: (value: T) => void): Promise<boolean> {
    if (operation.current) return false; operation.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const result = await action();
      if (!result.ok) { if (mounted.current) setError(result.error); return false; }
      if (mounted.current) { receive?.(result.value); if (success) setMessage(success); } return true;
    } catch (issue) { if (mounted.current) setError(issue instanceof Error ? issue.message : 'Desktop operation failed.'); return false; }
    finally { if (mounted.current) { await refresh(); setBusy(false); } operation.current = false; }
  }
  useEffect(() => {
    if (active && section === 'About & diagnostics' && !diagnostics) void run(() => window.devManager.getDiagnostics(), '', setDiagnostics);
    // Local checks run on first entry, never on ordinary state notifications.
  }, [active, section]);
  const settings = snapshot.settings;
  const patch = (value: SettingsPatch) => void run(() => window.devManager.updateSettings(value));
  const catalogBlocked = snapshot.scanning || snapshot.projects.some((project) => project.managed || project.sharing?.managed);
  const cancelPreview = () => { if (preview) void run(() => window.devManager.cancelImport(preview.token), '', () => setPreview(undefined)); };
  return <section className="settings-page" aria-label="Settings">
    <div className="page-heading"><div><h1 tabIndex={-1} ref={heading}>Settings<span className="heading-dot">.</span></h1><p className="muted">Your preferences and local workspace configuration.</p></div></div>
    <nav className="settings-navigation" aria-label="Settings sections">{sections.map((name) => <button key={name} className={`button ${section === name ? 'selected' : 'secondary'}`} aria-current={section === name ? 'page' : undefined} onClick={() => { setSection(name); setError(''); setMessage(''); }}>{name}</button>)}</nav>
    <div className="settings-feedback"><span role="status" aria-live="polite">{busy ? 'Working…' : message}</span>{error && <p className="detail-error" role="alert">{error}</p>}</div>
    <div className="settings-content" ref={content}>
    {section === 'Appearance' && <><h2>Appearance</h2>
      <Row title="Theme" detail="System follows your Windows appearance."><select aria-label="Appearance" disabled={busy} value={settings.appearance.theme} onChange={(event) => patch({ appearance: { theme: event.target.value as typeof settings.appearance.theme } })}>{themes.map((theme) => <option key={theme.value} value={theme.value}>{theme.label}</option>)}</select></Row>
      <Row title="Projects per page" detail="Also updates the project list pagination."><select aria-label="Default projects per page" disabled={busy} value={settings.appearance.pageSize} onChange={(event) => patch({ appearance: { pageSize: Number(event.target.value) as 5 | 10 | 20 } })}>{[5, 10, 20].map((size) => <option key={size}>{size}</option>)}</select></Row>
      <Row title="Project row density" detail="Compact gives more space to your project list."><select aria-label="Project row density" disabled={busy} value={settings.appearance.density} onChange={(event) => patch({ appearance: { density: event.target.value as 'standard' | 'compact' } })}><option value="standard">Standard</option><option value="compact">Compact</option></select></Row>
    </>}
    {section === 'Discovery' && <><h2>Discovery</h2>
      <Row title="Scan when DevDock opens" detail="Refreshes cached projects on the next launch. Projects stay stopped."><Toggle label="Scan when DevDock opens" checked={settings.discovery.scanOnLaunch} disabled={busy} change={(scanOnLaunch) => patch({ discovery: { scanOnLaunch } })} /></Row>
      <div className="settings-section-heading"><h3>Registered folders</h3><button className="button small primary" disabled={busy || snapshot.scanning} onClick={() => void run(() => window.devManager.addRoot(), '')}>Add folder</button></div>
      <p className="muted">Register folders containing your projects. Removing a registration keeps your files.</p>
      <ul className="settings-paths">{snapshot.roots.map((root) => {
        const projects = snapshot.projects.filter((project) => project.rootId === root.id); const managed = projects.some((project) => project.managed || project.sharing?.managed);
        return <li key={root.id}><div><strong>{root.name}</strong><code>{root.path}</code><span className="muted">{projects.length} cached projects{snapshot.exclusions.some((exclusion) => contains(exclusion.path, root.path)) ? ' · Entire folder excluded' : ''}</span></div><button className="button small secondary" aria-label={`Remove registration for ${root.name}`} disabled={busy || snapshot.scanning || managed} title={managed ? 'Stop managed projects and sharing first.' : 'Remove registration only'} onClick={() => setConfirm({ title: 'Remove folder registration?', body: <><p><code>{root.path}</code></p><p>Removes this registration and {projects.length} cached project entries. Files and exclusions are kept.</p></>, label: 'Remove registration', action: () => window.devManager.removeRoot(root.id) })}>Remove registration</button></li>;
      })}</ul>{!snapshot.roots.length && <p className="muted">No folders registered.</p>}
      <div className="settings-section-heading"><h3>Excluded folders</h3><button className="button small primary" disabled={busy || snapshot.scanning} onClick={() => void run(() => window.devManager.addExclusion(), '')}>Exclude folder from discovery</button></div>
      <p className="muted">Excluded folders and their contents stay out of discovery. Managed projects remain accessible until stopped.</p>
      <ul className="settings-paths">{snapshot.exclusions.map((item) => <li key={item.id}><div><code>{item.path}</code>{!snapshot.roots.some((root) => contains(root.path, item.path) || contains(item.path, root.path)) && <span className="muted">Outside registered folders</span>}</div><button className="button small secondary" disabled={busy || snapshot.scanning} onClick={() => void run(() => window.devManager.removeExclusion(item.id), 'Folder included again.')}>Include again</button></li>)}</ul>
      {!snapshot.exclusions.length && <p className="muted">No folders excluded.</p>}
      <div className="settings-section-heading"><h3>Scan results</h3><button className="button small secondary" disabled={busy} onClick={() => void run(() => snapshot.scanning ? window.devManager.cancelScan() : window.devManager.scan(), snapshot.scanning ? 'Cancellation requested.' : 'Scan completed.')}>{snapshot.scanning ? 'Cancel scan' : 'Rescan'}</button></div>
      <p className="muted">{snapshot.scanning ? 'Scanning…' : snapshot.lastScan ? `Last scan ${snapshot.lastScan.outcome} · ${new Date(snapshot.lastScan.at).toLocaleTimeString()}` : 'Catalog has not been refreshed this session.'}</p>
      {snapshot.diagnostics.length ? <details className="notice"><summary>Scan notes ({snapshot.diagnostics.length})</summary>{snapshot.diagnostics.map((note, index) => <p key={index}>{note}</p>)}</details> : <p className="muted">No scan notes.</p>}
    </>}
    {section === 'External activity' && <><h2>External activity</h2>
      <Row title="Detect external activity" detail="Updates project badges and recent activity from connected local tools every five seconds."><Toggle label="Detect external activity" checked={settings.discovery.externalActivity} disabled={busy} change={(externalActivity) => patch({ discovery: { externalActivity } })} /></Row>
      <p className="muted">Registered project folders are matched to open tools and listening servers. VS Code can stream output from dev commands when shell integration is enabled. Other command output, prompts, source code, and terminal history are not collected.</p>
      <div className="settings-section-heading"><h3>Local integrations</h3><button className="button small secondary" disabled={busy || snapshot.externalDetection?.checking || !settings.discovery.externalActivity} onClick={() => void run(() => window.devManager.refreshExternalActivity(), 'Activity checked.')}>Check now</button></div>
      {snapshot.externalDetection?.error && <p className="detail-error" role="alert">{snapshot.externalDetection.error}</p>}
      <p className="muted">{snapshot.externalDetection?.checkedAt ? `Last check ${new Date(snapshot.externalDetection.checkedAt).toLocaleTimeString()}` : 'Waiting for the first activity check.'}</p>
      {externalSources.map((source) => <Row key={source} title={externalLabels[source]} detail={snapshot.externalDetection?.connected.includes(source) ? 'Connected · activity received.' : snapshot.externalDetection?.installed.includes(source) ? 'Installed · waiting for activity.' : 'Set up the local bridge to connect this tool.'}><button className="button secondary" disabled={busy} onClick={() => void run(() => window.devManager.setupExternalActivity(source), '', setMessage)}>{snapshot.externalDetection?.installed.includes(source) ? 'Repair' : 'Set up'} {externalLabels[source]}</button></Row>)}
      <details className="settings-help"><summary>Connection help & supported tools</summary>
        <p>VS Code reports open local workspace folders and dev-command output. Reload existing windows after setup or Repair. Live output requires terminal shell integration and a dev command started after the bridge connects; earlier terminal output is unavailable. Remote, WSL, and container workspaces are skipped.</p>
        <p>Codex uses lifecycle hooks. Review and trust the installed DevDock hooks in Codex before they can run, then reopen the session. Open sessions can remain loaded after switching chats.</p>
        <p>Claude Code uses session and tool hooks. Reopen Claude Code after setup. The Claude chat desktop app is not connected by this bridge.</p>
        <p>Terminal setup preserves your prompt and adds a bridge to the Windows PowerShell and PowerShell 7 profiles. Open new terminals with profiles enabled. Execution policy is unchanged; cmd and Bash shells need their own integrations.</p>
        <p>Existing hook configuration and profile content are retained, with dated backups beside modified files. Turning detection off pauses tool reporting and VS Code output capture. Native server checks continue to prevent duplicate launches. Use Stop external server to end a detected development server while keeping its editor and terminal open.</p>
      </details>
    </>}
    {section === 'Behavior' && <><h2>Behavior</h2>
      <Row title="Open browser after verified startup" detail="Opens the local site once after a project you start becomes ready."><Toggle label="Open browser after verified startup" checked={settings.behavior.autoOpenBrowser} disabled={busy} change={(autoOpenBrowser) => patch({ behavior: { autoOpenBrowser } })} /></Row>
      <Row title="Remember last project filter" detail="Restores your focus, status, or folder filter when reopening. Search stays private to this session."><Toggle label="Remember last project filter" checked={settings.behavior.rememberLastFilter} disabled={busy} change={(rememberLastFilter) => void run(() => window.devManager.updateSettings({ behavior: { rememberLastFilter } }, filter))} /></Row>
      <Row title="Follow logs by default" detail="Applies when opening another project's details. The current log view keeps its choice."><Toggle label="Follow logs by default" checked={settings.behavior.logAutoScroll} disabled={busy} change={(logAutoScroll) => patch({ behavior: { logAutoScroll } })} /></Row>
    </>}
    {section === 'Local data' && <><h2>Local data</h2>
      <Row title="App data folder" detail="Contains local preferences, registrations, cached metadata, and recovery backups."><button className="button secondary" disabled={busy} onClick={() => void run(() => window.devManager.openDataFolder(), 'App data folder opened.')}>Open data folder</button></Row>
      <Row title="Export settings" detail="A portable JSON export. Folder paths are included only if you choose below."><button className="button secondary" disabled={busy} onClick={() => void run(() => window.devManager.exportSettings(includeDiscovery), '', (result) => setMessage(result === 'exported' ? 'Settings exported.' : 'Export cancelled.'))}>Export settings</button></Row>
      <label className="settings-check"><input type="checkbox" checked={includeDiscovery} disabled={busy} onChange={(event) => setIncludeDiscovery(event.target.checked)} /> Include project folder registrations and exclusions (contains local paths)</label>
      <Row title="Import settings" detail="Review changes before applying. Folder replacement is optional and requires stopped projects."><button className="button secondary" disabled={busy} onClick={() => void run(() => window.devManager.previewImport(), '', (value) => { setPreview(value ?? undefined); setApplyDiscovery(false); if (!value) setMessage('Import cancelled.'); })}>Import settings</button></Row>
      <Row title="Restore preference defaults" detail="Keeps registrations, exclusions, cached projects, logs, and active servers."><button className="button secondary" disabled={busy} onClick={() => setConfirm({ title: 'Restore preference defaults?', body: <p>Restores appearance, scan-on-launch, and behavior defaults. Your folders, exclusions, project list, and active servers are kept.</p>, label: 'Restore defaults', action: () => window.devManager.resetPreferences() })}>Restore defaults</button></Row>
      <Row title="Clear discovery cache" detail={catalogBlocked ? 'Stop managed projects and sharing, and finish or cancel the scan first.' : 'Clears cached entries, project pins, and recent activity. Keeps files, folders, exclusions, settings, and backups. Rescan rebuilds the list.'}><button className="button secondary" disabled={busy || catalogBlocked} onClick={() => setConfirm({ title: 'Clear discovery cache?', body: <p>Removes {snapshot.projects.length} cached entries, including project pins and recent activity. Files, registrations, exclusions, preferences, and recovery backups are kept. Use Rescan afterward to rebuild the list.</p>, label: 'Clear cache', action: () => window.devManager.clearCache() })}>Clear cache</button></Row>
      <button className="button small secondary" disabled={busy || snapshot.scanning} onClick={() => void run(() => window.devManager.scan(), 'Scan completed.')}>Rescan projects</button>
    </>}
    {section === 'About & diagnostics' && <><div className="settings-section-heading"><h2>About & diagnostics</h2><button className="button small secondary" disabled={busy} onClick={() => void run(() => window.devManager.getDiagnostics(true), 'Diagnostics refreshed.', setDiagnostics)}>Refresh diagnostics</button></div>
      <p className="muted">Local checks only. Runtime availability does not prove every project is compatible.</p>
      {diagnostics && <><dl className="settings-diagnostics"><div><dt>DevDock</dt><dd>{diagnostics.version} · {diagnostics.platform} {diagnostics.arch}</dd></div><div><dt>Electron</dt><dd>{diagnostics.electron}</dd></div><div><dt>Project Node</dt><dd>{diagnostics.node.version ?? diagnostics.node.code}</dd></div><div><dt>npm</dt><dd>{diagnostics.npm.version ?? diagnostics.npm.code}</dd></div><div><dt>Sharing runtime</dt><dd>{diagnostics.sharing.version ?? 'Unavailable or unsupported'}</dd></div><div><dt>State schema</dt><dd>v{diagnostics.schema}{diagnostics.recovered ? ' · Recovered backup' : ''}</dd></div></dl>
      <h3>Diagnostic report preview</h3><p className="muted">Copies versions, status, and counts. Local paths, project names, links, and logs are omitted.</p><pre className="diagnostic-preview">{diagnostics.report}</pre><button className="button secondary" disabled={busy} onClick={() => void run(() => window.devManager.copyDiagnostics(diagnostics.reportId), 'Diagnostics copied.')}>Copy diagnostics</button></>}
      <details className="settings-help"><summary>Usage & troubleshooting</summary><p>Add a project folder, then start an npm project with a dev script or a standalone HTML site. Install project dependencies separately.</p><p>If a server stays Unverified or crashes, inspect its live output. Running confirms a reachable owned server, rather than every route's behavior.</p><p>Closing DevDock stops managed servers and previews. Public sharing is optional, temporary, and requires the prepared sharing runtime and internet.</p><p>This preview targets native Windows. Node/npm must be available on PATH; reopen DevDock after installing them. Package managers other than npm are detected but do not yet have execution adapters.</p><p>State backups belong to the app data folder. Settings imports accept portable exports. Use legacy backups in a separate data folder when rolling back to an older app version.</p></details>
    </>}
    </div>
    {confirm && <Confirm working={busy} title={confirm.title} label={confirm.label} disabled={busy} cancel={() => setConfirm(undefined)} confirm={() => void run(confirm.action, 'Completed.').then((ok) => { if (ok) setConfirm(undefined); })}>{confirm.body}{error && <p role="alert" className="detail-error">{error}</p>}</Confirm>}
    {preview && <Confirm working={busy} title="Review settings import" label="Apply import" disabled={busy || applyDiscovery && catalogBlocked} cancel={cancelPreview} confirm={() => void run(() => window.devManager.applyImport(preview.token, applyDiscovery), 'Settings imported. Rescan to refresh any imported folders.').then((ok) => { if (ok) setPreview(undefined); })}>
      {preview.preferencesChanged.length ? <ul>{preview.preferencesChanged.map((change) => <li key={change}>{change}</li>)}</ul> : <p>No preference changes.</p>}
      {preview.discovery && <><label className="settings-check"><input type="checkbox" checked={applyDiscovery} disabled={busy || catalogBlocked} onChange={(event) => setApplyDiscovery(event.target.checked)} /> Apply folder registrations and exclusions</label>
        <p>Replaces existing folders and exclusions; adds {preview.discovery.added}, removes {preview.discovery.removed}, and clears {preview.discovery.cached} cached entries, including project pins and recent activity. Files are kept.</p>
        {catalogBlocked && <p className="detail-error">Stop projects and sharing, and finish the scan before applying folder replacements.</p>}
        <details><summary>Folder paths in this export</summary><ul>{preview.discovery.roots.map((root) => <li key={root.path}><code>{root.path}</code>{!root.available && ' · Unavailable'}</li>)}</ul><strong>Exclusions</strong><ul>{preview.discovery.exclusions.map((directory) => <li key={directory}><code>{directory}</code></li>)}</ul></details></>}
      <p className="muted">Preview expires in five minutes. Changes made since the preview require choosing the file again.</p>{error && <p className="detail-error" role="alert">{error}</p>}
    </Confirm>}
  </section>;
}
