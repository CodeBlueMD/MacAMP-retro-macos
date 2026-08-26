const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const googleDrive = require('./google-drive');

let mainWindow;

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1090,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    resizable: true,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0f0c',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:toggle-always-on-top', () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(next);
  return next;
});
ipcMain.handle('window:toggle-fullscreen', () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return next;
});

ipcMain.handle('files:open-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Add to Playlist',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] },
    ],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

function scanAudioDir(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scanAudioDir(full, out);
    else if (AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
}

ipcMain.handle('files:open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Add Folder to Playlist',
    properties: ['openDirectory'],
  });
  if (result.canceled) return [];
  const out = [];
  for (const dir of result.filePaths) scanAudioDir(dir, out);
  return out;
});

ipcMain.handle('files:save-m3u', async (_e, paths) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Playlist',
    defaultPath: 'playlist.m3u',
    filters: [{ name: 'M3U Playlist', extensions: ['m3u'] }],
  });
  if (result.canceled || !result.filePath) return false;
  const content = '#EXTM3U\n' + paths.join('\n') + '\n';
  fs.writeFileSync(result.filePath, content, 'utf8');
  return true;
});

ipcMain.handle('files:open-m3u', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Load Playlist',
    properties: ['openFile'],
    filters: [{ name: 'M3U Playlist', extensions: ['m3u', 'm3u8'] }],
  });
  if (result.canceled || !result.filePaths[0]) return [];
  const content = fs.readFileSync(result.filePaths[0], 'utf8');
  return content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
});

ipcMain.handle('files:read-tag-bytes', async (_e, filePath, maxBytes) => {
  try {
    const fd = fs.openSync(filePath, 'r');
    const size = Math.min(maxBytes, fs.fstatSync(fd).size);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    fs.closeSync(fd);
    return buf.toString('base64');
  } catch {
    return null;
  }
});

ipcMain.handle('google:status', () => googleDrive.status());
ipcMain.handle('google:connect', () => googleDrive.connect());
ipcMain.handle('google:disconnect', () => { googleDrive.disconnect(); return googleDrive.status(); });
ipcMain.handle('google:list-folder', (_e, folderIdOrUrl) => googleDrive.listAudioInFolder(folderIdOrUrl));
ipcMain.handle('google:get-track', (_e, fileId) => googleDrive.getFileBytesBase64(fileId));
ipcMain.handle('google:open-config', () => shell.showItemInFolder(googleDrive.configPath()));
