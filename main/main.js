const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('node:path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 550,
    height: 232,
    minWidth: 550,
    minHeight: 232,
    resizable: true,
    frame: false,
    transparent: false,
    backgroundColor: '#0d1117',
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
