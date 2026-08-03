# 👻 Ghost AI

A transparent, always-on-top AI chat window that is **invisible to screen recording and screen sharing**.

Built with Electron + Anthropic Claude API.

Version 1.0.17.

---

## ✨ Features

- **Transparent glass UI** — floats over any app
- **Screen capture protection** — hidden in OBS, Zoom, Teams, Meet, Windows Game Bar
- **Always on top** — even over fullscreen apps
- **Tray-only window controls** — hide/show from the system tray without a taskbar button
- **Paste your API key** — bring your own Anthropic key
- **Multi-model** — Sonnet 4, Opus 4, Haiku 4.5
- **Custom system prompt**
- **Opacity control** — dial it down to near-invisible
- **Keyboard shortcuts** — toggle/quit without touching the app

---

## ⌨️ Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+T` | Toggle show/hide |
| `Ctrl+Shift+Space` | Focus chat input |
| `Ctrl+Shift+X` | Toggle click-through |
| `Ctrl+Shift+Q` | Quit app |
| `Enter` | Send message |
| `Shift+Enter` | New line in message |

Hotkeys are configurable in the app settings. You can edit, enable, disable, add, and remove custom global shortcuts without restarting the app.

---

## 🚀 Quick Start (Development)

```bash
# 1. Clone / download this folder
cd ghost-ai

# 2. Install dependencies
npm install

# 3. Run
npm start
```

---

## 📦 Build Installer

Packaged builds use the product/executable name `Ghost AI`. Development runs started with `npm start` still use Electron's development process name because they are launched through the Electron binary.

### Windows (.exe installer)
```bash
npm run build:win
```
Output: `dist/Ghost AI Setup.exe`

### macOS (.dmg)
```bash
npm run build:mac
```
Output: `dist/Ghost AI.dmg`

### Linux (.AppImage)
```bash
npm run build:linux
```
Output: `dist/Ghost AI.AppImage`

---

## 🔑 Getting Your API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an account / log in
3. Go to **API Keys** → **Create Key**
4. Copy and paste into Ghost AI

---

## 🔒 Screen Capture Protection — How It Works

Ghost AI uses two Electron APIs that together make it invisible:

### `setContentProtection(true)`
- **Windows**: Uses `WDA_EXCLUDEFROMCAPTURE` flag → window excluded from all capture APIs (including Windows.Graphics.Capture, BitBlt, DXGIOutputDuplication)
- **macOS**: Uses `kCGWindowSharingNone` → excluded from CGWindowListCreateImage and screen recording APIs

This means:
- ✅ Invisible in Zoom screen share
- ✅ Invisible in Google Meet
- ✅ Invisible in Teams
- ✅ Invisible in OBS Studio
- ✅ Invisible in Windows Game Bar / Xbox Capture
- ✅ Invisible in macOS screenshot (Cmd+Shift+3/4)

### `type: 'panel'` (macOS only)
Additional layer on macOS that further excludes the window from screenshot APIs.

> ⚠️ **Note:** Content protection works on Windows 10+ and macOS 10.13+. On older systems or Linux, the window may still appear in captures.

---

## 🎨 Customization

Edit `src/index.html` CSS variables at the top of the `<style>` block:

```css
:root {
  --glass: rgba(10, 10, 15, 0.72);   /* Background opacity */
  --accent: #7DF9AA;                  /* Green accent */
  --accent2: #4FC3F7;                 /* Blue accent */
}
```

---

## 📁 File Structure

```
ghost-ai/
├── main.js          ← Electron main process (window config, API proxy)
├── preload.js       ← Secure IPC bridge
├── src/
│   └── index.html   ← Full UI (HTML + CSS + JS in one file)
├── assets/
│   ├── icon.ico     ← Windows icon (add your own)
│   ├── icon.icns    ← macOS icon (add your own)
│   └── icon.png     ← Linux icon (add your own)
└── package.json
```

---

## Global Hotkey System

Ghost AI uses a main-process `HotkeyManager` service around Electron's `globalShortcut` API. It owns validation, duplicate prevention, native registration, safe unregistration, persistence, logging, and event dispatch.

### Folder Structure

```
src/main/hotkeys/
├── hotkeyManager.js    # Global hotkey service
├── hotkeyManager.d.ts  # TypeScript-facing public types
└── settingsStore.js    # JSON persistence layer

tests/
└── hotkeyManager.test.js
```

### Architecture

- `main.js` creates the manager after `app.whenReady()`, subscribes to `hotkey:pressed`, and routes actions such as `toggle-window`, `toggle-click-through`, and `quit-app`.
- `src/main/hotkeys/hotkeyManager.js` exposes `registerHotkey()`, `unregisterHotkey()`, `updateHotkey()`, and `getRegisteredHotkeys()`.
- `src/main/hotkeys/settingsStore.js` persists shortcuts as JSON at Electron `app.getPath('userData')/hotkeys.json`.
- `preload.js` exposes a narrow `window.ghostAI.hotkeys` IPC API to the renderer.
- `src/index.html` renders the settings UI and subscribes to hotkey events for renderer-owned actions such as `focus-chat`, `open-settings`, and `new-chat`.

### Usage Examples

Add a new feature action in `HOTKEY_ACTIONS`:

```js
const HOTKEY_ACTIONS = Object.freeze({
  'open-settings': 'Open Settings',
  'my-feature': 'My Feature',
});
```

Handle main-process behavior in `handleHotkeyAction()`:

```js
case 'my-feature':
  showAndFocusWindow();
  break;
```

Subscribe in the renderer for UI behavior:

```js
window.ghostAI.hotkeys.onEvent(hotkey => {
  if (hotkey.action === 'my-feature') {
    // Run feature UI behavior here.
  }
});
```

### Validation and Fallback

The manager normalizes shortcuts such as `ctrl + shift + k` to `Ctrl+Shift+K`, rejects invalid combinations, prevents duplicate assignments, and disables a shortcut with an inline error if the OS or another application rejects registration.

### Testing Strategy

Run:

```bash
npm test
```

Tests use Node's built-in test runner with a fake `globalShortcut` and in-memory settings store. Coverage focuses on normalization, invalid shortcuts, duplicate prevention, custom registration/removal, event emission, persistence, and failed native registration fallback.

---

## Tray and Process Identity

Ghost AI is configured for a normal packaged desktop identity:

- `app.setName('Ghost AI')` and `app.setAppUserModelId('com.ghost.ai')` are set in the main process.
- `electron-builder` uses `productName` and `executableName` of `Ghost AI`.
- The window uses `skipTaskbar: true`, close/minimize hide the window, and the tray menu provides Show/Hide, Click-through, Settings, and Quit.
- A small tray icon is included at `assets/tray.svg`; real platform icons can be added later under `assets/icon.ico`, `assets/icon.icns`, and `assets/icon.png`.

This does not hide the app from Task Manager or process-management tools. It only presents the app as a normal packaged app and removes the visible taskbar window.

---

## ⚡ Tips

- **Opacity slider** at the bottom of chat lets you make it semi-transparent so you can read what's behind it
- Your API key is saved in `localStorage` — it persists between sessions
- Click ⚙ or use the tray menu to go back to settings and change model/key without restarting
- The window is **resizable** — drag the edges

---

## 🛠 Tech Stack

- **Electron** — Desktop wrapper
- **Anthropic Claude API** — AI backend
- **Pure HTML/CSS/JS** — No frameworks, tiny bundle

---

*Made for those who need AI assistance without anyone knowing.*
