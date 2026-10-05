import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { executable, npmCommand } from '../ports/NativePortProvider';
import type { AppService } from './appService';
import type { Diagnostics, RuntimeCheck } from '../../shared/settings';

export async function versionCommand(binary: string, args: string[]): Promise<RuntimeCheck> {
  return new Promise((resolve) => {
    let output = ''; let settled = false;
    const child = spawn(binary, args, { shell: false, windowsHide: true, cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'], signal: AbortSignal.timeout(3000) });
    const finish = (result: RuntimeCheck) => { if (!settled) { settled = true; resolve(result); } };
    child.stdout.on('data', (chunk: Buffer) => { if (settled) return; output = (output + chunk.toString('utf8')).slice(0, 4097); if (output.length > 4096) { child.kill(); finish({ status: 'unavailable', code: 'output_limit' }); } });
    child.once('error', () => finish({ status: 'unavailable', code: 'check_failed_or_timed_out' }));
    child.once('exit', (code) => {
      const version = output.trim();
      finish(code === 0 && /^v?\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(version) ? { status: 'available', version } : { status: 'unavailable', code: 'invalid_version' });
    });
  });
}
export class LocalDiagnostics {
  private checks?: Promise<{ node: RuntimeCheck; npm: RuntimeCheck }>;
  private inspecting = false;
  private report?: Diagnostics;
  constructor(private service: AppService, private metadata: { version: string; electron: string }) {}
  private async inspect(): Promise<{ node: RuntimeCheck; npm: RuntimeCheck }> {
    const missing: RuntimeCheck = { status: 'unavailable', code: 'runtime_not_found' };
    const node = await executable('node').then((binary) => versionCommand(binary, ['--version'])).catch(() => missing);
    const npm = await npmCommand().then(({ node, cli }) => versionCommand(node, [cli, '--version'])).catch(() => missing);
    return { node, npm };
  }
  async get(refresh = false): Promise<Diagnostics> {
    if (!this.checks || refresh && !this.inspecting) { this.inspecting = true; this.checks = this.inspect().finally(() => { this.inspecting = false; }); }
    const runtime = await this.checks; const snapshot = this.service.snapshot();
    const sharing: RuntimeCheck = snapshot.sharing.available ? { status: 'available', version: snapshot.sharing.version } : { status: 'unavailable', code: 'missing_invalid_or_unsupported' };
    const result: Diagnostics = { reportId: randomUUID(), ...this.metadata, platform: process.platform, arch: process.arch, ...runtime, sharing, schema: 3,
      recovered: snapshot.recovered, roots: snapshot.roots.length, projects: snapshot.projects.length, active: snapshot.projects.filter((project) => project.managed).length,
      previews: snapshot.projects.filter((project) => project.sharing?.managed).length, scan: snapshot.scanning ? 'scanning' : snapshot.lastScan?.outcome ?? 'not_checked_this_session', report: '' };
    const describe = (value: RuntimeCheck) => `${value.status}${value.version ? ` (${value.version})` : ` (${value.code})`}`;
    result.report = [`DevDock ${result.version}`, `Platform: ${result.platform} ${result.arch}`, `Electron: ${result.electron}`, `Project Node: ${describe(result.node)}`,
      `npm: ${describe(result.npm)}`, `Sharing runtime: ${describe(result.sharing)}`, `State schema: ${result.schema}`, `Recovered backup: ${result.recovered ? 'yes' : 'no'}`,
      `Registered roots: ${result.roots}`, `Cached projects: ${result.projects}`, `Managed projects: ${result.active}`, `Managed previews: ${result.previews}`, `Scan: ${result.scan}`].join('\n');
    this.report = result; return result;
  }
  reportText(id: string): string {
    if (!this.report || this.report.reportId !== id) throw new Error('Diagnostic preview changed. Refresh the preview before copying.');
    return this.report.report;
  }
}
