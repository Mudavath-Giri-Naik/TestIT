const { app, BrowserWindow, ipcMain, globalShortcut, screen, Menu, Tray, nativeImage, desktopCapturer, session, net } = require('electron');
const fs = require('fs');
const path = require('path');
const db = require('./src/main/database');
const supabaseSync = require('./src/main/supabaseSync');
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
      if (!mainWindow.isVisible()) mainWindow.showInactive();
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
  mainWindow.showInactive();
  mainWindow.focus();
}

function toggleWindowVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else mainWindow.showInactive();
  updateTrayMenu();
}

function hideWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
}

// Reveals the window without stealing focus from whatever app you're in —
// same non-intrusive behavior as the "show" half of toggleWindowVisibility.
function showWindow() {
  if (!mainWindow) return;
  if (!mainWindow.isVisible()) mainWindow.showInactive();
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

// Merges a pulled remote snapshot into the local db. Local rows are never
// overwritten — this only ever fills gaps. Returns how many new API keys
// were imported, so callers can decide whether to notify the renderer.
function mergeRemote(remote) {
  const localSessionIds = new Set(db.getSessions().map(s => s.id));
  const newSessionIds = new Set();
  for (const s of remote.sessions) {
    if (!localSessionIds.has(s.id)) {
      db.importSession(s);
      newSessionIds.add(s.id);
    }
  }
  for (const m of remote.messages) {
    if (newSessionIds.has(m.session_id)) {
      db.importMessage(m.session_id, m.role, m.content, m.created_at);
    }
  }
  if (remote.memory && remote.memory.core_memory && !db.getCoreMemory()) {
    db.updateCoreMemory(remote.memory.core_memory);
  }
  const localKeyIds = new Set(db.getAllApiKeys().map(k => k.id));
  let importedKeys = 0;
  for (const k of remote.apiKeys) {
    if (!localKeyIds.has(k.id)) { db.importApiKey(k); importedKeys++; }
  }
  if (remote.lastSessionId && !db.getLastSessionId()) {
    db.setLastSessionId(remote.lastSessionId);
  }
  return importedKeys;
}

// Pulls anything that exists in the shared cloud store but not on this machine
// (e.g. sessions or API keys added on another install — there is no login step,
// every install reads/writes the same shared tables). Fully fail-soft: any
// error here just means the app stays local-only, nothing else is affected.
async function syncWithSupabase() {
  try {
    const remote = await supabaseSync.pullAll();
    if (!remote) return;
    const importedKeys = mergeRemote(remote);
    // The renderer already read the (then-empty) local api_keys table before this
    // background pull landed — tell it to re-read now that the rows exist.
    if (importedKeys) sendToRenderer('supabase-api-keys-synced');
  } catch (e) {
    console.warn('[supabase] merge skipped:', e.message);
  }
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


function showAndFocusWindow() {
  if (!mainWindow) return;
  mainWindow.showInactive(); // Replaces mainWindow.focus()
}


function handleHotkeyAction(hotkey) {
  switch (hotkey.action) {
    case 'toggle-window':
      toggleWindowVisibility();
      break;
    case 'hide-window':
      hideWindow();
      break;
    case 'show-window':
    case 'screenshot-ask':
    case 'focus-chat':
    case 'open-settings':
    case 'new-chat':
      if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.showInactive(); // Reveals window without taking keyboard focus from browser
      }
      break;
    case 'toggle-window':
      toggleWindowVisibility();
      break;
    case 'hide-window':
      hideWindow();
      break;
    case 'show-window':
      showWindow();
      break;
    case 'screenshot-ask':
      // Reveal (without stealing focus) so the answer is visible; the renderer does the actual capture+ask.
      showWindow();
      break;
    case 'toggle-click-through':
      setClickThrough(!clickThrough);
      break;
    case 'quit-app':
      isQuitting = true;
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
    width: 420,
    height: 640,
    x: width - 440,
    y: 80,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    visibleOnAllWorkspaces: true,
    type: 'panel',
    skipTaskbar: true,
    
    // Configured to prevent focus-stealing while remaining interactive
    focusable: false,
    acceptFirstMouse: true,
    hasShadow: false,
    noActivate: true,

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    roundedCorners: true,
    resizable: true,
    minWidth: 340,
    minHeight: 420,
  });

  // Window methods called safely AFTER mainWindow is instantiated
  mainWindow.setContentProtection(true);
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.showInactive();
  mainWindow.loadFile('src/index.html');

  mainWindow.on('show', updateTrayMenu);
  mainWindow.on('hide', () => {
    updateTrayMenu();
  });

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

  // Cloud sign-in + cross-device merge happen in the background — the app is
  // fully usable locally the instant it opens, regardless of network state.
  syncWithSupabase();

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

// Dynamic Ignore Mouse Events Handler for Preload/Renderer mouse tracking
ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.setIgnoreMouseEvents(ignore, options);
  }
});

