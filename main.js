const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');

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
          label: 'About Cambuz PDF Reader',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Cambuz PDF Reader',
              message: 'Cambuz PDF Reader v1.0.0',
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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});