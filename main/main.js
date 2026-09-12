const { app, BrowserWindow, dialog, ipcMain, Menu, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const googleDrive = require('./google-drive');
const youtubeDownloader = require('./youtube-downloader');

let mainWindow;

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.aiff', '.aif']);

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;
  const initialWidth = Math.min(1320, Math.max(1024, screenW - 40));
  const initialHeight = Math.min(960, Math.max(760, screenH - 25));

  mainWindow = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    minWidth: 960,
    minHeight: 660,
    resizable: true,
    frame: false,
    backgroundColor: '#0c0d10',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  // Keep a minimal macOS menu so copy/paste still works.
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
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
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'aiff', 'aif'] }],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

function scanAudioDir(dir, out, depth = 0) {
  if (depth > 8) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scanAudioDir(full, out, depth + 1);
    else if (AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
}

function existing(p) {
  try { return fs.existsSync(p) ? p : null; } catch { return null; }
}

function listCloudStorageChildren(prefix) {
  const root = path.join(os.homedir(), 'Library', 'CloudStorage');
  const found = [];
  try {
    for (const name of fs.readdirSync(root)) {
      if (name.startsWith(prefix)) {
        const p = path.join(root, name);
        if (fs.statSync(p).isDirectory()) found.push(p);
      }
    }
  } catch {}
  return found;
}

ipcMain.handle('fs:home-dirs', () => {
  const home = os.homedir();
  const out = { home };
  const music = path.join(home, 'Music');
  const desktop = path.join(home, 'Desktop');
  const downloads = path.join(home, 'Downloads');
  if (existing(music)) out.music = music;
  if (existing(desktop)) out.desktop = desktop;
  if (existing(downloads)) out.downloads = downloads;
  const macampDir = youtubeDownloader.getMusicDir();
  if (existing(macampDir)) out.macamp = macampDir;
  return out;
});

ipcMain.handle('fs:cloud-roots', () => {
  const home = os.homedir();
  const roots = [];

  const icloud = existing(path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'));
  if (icloud) roots.push({ id: 'icloud', label: 'iCloud Drive', path: icloud });

  const dropboxClassic = existing(path.join(home, 'Dropbox'));
  if (dropboxClassic) roots.push({ id: 'dropbox', label: 'Dropbox', path: dropboxClassic });
  for (const p of listCloudStorageChildren('Dropbox-')) {
    roots.push({ id: 'dropbox', label: path.basename(p), path: p });
  }

  for (const p of listCloudStorageChildren('OneDrive-')) {
    roots.push({ id: 'onedrive', label: path.basename(p).replace(/^OneDrive-/, 'OneDrive '), path: p });
  }

  for (const p of listCloudStorageChildren('GoogleDrive-')) {
    // Usually .../GoogleDrive-xxx/My Drive
    const myDrive = existing(path.join(p, 'My Drive')) || p;
    roots.push({ id: 'gdrive-desktop', label: 'Google Drive (Desktop)', path: myDrive });
  }

  // de-dupe by path
  const seen = new Set();
  return roots.filter((r) => {
    if (seen.has(r.path)) return false;
    seen.add(r.path);
    return true;
  });
});

ipcMain.handle('fs:list-dir', (_e, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const dirs = [];
    const files = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) dirs.push(full);
      else if (AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) files.push(full);
    }
    dirs.sort((a, b) => a.localeCompare(b));
    files.sort((a, b) => a.localeCompare(b));
    return { path: dirPath, dirs, files };
  } catch (err) {
    return { path: dirPath, dirs: [], files: [], error: err.message };
  }
});

ipcMain.handle('fs:scan-audio-dir', (_e, dirPath) => {
  const out = [];
  scanAudioDir(dirPath, out);
  return out;
});

ipcMain.handle('fs:open-path', async (_e, dirPath) => {
  try {
    if (!dirPath) return false;
    await shell.openPath(dirPath);
    return true;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:reveal-item', (_e, targetPath) => {
  try {
    if (!targetPath) return false;
    shell.showItemInFolder(targetPath);
    return true;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:create-dir', (_e, parentPath, folderName) => {
  try {
    if (!parentPath || !folderName) throw new Error('Missing path or folder name');
    const safeName = folderName.trim().replace(/[/\\:]/g, '-');
    const newPath = path.join(parentPath, safeName);
    if (!fs.existsSync(newPath)) {
      fs.mkdirSync(newPath, { recursive: true });
    }
    return { success: true, path: newPath };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:rename-item', (_e, oldPath, newName) => {
  try {
    if (!oldPath || !newName) throw new Error('Missing path or new name');
    const dir = path.dirname(oldPath);
    const safeName = newName.trim().replace(/[/\\:]/g, '-');
    const newPath = path.join(dir, safeName);
    if (oldPath !== newPath) {
      if (fs.existsSync(newPath)) throw new Error('An item with that name already exists');
      fs.renameSync(oldPath, newPath);
    }
    return { success: true, oldPath, newPath };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:move-item', (_e, sourcePath, destDir) => {
  try {
    if (!sourcePath || !destDir) throw new Error('Missing source or destination');
    const baseName = path.basename(sourcePath);
    let destPath = path.join(destDir, baseName);
    if (sourcePath === destPath) return { success: true, path: destPath };
    if (fs.existsSync(destPath)) {
      const ext = path.extname(baseName);
      const nameWithoutExt = path.basename(baseName, ext);
      let counter = 1;
      while (fs.existsSync(destPath)) {
        destPath = path.join(destDir, `${nameWithoutExt} (${counter})${ext}`);
        counter++;
      }
    }
    fs.renameSync(sourcePath, destPath);
    return { success: true, oldPath: sourcePath, newPath: destPath };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:trash-item', async (_e, targetPath) => {
  try {
    if (!targetPath) return false;
    await shell.trashItem(targetPath);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

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
  fs.writeFileSync(result.filePath, '#EXTM3U\n' + paths.join('\n') + '\n', 'utf8');
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
ipcMain.handle('google:open-config', () => {
  googleDrive.ensureConfigTemplate();
  shell.showItemInFolder(googleDrive.configPath());
});

ipcMain.handle('youtube:status', () => youtubeDownloader.checkStatus());
ipcMain.handle('youtube:download', async (_e, url) => {
  return youtubeDownloader.download(
    url,
    (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('youtube:progress', progress);
      }
    },
    (trackPath) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('youtube:track-added', trackPath);
      }
    }
  );
});
ipcMain.handle('youtube:cancel', () => youtubeDownloader.cancel());
