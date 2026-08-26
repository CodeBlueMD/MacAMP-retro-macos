const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('retro', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggle-always-on-top'),
  openFileDialog: () => ipcRenderer.invoke('files:open-dialog'),
  pathForFile: (file) => webUtils.getPathForFile(file),
});
