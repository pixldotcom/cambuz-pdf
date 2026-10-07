const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
        {
          label: 'Print…',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow.webContents.send('menu-print'),
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

// Return only printer fields needed by the settings UI.
ipcMain.handle('list-printers', async (event) => {
  try {
    const printers = await event.sender.getPrintersAsync();
    return printers.map((printer) => ({
      name: String(printer.name || ''),
      displayName: String(printer.displayName || printer.name || ''),
      description: String(printer.description || ''),
      isDefault: Boolean(printer.isDefault),
    }));
  } catch (_) {
    return [];
  }
});

const MAX_PRINT_PDF_BYTES = 250 * 1024 * 1024;
const PRINT_PAPER_SIZES_MM = {
  A4: [210, 297],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  A3: [297, 420],
  A5: [148, 210],
  Tabloid: [279.4, 431.8],
};

function asPdfBuffer(input) {
  if (input instanceof Uint8Array) {
    if (input.byteLength > MAX_PRINT_PDF_BYTES) throw new Error('The print-ready PDF exceeds the 250 MiB print-job limit.');
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) {
    if (input.byteLength > MAX_PRINT_PDF_BYTES) throw new Error('The print-ready PDF exceeds the 250 MiB print-job limit.');
    return Buffer.from(input);
  }
  if (Array.isArray(input) && input.length <= MAX_PRINT_PDF_BYTES && input.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    return Buffer.from(input);
  }
  throw new Error('Invalid print PDF data.');
}

function getNativePaperSize(options) {
  const size = PRINT_PAPER_SIZES_MM[options.paperSize];
  if (!size) throw new Error('Unsupported paper size.');
  if (options.orientation !== 'portrait' && options.orientation !== 'landscape') {
    throw new Error('Unsupported paper orientation.');
  }
  const shortSide = Math.min(size[0], size[1]);
  const longSide = Math.max(size[0], size[1]);
  const widthMm = options.orientation === 'landscape' ? longSide : shortSide;
  const heightMm = options.orientation === 'landscape' ? shortSide : longSide;
  return {
    width: Math.round(widthMm * 1000),
    height: Math.round(heightMm * 1000),
  };
}

// Native print route: the renderer sends the already-composed, previewed PDF.
// Electron's print API then routes the job through the selected Windows driver.
ipcMain.handle('print-pdf', async (_event, rawBytes, rawOptions = {}) => {
  let tempDirectory = null;
  let printWindow = null;
  try {
    const pdfBuffer = asPdfBuffer(rawBytes);
    if (pdfBuffer.length < 5 || pdfBuffer.length > MAX_PRINT_PDF_BYTES) {
      throw new Error('The print-ready PDF is empty or exceeds the 250 MiB print-job limit.');
    }
    if (!pdfBuffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new Error('The print data is not a valid PDF file.');
    }

    const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
    const copies = Number(options.copies);
    if (!Number.isInteger(copies) || copies < 1 || copies > 99) {
      throw new Error('Copies must be a whole number from 1 to 99.');
    }
    const pageSize = getNativePaperSize(options);
    const printerName = typeof options.deviceName === 'string' ? options.deviceName.trim() : '';

    if (printerName) {
      const installedPrinters = await mainWindow.webContents.getPrintersAsync();
      if (!installedPrinters.some((printer) => printer.name === printerName)) {
        throw new Error('The selected printer is no longer available. Refresh the printer list and try again.');
      }
    }

    tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cambuz-print-'));
    const pdfPath = path.join(tempDirectory, 'print-job.pdf');
    await fs.promises.writeFile(pdfPath, pdfBuffer);

    printWindow = new BrowserWindow({
      parent: mainWindow,
      width: 900,
      height: 700,
      show: !printerName, // native system dialog must have a visible owner
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        plugins: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    await printWindow.loadFile(pdfPath);
    // Allow Chromium's built-in PDF viewer to finish initializing before the
    // native print call; did-finish-load alone can precede PDF plugin setup.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const nativeOptions = {
      silent: Boolean(printerName),
      printBackground: true,
      color: true,
      landscape: options.orientation === 'landscape', // matches the prepared sheet's MediaBox
      copies,
      collate: true,
      deviceName: printerName || undefined,
      pageSize,
      pagesPerSheet: 1, // N-up has already been composed in the prepared PDF
      scaleFactor: 100,
      margins: { marginType: 'none' },
    };

    const outcome = await new Promise((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ success: false, failureReason: 'Native printing timed out.' });
      }, printerName ? 120000 : 10 * 60 * 1000);
      try {
        printWindow.webContents.print(nativeOptions, (success, failureReason) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve({ success, failureReason });
        });
      } catch (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ success: false, failureReason: error.message });
      }
    });

    if (!outcome.success) {
      throw new Error(outcome.failureReason || 'The native printer did not accept the print job.');
    }
    return { ok: true, printerName: printerName || 'system printer' };
  } catch (err) {
    return { ok: false, error: err.message || 'Printing failed.' };
  } finally {
    if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
    if (tempDirectory) {
      await fs.promises.rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
    }
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
