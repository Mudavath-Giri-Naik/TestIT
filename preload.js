const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ghostAI', {
  chat: (opts) => ipcRenderer.invoke('ai-chat', opts),
  abortChat: () => ipcRenderer.send('ai-chat-abort'),
  captureScreenshot: () => ipcRenderer.invoke('capture-screenshot'),
  transcribe: (opts) => ipcRenderer.invoke('transcribe-audio', opts),
  validateKey: (opts) => ipcRenderer.invoke('validate-key', opts),
  interviewCoach: {
    generate: (opts) => ipcRenderer.invoke('interview-coach:generate', opts),
    abort: () => ipcRenderer.send('interview-coach:abort'),
  },
  setClickThrough: (enabled) => ipcRenderer.invoke('set-click-through', enabled),
  db: {
    getSessions: () => ipcRenderer.invoke('db:get-sessions'),
    createSession: (id, title, provider, model) => ipcRenderer.invoke('db:create-session', id, title, provider, model),
    getMessages: (sessionId) => ipcRenderer.invoke('db:get-messages', sessionId),
    addMessage: (sessionId, role, content) => ipcRenderer.invoke('db:add-message', sessionId, role, content),
    deleteSession: (id) => ipcRenderer.invoke('db:delete-session', id),
    getMemory: () => ipcRenderer.invoke('db:get-memory'),
    updateMemory: (text) => ipcRenderer.invoke('db:update-memory', text),
    updateSessionTokens: (sessionId, tokens) => ipcRenderer.invoke('db:update-session-tokens', sessionId, tokens),
    getLastSession: () => ipcRenderer.invoke('db:get-last-session'),
    setLastSession: (sessionId) => ipcRenderer.invoke('db:set-last-session', sessionId),
    getApiKeys: (provider) => ipcRenderer.invoke('db:get-api-keys', provider),
    addApiKey: (provider, label, keyValue, makeActive) => ipcRenderer.invoke('db:add-api-key', provider, label, keyValue, makeActive),
    setActiveApiKey: (id, provider) => ipcRenderer.invoke('db:set-active-api-key', id, provider),
    deleteApiKey: (id) => ipcRenderer.invoke('db:delete-api-key', id),
    updateKeyRateLimit: (provider, keyValue, limit, remaining) => ipcRenderer.invoke('db:update-key-ratelimit', provider, keyValue, limit, remaining),
    refreshApiKeys: () => ipcRenderer.invoke('db:refresh-api-keys'),
    onApiKeysSynced: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('supabase-api-keys-synced', handler);
      return () => ipcRenderer.removeListener('supabase-api-keys-synced', handler);
    },
  },
  hotkeys: {
    getRegisteredHotkeys: () => ipcRenderer.invoke('hotkeys:get'),
    registerHotkey: (hotkey) => ipcRenderer.invoke('hotkeys:register', hotkey),
    unregisterHotkey: (id) => ipcRenderer.invoke('hotkeys:unregister', id),
    updateHotkey: (id, updates) => ipcRenderer.invoke('hotkeys:update', id, updates),
    validateAccelerator: (accelerator, excludeId) => ipcRenderer.invoke('hotkeys:validate', accelerator, excludeId),
    setCapturing: (capturing) => ipcRenderer.send('hotkeys:set-capturing', Boolean(capturing)),
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
  showWindow: () => ipcRenderer.send('window-show'),
  toggleWindow: () => ipcRenderer.send('window-toggle'),
  toggleTypeMode: () => ipcRenderer.invoke('type-mode:toggle'),
  onTypeModeChanged: (callback) => {
    ipcRenderer.on('type-mode-changed', (event, enabled) => callback(enabled));
  },
  platform: process.platform,
});
