import { useEffect, useRef, useState } from 'react';
import type { CompatibilityReport, Project } from '../shared/contracts';

export function ShareConfirmation({ project, cancel, confirm }: { project: Project; cancel(): void; confirm(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [report, setReport] = useState<CompatibilityReport>();
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
    let mounted = true;
    void window.devManager.sharingCompatibility(project.id).then((result) => {
      if (mounted) { if (result.ok) setReport(result.value); else setError(result.error); }
    }).catch(() => { if (mounted) setError('Compatibility inspection failed. Retry after rescanning.'); });
    return () => { mounted = false; };
  }, [project.id]);
  return <dialog ref={dialog} className="share-confirmation" aria-labelledby="share-title" onCancel={(event) => { event.preventDefault(); cancel(); }}>
    <h2 id="share-title">Share {project.name} online?</h2>
    <p>Anyone with this temporary link can access this project's web server, including its available pages and actions.</p>
    <p className="muted">Keep this app, the project, and your internet connection running. Restarting or closing ends sharing.</p>
    {report ? <div className="compatibility-notes"><strong>{report.summary}</strong><ul>{report.notes.map((note) => <li key={note}>{note}</li>)}</ul></div> : <p role="status">{error || 'Checking project compatibility…'}</p>}
    <div className="sharing-actions"><button autoFocus className="button secondary" onClick={cancel}>Cancel</button><button className="button primary" disabled={!report || project.status !== 'running' || project.missing} onClick={confirm}>Start sharing</button></div>
  </dialog>;
}
