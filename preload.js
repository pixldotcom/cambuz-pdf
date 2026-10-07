const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cambuzAPI', {
  openFile: () => ipcRenderer.invoke('dialog-open-file'),
  onMenuOpenFile: (callback) => ipcRenderer.on('menu-open-file', callback),
  onMenuCloseFile: (callback) => ipcRenderer.on('menu-close-file', callback),
  onMenuZoomIn: (callback) => ipcRenderer.on('menu-zoom-in', callback),
  onMenuZoomOut: (callback) => ipcRenderer.on('menu-zoom-out', callback),
  onMenuFitPage: (callback) => ipcRenderer.on('menu-fit-page', callback),
  onMenuFitWidth: (callback) => ipcRenderer.on('menu-fit-width', callback),
  onMenuPrevPage: (callback) => ipcRenderer.on('menu-prev-page', callback),
  onMenuNextPage: (callback) => ipcRenderer.on('menu-next-page', callback),
  onMenuToggleTheme: (callback) => ipcRenderer.on('menu-toggle-theme', callback),
});