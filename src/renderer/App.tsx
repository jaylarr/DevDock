import { useCallback, useEffect, useRef, useState } from 'react';
import { canLaunch, type LogEntry, type Project, type Result } from '../shared/contracts';
import { useStore } from './store';
import { ShareConfirmation } from './ShareConfirmation';

const labels: Record<Project['status'], string> = { stopped: 'Stopped', starting: 'Starting', running: 'Running', unverified: 'Unverified', stopping: 'Stopping', crashed: 'Crashed', error: 'Error' };
const active = (project: Project) => project.managed || ['starting', 'running', 'unverified', 'stopping'].includes(project.status);

export function App() {
  const { snapshot, selected, filter, search, setSnapshot, select, setFilter, setSearch } = useStore();
  const [error, setError] = useState('');
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const darkTheme = snapshot?.theme === 'dark' || ((!snapshot || snapshot.theme === 'system') && systemDark);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [sharingProject, setSharingProject] = useState<string>();
  const projectList = useRef<HTMLDivElement>(null);
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
  useEffect(() => { setLogs([]); }, [selected]);
  useEffect(() => {
    const element = logPanel.current;
    if (autoScroll && element) element.scrollTop = element.scrollHeight;
  }, [logs, autoScroll]);
  useEffect(() => { document.documentElement.dataset.theme = snapshot?.theme ?? 'system'; }, [snapshot?.theme]);

  async function perform(key: string, action: () => Promise<Result<unknown>>) {
    setError(''); setPending((before) => new Set(before).add(key));
    try { const result = await action(); if (!result.ok) setError(result.error); }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'The desktop operation failed.'); }
    finally { setPending((before) => { const next = new Set(before); next.delete(key); return next; }); await refresh(); }
  }
  const projects = snapshot?.projects ?? [];
  const current = projects.find((project) => project.id === selected);
  const running = projects.filter((project) => project.status === 'running').length;
  const sharingCount = projects.filter((project) => project.sharing?.status === 'sharing').length;
  const sharingManaged = projects.some((project) => project.sharing?.managed);
  const confirmation = projects.find((project) => project.id === sharingProject);
  const excluded = (project: Project) => snapshot?.exclusions.some((item) => project.path.toLowerCase() === item.path.toLowerCase() || project.path.toLowerCase().startsWith(`${item.path.toLowerCase()}\\`));
  const shareReason = (project: Project) => !snapshot?.sharing.available ? snapshot?.sharing.error ?? 'Sharing unavailable.' : excluded(project) ? 'Excluded projects cannot begin sharing.' : project.missing ? 'Rescan this missing project.' : project.status !== 'running' ? 'Start this project and wait for Running.' : undefined;
  const visible = projects.filter((project) => {
    const matches = `${project.name} ${project.path} ${project.framework}`.toLowerCase().includes(search.toLowerCase());
    return matches && (filter === 'all' || filter === 'running' && active(project) || filter === 'stopped' && project.status === 'stopped' || filter === 'errors' && ['crashed', 'error', 'unverified'].includes(project.status) || filter === project.rootId);
  });
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageProjects = visible.slice(pageStart, pageStart + pageSize);
  useEffect(() => { setPage(1); select(undefined); }, [filter, search, pageSize, select]);
  useEffect(() => { if (projectList.current) projectList.current.scrollTop = 0; }, [currentPage, filter, search, pageSize]);
  useEffect(() => {
    const list = projectList.current;
    const row = selected && list?.querySelector<HTMLElement>(`[data-project-id="${selected}"]`);
    if (list && row) list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - 1;
  }, [selected]);
  function toggleDetails(id: string) { select(selected === id ? undefined : id); }
  function changePage(next: number) { setPage(next); select(undefined); }
  const details = current && <section id={`details-${current.id}`} className="details-panel" aria-label={`Details for ${current.name}`}>
    <div className="details-heading"><div><span className="eyebrow">PROJECT DETAILS</span></div><button className="icon-button" aria-label="Close project details" onClick={() => select(undefined)}>×</button></div>
    <dl className="project-metadata"><div><dt>Full URL</dt><dd>{current.localUrl ? <button className="text-link full-url" onClick={() => void perform(current.id, () => window.devManager.open(current.id))}>{current.localUrl}</button> : 'Available when the local server is ready.'}</dd></div><div><dt>Folder</dt><dd>{current.path}</dd></div><div><dt>{current.kind === 'static' ? 'Entry page' : 'Dev command'}</dt><dd><code>{current.kind === 'static' ? current.entryFile : current.devScript}</code></dd></div><div><dt>Runtime</dt><dd>{current.framework} · {current.kind === 'static' ? 'Built-in server' : current.manager}{current.pid ? ` · PID ${current.pid}` : ' · Not running'}{current.port ? ` · Port ${current.port}` : ''}</dd></div></dl>
    <div className="detail-meta"><button className="button small secondary" onClick={() => void perform(current.id, () => window.devManager.folder(current.id))}>Open folder</button><button className="button small secondary" disabled={pending.has(current.id) || current.status === 'stopping' || current.missing || !canLaunch(current)} onClick={() => void perform(current.id, () => window.devManager.restart(current.id))}>Restart</button></div>
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
    <div className="log-viewer" ref={logPanel} tabIndex={0} aria-label="Project logs">{logs.length ? logs.map((entry) => <div className={`log-line ${entry.stream}`} key={entry.id}><time>{new Date(entry.timestamp).toLocaleTimeString()}</time><span>{entry.text}</span></div>) : <p className="log-placeholder">Start this project to see its terminal output here.</p>}</div>
  </section>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">⌘</span><div>Local Dev<span className="brand-subtitle">YOUR WORKSPACE, READY.</span></div></div>
      <div className="sidebar-label">WORKSPACE</div>
      <nav aria-label="Project filters">{[['all', 'All projects', projects.length], ['running', 'Active', projects.filter(active).length], ['stopped', 'Stopped', projects.filter((item) => item.status === 'stopped').length], ['errors', 'Needs attention', projects.filter((item) => ['crashed', 'error', 'unverified'].includes(item.status)).length]].map(([key, label, count]) =>
        <button key={key} className={`nav-button ${filter === key ? 'selected' : ''}`} onClick={() => setFilter(String(key))}><span>{label}</span><span className="count">{count}</span></button>)}</nav>
      <div className="roots-heading"><span className="sidebar-label">ROOT FOLDERS</span><button className="icon-button" aria-label="Add root folder" disabled={pending.has('root') || snapshot?.scanning} onClick={() => void perform('root', () => window.devManager.addRoot())}>+</button></div>
      <div className="root-list">{snapshot?.roots.map((root) => <div key={root.id} className="root-entry">
        <button title={root.path} className={`root-button ${filter === root.id ? 'selected' : ''}`} onClick={() => setFilter(root.id)}><span aria-hidden="true">▱</span>{root.name}</button>
        <button aria-label={`Remove root ${root.name}`} title="Remove registration only" className="root-remove" disabled={snapshot.scanning || pending.has(root.id)} onClick={() => void perform(root.id, () => window.devManager.removeRoot(root.id))}>×</button>
      </div>)}{!snapshot?.roots.length && <p className="muted root-empty">Choose where your projects live.</p>}</div>
      <div className="sidebar-footer"><span className="offline-dot" />Local controls · optional sharing<div className="milestone">v0.3.0 · Temporary public previews</div></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><span>DEVELOPMENT / PROJECTS</span><div className="theme-control"><span>Appearance</span><button type="button" className="theme-switch" role="switch" aria-label="Dark mode" aria-checked={darkTheme} disabled={!snapshot || pending.has('theme')} onClick={() => void perform('theme', () => window.devManager.theme(darkTheme ? 'light' : 'dark'))}><span className="theme-switch-thumb" aria-hidden="true" /><span className="theme-switch-option" aria-hidden="true">Light</span><span className="theme-switch-option" aria-hidden="true">Dark</span></button></div></header>
      <section className="dashboard">
        <div className="page-heading"><div><h1>Your projects<span className="heading-dot">.</span></h1><p className="muted">Discover, run, and inspect your local development servers.</p></div><button className="button primary" disabled={pending.has('root') || snapshot?.scanning} onClick={() => void perform('root', () => window.devManager.addRoot())}>+ Add folder</button></div>
        <div className="summary-strip"><div><strong>{projects.length.toString().padStart(2, '0')}</strong><span>Projects discovered</span></div><div><strong className="accent-text">{running.toString().padStart(2, '0')}</strong><span>Servers ready</span></div><div><strong>{sharingCount.toString().padStart(2, '0')}</strong><span>Public previews</span></div><div className="scope-note"><span className={`status-dot ${sharingCount ? 'running' : 'stopped'}`} />{sharingCount ? 'Sharing selected projects' : 'Local until you share'}</div></div>
        {error && <div className="notice error-notice" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
        {!!snapshot?.diagnostics.length && <details className="notice"><summary>Scan notes ({snapshot.diagnostics.length})</summary>{snapshot.diagnostics.map((note, index) => <p key={index}>{note}</p>)}</details>}
        <div className="toolbar"><label className="search-box"><span aria-hidden="true">⌕</span><input aria-label="Search projects" placeholder="Search projects, frameworks, or paths…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <button className="button secondary" onClick={() => setDiscoveryOpen(true)}>Discovery settings</button>
          {sharingManaged && <button className="button secondary" disabled={pending.has('share-all')} onClick={() => void perform('share-all', () => window.devManager.stopAllSharing())}>Stop All Sharing</button>}
          <button className="button secondary" disabled={pending.has('scan')} onClick={() => void perform('scan', () => snapshot?.scanning ? window.devManager.cancelScan() : window.devManager.scan())}>{snapshot?.scanning ? 'Cancel scan' : '↻ Rescan'}</button></div>
        <div className="list-caption"><span>{snapshot?.scanning ? 'Scanning folders…' : `${visible.length} project${visible.length === 1 ? '' : 's'}`}</span><span>NAME / FRAMEWORK / STATUS</span></div>
        <div className="project-list" ref={projectList} aria-label="Projects">{pageProjects.map((project) => <article key={project.id} className={`project-row ${selected === project.id ? 'is-selected' : ''}`} data-project-id={project.id}>
          <div className="row-heading"><button className="project-info" onClick={() => toggleDetails(project.id)} aria-label={`View ${project.name}`} aria-expanded={selected === project.id} aria-controls={`details-${project.id}`}><span className="project-monogram">{project.name.replace(/^@/, '').slice(0, 2).toUpperCase()}</span><span className="project-description"><strong>{project.name}</strong><span className="project-path" title={project.path}>{project.path}</span></span></button>
          <span className="framework-tag">{project.framework}<small>{project.kind === 'static' ? 'Local HTTP' : project.manager}</small></span><span className="status-label"><span className={`status-dot ${project.status}`} />{project.missing ? 'Missing' : labels[project.status]}{project.sharing?.managed && <small className="sharing-badge">{project.sharing.status === 'sharing' ? 'Public' : project.sharing.status === 'connecting' ? 'Connecting' : project.sharing.status === 'stopping' ? 'Stopping share' : 'Sharing error'}</small>}</span>
          <div className="row-actions">{project.status === 'running' && <button className="button small secondary" onClick={() => void perform(project.id, () => window.devManager.open(project.id))}>Open ↗</button>}
            {project.sharing?.status === 'sharing' && project.sharing.publicUrl && <button className="button small secondary" title={project.sharing.publicUrl} aria-label={`Open public preview for ${project.name}`} disabled={pending.has(`share-open-${project.id}`)} onClick={() => void perform(`share-open-${project.id}`, () => window.devManager.openPublicLink(project.id))}>Public Preview ↗</button>}
            {project.status === 'running' && !project.sharing?.managed && <button className="button small secondary" title={shareReason(project)} disabled={!!shareReason(project) || pending.has(project.id)} onClick={() => setSharingProject(project.id)}>Share Online</button>}
            <button className={`button small ${active(project) ? 'secondary' : 'primary'}`} disabled={pending.has(project.id) || project.status === 'stopping' || !active(project) && (project.missing || !canLaunch(project))} onClick={() => void perform(project.id, () => active(project) ? window.devManager.stop(project.id) : window.devManager.start(project.id))}>{pending.has(project.id) ? 'Working…' : active(project) ? 'Stop' : 'Start'}</button>
            <button className="icon-button expand-button" aria-label={`View logs for ${project.name}`} title={selected === project.id ? 'Collapse project details' : 'Expand project details'} aria-expanded={selected === project.id} aria-controls={`details-${project.id}`} onClick={() => toggleDetails(project.id)}>{selected === project.id ? '⌄' : '›'}</button></div></div>
          {selected === project.id && details}
        </article>)}{!visible.length && <div className="empty-state"><span className="empty-symbol" aria-hidden="true">▱</span><h2>{projects.length ? 'No matching projects' : 'A calmer way to start your work.'}</h2><p>{projects.length ? 'Try a different filter or search.' : 'Add a folder. We’ll find development apps and standalone HTML sites.'}</p>{!snapshot?.roots.length && <button className="button primary" onClick={() => void perform('root', () => window.devManager.addRoot())}>Choose project folder</button>}</div>}</div>
        <nav className="pagination" aria-label="Project pagination"><label>Per page <select aria-label="Projects per page" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{[5, 10, 20].map((size) => <option key={size} value={size}>{size}</option>)}</select></label><span>{visible.length ? `${pageStart + 1}–${Math.min(pageStart + pageSize, visible.length)} of ${visible.length}` : '0 projects'}</span><div><button className="button small secondary" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>Previous</button><span>Page {currentPage} of {pageCount}</span><button className="button small secondary" disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)}>Next</button></div></nav>
      </section>
      <footer className="workspace-footer"><span>Runs on your computer · share only when you choose.</span><span>npm + Static HTML · temporary HTTPS previews</span></footer>
      {confirmation && <ShareConfirmation project={confirmation} cancel={() => setSharingProject(undefined)} confirm={() => { setSharingProject(undefined); void perform(`share-${confirmation.id}`, () => window.devManager.share(confirmation.id)); }} />}
      {discoveryOpen && <div className="settings-overlay"><section className="discovery-settings" role="dialog" aria-modal="true" aria-labelledby="discovery-title" onKeyDown={(event) => { if (event.key === 'Escape') setDiscoveryOpen(false); }}>
        <div className="details-heading"><h2 id="discovery-title">Discovery settings</h2><button autoFocus className="icon-button" aria-label="Close discovery settings" onClick={() => setDiscoveryOpen(false)}>×</button></div>
        <p className="muted">Excluded folders and their contents stay out of the project list. Files are kept intact. Managed projects remain available until stopped.</p>
        <ul className="exclusion-list">{snapshot?.exclusions.map((item) => <li key={item.id}><code>{item.path}</code><button className="button small secondary" disabled={snapshot.scanning || pending.has(item.id)} onClick={() => void perform(item.id, () => window.devManager.removeExclusion(item.id))}>Include again</button></li>)}</ul>
        {!snapshot?.exclusions.length && <p className="muted">No folders excluded.</p>}
        <button className="button primary" disabled={snapshot?.scanning || pending.has('exclusion')} onClick={() => void perform('exclusion', () => window.devManager.addExclusion())}>Exclude folder from discovery</button>
        {error && <p role="alert" className="detail-error">{error}</p>}
      </section></div>}
    </main>
  </div>;
}
