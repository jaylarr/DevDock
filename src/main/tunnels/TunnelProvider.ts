import type { SharingAvailability } from '../../shared/contracts';

export interface VerifiedOrigin {
  origin: string;
  entryPath: string;
  current(): boolean;
  owned(): Promise<boolean>;
}
export interface TunnelEvents {
  url(value: string): void;
  connected(): void;
  disconnected(): void;
  exited(error: string): void;
  log(text: string): void;
}
export interface TunnelHandle { stop(): Promise<void>; alive(): boolean }
export interface TunnelProvider {
  availability(): Promise<SharingAvailability>;
  start(origin: string, events: TunnelEvents, signal: AbortSignal): Promise<TunnelHandle>;
}
export function publicOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(url.hostname)) return;
    return url.origin;
  } catch { return; }
}
