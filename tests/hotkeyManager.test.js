const assert = require('node:assert/strict');
const test = require('node:test');
const { HotkeyManager, normalizeAccelerator } = require('../src/main/hotkeys/hotkeyManager');

class MemoryStore {
  constructor(initial = null) {
    this.value = initial;
    this.saveCount = 0;
  }

  load() {
    return this.value ? JSON.parse(JSON.stringify(this.value)) : null;
  }

  save(value) {
    this.value = JSON.parse(JSON.stringify(value));
    this.saveCount += 1;
    return { success: true };
  }
}

class FakeGlobalShortcut {
  constructor({ fail = [] } = {}) {
    this.callbacks = new Map();
    this.fail = new Set(fail);
  }

  register(accelerator, callback) {
    if (this.fail.has(accelerator) || this.callbacks.has(accelerator)) return false;
    this.callbacks.set(accelerator, callback);
    return true;
  }

  unregister(accelerator) {
    this.callbacks.delete(accelerator);
  }

  unregisterAll() {
    this.callbacks.clear();
  }

  trigger(accelerator) {
    this.callbacks.get(accelerator)?.();
  }
}

function createManager(options = {}) {
  return new HotkeyManager({
    globalShortcut: options.globalShortcut || new FakeGlobalShortcut(),
    store: options.store || new MemoryStore(),
    logger: { log() {}, warn() {}, error() {} },
    platform: 'win32',
  });
}

test('normalizes common accelerator formats', () => {
  assert.deepEqual(normalizeAccelerator('ctrl + shift + k'), {
    success: true,
    accelerator: 'Ctrl+Shift+K',
  });
  assert.deepEqual(normalizeAccelerator('Alt+Space'), {
    success: true,
    accelerator: 'Alt+Space',
  });
});

test('rejects invalid global shortcuts', () => {
  const result = normalizeAccelerator('K');
  assert.equal(result.success, false);
  assert.match(result.error, /modifier/i);
});

test('prevents duplicate shortcut assignments', () => {
  const manager = createManager();
  manager.initialize();

  const result = manager.registerHotkey({
    action: 'focus-chat',
    label: 'Duplicate',
    accelerator: 'Ctrl+Shift+Space',
    enabled: true,
  });

  assert.equal(result.success, false);
  assert.match(result.error, /already assigned/i);
});

test('registers, emits, and unregisters custom hotkeys', () => {
  const globalShortcut = new FakeGlobalShortcut();
  const manager = createManager({ globalShortcut });
  manager.initialize();

  const result = manager.registerHotkey({
    action: 'open-settings',
    label: 'Open Settings',
    accelerator: 'Ctrl+Alt+S',
    enabled: true,
  });
  assert.equal(result.success, true);

  let action = null;
  manager.on('hotkey:pressed', hotkey => {
    action = hotkey.action;
  });
  globalShortcut.trigger('Ctrl+Alt+S');
  assert.equal(action, 'open-settings');

  const remove = manager.unregisterHotkey(result.data.id);
  assert.equal(remove.success, true);
  assert.equal(globalShortcut.callbacks.has('Ctrl+Alt+S'), false);
});

test('persists updates in the settings store', () => {
  const store = new MemoryStore();
  const manager = createManager({ store });
  manager.initialize();

  const result = manager.updateHotkey('focus-chat', {
    enabled: true,
    accelerator: 'Ctrl+Alt+M',
  });

  assert.equal(result.success, true);
  const saved = store.value.hotkeys.find(hotkey => hotkey.id === 'focus-chat');
  assert.equal(saved.enabled, true);
  assert.equal(saved.accelerator, 'Ctrl+Alt+M');
});

test('falls back to disabled state when native registration fails', () => {
  const globalShortcut = new FakeGlobalShortcut({ fail: ['Ctrl+Alt+M'] });
  const manager = createManager({ globalShortcut });
  manager.initialize();

  const result = manager.updateHotkey('focus-chat', {
    enabled: true,
    accelerator: 'Ctrl+Alt+M',
  });

  assert.equal(result.success, false);
  assert.equal(result.data.enabled, false);
  assert.match(result.data.registrationError, /rejected/i);
});
