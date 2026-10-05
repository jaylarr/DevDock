import { access, copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { record } from '../../shared/settings';
import type { ExternalSource } from '../../shared/contracts';

export interface ActivitySetupOptions { directory: string; assets: string; home: string; documents: string; node: string; vscode?: { executable: string; cli: string; extensionsDirectory?: string; userDataDirectory?: string } }
export async function findVSCode(candidates: string[]): Promise<ActivitySetupOptions['vscode']> {
  for (const directory of candidates) {
    const executable = path.join(directory, 'Code.exe');
    try {
      await access(executable);
      const resources = ['resources/app/out/cli.js'];
      const wrapper = path.join(directory, 'bin/code.cmd');
      try {
        if ((await stat(wrapper)).size <= 65536) {
          const match = (await readFile(wrapper, 'utf8')).match(/"%~dp0\.\.\\([^"\r\n]*resources\\app\\out\\cli\.js)"/i);
          if (match && /^(?:[a-z0-9][a-z0-9._-]*\\)?resources\\app\\out\\cli\.js$/i.test(match[1]!)) resources.unshift(match[1]!);
        }
      } catch { /* Older installs use the unversioned resource directory. */ }
      for (const relative of resources) { const cli = path.join(directory, relative); try { await access(cli); return { executable, cli }; } catch { /* Try the next supported resource location. */ } }
    } catch { /* Try the next standard installation. */ }
  }
}
async function readConfiguration(file: string): Promise<Record<string, unknown>> {
  try {
    const info = await stat(file); if (info.size > 1048576) throw new Error('The existing configuration is too large to merge safely.');
    const value: unknown = JSON.parse(await readFile(file, 'utf8')); if (!record(value)) throw new Error('The existing configuration must be a JSON object.'); return value;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw new Error('The existing configuration could not be merged. It was not changed.', { cause: error }); }
}
async function replaceConfiguration(file: string, text: string | Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  try { await copyFile(file, `${file}.devdock-${Date.now()}-${randomUUID()}.bak`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = `${file}.${randomUUID()}.tmp`; await writeFile(temporary, text, 'utf8'); await rename(temporary, file);
}
export function mergeActivityHooks(configuration: Record<string, unknown>, command: string, args?: string[]): Record<string, unknown> {
  if (configuration.hooks !== undefined && !record(configuration.hooks)) throw new Error('Existing hooks are not a JSON object; no configuration was changed.');
  const hooks = structuredClone(configuration.hooks ?? {}) as Record<string, unknown>;
  for (const event of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd']) {
    const previous = hooks[event]; if (previous !== undefined && !Array.isArray(previous)) throw new Error('Existing event hooks are not a list; no configuration was changed.');
    const entries: unknown[] = [];
    for (const entry of previous ?? []) {
      if (!record(entry) || !Array.isArray(entry.hooks)) { entries.push(entry); continue; }
      const retained = entry.hooks.filter((handler) => !record(handler) || !(typeof handler.command === 'string' && handler.command.includes('devdock-activity-hook.cjs') || Array.isArray(handler.args) && handler.args.some((arg) => typeof arg === 'string' && arg.includes('devdock-activity-hook.cjs'))));
      if (retained.length) entries.push({ ...entry, hooks: retained });
    }
    entries.push({ hooks: [{ type: 'command', command, ...(args ? { args } : {}), timeout: 3 }] }); hooks[event] = entries;
  }
  return { ...configuration, hooks };
}
// Minimal ZIP/VSIX writer: fixed bundled filenames only, no third-party packager or network download.
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function packageZip(files: { name: string; data: Buffer }[]): Buffer {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name), checksum = crc32(file.data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(file.data.length, 18); header.writeUInt32LE(file.data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, file.data);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(file.data.length, 20); directory.writeUInt32LE(file.data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42); central.push(directory, name);
    offset += header.length + name.length + file.data.length;
  }
  const size = central.reduce((sum, buffer) => sum + buffer.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
export async function buildActivityExtension(options: ActivitySetupOptions): Promise<string> {
  const manifest = { name: 'devdock-activity', displayName: 'DevDock Activity', description: 'Reports local workspaces and dev-server output to DevDock.', version: '0.2.0', publisher: 'devdock-local', engines: { vscode: '^1.93.0' },
    categories: ['Other'], activationEvents: ['onStartupFinished'], main: './extension.cjs', extensionKind: ['ui'], capabilities: { untrustedWorkspaces: { supported: true }, virtualWorkspaces: { supported: false } }, license: 'MIT' };
  const xml = '<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="devdock-activity" Version="0.2.0" Publisher="devdock-local"/><DisplayName>DevDock Activity</DisplayName><Description xml:space="preserve">Local workspace and dev-server bridge</Description><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.93.0"/><Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui"/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>';
  const content = '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>';
  const files = [ { name: 'extension/package.json', data: Buffer.from(JSON.stringify(manifest)) }, { name: 'extension/bridge-config.json', data: Buffer.from(JSON.stringify({ dataDirectory: options.directory })) },
    { name: 'extension/extension.cjs', data: await readFile(path.join(options.assets, 'vscode-extension.cjs')) }, { name: 'extension.vsixmanifest', data: Buffer.from(xml) }, { name: '[Content_Types].xml', data: Buffer.from(content) } ];
  await mkdir(path.join(options.directory, 'integrations'), { recursive: true });
  const file = path.join(options.directory, 'integrations', 'devdock-activity.vsix'); await writeFile(file, packageZip(files)); return file;
}
function quoted(value: string): string { if (/["`$%\r\n]/.test(value)) throw new Error('Unsupported integration path.'); return `"${value.replaceAll('\\', '/')}"`; }
export function mergeTerminalProfile(current: string, script: string, directory: string): string {
  const clean = current.replace(/(?:\r?\n)?# BEGIN DEVDOCK ACTIVITY\r?\n[\s\S]*?# END DEVDOCK ACTIVITY(?:\r?\n)?/g, '\n');
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  return `${clean.trimEnd()}\n\n# BEGIN DEVDOCK ACTIVITY\n. ${quote(script)} -DataDirectory ${quote(directory)}\n# END DEVDOCK ACTIVITY\n`;
}
async function readProfile(file: string): Promise<string> {
  try {
    const info = await stat(file); if (info.size > 1048576) throw new Error('Existing PowerShell profile is too large to merge safely.');
    const buffer = await readFile(file);
    const text = buffer[0] === 0xff && buffer[1] === 0xfe ? buffer.subarray(2).toString('utf16le') : new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (text.includes('\0')) throw new Error('Unsupported PowerShell profile encoding.');
    return text;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw new Error('The existing PowerShell profile could not be read safely. It was not changed.', { cause: error }); }
}
export async function setupActivity(source: ExternalSource, options: ActivitySetupOptions): Promise<string> {
  const integrations = path.join(options.directory, 'integrations'); await mkdir(integrations, { recursive: true });
  let message: string;
  if (source === 'codex' || source === 'claude') {
    const script = path.join(integrations, 'devdock-activity-hook.cjs'); await copyFile(path.join(options.assets, 'devdock-activity-hook.cjs'), script);
    const target = source === 'codex' ? path.join(options.home, '.codex', 'hooks.json') : path.join(options.home, '.claude', 'settings.json');
    const configuration = await readConfiguration(target);
    const command = source === 'codex' ? `node ${quoted(script)} ${source} ${quoted(options.directory)}` : options.node;
    const args = source === 'claude' ? [script, source, options.directory] : undefined;
    await replaceConfiguration(target, JSON.stringify(mergeActivityHooks(configuration, command, args), null, 2) + '\n');
    message = source === 'codex' ? 'Codex hooks installed. Review and trust the DevDock hooks in Codex, then reopen the project session.' : 'Claude Code hooks installed. Reopen Claude Code to load them.';
  } else if (source === 'terminal') {
    const script = path.join(integrations, 'devdock-terminal.ps1'); await copyFile(path.join(options.assets, 'devdock-terminal.ps1'), script);
    const profiles: { file: string; text: string }[] = [];
    for (const folder of ['WindowsPowerShell', 'PowerShell']) {
      const profile = path.join(options.documents, folder, 'Microsoft.PowerShell_profile.ps1');
      const current = await readProfile(profile);
      profiles.push({ file: profile, text: mergeTerminalProfile(current, script, options.directory) });
    }
    // A UTF-8 BOM also preserves non-ASCII paths in Windows PowerShell 5.1.
    for (const profile of profiles) await replaceConfiguration(profile.file, Buffer.from('\ufeff' + profile.text, 'utf8'));
    message = 'PowerShell prompt bridge installed. Open a new PowerShell terminal with profiles enabled. Your prompt is preserved; execution policy is unchanged.';
  } else {
    if (!options.vscode) throw new Error('VS Code was not found in a supported Windows installation.');
    const file = await buildActivityExtension(options);
    const extra = [...(options.vscode.extensionsDirectory ? ['--extensions-dir', options.vscode.extensionsDirectory] : []), ...(options.vscode.userDataDirectory ? ['--user-data-dir', options.vscode.userDataDirectory] : [])];
    await new Promise<void>((resolve, reject) => execFile(options.vscode!.executable, [options.vscode!.cli, ...extra, '--install-extension', file, '--force'],
      { windowsHide: true, timeout: 45000, maxBuffer: 65536, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }, (error) => error ? reject(new Error('VS Code could not install its local bridge. The VSIX is in the activity integrations folder.')) : resolve()));
    message = 'VS Code bridge installed. Reload existing VS Code windows to connect them; new windows connect automatically.';
  }
  await writeFile(path.join(options.directory, `${source}.installed`), '1', 'utf8'); return message;
}
