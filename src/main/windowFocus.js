// Win32 helpers for Type Mode: take real keyboard focus from whatever app is
// in front, and later hand it back to exactly that window.
//
// Windows only lets a process pull itself to the foreground in limited cases
// (e.g. it just received the user's input). A chord pressed while another app
// is active doesn't qualify, so when a plain focus attempt fails we briefly
// attach to the foreground thread's input queue, which lifts that restriction.

let win32 = null;

function loadWin32() {
  if (win32) return win32;
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  win32 = {
    GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
    SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(intptr_t hWnd)'),
    BringWindowToTop: user32.func('bool __stdcall BringWindowToTop(intptr_t hWnd)'),
    IsWindow: user32.func('bool __stdcall IsWindow(intptr_t hWnd)'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, void *lpdwProcessId)'),
    AttachThreadInput: user32.func('bool __stdcall AttachThreadInput(uint32_t idAttach, uint32_t idAttachTo, bool fAttach)'),
    GetCurrentThreadId: kernel32.func('uint32_t __stdcall GetCurrentThreadId()'),
  };
  return win32;
}

function hwndOf(browserWindow) {
  const handle = browserWindow.getNativeWindowHandle();
  return handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
}

const sameHwnd = (a, b) => BigInt(a || 0) === BigInt(b || 0);

function getForegroundWindow() {
  if (process.platform !== 'win32') return null;
  const hwnd = loadWin32().GetForegroundWindow();
  return hwnd ? BigInt(hwnd) : null;
}

function isForeground(browserWindow) {
  if (process.platform !== 'win32') return browserWindow.isFocused();
  return sameHwnd(loadWin32().GetForegroundWindow(), hwndOf(browserWindow));
}

// Brings `target` to the foreground, attaching to the current foreground
// thread's input queue so Windows' foreground-lock rules allow it.
function setForegroundAttached(target) {
  const api = loadWin32();
  const foreground = api.GetForegroundWindow();
  const foregroundThread = foreground ? api.GetWindowThreadProcessId(foreground, null) : 0;
  const ownThread = api.GetCurrentThreadId();
  const attach = foregroundThread && foregroundThread !== ownThread;
  if (attach) api.AttachThreadInput(ownThread, foregroundThread, true);
  try {
    api.BringWindowToTop(target);
    api.SetForegroundWindow(target);
  } finally {
    if (attach) api.AttachThreadInput(ownThread, foregroundThread, false);
  }
  return sameHwnd(api.GetForegroundWindow(), target);
}

// Makes `browserWindow` the foreground window. Returns true on success.
function forceForeground(browserWindow) {
  browserWindow.focus();
  if (process.platform !== 'win32' || isForeground(browserWindow)) return true;
  setForegroundAttached(hwndOf(browserWindow));
  browserWindow.focus();
  return isForeground(browserWindow);
}

// Hands foreground back to a window captured earlier with getForegroundWindow().
function restoreForeground(hwnd) {
  if (process.platform !== 'win32' || !hwnd) return false;
  const api = loadWin32();
  if (!api.IsWindow(hwnd)) return false;
  if (api.SetForegroundWindow(hwnd) && sameHwnd(api.GetForegroundWindow(), hwnd)) return true;
  return setForegroundAttached(hwnd);
}

module.exports = { getForegroundWindow, forceForeground, restoreForeground, isForeground, hwndOf, sameHwnd };
