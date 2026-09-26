// Windows backend for letter chords (see letterChords.js). A low-level keyboard
// hook (WH_KEYBOARD_LL) sees every key system-wide and can withhold it; keys
// we withhold and later decide were ordinary typing are re-sent with SendInput.
//
// The hook runs on the Electron main thread's message loop, so it must stay
// fast: all it does is update the detector's state. Chord actions are deferred
// with setImmediate so a slow action can never stall the user's keyboard.
//
// Exposes the same register/unregister shape as Electron's globalShortcut.

const { LetterChordDetector, parseLetterChord } = require('./letterChords');

const WH_KEYBOARD_LL = 13;
const WM_KEYDOWN = 0x0100;
const WM_SYSKEYDOWN = 0x0104;
const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
// Tags our own replayed keystrokes so the hook lets them through untouched.
const REPLAY_MARKER = 0x47484f53; // "GHOS"
const MODIFIER_VKS = [0x10, 0x11, 0x12, 0x5b, 0x5c]; // Shift, Ctrl, Alt, LWin, RWin

function loadWin32() {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');

  const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
    vkCode: 'uint32_t',
    scanCode: 'uint32_t',
    flags: 'uint32_t',
    time: 'uint32_t',
    dwExtraInfo: 'uintptr_t',
  });
  const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
    wVk: 'uint16_t',
    wScan: 'uint16_t',
    dwFlags: 'uint32_t',
    time: 'uint32_t',
    dwExtraInfo: 'uintptr_t',
  });
  // INPUT is a union sized by its largest member (MOUSEINPUT), which is 8 bytes
  // bigger than KEYBDINPUT on both x86 and x64.
  const INPUT = koffi.struct('INPUT', {
    type: 'uint32_t',
    ki: KEYBDINPUT,
    padding: koffi.array('uint8_t', 8),
  });
  const HookProc = koffi.proto('intptr_t __stdcall LowLevelKeyboardProc(int nCode, uintptr_t wParam, void *lParam)');

  return {
    koffi,
    KBDLLHOOKSTRUCT,
    INPUT,
    HookProc,
    SetWindowsHookExW: user32.func('void * __stdcall SetWindowsHookExW(int idHook, LowLevelKeyboardProc *lpfn, void *hmod, uint32_t dwThreadId)'),
    UnhookWindowsHookEx: user32.func('bool __stdcall UnhookWindowsHookEx(void *hhk)'),
    CallNextHookEx: user32.func('intptr_t __stdcall CallNextHookEx(void *hhk, int nCode, uintptr_t wParam, void *lParam)'),
    SendInput: user32.func('uint32_t __stdcall SendInput(uint32_t cInputs, const INPUT *pInputs, int cbSize)'),
    GetAsyncKeyState: user32.func('int16_t __stdcall GetAsyncKeyState(int vKey)'),
    GetModuleHandleW: kernel32.func('void * __stdcall GetModuleHandleW(const char16_t *name)'),
  };
}

class WindowsLetterChords {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.callbacks = new Map(); // accelerator -> callback
    this.paused = false;
    this.win32 = null;
    this.hook = null;
    this.hookCallback = null;
    this.detector = new LetterChordDetector({
      replay: (events) => this.replay(events),
      onChord: (accelerator) => {
        const callback = this.callbacks.get(accelerator);
        if (callback) setImmediate(callback);
      },
    });
  }

  register(accelerator, callback) {
    if (!parseLetterChord(accelerator) || this.callbacks.has(accelerator)) return false;
    if (!this.ensureHook()) return false;
    this.callbacks.set(accelerator, callback);
    this.detector.setChords(this.callbacks.keys());
    return true;
  }

  unregister(accelerator) {
    if (!this.callbacks.delete(accelerator)) return;
    this.detector.setChords(this.callbacks.keys());
    if (this.callbacks.size === 0) this.removeHook();
  }

  isRegistered(accelerator) {
    return this.callbacks.has(accelerator);
  }

  unregisterAll() {
    this.callbacks.clear();
    this.detector.setChords([]);
    this.removeHook();
  }

  // Lets the Settings screen record a chord without triggering it.
  setPaused(paused) {
    this.paused = Boolean(paused);
    if (this.paused) this.detector.reset();
  }

  ensureHook() {
    if (this.hook) return true;
    try {
      if (!this.win32) this.win32 = loadWin32();
      const { koffi, HookProc, SetWindowsHookExW, GetModuleHandleW } = this.win32;
      this.hookCallback = koffi.register((nCode, wParam, lParam) => this.onHook(nCode, wParam, lParam), koffi.pointer(HookProc));
      this.hook = SetWindowsHookExW(WH_KEYBOARD_LL, this.hookCallback, GetModuleHandleW(null), 0);
      if (!this.hook) throw new Error('SetWindowsHookExW returned null.');
      return true;
    } catch (error) {
      this.logger.error('[hotkeys] Could not install the keyboard hook for letter chords.', error);
      this.removeHook();
      return false;
    }
  }

  removeHook() {
    this.detector.reset();
    if (!this.win32) return;
    if (this.hook) this.win32.UnhookWindowsHookEx(this.hook);
    if (this.hookCallback) this.win32.koffi.unregister(this.hookCallback);
    this.hook = null;
    this.hookCallback = null;
  }

  onHook(nCode, wParam, lParam) {
    const { koffi, KBDLLHOOKSTRUCT, CallNextHookEx } = this.win32;
    try {
      if (nCode >= 0 && !this.paused) {
        const info = koffi.decode(lParam, KBDLLHOOKSTRUCT);
        if (Number(info.dwExtraInfo) !== REPLAY_MARKER) {
          const suppress = this.detector.handleKey({
            vk: info.vkCode,
            scanCode: info.scanCode,
            down: Number(wParam) === WM_KEYDOWN || Number(wParam) === WM_SYSKEYDOWN,
            modifiersDown: () => this.modifiersDown(),
          });
          if (suppress) return 1;
        }
      }
    } catch (error) {
      this.logger.error('[hotkeys] Letter chord hook error.', error);
    }
    return CallNextHookEx(null, nCode, wParam, lParam);
  }

  modifiersDown() {
    return MODIFIER_VKS.some((vk) => (this.win32.GetAsyncKeyState(vk) & 0x8000) !== 0);
  }

  replay(events) {
    const { koffi, INPUT, SendInput } = this.win32;
    const inputs = events.map(({ vk, scanCode, down }) => ({
      type: INPUT_KEYBOARD,
      ki: { wVk: vk, wScan: scanCode, dwFlags: down ? 0 : KEYEVENTF_KEYUP, time: 0, dwExtraInfo: REPLAY_MARKER },
      padding: [0, 0, 0, 0, 0, 0, 0, 0],
    }));
    const sent = SendInput(inputs.length, inputs, koffi.sizeof(INPUT));
    if (sent !== inputs.length) this.logger.warn(`[hotkeys] Replayed ${sent}/${inputs.length} withheld keystrokes.`);
  }
}

// Letter chords need a system-wide keyboard hook, which is Windows-only here.
function createLetterChordBackend(options) {
  if (process.platform !== 'win32') return null;
  return new WindowsLetterChords(options);
}

module.exports = { createLetterChordBackend };