// The titlebar's close (✕) button fully quits the app — it previously just
// hid the window to the tray, so the background process (and its session
// state) kept running until the tray "Quit" item was used instead.
ipcMain.on('window-close', () => {
  isQuitting = true;
  app.quit();
});
ipcMain.on('window-minimize', () => mainWindow.hide());
ipcMain.handle('set-click-through', (event, enabled) => {
  setClickThrough(Boolean(enabled));
  return clickThrough;
});

// ── SCREENSHOT (for click-a-keyword → ask AI) ──
// mainWindow has setContentProtection(true), so it never appears in this capture.
ipcMain.handle('capture-screenshot', async () => {
  try {
    const primary = screen.getPrimaryDisplay();
    const { width, height } = primary.size;
    const scaleFactor = primary.scaleFactor || 1;
    const maxEdge = 1568; // keeps vision API payloads small and within provider limits
    const nativeW = Math.round(width * scaleFactor);
    const nativeH = Math.round(height * scaleFactor);
    const shrink = Math.min(1, maxEdge / Math.max(nativeW, nativeH));

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(nativeW * shrink), height: Math.round(nativeH * shrink) },
    });
    if (!sources.length) return { success: false, error: 'No screen source available to capture.' };

    const source = sources.find(s => s.display_id === String(primary.id)) || sources[0];
    const dataUrl = source.thumbnail.toDataURL();
    if (!dataUrl || dataUrl === 'data:,') return { success: false, error: 'Screenshot capture returned an empty image.' };
    return { success: true, dataUrl };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── DATABASE / HISTORY ──
