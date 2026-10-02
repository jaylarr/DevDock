import type { SharingAvailability, SharingView } from '../../shared/contracts';
import { publicOrigin, type TunnelHandle, type TunnelProvider, type VerifiedOrigin } from '../tunnels/TunnelProvider';
import type { LogManager } from './logManager';

interface Session {
  view: SharingView; abort: AbortController; job?: Promise<void>; handle?: TunnelHandle; origin?: VerifiedOrigin;
  candidate?: string; connected: boolean; timer?: ReturnType<typeof setTimeout>; monitor?: ReturnType<typeof setInterval>;
  checking?: boolean; stopPromise?: Promise<void>; failure?: string;
}
export class TunnelManager {
  private sessions = new Map<string, Session>();
  private blocked = new Set<string>();
  private closing = false;
  private stoppingAll = false;
  private stopAllJob?: Promise<void>;
  availability: SharingAvailability = { available: false, error: 'Checking sharing runtime…' };
  constructor(private provider: TunnelProvider, private logs: LogManager, private changed: () => void, private timeout = 60000, private monitorInterval = 5000, private disconnectTimeout = 15000) {}
  async initialize(): Promise<void> { this.availability = await this.provider.availability(); }
  view(id: string): SharingView { return { ...(this.sessions.get(id)?.view ?? { status: 'disabled' }) }; }
  owns(id: string): boolean { const session = this.sessions.get(id); return !!session && (!!session.job || !!session.handle?.alive()); }
  block(id: string): void { this.blocked.add(id); }
  unblock(id: string): void { this.blocked.delete(id); }
  start(id: string, verify: () => Promise<VerifiedOrigin>): Promise<void> {
    if (this.closing || this.stoppingAll || this.blocked.has(id)) return Promise.reject(new Error('Sharing is unavailable while this project or the manager is stopping.'));
    if (this.owns(id) || ['connecting', 'sharing', 'stopping'].includes(this.view(id).status)) return Promise.reject(new Error('This project already has a sharing session.'));
    if (!this.availability.available) return Promise.reject(new Error(this.availability.error));
    const session: Session = { view: { status: 'connecting', managed: true }, abort: new AbortController(), connected: false };
    this.sessions.set(id, session); this.changed();
    const valid = () => this.sessions.get(id) === session && !session.abort.signal.aborted && !!session.origin?.current();
    const ready = () => {
      if (!valid() || !session.candidate || !session.connected) return;
      if (session.view.status === 'sharing') return;
      if (session.timer) clearTimeout(session.timer); session.timer = undefined;
      session.view = { status: 'sharing', managed: true, publicUrl: `${session.candidate}${session.origin!.entryPath}`, startedAt: session.view.startedAt ?? new Date().toISOString() };
      this.changed();
    };
    session.timer = setTimeout(() => this.fail(id, session, 'Sharing did not connect within 60 seconds. Check internet access and retry.'), this.timeout);
    session.job = (async () => {
      session.origin = await verify();
      if (!valid()) return;
      session.handle = await this.provider.start(session.origin.origin, {
        url: (value) => {
          if (!valid()) return;
          const origin = publicOrigin(value);
          if (!origin) { this.fail(id, session, 'The provider returned an invalid public URL.'); return; }
          session.candidate = origin; ready();
        },
        connected: () => { if (valid()) { session.connected = true; ready(); } },
        disconnected: () => {
          if (!valid() || !session.connected) return;
          session.connected = false; session.view = { ...session.view, status: 'connecting', publicUrl: undefined };
          session.timer = setTimeout(() => this.fail(id, session, 'Tunnel connection was lost. Retry sharing when your connection is available.'), this.disconnectTimeout); this.changed();
        },
        exited: (error) => this.fail(id, session, error),
        log: (text) => { if (this.sessions.get(id) === session) this.logs.append(id, 'system', `[Sharing] ${text}`); },
      }, session.abort.signal);
      if (!valid()) return;
      session.monitor = setInterval(() => {
        if (session.checking || !valid()) { if (!session.origin?.current()) this.fail(id, session, 'The local project ended or restarted.'); return; }
        session.checking = true;
        void session.origin!.owned().then((owned) => { if (valid() && !owned) this.fail(id, session, 'The local server port is no longer owned by this project.'); })
          .catch(() => { if (valid()) this.fail(id, session, 'Local server ownership could not be reverified.'); }).finally(() => { session.checking = false; });
      }, this.monitorInterval);
    })().catch((error: unknown) => {
      if (!session.abort.signal.aborted) {
        session.failure = error instanceof Error ? error.message : 'Sharing could not start.';
        if (session.timer) clearTimeout(session.timer);
        session.abort.abort();
        session.view = { status: 'error', managed: !!session.handle?.alive(), error: session.failure }; this.changed();
        throw error;
      }
    }).finally(() => { session.job = undefined; });
    // After spawning, a late cancellation must still clean up its new handle.
    const job = session.job;
    void job.finally(() => { if (session.abort.signal.aborted) void this.stop(id).catch(() => {}); }).catch(() => {});
    return job;
  }
  private fail(id: string, session: Session, message: string): void {
    if (this.sessions.get(id) !== session || session.abort.signal.aborted) return;
    session.failure = message; session.view = { status: 'error', managed: true, error: message }; this.changed();
    this.logs.append(id, 'system', `[Sharing] ${message}`);
    void this.stop(id).catch(() => {});
  }
  async stop(id: string): Promise<void> {
    const session = this.sessions.get(id); if (!session) return;
    if (session.stopPromise) return session.stopPromise;
    session.abort.abort();
    if (session.timer) clearTimeout(session.timer);
    if (session.monitor) clearInterval(session.monitor);
    session.view = { ...session.view, status: 'stopping', publicUrl: undefined }; this.changed();
    session.stopPromise = (async () => {
      await session.job?.catch(() => undefined);
      try {
        await session.handle?.stop();
        session.handle = undefined;
        session.view = session.failure ? { status: 'error', error: session.failure, managed: false } : { status: 'disabled' };
      } catch (error) {
        session.view = { status: 'error', managed: !!session.handle?.alive(), error: error instanceof Error ? error.message : 'Tunnel cleanup failed.' };
        this.logs.append(id, 'system', `[Sharing] ${session.view.error}`); throw error;
      } finally { session.stopPromise = undefined; this.changed(); }
    })();
    return session.stopPromise;
  }
  async stopAll(close = false): Promise<void> {
    if (close) this.closing = true;
    if (this.stopAllJob) return this.stopAllJob;
    this.stoppingAll = true;
    this.stopAllJob = (async () => {
      const results = await Promise.allSettled([...this.sessions.keys()].map((id) => this.stop(id)));
      const failed = results.filter((item) => item.status === 'rejected');
      if (failed.length) { this.closing = false; throw new Error(`${failed.length} sharing session(s) could not be stopped. Retry Stop All Sharing.`); }
    })().finally(() => { this.stoppingAll = false; this.stopAllJob = undefined; });
    return this.stopAllJob;
  }
  publicUrl(id: string): string {
    const session = this.sessions.get(id);
    if (session?.view.status !== 'sharing' || !session.view.publicUrl || !session.handle?.alive() || !session.origin?.current()) throw new Error('An active public link is not available.');
    return session.view.publicUrl;
  }
}
