import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry, Project, Result, Theme } from '../shared/contracts';
import { useStore } from './store';

const labels: Record<Project['status'], string> = { stopped: 'Stopped', starting: 'Starting', running: 'Running', unverified: 'Unverified', stopping: 'Stopping', crashed: 'Crashed', error: 'Error' };
const active = (project: Project) => project.managed || ['starting', 'running', 'unverified', 'stopping'].includes(project.status);

export function App() {
  const { snapshot, selected, filter, search, setSnapshot, select, setFilter, setSearch } = useStore();
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
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
  const visible = projects.filter((project) => {
    const matches = `${project.name} ${project.path} ${project.framework}`.toLowerCase().includes(search.toLowerCase());
    return matches && (filter === 'all' || filter === 'running' && active(project) || filter === 'stopped' && project.status === 'stopped' || filter === 'errors' && ['crashed', 'error', 'unverified'].includes(project.status) || filter === project.rootId);
  });

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
      <div className="sidebar-footer"><span className="offline-dot" />Local controls · no cloud backend<div className="milestone">Milestone 1 · Desktop foundation</div></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><span>DEVELOPMENT / PROJECTS</span><label className="theme-control">Appearance <select aria-label="Appearance" value={snapshot?.theme ?? 'system'} onChange={(event) => void perform('theme', () => window.devManager.theme(event.target.value as Theme))}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label></header>
      <section className="dashboard">
        <div className="page-heading"><div><div className="eyebrow">ONE PLACE TO GET STARTED</div><h1>Your projects<span className="heading-dot">.</span></h1><p className="muted">Discover, run, and inspect your local development servers.</p></div><button className="button primary" disabled={pending.has('root') || snapshot?.scanning} onClick={() => void perform('root', () => window.devManager.addRoot())}>+ Add folder</button></div>
        <div className="summary-strip"><div><strong>{projects.length.toString().padStart(2, '0')}</strong><span>Projects discovered</span></div><div><strong className="green-text">{running.toString().padStart(2, '0')}</strong><span>Servers ready</span></div><div><strong>{(snapshot?.roots.length ?? 0).toString().padStart(2, '0')}</strong><span>Root folders</span></div><div className="scope-note"><span className="status-dot stopped" />Private on this computer<span>Public sharing comes in a later milestone.</span></div></div>
        {error && <div className="notice error-notice" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
        {!!snapshot?.diagnostics.length && <details className="notice"><summary>Scan notes ({snapshot.diagnostics.length})</summary>{snapshot.diagnostics.map((note, index) => <p key={index}>{note}</p>)}</details>}
        <div className="toolbar"><label className="search-box"><span aria-hidden="true">⌕</span><input aria-label="Search projects" placeholder="Search projects, frameworks, or paths…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <button className="button secondary" disabled={pending.has('scan')} onClick={() => void perform('scan', () => snapshot?.scanning ? window.devManager.cancelScan() : window.devManager.scan())}>{snapshot?.scanning ? 'Cancel scan' : '↻ Rescan'}</button></div>
        <div className="list-caption"><span>{snapshot?.scanning ? 'Scanning folders…' : `${visible.length} project${visible.length === 1 ? '' : 's'}`}</span><span>NAME / FRAMEWORK / STATUS</span></div>
        <div className="project-list">{visible.map((project) => <article key={project.id} className={`project-row ${selected === project.id ? 'is-selected' : ''}`} data-project-id={project.id}>
          <button className="project-info" onClick={() => select(project.id)} aria-label={`View ${project.name}`}><span className="project-monogram">{project.name.replace(/^@/, '').slice(0, 2).toUpperCase()}</span><span className="project-description"><strong>{project.name}</strong><span className="project-path" title={project.path}>{project.path}</span></span></button>
          <span className="framework-tag">{project.framework}<small>{project.manager}</small></span><span className="status-label"><span className={`status-dot ${project.status}`} />{project.missing ? 'Missing' : labels[project.status]}</span>
          <div className="row-actions">{project.status === 'running' && <button className="button small secondary" onClick={() => void perform(project.id, () => window.devManager.open(project.id))}>Open ↗</button>}
            <button className={`button small ${active(project) ? 'secondary' : 'primary'}`} disabled={pending.has(project.id) || project.status === 'stopping' || !active(project) && (project.missing || project.manager !== 'npm')} onClick={() => void perform(project.id, () => active(project) ? window.devManager.stop(project.id) : window.devManager.start(project.id))}>{pending.has(project.id) ? 'Working…' : active(project) ? 'Stop' : 'Start'}</button>
            <button className="icon-button" aria-label={`View logs for ${project.name}`} onClick={() => select(project.id)}>›</button></div>
        </article>)}{!visible.length && <div className="empty-state"><span className="empty-symbol" aria-hidden="true">▱</span><h2>{projects.length ? 'No matching projects' : 'A calmer way to start your work.'}</h2><p>{projects.length ? 'Try a different filter or search.' : 'Add a folder. We’ll find its package.json files with a dev script.'}</p>{!snapshot?.roots.length && <button className="button primary" onClick={() => void perform('root', () => window.devManager.addRoot())}>Choose project folder</button>}</div>}</div>
      </section>
      {current && <section className="details-panel" aria-label={`Details for ${current.name}`}>
        <div className="details-heading"><div><span className="eyebrow">PROJECT DETAILS</span><h2>{current.name}</h2></div><button className="icon-button" aria-label="Close project details" onClick={() => select(undefined)}>×</button></div>
        <div className="detail-meta"><code>{current.devScript}</code><span>{current.pid ? `PID ${current.pid}` : 'Not running'}</span>{current.localUrl && <button className="text-link" onClick={() => void perform(current.id, () => window.devManager.open(current.id))}>{current.localUrl} ↗</button>}
          <button className="button small secondary" onClick={() => void perform(current.id, () => window.devManager.folder(current.id))}>Open folder</button><button className="button small secondary" disabled={pending.has(current.id) || current.status === 'stopping' || current.missing || current.manager !== 'npm'} onClick={() => void perform(current.id, () => window.devManager.restart(current.id))}>Restart</button></div>
        {current.error && <p className="detail-error">{current.error}</p>}
        <div className="log-toolbar"><strong>Live output <span className="muted">/ {logs.length} lines</span></strong><div><label><input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} /> Auto-scroll</label><button onClick={() => void perform('copy', () => window.devManager.copyLogs(current.id))}>Copy</button><button onClick={() => void perform('clear', () => window.devManager.clearLogs(current.id))}>Clear</button></div></div>
        <div className="log-viewer" ref={logPanel} tabIndex={0} aria-label="Project logs">{logs.length ? logs.map((entry) => <div className={`log-line ${entry.stream}`} key={entry.id}><time>{new Date(entry.timestamp).toLocaleTimeString()}</time><span>{entry.text}</span></div>) : <p className="log-placeholder">Start this project to see its terminal output here.</p>}</div>
      </section>}
      <footer className="workspace-footer"><span>Everything stays on your computer.</span><span>npm execution · HTTP localhost · no automatic installs</span></footer>
    </main>
  </div>;
}
