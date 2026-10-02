import { contextBridge, ipcRenderer } from 'electron';
import { channels, type DevManagerAPI } from '../shared/contracts';

const api: DevManagerAPI = {
  snapshot: () => ipcRenderer.invoke(channels.snapshot),
  addRoot: () => ipcRenderer.invoke(channels.addRoot),
  removeRoot: (id) => ipcRenderer.invoke(channels.removeRoot, id),
  scan: () => ipcRenderer.invoke(channels.scan),
  cancelScan: () => ipcRenderer.invoke(channels.cancelScan),
  addExclusion: () => ipcRenderer.invoke(channels.addExclusion),
  removeExclusion: (id) => ipcRenderer.invoke(channels.removeExclusion, id),
  start: (id) => ipcRenderer.invoke(channels.start, id),
  stop: (id) => ipcRenderer.invoke(channels.stop, id),
  restart: (id) => ipcRenderer.invoke(channels.restart, id),
  share: (id) => ipcRenderer.invoke(channels.share, id),
  sharingCompatibility: (id) => ipcRenderer.invoke(channels.compatibility, id),
  stopSharing: (id) => ipcRenderer.invoke(channels.stopSharing, id),
  stopAllSharing: () => ipcRenderer.invoke(channels.stopAllSharing),
  copyPublicLink: (id) => ipcRenderer.invoke(channels.copyPublicLink, id),
  openPublicLink: (id) => ipcRenderer.invoke(channels.openPublicLink, id),
  open: (id) => ipcRenderer.invoke(channels.open, id),
  folder: (id) => ipcRenderer.invoke(channels.folder, id),
  logs: (id) => ipcRenderer.invoke(channels.logs, id),
  clearLogs: (id) => ipcRenderer.invoke(channels.clearLogs, id),
  copyLogs: (id) => ipcRenderer.invoke(channels.copyLogs, id),
  theme: (theme) => ipcRenderer.invoke(channels.theme, theme),
  onChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on(channels.changed, listener);
    return () => ipcRenderer.removeListener(channels.changed, listener);
  },
};
contextBridge.exposeInMainWorld('devManager', Object.freeze(api));