// Every handler below writes to local SQLite first (unchanged, instant, always works),
// then fires an async mirror to Supabase that can never fail the local operation.
ipcMain.handle('db:get-sessions', () => {
  try { return { success: true, data: db.getSessions() }; } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:create-session', (event, id, title, provider, model) => {
  try {
    const data = db.createSession(id, title, provider, model);
    supabaseSync.pushSession(data);
    return { success: true, data };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:get-messages', (event, sessionId) => {
  try { return { success: true, data: db.getMessages(sessionId) }; } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:add-message', (event, sessionId, role, content) => {
  try {
    const createdAt = db.addMessage(sessionId, role, content);
    supabaseSync.pushMessage(sessionId, role, content, createdAt);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:delete-session', (event, id) => {
  try {
    db.deleteSession(id);
    supabaseSync.pushDeleteSession(id);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:get-memory', () => {
  try { return { success: true, data: db.getCoreMemory() }; } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:update-memory', (event, text) => {
  try {
    db.updateCoreMemory(text);
    supabaseSync.pushMemory(text);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:update-session-tokens', (event, sessionId, tokens) => {
  try {
    db.updateSessionTokens(sessionId, tokens);
    supabaseSync.pushSessionTokens(sessionId, tokens);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:get-last-session', () => {
  try { return { success: true, data: db.getLastSessionId() }; } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:set-last-session', (event, sessionId) => {
  try {
    db.setLastSessionId(sessionId);
    supabaseSync.pushLastSession(sessionId);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── API KEYS (multiple per provider, manual rotation) ──
ipcMain.handle('db:get-api-keys', (event, provider) => {
  try { return { success: true, data: db.getApiKeys(provider) }; } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:add-api-key', (event, provider, label, keyValue, makeActive) => {
  try {
    const id = `key_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const row = db.addApiKey(id, provider, label, keyValue, makeActive);
    supabaseSync.pushApiKey(row);
    if (makeActive) {
      // Other keys for this provider just got deactivated locally — mirror that too.
      db.getApiKeys(provider).forEach(k => supabaseSync.pushApiKey(k));
    }
    return { success: true, data: row };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:set-active-api-key', (event, id, provider) => {
  try {
    db.setActiveApiKey(id, provider);
    db.getApiKeys(provider).forEach(k => supabaseSync.pushApiKey(k));
    return { success: true, data: db.getApiKeys(provider) };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:delete-api-key', (event, id) => {
  try {
    db.deleteApiKey(id);
    supabaseSync.pushDeleteApiKey(id);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db:update-key-ratelimit', (event, provider, keyValue, limit, remaining) => {
  try {
    db.updateApiKeyRateLimit(provider, keyValue, limit, remaining);
    const row = db.getApiKeys(provider).find(k => k.key_value === keyValue);
    if (row) supabaseSync.pushApiKey(row);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
// User-initiated pull from the shared cloud store (Settings "Refresh" button).
// Unlike the silent background sync on launch, this surfaces the real error
// (e.g. a misconfigured/unreachable Supabase project) instead of swallowing it.
ipcMain.handle('db:refresh-api-keys', async () => {
  try {
    const remote = await supabaseSync.pullAllOrThrow();
    const importedKeys = mergeRemote(remote);
    return { success: true, importedKeys };
  } catch (e) {
    return { success: false, error: e.message };
  }
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

ipcMain.handle('ai-chat', async (event, { provider, apiKey, messages, model, systemPrompt, images }) => {
  if (currentChatAbort) currentChatAbort.abort();
  const abort = new AbortController();
  currentChatAbort = abort;
  try {
    const result = await callAI(provider, apiKey, model, messages, systemPrompt, false, abort.signal, images);
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

    const res = await net.fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
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

// Splits a `data:<mime>;base64,<data>` URL into its parts, or null if malformed.
function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

// Reads the provider's own real remaining-quota headers when it reports them, instead
// of estimating. Groq and Anthropic document these; Gemini has no equivalent header,
// so it stays null there and the renderer falls back to context-window tracking.
function extractRateLimit(res, provider) {
  const h = res.headers;
  let limit = null, remaining = null;
  if (provider === 'groq' || provider === 'grok') {
    limit = h.get('x-ratelimit-limit-tokens');
    remaining = h.get('x-ratelimit-remaining-tokens');
  } else if (provider === 'anthropic') {
    remaining = h.get('anthropic-ratelimit-tokens-remaining') || h.get('anthropic-ratelimit-input-tokens-remaining');
    limit = h.get('anthropic-ratelimit-tokens-limit') || h.get('anthropic-ratelimit-input-tokens-limit');
  }
  const remainingNum = remaining !== null ? parseInt(remaining, 10) : NaN;
  if (Number.isNaN(remainingNum)) return null;
  const limitNum = limit !== null ? parseInt(limit, 10) : NaN;
  return { limit: Number.isNaN(limitNum) ? null : limitNum, remaining: remainingNum };
}

async function callAI(provider, apiKey, model, messages, systemPrompt, isTest, signal, images) {
  const imageList = (Array.isArray(images) ? images : []).map(parseDataUrl).filter(Boolean);
  const rawImages = Array.isArray(images) ? images : [];

  // Attaches the screenshot(s) to the last (user) message in OpenAI-compatible content-array form.
  function withImageOpenAIStyle(msgs) {
    if (!rawImages.length || !msgs.length) return msgs;
    const cloned = msgs.map(m => ({ ...m }));
    const last = cloned[cloned.length - 1];
    if (last.role !== 'user') return cloned;
    last.content = [
      ...rawImages.map(url => ({ type: 'image_url', image_url: { url } })),
      { type: 'text', text: last.content },
    ];
    return cloned;
  }

  // ── ANTHROPIC ──
  if (provider === 'anthropic') {
    let msgs = messages;
    if (imageList.length && msgs.length) {
      msgs = msgs.map(m => ({ ...m }));
      const last = msgs[msgs.length - 1];
      if (last.role === 'user') {
        last.content = [
          ...imageList.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 } })),
          { type: 'text', text: last.content },
        ];
      }
    }
    const body = { model, max_tokens: isTest ? 10 : 2048, messages: msgs };
    if (systemPrompt) body.system = systemPrompt;
    const res = await net.fetch('https://api.anthropic.com/v1/messages', {
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
    const usage = {
      totalTokens: data.usage ? (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0) : null,
      rateLimit: extractRateLimit(res, provider),
    };
    return { success: true, content: data.content[0].text, usage };
  }

  // ── GROQ ──
  if (provider === 'groq') {
    const withImage = withImageOpenAIStyle(messages);
    const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...withImage] : withImage;
    const res = await net.fetch('https://api.groq.com/openai/v1/chat/completions', {
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
    const usage = {
      totalTokens: data.usage ? data.usage.total_tokens : null,
      rateLimit: extractRateLimit(res, provider),
    };
    return { success: true, content: data.choices[0].message.content, usage };
  }

  // ── GEMINI ──
  if (provider === 'gemini') {
    const contents = messages.map((m, i) => {
      const parts = [{ text: m.content }];
      if (imageList.length && i === messages.length - 1 && m.role === 'user') {
        parts.unshift(...imageList.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })));
      }
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts,
      };
    });
    const body = { contents };
    if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
    const res = await net.fetch(
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
    // Gemini doesn't expose a remaining-quota response header, so rateLimit stays null
    // here and the renderer falls back to context-window tracking for this provider.
    const usage = { totalTokens: data.usageMetadata ? data.usageMetadata.totalTokenCount : null, rateLimit: null };
    return { success: true, content: text, usage };
  }

  // ── GROK (xAI) ──
  if (provider === 'grok') {
    const withImage = withImageOpenAIStyle(messages);
    const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...withImage] : withImage;
    const res = await net.fetch('https://api.x.ai/v1/chat/completions', {
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
    // xAI hasn't documented a remaining-quota header the way Groq/Anthropic do — this
    // attempts the same OpenAI-style header name on the chance it's supported, and
    // falls back to context-window tracking (via extractRateLimit returning null) if not.
    const usage = {
      totalTokens: data.usage ? data.usage.total_tokens : null,
      rateLimit: extractRateLimit(res, provider),
    };
    return { success: true, content: data.choices[0].message.content, usage };
  }

  throw new Error(`Unknown provider: ${provider}`);
}