const { contextBridge, ipcRenderer, webUtils } = require('electron');
const path = require('node:path');

contextBridge.exposeInMainWorld('retro', {
  homeDirs: () => ipcRenderer.invoke('fs:home-dirs'),
  cloudRoots: () => ipcRenderer.invoke('fs:cloud-roots'),
  listDir: (dirPath) => ipcRenderer.invoke('fs:list-dir', dirPath),
  scanAudioDir: (dirPath) => ipcRenderer.invoke('fs:scan-audio-dir', dirPath),
  openPath: (dirPath) => ipcRenderer.invoke('fs:open-path', dirPath),
  revealItem: (targetPath) => ipcRenderer.invoke('fs:reveal-item', targetPath),
  createDir: (parentPath, folderName) => ipcRenderer.invoke('fs:create-dir', parentPath, folderName),
  renameItem: (oldPath, newName) => ipcRenderer.invoke('fs:rename-item', oldPath, newName),
  moveItem: (sourcePath, destDir) => ipcRenderer.invoke('fs:move-item', sourcePath, destDir),
  trashItem: (targetPath) => ipcRenderer.invoke('fs:trash-item', targetPath),
  dirname: (p) => path.dirname(p),
  basename: (p) => path.basename(p),

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

  youtubeStatus: () => ipcRenderer.invoke('youtube:status'),
  youtubeDownload: (url) => ipcRenderer.invoke('youtube:download', url),
  youtubeCancel: () => ipcRenderer.invoke('youtube:cancel'),
  onYoutubeProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('youtube:progress', handler);
    return () => ipcRenderer.removeListener('youtube:progress', handler);
  },
  onYoutubeTrackAdded: (cb) => {
    const handler = (_e, filePath) => cb(filePath);
    ipcRenderer.on('youtube:track-added', handler);
    return () => ipcRenderer.removeListener('youtube:track-added', handler);
  },
});
