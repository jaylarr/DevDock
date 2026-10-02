import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, shell } from 'electron';
import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { channels, type Result, type Theme } from '../shared/contracts';
import { AppService } from './services/appService';
import { Persistence } from './services/persistence';
import { localOrigin } from './services/processManager';
import { within } from './services/identity';

app.setName('Local Dev Manager');
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
function handlers(manager: AppService): void {
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
  handle(channels.addRoot, async () => {
    const selected = await dialog.showOpenDialog(window!, { title: 'Add a project root folder', properties: ['openDirectory'] });
    if (!selected.canceled && selected.filePaths[0]) await manager.addRoot(selected.filePaths[0]);
  });
  handle(channels.removeRoot, (id) => manager.removeRoot(identifier(id)));
  handle(channels.scan, () => manager.scan());
  handle(channels.cancelScan, () => manager.cancelScan());
  handle(channels.start, (id) => manager.start(identifier(id)));
  handle(channels.stop, (id) => manager.stop(identifier(id)));
  handle(channels.restart, (id) => manager.restart(identifier(id)));
  handle(channels.logs, (id) => { const project = manager.project(identifier(id)); return manager.logs.get(project.id); });
  handle(channels.clearLogs, (id) => { const project = manager.project(identifier(id)); manager.logs.clear(project.id); });
  handle(channels.copyLogs, (id) => {
    const project = manager.project(identifier(id));
    clipboard.writeText(manager.logs.get(project.id).map((entry) => `${entry.timestamp} [${entry.stream}] ${entry.text}`).join('\n'));
  });
  handle(channels.folder, async (id) => {
    const project = manager.project(identifier(id)); await access(project.path);
    const error = await shell.openPath(project.path); if (error) throw new Error(error);
  });
  handle(channels.open, async (id) => {
    const project = manager.processes.view(manager.project(identifier(id)));
    const url = project.localUrl ? localOrigin(project.localUrl) : undefined;
    if (project.status !== 'running' || !url) throw new Error('A verified local server is not available.');
    await shell.openExternal(url);
  });
  handle(channels.theme, (theme) => {
    if (theme !== 'system' && theme !== 'light' && theme !== 'dark') throw new Error('Invalid theme.');
    return manager.theme(theme as Theme);
  });
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
    service = new AppService(new Persistence(app.getPath('userData')), changed);
    await service.initialize();
    window = new BrowserWindow({ width: 1220, height: 800, minWidth: 850, minHeight: 600, show: false,
      backgroundColor: '#f4f5f1', title: 'Local Dev Manager', autoHideMenuBar: true,
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
    void service.scan().catch((error: unknown) => dialog.showErrorBox('Scan failed', error instanceof Error ? error.message : 'Could not scan folders.'));
  }).catch((error: unknown) => { dialog.showErrorBox('Local Dev Manager could not start', error instanceof Error ? error.message : 'Unknown startup error.'); app.exit(1); });
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
