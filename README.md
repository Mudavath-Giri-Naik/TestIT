# 👻 Ghost AI

A transparent, always-on-top AI chat window that is **invisible to screen recording and screen sharing**.

Built with Electron + Anthropic Claude API.

---

## ✨ Features

- **Transparent glass UI** — floats over any app
- **Screen capture protection** — hidden in OBS, Zoom, Teams, Meet, Windows Game Bar
- **Always on top** — even over fullscreen apps
- **No taskbar / dock icon** — completely stealthy
- **Paste your API key** — bring your own Anthropic key
- **Multi-model** — Sonnet 4, Opus 4, Haiku 4.5
- **Custom system prompt**
- **Opacity control** — dial it down to near-invisible
- **Keyboard shortcuts** — toggle/quit without touching the app

---

## ⌨️ Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+Space` | Toggle show/hide |
| `Ctrl+Shift+Q` | Quit app |
| `Enter` | Send message |
| `Shift+Enter` | New line in message |

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

## ⚡ Tips

- **Opacity slider** at the bottom of chat lets you make it semi-transparent so you can read what's behind it
- Your API key is saved in `localStorage` — it persists between sessions
- Click ⚙ to go back to settings and change model/key without restarting
- The window is **resizable** — drag the edges

---

## 🛠 Tech Stack

- **Electron** — Desktop wrapper
- **Anthropic Claude API** — AI backend
- **Pure HTML/CSS/JS** — No frameworks, tiny bundle

---

*Made for those who need AI assistance without anyone knowing.*
