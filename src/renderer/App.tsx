import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { canLaunch, externalLabels, type LogEntry, type Project, type Result } from '../shared/contracts';
import { useStore } from './store';
import { SettingsView } from './SettingsView';
import { filterString, projectFilters } from '../shared/settings';
import { recentProjects, orderUnpinned } from './projectOrdering';
import { ShareConfirmation } from './ShareConfirmation';

const labels: Record<Project['status'], string> = { stopped: 'Stopped', starting: 'Starting', running: 'Running', unverified: 'Unverified', stopping: 'Stopping', crashed: 'Crashed', error: 'Error' };
const active = (project: Project) => project.managed || ['starting', 'running', 'unverified', 'stopping'].includes(project.status);
const openElsewhere = (project: Project) => project.external?.some((presence) => presence.state !== 'recent');

export function App() {
  const { snapshot, selected, filter, search, setSnapshot, select, setFilter, setSearch } = useStore();
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = snapshot?.settings.appearance.pageSize ?? 10;
  const [view, setView] = useState<'projects' | 'settings'>('projects');
  const settingsButton = useRef<HTMLButtonElement>(null);
  const hydrated = useRef(false);
  const [sharingProject, setSharingProject] = useState<string>();
  const projectList = useRef<HTMLDivElement>(null);
  const dashboardScroll = useRef(0);
  const logPanel = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const result = await window.devManager.snapshot();
      if (current !== sequence.current) return;
      if (result.ok) setSnapshot(result.value); else setError(result.error);
      if (selected) {
        const entries = await window.devManager.logs(selected);
        if (current === sequence.current && entries.ok) setLogs(entries.value);
      }
    } catch { setError('The desktop connection is unavailable. Open this interface through Electron.'); }
  }, [selected, setSnapshot]);
  useEffect(() => {
    if (!window.devManager) { setError('Open the desktop app with npm run dev or npm start.'); return; }
    const unsubscribe = window.devManager.onChanged(() => { void refresh(); });
    void refresh();
    return unsubscribe;
  }, [refresh]);
  useEffect(() => { setLogs([]); setAutoScroll(snapshot?.settings.behavior.logAutoScroll ?? true); }, [selected]);
  useEffect(() => {
    if (!snapshot) return;
    if (!hydrated.current) { hydrated.current = true; if (snapshot.settings.behavior.rememberLastFilter) setFilter(filterString(snapshot.view.lastFilter)); }
    else if (!projectFilters.some((value) => value === filter) && !snapshot.roots.some((root) => root.id === filter)) setFilter('all');
    if (selected && !snapshot.projects.some((project) => project.id === selected)) select(undefined);
  }, [snapshot, filter, selected, setFilter, select]);
  useEffect(() => {
    const element = logPanel.current;
    if (autoScroll && element) element.scrollTop = element.scrollHeight;
  }, [logs, autoScroll]);
  useEffect(() => { document.documentElement.dataset.theme = snapshot?.settings.appearance.theme ?? 'system'; }, [snapshot?.settings.appearance.theme]);

  async function perform(key: string, action: () => Promise<Result<unknown>>) {
    setError(''); setPending((before) => new Set(before).add(key));
    try { const result = await action(); if (!result.ok) setError(result.error); }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'The desktop operation failed.'); }
    finally { setPending((before) => { const next = new Set(before); next.delete(key); return next; }); await refresh(); }
  }
  const projects = snapshot?.projects ?? [];
  const recent = recentProjects(projects);
  const recentIds = new Set(recent.map((project) => project.id));
  const current = projects.find((project) => project.id === selected);
  const running = projects.filter((project) => project.status === 'running').length;
  const sharingCount = projects.filter((project) => project.sharing?.status === 'sharing').length;
  const sharingManaged = projects.some((project) => project.sharing?.managed);
  const confirmation = projects.find((project) => project.id === sharingProject);
  const excluded = (project: Project) => snapshot?.exclusions.some((item) => project.path.toLowerCase() === item.path.toLowerCase() || project.path.toLowerCase().startsWith(`${item.path.toLowerCase()}\\`));
  const shareReason = (project: Project) => !snapshot?.sharing.available ? snapshot?.sharing.error ?? 'Sharing unavailable.' : project.externalServers?.length && !project.managed ? 'This server is running in another terminal. Public previews require a server started by DevDock.' : excluded(project) ? 'Excluded projects cannot begin sharing.' : project.missing ? 'Rescan this missing project.' : project.status !== 'running' ? 'Start this project and wait for Running.' : undefined;
  const visible = projects.filter((project) => {
    const matches = `${project.name} ${project.path} ${project.framework}`.toLowerCase().includes(search.toLowerCase());
    return matches && (filter === 'all' || filter === 'pinned' && project.pinned || filter === 'recent' && recentIds.has(project.id) || filter === 'running' && active(project) || filter === 'stopped' && project.status === 'stopped' || filter === 'errors' && ['crashed', 'error', 'unverified'].includes(project.status) || filter === project.rootId);
  });
  const pinnedProjects = visible.filter((project) => project.pinned).sort((a, b) => a.name.localeCompare(b.name));
  const unpinnedProjects = orderUnpinned(visible, recentIds);
  const pageCount = Math.max(1, Math.ceil(unpinnedProjects.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageProjects = unpinnedProjects.slice(pageStart, pageStart + pageSize);
  const rows = [...pinnedProjects, ...pageProjects];
  const group = (project: Project) => project.pinned ? 'Pinned projects' : recentIds.has(project.id) ? 'Recent activity' : 'Other projects';
  const grouped = pinnedProjects.length > 0 || pageProjects.some((project) => recentIds.has(project.id));
  useEffect(() => { setPage(1); select(undefined); }, [filter, search, pageSize, select]);
  useEffect(() => { dashboardScroll.current = 0; if (projectList.current) projectList.current.scrollTop = 0; }, [currentPage, filter, search, pageSize]);
  useEffect(() => {
    const list = projectList.current;
    const row = selected && list?.querySelector<HTMLElement>(`[data-project-id="${selected}"]`);
    if (list && row) list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - 1;
  }, [selected]);
  function chooseFilter(value: string) { if (view === 'settings' && value === filter) requestAnimationFrame(() => { if (projectList.current) projectList.current.scrollTop = dashboardScroll.current; }); setView('projects'); setFilter(value); if (snapshot?.settings.behavior.rememberLastFilter) void perform('filter', () => window.devManager.rememberFilter(value)); }
  function openSettings() { if (view === 'projects' && projectList.current) dashboardScroll.current = projectList.current.scrollTop; setView('settings'); }
  function backToProjects() { setView('projects'); requestAnimationFrame(() => { if (projectList.current) projectList.current.scrollTop = dashboardScroll.current; settingsButton.current?.focus({ preventScroll: true }); }); }
  function toggleDetails(id: string) { select(selected === id ? undefined : id); }
  function changePage(next: number) { setPage(next); select(undefined); }
  const details = current && <section id={`details-${current.id}`} className="details-panel" aria-label={`Details for ${current.name}`}>
    <div className="details-heading"><div><span className="eyebrow">PROJECT DETAILS</span></div><button className="icon-button" aria-label="Close project details" onClick={() => select(undefined)}>×</button></div>
    <dl className="project-metadata"><div><dt>Full URL</dt><dd>{current.localUrl ? <button className="text-link full-url" onClick={() => void perform(current.id, () => window.devManager.open(current.id))}>{current.localUrl}</button> : 'Available when the local server is ready.'}</dd></div><div><dt>Folder</dt><dd>{current.path}</dd></div><div><dt>{current.kind === 'static' ? 'Entry page' : 'Dev command'}</dt><dd><code>{current.kind === 'static' ? current.entryFile : current.devScript}</code></dd></div><div><dt>Runtime</dt><dd>{current.framework} · {current.kind === 'static' ? 'Built-in server' : current.manager}{current.pid ? ` · PID ${current.pid}` : ' · Not running'}{current.port ? ` · Port ${current.port}` : ''}</dd></div></dl>
    <div className="detail-meta"><button className="button small secondary" onClick={() => void perform(current.id, () => window.devManager.folder(current.id))}>Open folder</button><button className="button small secondary" title={current.externalServers?.length ? 'Restart this server in its original terminal.' : undefined} disabled={pending.has(current.id) || current.status === 'stopping' || current.missing || !canLaunch(current) || !!current.externalServers?.length} onClick={() => void perform(current.id, () => window.devManager.restart(current.id))}>Restart</button></div>
    {!!current.externalServers?.length && <p className="muted">Server started outside DevDock · {current.externalServers.map((server) => `Port ${server.port}`).join(', ')}. Stop external server ends {current.externalServers.length > 1 ? 'the detected servers' : 'the server'} while keeping your editor and terminal open. Restart it from its original terminal or start it through DevDock after stopping.</p>}
    {current.error && <p className="detail-error">{current.error}</p>}
    <div className="sharing-panel" aria-label={`Sharing for ${current.name}`}>
      <div className="sharing-heading"><strong>Public preview</strong><span role="status">{current.sharing?.status === 'sharing' ? 'Sharing' : current.sharing?.status === 'connecting' ? 'Connecting…' : current.sharing?.status === 'stopping' ? 'Stopping…' : current.sharing?.status === 'error' ? 'Sharing error' : 'Not shared'}</span></div>
      {current.sharing?.publicUrl && <button className="text-link public-url" onClick={() => void perform(`share-open-${current.id}`, () => window.devManager.openPublicLink(current.id))}>{current.sharing.publicUrl}</button>}
      {current.sharing?.error && <p className="detail-error">{current.sharing.error}</p>}
      <div className="sharing-actions">{current.sharing?.status === 'sharing' && <><button className="button small secondary" onClick={() => void perform(`share-copy-${current.id}`, () => window.devManager.copyPublicLink(current.id))}>Copy Public Link</button><button className="button small secondary" onClick={() => void perform(`share-open-${current.id}`, () => window.devManager.openPublicLink(current.id))}>Open Public Link</button></>}
        {current.sharing?.managed ? <button className="button small secondary" disabled={current.sharing.status === 'stopping'} onClick={() => void perform(`share-stop-${current.id}`, () => window.devManager.stopSharing(current.id))}>Stop Sharing</button> : <button className="button small secondary" disabled={!!shareReason(current)} title={shareReason(current)} onClick={() => setSharingProject(current.id)}>Share Online</button>}
      </div>{shareReason(current) && !current.sharing?.managed && <p className="muted">{shareReason(current)}</p>}
    </div>
    <div className="log-toolbar"><strong>Live output <span className="muted">/ {logs.length} lines</span></strong><div><label><input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} /> Auto-scroll</label><button onClick={() => void perform('copy', () => window.devManager.copyLogs(current.id))}>Copy</button><button onClick={() => void perform('clear', () => window.devManager.clearLogs(current.id))}>Clear</button></div></div>
    {!!current.externalServers?.length && !current.externalOutput && <p className="muted">Terminal output is currently available in the original terminal. For streaming from VS Code, repair its bridge in Settings, reload VS Code, and run the dev command with shell integration enabled. Earlier terminal output cannot be recovered.</p>}
    {!!current.externalServers?.length && current.externalOutput && <p className="muted">Streaming dev-command output from VS Code.</p>}
    <div className="log-viewer" ref={logPanel} tabIndex={0} aria-label="Project logs">{logs.length ? logs.map((entry) => <div className={`log-line ${entry.stream}`} key={entry.id}><time>{new Date(entry.timestamp).toLocaleTimeString()}</time><span>{entry.text}</span></div>) : <p className="log-placeholder">{current.externalServers?.length ? 'Waiting for output from the connected dev command.' : 'Start this project to see its terminal output here.'}</p>}</div>
  </section>;

  return <div className="app-shell" data-density={snapshot?.settings.appearance.density ?? 'standard'}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">⌘</span><div>Local Dev<span className="brand-subtitle">YOUR WORKSPACE, READY.</span></div></div>
      <div className="sidebar-label">WORKSPACE</div>
      <nav aria-label="Project filters">{[['all', 'All projects', projects.length], ['pinned', 'Pinned', projects.filter((item) => item.pinned).length], ['recent', 'Recent activity', recent.length], ['running', 'Active', projects.filter(active).length], ['stopped', 'Stopped', projects.filter((item) => item.status === 'stopped').length], ['errors', 'Needs attention', projects.filter((item) => ['crashed', 'error', 'unverified'].includes(item.status)).length]].map(([key, label, count]) =>
        <button key={key} className={`nav-button ${filter === key ? 'selected' : ''}`} aria-current={view === 'projects' && filter === key ? 'page' : undefined} onClick={() => chooseFilter(String(key))}><span>{label}</span><span className="count">{count}</span></button>)}</nav>
      <div className="roots-heading"><span className="sidebar-label">ROOT FOLDERS</span><button className="icon-button" aria-label="Add root folder" disabled={pending.has('root') || snapshot?.scanning} onClick={() => void perform('root', () => window.devManager.addRoot())}>+</button></div>
      <div className="root-list">{snapshot?.roots.map((root) => <div key={root.id} className="root-entry">
        <button title={root.path} className={`root-button ${filter === root.id ? 'selected' : ''}`} onClick={() => chooseFilter(root.id)}><span aria-hidden="true">▱</span>{root.name}</button>
      </div>)}{!snapshot?.roots.length && <p className="muted root-empty">Choose where your projects live.</p>}</div>
      <div className="sidebar-footer"><button ref={settingsButton} className={`nav-button settings-entry ${view === 'settings' ? 'selected' : ''}`} aria-current={view === 'settings' ? 'page' : undefined} onClick={openSettings}>Settings</button><span className="offline-dot" />Local controls · optional sharing<div className="milestone">v0.3.0 · Temporary public previews</div></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><span>DEVELOPMENT / {view === 'settings' ? 'SETTINGS' : 'PROJECTS'}</span><div className="settings-actions">{view === 'settings' && sharingManaged && <button className="button small secondary" disabled={pending.has('share-all')} onClick={() => void perform('share-all', () => window.devManager.stopAllSharing())}>Stop All Sharing</button>}{view === 'settings' && <button className="button small secondary" onClick={backToProjects}>Back to projects</button>}</div></header>
      <section className="dashboard" hidden={view !== 'projects'}>
        <div className="page-heading"><div><h1>Your projects<span className="heading-dot">.</span></h1><p className="muted">Discover, run, and inspect your local development servers.</p></div><button className="button primary" disabled={pending.has('root') || snapshot?.scanning} onClick={() => void perform('root', () => window.devManager.addRoot())}>+ Add folder</button></div>
        <div className="summary-strip"><div><strong>{projects.length.toString().padStart(2, '0')}</strong><span>Projects discovered</span></div><div><strong className="accent-text">{running.toString().padStart(2, '0')}</strong><span>Servers ready</span></div><div><strong>{sharingCount.toString().padStart(2, '0')}</strong><span>Public previews</span></div><div className="scope-note"><span className={`status-dot ${sharingCount ? 'running' : 'stopped'}`} />{sharingCount ? 'Sharing selected projects' : 'Local until you share'}</div></div>
        {error && <div className="notice error-notice" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
        {snapshot?.externalServerError && <div className="notice error-notice" role="alert"><span>{snapshot.externalServerError}</span></div>}
        {!!snapshot?.diagnostics.length && <details className="notice"><summary>Scan notes ({snapshot.diagnostics.length})</summary>{snapshot.diagnostics.map((note, index) => <p key={index}>{note}</p>)}</details>}
        <div className="toolbar"><label className="search-box"><span aria-hidden="true">⌕</span><input aria-label="Search projects" placeholder="Search projects, frameworks, or paths…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          {sharingManaged && <button className="button secondary" disabled={pending.has('share-all')} onClick={() => void perform('share-all', () => window.devManager.stopAllSharing())}>Stop All Sharing</button>}
          <button className="button secondary" disabled={pending.has('scan')} onClick={() => void perform('scan', () => snapshot?.scanning ? window.devManager.cancelScan() : window.devManager.scan())}>{snapshot?.scanning ? 'Cancel scan' : '↻ Rescan'}</button></div>
        <div className="list-caption"><span>{snapshot?.scanning ? 'Scanning folders…' : `${visible.length} project${visible.length === 1 ? '' : 's'}`}{projects.some(openElsewhere) && ` · ${projects.filter(openElsewhere).length} open elsewhere`}</span><span>{filter === 'recent' ? 'LAST 10 RECENTLY USED PROJECTS' : 'NAME / FRAMEWORK / SERVER STATUS'}</span></div>
        <div className="project-list" ref={projectList} aria-label="Projects">{rows.map((project, index) => <Fragment key={project.id}>
          {grouped && (index === 0 || group(rows[index - 1]!) !== group(project)) && <h2 className="project-group-heading">{group(project)}{project.pinned && <span>Keep your focus here</span>}</h2>}
          <article className={`project-row ${selected === project.id ? 'is-selected' : ''}`} data-project-id={project.id}>
          <div className="row-heading"><button className={`icon-button pin-button ${project.pinned ? 'is-pinned' : ''}`} aria-label={`${project.pinned ? 'Unpin' : 'Pin'} ${project.name}`} aria-pressed={!!project.pinned} title={project.pinned ? 'Unpin project' : 'Pin project to the top'} disabled={pending.has(`pin-${project.id}`)} onClick={() => void perform(`pin-${project.id}`, () => window.devManager.setPinned(project.id, !project.pinned))}><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M8 3h8l-1 6 4 4v2H5v-2l4-4-1-6Z" /><path d="M12 15v6" /></svg></button><button className="project-info" onClick={() => toggleDetails(project.id)} aria-label={`View ${project.name}`} aria-expanded={selected === project.id} aria-controls={`details-${project.id}`}><span className="project-monogram">{project.name.replace(/^@/, '').slice(0, 2).toUpperCase()}</span><span className="project-description"><strong>{project.name}</strong><span className="project-path" title={project.path}>{project.path}</span>{!!project.external?.length && <span className="external-presence" aria-label="External project activity">{project.external.map((presence) => <span key={presence.source} className={`external-badge ${presence.state}`} title={`${presence.state === 'recent' ? 'Recent activity reported by' : presence.state === 'working' ? 'Work reported in' : 'Open session reported by'} ${externalLabels[presence.source]} · ${new Date(presence.seenAt).toLocaleString()}`}>{externalLabels[presence.source]}{presence.state === 'working' ? ' · working' : presence.state === 'recent' ? ' · recent' : ''}</span>)}</span>}{project.lastActiveAt && <time className="project-activity" dateTime={project.lastActiveAt} title={`${new Date(project.lastActiveAt).toLocaleString()}${project.lastActivitySource && project.lastActivitySource !== 'devdock' ? ` · ${externalLabels[project.lastActivitySource]}` : ''}`}>Last active {new Date(project.lastActiveAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>}</span></button>
          <span className="framework-tag">{project.framework}<small>{project.kind === 'static' ? 'Local HTTP' : project.manager}</small></span><span className="status-label"><span className={`status-dot ${project.status}`} />{project.missing ? 'Missing' : labels[project.status]}{project.sharing?.managed && <small className="sharing-badge">{project.sharing.status === 'sharing' ? 'Public' : project.sharing.status === 'connecting' ? 'Connecting' : project.sharing.status === 'stopping' ? 'Stopping share' : 'Sharing error'}</small>}</span>
          <div className="row-actions">{project.status === 'running' && <button className="button small secondary" onClick={() => void perform(project.id, () => window.devManager.open(project.id))}>Open ↗</button>}
            {project.sharing?.status === 'sharing' && project.sharing.publicUrl && <button className="button small secondary" title={project.sharing.publicUrl} aria-label={`Open public preview for ${project.name}`} disabled={pending.has(`share-open-${project.id}`)} onClick={() => void perform(`share-open-${project.id}`, () => window.devManager.openPublicLink(project.id))}>Public Preview ↗</button>}
            {project.status === 'running' && !project.sharing?.managed && <button className="button small secondary" title={shareReason(project)} disabled={!!shareReason(project) || pending.has(project.id)} onClick={() => setSharingProject(project.id)}>Share Online</button>}
            {project.externalServers?.length && !project.managed ? <><span className="muted external-runtime-label">Running elsewhere</span><button className="button small secondary" title="Stop the detected development servers. Keep the editor and terminal open." disabled={pending.has(project.id) || project.status === 'stopping' || !!snapshot?.externalServerError} onClick={() => void perform(project.id, () => window.devManager.stopExternal(project.id, project.externalServers!.map(({ pid, ownerStartedAt, port }) => ({ pid, ownerStartedAt, port }))))}>{pending.has(project.id) || project.status === 'stopping' ? 'Stopping…' : 'Stop external server'}</button></> : <button className={`button small ${active(project) ? 'secondary' : 'primary'}`} disabled={pending.has(project.id) || project.status === 'stopping' || !active(project) && (project.missing || !canLaunch(project))} onClick={() => void perform(project.id, () => active(project) ? window.devManager.stop(project.id) : window.devManager.start(project.id))}>{pending.has(project.id) ? 'Working…' : active(project) ? 'Stop' : 'Start'}</button>}
            <button className="icon-button expand-button" aria-label={`View logs for ${project.name}`} title={selected === project.id ? 'Collapse project details' : 'Expand project details'} aria-expanded={selected === project.id} aria-controls={`details-${project.id}`} onClick={() => toggleDetails(project.id)}>{selected === project.id ? '⌄' : '›'}</button></div></div>
          {selected === project.id && details}
        </article></Fragment>)}{!visible.length && <div className="empty-state"><span className="empty-symbol" aria-hidden="true">▱</span><h2>{filter === 'pinned' && !search ? 'No pinned projects yet' : filter === 'recent' && !search ? 'No recent activity yet' : projects.length ? 'No matching projects' : 'A calmer way to start your work.'}</h2><p>{filter === 'pinned' && !search ? 'Use the pin beside a project to keep it at the top.' : filter === 'recent' && !search ? 'Use a project through DevDock or connect your tools in Settings → External activity.' : projects.length ? 'Try a different filter or search.' : 'Add a folder. We’ll find development apps and standalone HTML sites.'}</p>{!snapshot?.roots.length && <button className="button primary" onClick={() => void perform('root', () => window.devManager.addRoot())}>Choose project folder</button>}</div>}</div>
        <nav className="pagination" aria-label="Project pagination"><label>Per page <select aria-label="Projects per page" value={pageSize} disabled={pending.has('page-size')} onChange={(event) => void perform('page-size', () => window.devManager.updateSettings({ appearance: { pageSize: Number(event.target.value) as 5 | 10 | 20 } }))}>{[5, 10, 20].map((size) => <option key={size} value={size}>{size}</option>)}</select></label><span>{pinnedProjects.length > 0 && `${pinnedProjects.length} pinned${unpinnedProjects.length ? ' · ' : ''}`}{unpinnedProjects.length ? `${pageStart + 1}–${Math.min(pageStart + pageSize, unpinnedProjects.length)} of ${unpinnedProjects.length}${pinnedProjects.length ? ' others' : ''}` : !pinnedProjects.length ? '0 projects' : ''}</span><div><button className="button small secondary" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>Previous</button><span>Page {currentPage} of {pageCount}</span><button className="button small secondary" disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)}>Next</button></div></nav>
      </section>
      {confirmation && <ShareConfirmation project={confirmation} cancel={() => setSharingProject(undefined)} confirm={() => { setSharingProject(undefined); void perform(`share-${confirmation.id}`, () => window.devManager.share(confirmation.id)); }} />}
      {snapshot && <div hidden={view !== 'settings'} className="settings-destination"><SettingsView snapshot={snapshot} active={view === 'settings'} filter={filter} refresh={refresh} /></div>}
      <footer className="workspace-footer"><span>Runs on your computer · share only when you choose.</span><span>npm + Static HTML · temporary HTTPS previews</span></footer>
    </main>
  </div>;
}
