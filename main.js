const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: 'Cambuz PDF Reader',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#1e1e2e',
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Build menu
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open PDF...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow.webContents.send('menu-open-file'),
        },
        {
          label: 'Close PDF',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow.webContents.send('menu-close-file'),
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Find in Document...',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow.webContents.send('menu-find'),
        },
        { type: 'separator' },
        {
          label: 'Select All Text on Page',
          accelerator: 'CmdOrCtrl+A',
          click: () => mainWindow.webContents.send('menu-select-all'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => mainWindow.webContents.send('menu-zoom-in'),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => mainWindow.webContents.send('menu-zoom-out'),
        },
        {
          label: 'Fit Page',
          accelerator: 'CmdOrCtrl+0',
          click: () => mainWindow.webContents.send('menu-fit-page'),
        },
        {
          label: 'Fit Width',
          accelerator: 'CmdOrCtrl+Shift+0',
          click: () => mainWindow.webContents.send('menu-fit-width'),
        },
        { type: 'separator' },
        {
          label: 'Previous Page',
          accelerator: 'PageUp',
          click: () => mainWindow.webContents.send('menu-prev-page'),
        },
        {
          label: 'Next Page',
          accelerator: 'PageDown',
          click: () => mainWindow.webContents.send('menu-next-page'),
        },
        { type: 'separator' },
        {
          label: 'Rotate Clockwise',
          accelerator: 'CmdOrCtrl+Right',
          click: () => mainWindow.webContents.send('menu-rotate-cw'),
        },
        {
          label: 'Rotate Counter-clockwise',
          accelerator: 'CmdOrCtrl+Left',
          click: () => mainWindow.webContents.send('menu-rotate-ccw'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          accelerator: 'F9',
          click: () => mainWindow.webContents.send('menu-sidebar'),
        },
        {
          label: 'Toggle Full Screen',
          accelerator: 'F11',
          click: () => mainWindow.webContents.send('menu-fullscreen'),
        },
        {
          label: 'Toggle Dark/Light',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => mainWindow.webContents.send('menu-toggle-theme'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'F1',
          click: () => mainWindow.webContents.send('menu-shortcuts'),
        },
        { type: 'separator' },
        {
          label: 'About Cambuz PDF Reader',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Cambuz PDF Reader',
              message: 'Cambuz PDF Reader v1.1.0',
              detail: 'A lightweight, fast PDF reader.\nRead. Search. Print. Done.',
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC handlers
ipcMain.handle('dialog-open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open PDF',
    filters: [
      { name: 'PDF Files', extensions: ['pdf'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Read a PDF from disk for the renderer (Phase 2: correct Electron file
// loading + reopen of recent files by path).
ipcMain.handle('read-file', async (_event, filePath) => {
  try {
    if (typeof filePath !== 'string' || !filePath) {
      return { ok: false, error: 'No file path provided' };
    }
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      return { ok: false, error: 'Not a file' };
    }
    const buffer = await fs.promises.readFile(filePath);
    return {
      ok: true,
      name: path.basename(filePath),
      size: buffer.length,
      data: new Uint8Array(buffer),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
