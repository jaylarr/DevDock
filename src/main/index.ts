import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, shell } from 'electron';
import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { channels, externalSources, type ExternalSource, type Result } from '../shared/contracts';
import { AppService } from './services/appService';
import { Persistence } from './services/persistence';
import { localOrigin } from './services/processManager';
import { within } from './services/identity';
import { LocalDiagnostics } from './services/diagnostics';
import { SettingsTransfer, writePortableFile } from './services/settingsTransfer';
import { record, type SettingsPatch } from '../shared/settings';
import { sharingCompatibility } from './services/sharingCompatibility';
import { setupActivity, findVSCode } from './services/activitySetup';
import { executable } from './ports/NativePortProvider';
import { readStopTargets } from './services/externalServerStop';

// Keep the existing data directory when changing the product name.
const legacyUserData = path.join(app.getPath('appData'), 'Local Dev Manager');
app.setName('DevDock');
app.setPath('userData', legacyUserData);
if (process.env.LDM_DATA_DIR) app.setPath('userData', path.resolve(process.env.LDM_DATA_DIR));
protocol.registerSchemesAsPrivileged([{ scheme: 'ldm', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
let window: BrowserWindow | undefined;
let service: AppService | undefined;
let quitting = false;
let approvedQuit = false;
let notification: ReturnType<typeof setTimeout> | undefined;
const developmentUrl = !app.isPackaged && process.env.LDM_RENDERER_URL ? new URL(process.env.LDM_RENDERER_URL) : undefined;
if (developmentUrl && (developmentUrl.protocol !== 'http:' || developmentUrl.hostname !== '127.0.0.1')) throw new Error('Development renderer must use the loopback interface.');
const rendererUrl = developmentUrl?.href ?? 'ldm://manager/index.html';

function changed(): void {
  if (notification) return;
  notification = setTimeout(() => { notification = undefined; if (window && !window.isDestroyed()) window.webContents.send(channels.changed); }, 50);
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{16}$/.test(value)) throw new Error('Invalid project/root ID.');
  return value;
}
function token(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new Error('Invalid preview token.'); return value; }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('Invalid boolean.'); return value; }
function handlers(manager: AppService): void {
  let settingUpActivity = false;
  const transfer = new SettingsTransfer(manager);
  const diagnostics = new LocalDiagnostics(manager, { version: app.getVersion(), electron: process.versions.electron });
  const handle = (channel: string, operation: (argument: unknown) => unknown | Promise<unknown>) => {
    ipcMain.handle(channel, async (event, argument: unknown): Promise<Result<unknown>> => {
      try {
        if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== rendererUrl) throw new Error('Untrusted IPC sender.');
        if (quitting) throw new Error('The manager is shutting down.');
        return { ok: true, value: await operation(argument) };
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Operation failed.' }; }
    });
  };
  handle(channels.snapshot, () => manager.snapshot());
  handle(channels.externalRefresh, async () => { await manager.externalActivity?.refresh(); await manager.externalServers?.refresh(); });
  handle(channels.externalSetup, async (value) => {
    if (!externalSources.some((source) => source === value) || !manager.externalActivity) throw new Error('Invalid activity integration.');
    if (settingUpActivity) throw new Error('Wait for the current integration setup to finish.');
    settingUpActivity = true;
    try {
      let vscode: { executable: string; cli: string } | undefined;
      if (value === 'vscode') {
        const candidates = [path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code'), path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft VS Code')];
        vscode = await findVSCode(candidates);
      }
      const message = await setupActivity(value as ExternalSource, { directory: manager.externalActivity.directory, assets: path.resolve(__dirname, 'activity-assets'), home: app.getPath('home'), documents: app.getPath('documents'), node: await executable('node'), vscode });
      await manager.externalActivity.installed(value as ExternalSource); return message;
    } finally { settingUpActivity = false; }
  });
  handle(channels.addRoot, async () => {
    const selected = await dialog.showOpenDialog(window!, { title: 'Add a project root folder', properties: ['openDirectory'] });
    if (!selected.canceled && selected.filePaths[0]) await manager.addRoot(selected.filePaths[0]);
  });
  handle(channels.removeRoot, (id) => manager.removeRoot(identifier(id)));
  handle(channels.scan, () => manager.scan());
  handle(channels.cancelScan, () => manager.cancelScan());
  handle(channels.addExclusion, async () => {
    const selected = await dialog.showOpenDialog(window!, { title: 'Exclude a folder from project discovery', properties: ['openDirectory'] });
    if (!selected.canceled && selected.filePaths[0]) await manager.addExclusion(selected.filePaths[0]);
  });
  handle(channels.removeExclusion, (id) => manager.removeExclusion(identifier(id)));
  handle(channels.start, (id) => manager.start(identifier(id)));
  handle(channels.stop, (id) => manager.stop(identifier(id)));
  handle(channels.stopExternal, (input) => {
    if (!record(input) || Object.keys(input).some((key) => !['id', 'servers'].includes(key))) throw new Error('Invalid external server stop request.');
    return manager.stopExternal(identifier(input.id), readStopTargets(input.servers));
  });
  handle(channels.restart, (id) => manager.restart(identifier(id)));
  handle(channels.pin, (input) => {
    if (!record(input) || Object.keys(input).some((key) => !['id', 'pinned'].includes(key))) throw new Error('Invalid pin request.');
    return manager.setPinned(identifier(input.id), boolean(input.pinned));
  });
  handle(channels.share, (id) => manager.share(identifier(id)));
  handle(channels.compatibility, (id) => sharingCompatibility(manager.project(identifier(id))));
  handle(channels.stopSharing, (id) => manager.stopSharing(identifier(id)));
  handle(channels.stopAllSharing, () => manager.stopAllSharing());
  handle(channels.copyPublicLink, (id) => clipboard.writeText(manager.publicUrl(identifier(id))));
  handle(channels.openPublicLink, (id) => shell.openExternal(manager.publicUrl(identifier(id))));
  handle(channels.logs, (id) => { const project = manager.project(identifier(id)); return manager.logs.get(project.id); });
  handle(channels.clearLogs, (id) => { const project = manager.project(identifier(id)); manager.logs.clear(project.id); });
  handle(channels.copyLogs, (id) => {
    const project = manager.project(identifier(id));
    clipboard.writeText(manager.logs.get(project.id).map((entry) => `${entry.timestamp} [${entry.stream}] ${entry.text}`).join('\n'));
  });
  handle(channels.folder, async (id) => {
    const project = manager.project(identifier(id)); await access(project.path);
    const error = await shell.openPath(project.path); if (error) throw new Error(error);
    await manager.recordActivity(project.id);
  });
  handle(channels.open, async (id) => {
    const project = manager.project(identifier(id)); const localUrl = await manager.openUrl(project.id);
    if (!localOrigin(localUrl)) throw new Error('A verified local server is not available.');
    // Preserve the manager-selected entry page on the verified loopback origin.
    await shell.openExternal(localUrl);
    await manager.recordActivity(project.id);
  });
  handle(channels.settings, (input) => {
    if (!record(input) || Object.keys(input).some((key) => !['patch', 'currentFilter'].includes(key))) throw new Error('Invalid settings request.');
    if (input.currentFilter !== undefined && (typeof input.currentFilter !== 'string' || input.currentFilter.length > 32)) throw new Error('Invalid filter.');
    return manager.updateSettings(input.patch as SettingsPatch, input.currentFilter as string | undefined);
  });
  handle(channels.filter, (value) => { if (typeof value !== 'string' || value.length > 32) throw new Error('Invalid filter.'); return manager.rememberFilter(value); });
  handle(channels.reset, () => manager.resetPreferences());
  handle(channels.clearCache, () => manager.clearCache());
  handle(channels.dataFolder, async () => { const error = await shell.openPath(app.getPath('userData')); if (error) throw new Error(error); });
  handle(channels.exportSettings, async (include) => {
    const value = transfer.export(boolean(include));
    const selected = await dialog.showSaveDialog(window!, { title: 'Export DevDock settings', defaultPath: `devdock-settings-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON settings', extensions: ['json'] }] });
    if (selected.canceled || !selected.filePath) return 'cancelled';
    await writePortableFile(selected.filePath, value); return 'exported';
  });
  handle(channels.previewImport, async () => {
    transfer.cancel();
    const selected = await dialog.showOpenDialog(window!, { title: 'Import DevDock settings', properties: ['openFile'], filters: [{ name: 'JSON settings', extensions: ['json'] }] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return transfer.preview(selected.filePaths[0]);
  });
  handle(channels.applyImport, (input) => {
    if (!record(input) || Object.keys(input).some((key) => !['token', 'discovery'].includes(key))) throw new Error('Invalid import request.');
    return transfer.apply(token(input.token), boolean(input.discovery));
  });
  handle(channels.cancelImport, (value) => transfer.cancel(token(value)));
  handle(channels.diagnostics, (refresh) => diagnostics.get(boolean(refresh)));
  handle(channels.copyDiagnostics, (id) => clipboard.writeText(diagnostics.reportText(token(id))));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  app.whenReady().then(async () => {
    const rendererDirectory = path.resolve(__dirname, '../renderer');
    protocol.handle('ldm', async (request) => {
      const url = new URL(request.url);
      const file = path.resolve(rendererDirectory, `.${decodeURIComponent(url.pathname)}`);
      if (url.host !== 'manager' || !within(file, rendererDirectory)) return new Response('Not found', { status: 404 });
      const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
      try { return new Response(new Uint8Array(await readFile(file)), { headers: { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' } }); }
      catch { return new Response('Not found', { status: 404 }); }
    });
    service = new AppService(new Persistence(app.getPath('userData')), changed, {
      openLocal: async (url) => { if (!quitting && localOrigin(url)) await shell.openExternal(url); },
      directory: path.join(app.getAppPath(), '.sharing-runtime'), protectedOrigin: developmentUrl?.origin,
      activityDirectory: path.join(app.getPath('userData'), 'external-activity'),
    });
    await service.initialize();
    window = new BrowserWindow({ width: 1220, height: 800, minWidth: 850, minHeight: 600, show: false,
      backgroundColor: '#f4f5f1', title: 'DevDock', autoHideMenuBar: true,
      webPreferences: { preload: path.resolve(__dirname, '../preload/index.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false } });
    const session = window.webContents.session;
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      const appAsset = url.protocol === 'ldm:' && url.host === 'manager';
      const devAsset = developmentUrl && url.host === developmentUrl.host && ['http:', 'ws:'].includes(url.protocol);
      callback({ cancel: !(appAsset || devAsset) });
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    handlers(service);
    window.once('ready-to-show', () => window?.show());
    await window.loadURL(rendererUrl);
    if (service.snapshot().settings.discovery.scanOnLaunch) void service.scan().catch((error: unknown) => dialog.showErrorBox('Scan failed', error instanceof Error ? error.message : 'Could not scan folders.'));
  }).catch((error: unknown) => { dialog.showErrorBox('DevDock could not start', error instanceof Error ? error.message : 'Unknown startup error.'); app.exit(1); });
  app.on('before-quit', (event) => {
    if (approvedQuit) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void (service?.close() ?? Promise.resolve()).then(() => { approvedQuit = true; app.quit(); }).catch((error: unknown) => {
      quitting = false; dialog.showErrorBox('Cleanup needs attention', error instanceof Error ? error.message : 'Could not stop managed projects.');
    });
  });
  app.on('window-all-closed', () => app.quit());
}
