const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('retro', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggle-always-on-top'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  openFileDialog: () => ipcRenderer.invoke('files:open-dialog'),
  openFolderDialog: () => ipcRenderer.invoke('files:open-folder-dialog'),
  saveM3u: (paths) => ipcRenderer.invoke('files:save-m3u', paths),
  openM3u: () => ipcRenderer.invoke('files:open-m3u'),
  readTagBytes: (filePath, maxBytes) => ipcRenderer.invoke('files:read-tag-bytes', filePath, maxBytes),
  pathForFile: (file) => webUtils.getPathForFile(file),

  googleStatus: () => ipcRenderer.invoke('google:status'),
  googleConnect: () => ipcRenderer.invoke('google:connect'),
  googleDisconnect: () => ipcRenderer.invoke('google:disconnect'),
  googleListFolder: (folderIdOrUrl) => ipcRenderer.invoke('google:list-folder', folderIdOrUrl),
  googleGetTrack: (fileId) => ipcRenderer.invoke('google:get-track', fileId),
  googleOpenConfig: () => ipcRenderer.invoke('google:open-config'),
});
