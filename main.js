const { app, BrowserWindow, ipcMain, globalShortcut, screen, Menu, Tray, nativeImage, desktopCapturer, session } = require('electron');
const fs = require('fs');
const path = require('path');
const db = require('./src/main/database');
const { JsonSettingsStore } = require('./src/main/hotkeys/settingsStore');
const { HOTKEY_ACTIONS, HotkeyManager } = require('./src/main/hotkeys/hotkeyManager');

const APP_NAME = 'Ghost AI';
const APP_ID = 'com.ghost.ai';

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

// Prevent multiple instances (avoids cache lock errors)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Fix GPU cache "Access is denied" errors on Windows
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disk-cache-size', '0');

let mainWindow;
let tray;
let clickThrough = false;
let hotkeyManager;
let isQuitting = false;

function setClickThrough(enabled) {
  if (!mainWindow) return;
  clickThrough = enabled;
  mainWindow.setIgnoreMouseEvents(enabled, { forward: true });
  mainWindow.webContents.send('click-through-changed', enabled);
  updateTrayMenu();
}

function showAndFocusWindow() {
  if (!mainWindow) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function toggleWindowVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else mainWindow.showInactive();
  updateTrayMenu();
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function createHotkeyManager() {
  const settingsPath = path.join(app.getPath('userData'), 'hotkeys.json');
  const store = new JsonSettingsStore({ filePath: settingsPath });
  hotkeyManager = new HotkeyManager({ globalShortcut, store });

  hotkeyManager.on('hotkey:pressed', (hotkey) => {
    console.log(`[hotkeys] ${hotkey.accelerator} -> ${hotkey.action}`);
    handleHotkeyAction(hotkey);
    sendToRenderer('hotkey-event', hotkey);
  });

  hotkeyManager.on('hotkey:changed', (hotkeys) => {
    sendToRenderer('hotkeys-changed', hotkeys);
  });

  hotkeyManager.on('hotkey:error', (hotkey) => {
    sendToRenderer('hotkey-error', hotkey);
  });

  hotkeyManager.initialize();
}

function createTrayIcon() {
  const assetCandidates = [
    path.join(__dirname, 'assets', 'tray.png'),
    path.join(__dirname, 'assets', 'icon.png'),
    path.join(__dirname, 'assets', 'tray.svg'),
  ];
  const iconPath = assetCandidates.find(candidate => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });

  if (iconPath) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) return icon;
  }

  return nativeImage.createFromDataURL(`data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill="#09090e"/>
      <path d="M9 17c0-5 3-9 7-9s7 4 7 9v5c0 1-1 2-2 2h-1.6l-1.8-2-1.8 2h-1.6l-1.8-2-1.8 2H11c-1 0-2-1-2-2v-5z" fill="#7DF9AA"/>
      <circle cx="13" cy="16" r="1.4" fill="#09090e"/>
      <circle cx="19" cy="16" r="1.4" fill="#09090e"/>
    </svg>
  `)}`);
}

function updateTrayMenu() {
  if (!tray) return;

  const visible = Boolean(mainWindow && mainWindow.isVisible());
  const contextMenu = Menu.buildFromTemplate([
    {
      label: visible ? 'Hide Ghost AI' : 'Show Ghost AI',
      click: toggleWindowVisibility,
    },
    {
      label: clickThrough ? 'Disable Click-through' : 'Enable Click-through',
      click: () => setClickThrough(!clickThrough),
    },
    {
      label: 'Open Settings',
      click: () => {
        showAndFocusWindow();
        sendToRenderer('hotkey-event', { action: 'open-settings' });
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Ghost AI',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip(APP_NAME);
  tray.setContextMenu(contextMenu);
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.on('click', toggleWindowVisibility);
  tray.on('double-click', showAndFocusWindow);
  updateTrayMenu();
}

function handleHotkeyAction(hotkey) {
  switch (hotkey.action) {
    case 'toggle-window':
      toggleWindowVisibility();
      break;
    case 'toggle-click-through':
      setClickThrough(!clickThrough);
      break;
    case 'quit-app':
      app.quit();
      break;
    case 'focus-chat':
    case 'open-settings':
    case 'new-chat':
      showAndFocusWindow();
      break;
    default:
      console.warn(`[hotkeys] No handler registered for action "${hotkey.action}".`);
  }
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 420, height: 640,
    x: width - 440, y: 80,
    transparent: true, frame: false,
    backgroundColor: '#00000000',
    alwaysOnTop: true, visibleOnAllWorkspaces: true,
    type: 'panel', skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    roundedCorners: true, hasShadow: true,
    resizable: true, minWidth: 340, minHeight: 420,
  });

  mainWindow.setContentProtection(true);
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile('src/index.html');
  mainWindow.on('show', updateTrayMenu);
  mainWindow.on('hide', updateTrayMenu);
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  if (process.platform === 'darwin') app.dock.hide();
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Create Edit menu to allow standard copy/paste keyboard shortcuts
  const template = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectall' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  db.init();
  createHotkeyManager();

  // Allow the renderer to capture system/computer audio (loopback) for the live agent.
  // On Windows, audio: 'loopback' captures what's playing on the machine (e.g. a call).
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' });
    }).catch(() => callback({}));
  }, { useSystemPicker: false });
});

app.on('before-quit', () => {
  isQuitting = true;
});
app.on('will-quit', () => {
  if (hotkeyManager) hotkeyManager.shutdown();
  globalShortcut.unregisterAll();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.on('window-close', () => mainWindow.hide());
ipcMain.on('window-minimize', () => mainWindow.hide());
ipcMain.handle('set-click-through', (event, enabled) => {
  setClickThrough(Boolean(enabled));
  return clickThrough;
});

// ── DATABASE / HISTORY ──
ipcMain.handle('db:get-sessions', () => {
  try { return { success: true, data: db.getSessions() }; } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:create-session', (event, id, title, provider, model) => {
  try { return { success: true, data: db.createSession(id, title, provider, model) }; } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:get-messages', (event, sessionId) => {
  try { return { success: true, data: db.getMessages(sessionId) }; } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:add-message', (event, sessionId, role, content) => {
  try { db.addMessage(sessionId, role, content); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:delete-session', (event, id) => {
  try { db.deleteSession(id); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:get-memory', () => {
  try { return { success: true, data: db.getCoreMemory() }; } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:update-memory', (event, text) => {
  try { db.updateCoreMemory(text); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
});

// ── VALIDATE API KEY (test call) ──
ipcMain.handle('hotkeys:get', () => {
  return {
    success: true,
    data: hotkeyManager ? hotkeyManager.getRegisteredHotkeys() : [],
    actions: HOTKEY_ACTIONS,
  };
});

ipcMain.handle('hotkeys:register', (event, hotkey) => {
  if (!hotkeyManager) return { success: false, error: 'Hotkey manager is not ready.' };
  return hotkeyManager.registerHotkey(hotkey);
});

ipcMain.handle('hotkeys:update', (event, id, updates) => {
  if (!hotkeyManager) return { success: false, error: 'Hotkey manager is not ready.' };
  return hotkeyManager.updateHotkey(id, updates);
});

ipcMain.handle('hotkeys:unregister', (event, id) => {
  if (!hotkeyManager) return { success: false, error: 'Hotkey manager is not ready.' };
  return hotkeyManager.unregisterHotkey(id);
});

ipcMain.handle('hotkeys:validate', (event, accelerator, excludeId) => {
  if (!hotkeyManager) return { success: false, error: 'Hotkey manager is not ready.' };
  return hotkeyManager.validateAccelerator(accelerator, excludeId);
});

ipcMain.handle('validate-key', async (event, { provider, apiKey, model }) => {
  try {
    const result = await callAI(provider, apiKey, model, [{ role: 'user', content: 'Hi' }], '', true);
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── CHAT ──
let currentChatAbort = null;

ipcMain.handle('ai-chat', async (event, { provider, apiKey, messages, model, systemPrompt }) => {
  if (currentChatAbort) currentChatAbort.abort();
  const abort = new AbortController();
  currentChatAbort = abort;
  try {
    const result = await callAI(provider, apiKey, model, messages, systemPrompt, false, abort.signal);
    return result;
  } catch (e) {
    if (e.name === 'AbortError') return { success: false, error: 'stopped', aborted: true };
    return { success: false, error: e.message };
  } finally {
    if (currentChatAbort === abort) currentChatAbort = null;
  }
});

ipcMain.on('ai-chat-abort', () => {
  if (currentChatAbort) {
    currentChatAbort.abort();
    currentChatAbort = null;
  }
});

// ── LIVE AGENT: transcribe an audio chunk via Groq Whisper ──
ipcMain.handle('transcribe-audio', async (event, { apiKey, buffer, mimeType }) => {
  try {
    if (!apiKey) return { success: false, error: 'Missing Groq API key for transcription.' };
    const ext = (mimeType && mimeType.includes('wav')) ? 'wav' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType || 'audio/webm' }), `chunk.${ext}`);
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'json');
    form.append('temperature', '0');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      const msg = e.error?.message || '';
      if (res.status === 401) throw new Error('Invalid Groq API key for transcription.');
      if (res.status === 429) throw new Error('Groq rate limit hit while transcribing.');
      throw new Error(`Transcription HTTP ${res.status}: ${msg}`);
    }
    const data = await res.json();
    return { success: true, text: (data.text || '').trim() };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

async function callAI(provider, apiKey, model, messages, systemPrompt, isTest, signal) {

  // ── ANTHROPIC ──
  if (provider === 'anthropic') {
    const body = { model, max_tokens: isTest ? 10 : 2048, messages };
    if (systemPrompt) body.system = systemPrompt;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      const msg = e.error?.message || '';
      if (res.status === 401) throw new Error('Invalid API key. Check your key at console.anthropic.com');
      if (res.status === 400) throw new Error(`Bad request: ${msg || 'check model name'}`);
      if (res.status === 429) throw new Error('Rate limit hit. Wait a moment and retry.');
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    const data = await res.json();
    return { success: true, content: data.content[0].text };
  }

  // ── GROQ ──
  if (provider === 'groq') {
    const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages;
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: msgs, max_tokens: isTest ? 10 : 2048 }),
      signal,
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      const msg = e.error?.message || '';
      if (res.status === 401) throw new Error('Invalid API key. Get yours at console.groq.com/keys');
      if (res.status === 400) throw new Error(`Model or request error: ${msg || 'try a different model'}`);
      if (res.status === 404) throw new Error(`Model "${model}" not found. Try llama-3.3-70b-versatile`);
      if (res.status === 429) throw new Error('Rate limit hit. Groq free tier has limits — wait and retry.');
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    const data = await res.json();
    return { success: true, content: data.choices[0].message.content };
  }

  // ── GEMINI ──
  if (provider === 'gemini') {
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const body = { contents };
    if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }
    );
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      const msg = e.error?.message || '';
      if (res.status === 400) throw new Error(`Bad request: ${msg || 'check model name or key'}`);
      if (res.status === 403) throw new Error('API key invalid or Gemini API not enabled in your Google project.');
      if (res.status === 429) throw new Error('Quota exceeded. Check aistudio.google.com for limits.');
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response — model may have blocked the message.');
    return { success: true, content: text };
  }

  // ── GROK (xAI) ──
  if (provider === 'grok') {
    const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages;
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: msgs, max_tokens: isTest ? 10 : 2048 }),
      signal,
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      const msg = e.error?.message || '';
      if (res.status === 401) throw new Error('Invalid API key. Get yours at console.x.ai');
      if (res.status === 400) throw new Error(`Request error: ${msg || 'check model name'}`);
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    const data = await res.json();
    return { success: true, content: data.choices[0].message.content };
  }

  throw new Error(`Unknown provider: ${provider}`);
}
