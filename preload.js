const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ghostAI', {
  chat: (opts) => ipcRenderer.invoke('ai-chat', opts),
  validateKey: (opts) => ipcRenderer.invoke('validate-key', opts),
  close: () => ipcRenderer.send('window-close'),
  minimize: () => ipcRenderer.send('window-minimize'),
  platform: process.platform,
});
