const { app, BrowserWindow, ipcMain, globalShortcut, screen, Menu } = require('electron');
const path = require('path');

let mainWindow;

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
  if (process.platform === 'darwin') app.dock.hide();
}

app.whenReady().then(() => {
  createWindow();

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

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (mainWindow.isVisible()) mainWindow.hide();
    else { mainWindow.show(); mainWindow.focus(); }
  });
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.on('window-close', () => mainWindow.hide());
ipcMain.on('window-minimize', () => mainWindow.minimize());

// ── VALIDATE API KEY (test call) ──
ipcMain.handle('validate-key', async (event, { provider, apiKey, model }) => {
  try {
    const result = await callAI(provider, apiKey, model, [{ role: 'user', content: 'Hi' }], '', true);
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── CHAT ──
ipcMain.handle('ai-chat', async (event, { provider, apiKey, messages, model, systemPrompt }) => {
  return await callAI(provider, apiKey, model, messages, systemPrompt, false);
});

async function callAI(provider, apiKey, model, messages, systemPrompt, isTest) {

  // ── ANTHROPIC ──
  if (provider === 'anthropic') {
    const body = { model, max_tokens: isTest ? 10 : 2048, messages };
    if (systemPrompt) body.system = systemPrompt;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
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
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
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
