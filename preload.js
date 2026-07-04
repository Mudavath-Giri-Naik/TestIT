const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ghostAI', {
  chat: (opts) => ipcRenderer.invoke('ai-chat', opts),
  abortChat: () => ipcRenderer.send('ai-chat-abort'),
  transcribe: (opts) => ipcRenderer.invoke('transcribe-audio', opts),
  validateKey: (opts) => ipcRenderer.invoke('validate-key', opts),
  setClickThrough: (enabled) => ipcRenderer.invoke('set-click-through', enabled),
  db: {
    getSessions: () => ipcRenderer.invoke('db:get-sessions'),
    createSession: (id, title, provider, model) => ipcRenderer.invoke('db:create-session', id, title, provider, model),
    getMessages: (sessionId) => ipcRenderer.invoke('db:get-messages', sessionId),
    addMessage: (sessionId, role, content) => ipcRenderer.invoke('db:add-message', sessionId, role, content),
    deleteSession: (id) => ipcRenderer.invoke('db:delete-session', id),
    getMemory: () => ipcRenderer.invoke('db:get-memory'),
    updateMemory: (text) => ipcRenderer.invoke('db:update-memory', text),
  },
  hotkeys: {
    getRegisteredHotkeys: () => ipcRenderer.invoke('hotkeys:get'),
    registerHotkey: (hotkey) => ipcRenderer.invoke('hotkeys:register', hotkey),
    unregisterHotkey: (id) => ipcRenderer.invoke('hotkeys:unregister', id),
    updateHotkey: (id, updates) => ipcRenderer.invoke('hotkeys:update', id, updates),
    validateAccelerator: (accelerator, excludeId) => ipcRenderer.invoke('hotkeys:validate', accelerator, excludeId),
    onChanged: (callback) => {
      const handler = (event, hotkeys) => callback(hotkeys);
      ipcRenderer.on('hotkeys-changed', handler);
      return () => ipcRenderer.removeListener('hotkeys-changed', handler);
    },
    onEvent: (callback) => {
      const handler = (event, hotkey) => callback(hotkey);
      ipcRenderer.on('hotkey-event', handler);
      return () => ipcRenderer.removeListener('hotkey-event', handler);
    },
    onError: (callback) => {
      const handler = (event, hotkey) => callback(hotkey);
      ipcRenderer.on('hotkey-error', handler);
      return () => ipcRenderer.removeListener('hotkey-error', handler);
    },
  },
  onClickThroughChanged: (callback) => {
    ipcRenderer.on('click-through-changed', (event, enabled) => callback(enabled));
  },
  close: () => ipcRenderer.send('window-close'),
  minimize: () => ipcRenderer.send('window-minimize'),
  platform: process.platform,
});
