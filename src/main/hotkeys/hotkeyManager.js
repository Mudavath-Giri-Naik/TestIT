const { EventEmitter } = require('events');
const os = require('os');

const HOTKEY_SCHEMA_VERSION = 1;

const HOTKEY_ACTIONS = Object.freeze({
  'toggle-window': 'Toggle Window',
  'hide-window': 'Hide Window',
  'show-window': 'Show Window (Restore)',
  'screenshot-ask': 'Screenshot & Ask AI',
  'toggle-click-through': 'Toggle Click-through',
  'quit-app': 'Quit App',
  'focus-chat': 'Focus Chat Input',
  'open-settings': 'Open Settings',
  'new-chat': 'New Chat',
});

const DEFAULT_HOTKEYS = Object.freeze([
  {
    id: 'toggle-window',
    action: 'toggle-window',
    label: 'Toggle window',
    accelerator: 'CommandOrControl+Shift+T',
    enabled: true,
    locked: true,
  },
  {
    id: 'screenshot-ask',
    action: 'screenshot-ask',
    label: 'Screenshot & ask AI',
    accelerator: 'CommandOrControl+Shift+S',
    enabled: true,
    locked: true,
  },
  {
    id: 'hide-window',
    action: 'hide-window',
    label: 'Hide window',
    accelerator: 'CommandOrControl+Shift+Z',
    enabled: true,
    locked: true,
  },
  {
    id: 'show-window',
    action: 'show-window',
    label: 'Show window (restore)',
    accelerator: 'CommandOrControl+Shift+O',
    enabled: true,
    locked: true,
  },
  {
    id: 'toggle-click-through',
    action: 'toggle-click-through',
    label: 'Toggle click-through',
    accelerator: 'CommandOrControl+Shift+X',
    enabled: true,
    locked: true,
  },
  {
    id: 'quit-app',
    action: 'quit-app',
    label: 'Quit app',
    accelerator: 'CommandOrControl+Shift+Q',
    enabled: true,
    locked: true,
  },
  {
    id: 'focus-chat',
    action: 'focus-chat',
    label: 'Focus chat input',
    accelerator: 'CommandOrControl+Shift+Space',
    enabled: true,
    locked: false,
  },
]);

const MODIFIER_ALIASES = new Map([
  ['CTRL', 'Ctrl'],
  ['CONTROL', 'Ctrl'],
  ['CMDORCTRL', 'CommandOrControl'],
  ['COMMANDORCONTROL', 'CommandOrControl'],
  ['COMMAND', 'Command'],
  ['CMD', 'Command'],
  ['META', 'Meta'],
  ['SUPER', 'Super'],
  ['SHIFT', 'Shift'],
  ['ALT', 'Alt'],
  ['OPTION', 'Alt'],
]);

const KEY_ALIASES = new Map([
  [' ', 'Space'],
  ['SPACEBAR', 'Space'],
  ['ESC', 'Escape'],
  ['RETURN', 'Enter'],
  ['DEL', 'Delete'],
  ['ARROWUP', 'Up'],
  ['ARROWDOWN', 'Down'],
  ['ARROWLEFT', 'Left'],
  ['ARROWRIGHT', 'Right'],
  ['PLUS', 'Plus'],
  ['+', 'Plus'],
]);

const MODIFIER_ORDER = ['CommandOrControl', 'Command', 'Ctrl', 'Alt', 'Shift', 'Meta', 'Super'];

/**
 * @typedef {Object} HotkeyConfig
 * @property {string} id
 * @property {string} action
 * @property {string} label
 * @property {string} accelerator
 * @property {boolean} enabled
 * @property {boolean} [locked]
 * @property {boolean} [registered]
 * @property {string | null} [registrationError]
 */

/**
 * @typedef {Object} HotkeyResult
 * @property {boolean} success
 * @property {HotkeyConfig | HotkeyConfig[]} [data]
 * @property {string} [error]
 */

class HotkeyManager extends EventEmitter {
  /**
   * @param {{
   *   globalShortcut: { register: Function, unregister: Function, unregisterAll?: Function, isRegistered?: Function },
   *   store: { load: Function, save: Function },
   *   logger?: Pick<Console, 'log' | 'warn' | 'error'>,
   *   defaults?: HotkeyConfig[],
   *   platform?: string
   * }} options
   */
  constructor({ globalShortcut, store, logger = console, defaults = DEFAULT_HOTKEYS, platform = os.platform() }) {
    super();
    this.globalShortcut = globalShortcut;
    this.store = store;
    this.logger = logger;
    this.defaults = defaults;
    this.platform = platform;
    this.hotkeys = new Map();
    this.nativeRegistrations = new Map();
  }

  initialize() {
    const loaded = this.store.load();
    const hotkeys = this.mergeWithDefaults(loaded?.hotkeys);
    this.hotkeys = new Map(hotkeys.map((hotkey) => [hotkey.id, this.toRuntimeConfig(hotkey)]));
    this.registerEnabledHotkeys();
    this.persist();
    this.emitChanged();
    return this.getRegisteredHotkeys();
  }

  /**
   * @param {Partial<HotkeyConfig>} hotkey
   * @returns {HotkeyResult}
   */
  registerHotkey(hotkey) {
    const config = this.toRuntimeConfig({
      ...hotkey,
      id: hotkey.id || this.createId(),
      enabled: hotkey.enabled !== false,
      locked: Boolean(hotkey.locked),
    });

    const validation = this.validateConfig(config);
    if (!validation.success) return validation;
    if (this.hotkeys.has(config.id)) return { success: false, error: `Hotkey id "${config.id}" already exists.` };

    this.hotkeys.set(config.id, config);
    const result = this.registerNativeIfEnabled(config);
    this.persistAndNotify();
    return result.success ? { success: true, data: this.clone(config) } : result;
  }

  /**
   * @param {string} id
   * @returns {HotkeyResult}
   */
  unregisterHotkey(id) {
    const current = this.hotkeys.get(id);
    if (!current) return { success: false, error: `Hotkey "${id}" was not found.` };
    if (current.locked) return { success: false, error: 'Built-in hotkeys cannot be removed. Disable them instead.' };

    this.unregisterNative(id);
    this.hotkeys.delete(id);
    this.persistAndNotify();
    return { success: true, data: this.getRegisteredHotkeys() };
  }

  /**
   * @param {string} id
   * @param {Partial<HotkeyConfig>} updates
   * @returns {HotkeyResult}
   */
  updateHotkey(id, updates) {
    const current = this.hotkeys.get(id);
    if (!current) return { success: false, error: `Hotkey "${id}" was not found.` };

    const next = this.toRuntimeConfig({
      ...current,
      ...updates,
      id: current.id,
      locked: current.locked,
    });
    const validation = this.validateConfig(next, id);
    if (!validation.success) return validation;

    this.unregisterNative(id);
    this.hotkeys.set(id, next);
    const result = this.registerNativeIfEnabled(next);
    this.persistAndNotify();
    return result.success ? { success: true, data: this.clone(next) } : result;
  }

  getRegisteredHotkeys() {
    return Array.from(this.hotkeys.values()).map((hotkey) => this.clone(hotkey));
  }

  validateAccelerator(accelerator, excludeId) {
    const normalized = normalizeAccelerator(accelerator);
    if (!normalized.success) return normalized;

    const duplicate = this.findDuplicate(normalized.accelerator, excludeId);
    if (duplicate) {
      return {
        success: false,
        error: `"${normalized.accelerator}" is already assigned to ${duplicate.label}.`,
      };
    }
    return { success: true, accelerator: normalized.accelerator };
  }

  shutdown() {
    for (const id of this.nativeRegistrations.keys()) this.unregisterNative(id);
    this.removeAllListeners();
  }

  registerEnabledHotkeys() {
    for (const hotkey of this.hotkeys.values()) this.registerNativeIfEnabled(hotkey);
  }

  registerNativeIfEnabled(hotkey) {
    hotkey.registered = false;
    hotkey.registrationError = null;
    if (!hotkey.enabled) return { success: true, data: this.clone(hotkey) };

    try {
      const ok = this.globalShortcut.register(hotkey.accelerator, () => {
        const payload = this.clone(hotkey);
        this.emit('hotkey:pressed', payload);
      });
      if (!ok) {
        hotkey.enabled = false;
        hotkey.registrationError = `The operating system or another app rejected "${hotkey.accelerator}".`;
        this.logger.warn(`[hotkeys] ${hotkey.registrationError}`);
        this.emit('hotkey:error', this.clone(hotkey));
        return { success: false, error: hotkey.registrationError, data: this.clone(hotkey) };
      }
      hotkey.registered = true;
      this.nativeRegistrations.set(hotkey.id, hotkey.accelerator);
      return { success: true, data: this.clone(hotkey) };
    } catch (error) {
      hotkey.enabled = false;
      hotkey.registrationError = error.message;
      this.logger.error('[hotkeys] Failed to register hotkey.', error);
      this.emit('hotkey:error', this.clone(hotkey));
      return { success: false, error: error.message, data: this.clone(hotkey) };
    }
  }

  unregisterNative(id) {
    const accelerator = this.nativeRegistrations.get(id);
    if (!accelerator) return;
    try {
      this.globalShortcut.unregister(accelerator);
    } catch (error) {
      this.logger.warn(`[hotkeys] Failed to unregister "${accelerator}".`, error);
    } finally {
      this.nativeRegistrations.delete(id);
      const hotkey = this.hotkeys.get(id);
      if (hotkey) hotkey.registered = false;
    }
  }

  validateConfig(config, excludeId) {
    if (!HOTKEY_ACTIONS[config.action]) return { success: false, error: 'Choose a valid hotkey action.' };
    if (!config.label || !config.label.trim()) return { success: false, error: 'Enter a hotkey label.' };
    return this.validateAccelerator(config.accelerator, excludeId);
  }

  findDuplicate(accelerator, excludeId) {
    const key = acceleratorIdentity(accelerator, this.platform);
    return Array.from(this.hotkeys.values()).find((hotkey) => (
      hotkey.id !== excludeId && acceleratorIdentity(hotkey.accelerator, this.platform) === key
    ));
  }

  mergeWithDefaults(savedHotkeys) {
    const saved = Array.isArray(savedHotkeys) ? savedHotkeys : [];
    const byId = new Map(saved.map((hotkey) => [hotkey.id, hotkey]));
    const mergedDefaults = this.defaults.map((defaultHotkey) => ({
      ...defaultHotkey,
      ...byId.get(defaultHotkey.id),
      id: defaultHotkey.id,
      action: byId.get(defaultHotkey.id)?.action || defaultHotkey.action,
      label: byId.get(defaultHotkey.id)?.label || defaultHotkey.label,
      locked: defaultHotkey.locked,
    }));
    const custom = saved.filter((hotkey) => !this.defaults.some((defaultHotkey) => defaultHotkey.id === hotkey.id));
    return [...mergedDefaults, ...custom];
  }

  toRuntimeConfig(config) {
    const normalized = normalizeAccelerator(config.accelerator || '');
    return {
      id: String(config.id || this.createId()),
      action: String(config.action || 'focus-chat'),
      label: String(config.label || HOTKEY_ACTIONS[config.action] || 'Custom hotkey'),
      accelerator: normalized.success ? normalized.accelerator : String(config.accelerator || ''),
      enabled: Boolean(config.enabled),
      locked: Boolean(config.locked),
      registered: Boolean(config.registered),
      registrationError: config.registrationError || null,
    };
  }

  persistAndNotify() {
    this.persist();
    this.emitChanged();
  }

  persist() {
    return this.store.save({
      version: HOTKEY_SCHEMA_VERSION,
      hotkeys: this.getRegisteredHotkeys().map(({ registered, ...hotkey }) => hotkey),
    });
  }

  emitChanged() {
    this.emit('hotkey:changed', this.getRegisteredHotkeys());
  }

  createId() {
    return `hotkey-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
}

function normalizeAccelerator(accelerator) {
  if (typeof accelerator !== 'string' || !accelerator.trim()) {
    return { success: false, error: 'Enter a shortcut such as Ctrl+Shift+K.' };
  }

  const rawParts = accelerator
    .trim()
    .replace(/\s*\+\s*/g, '+')
    .split('+')
    .filter(Boolean);
  const modifiers = new Set();
  let key = null;

  for (const rawPart of rawParts) {
    const part = rawPart.trim();
    const upper = part.toUpperCase();
    const modifier = MODIFIER_ALIASES.get(upper);
    if (modifier) {
      if (modifiers.has(modifier)) return { success: false, error: `Duplicate modifier "${modifier}".` };
      modifiers.add(modifier);
      continue;
    }

    if (key) return { success: false, error: 'Shortcuts can contain only one non-modifier key.' };
    key = normalizeKey(part);
  }

  if (!key) return { success: false, error: 'Add a regular key after the modifier keys.' };
  if (modifiers.size === 0 && !/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) {
    return { success: false, error: 'Global shortcuts need at least one modifier key.' };
  }

  return {
    success: true,
    accelerator: [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join('+'),
  };
}

function normalizeKey(key) {
  const upper = key.toUpperCase();
  if (KEY_ALIASES.has(upper)) return KEY_ALIASES.get(upper);
  if (/^[A-Z0-9]$/.test(upper)) return upper;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(upper)) return upper;
  return key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
}

function acceleratorIdentity(accelerator, platform) {
  const normalized = normalizeAccelerator(accelerator);
  if (!normalized.success) return accelerator;
  return normalized.accelerator
    .replace('CommandOrControl', platform === 'darwin' ? 'Command' : 'Ctrl')
    .toUpperCase();
}

module.exports = {
  DEFAULT_HOTKEYS,
  HOTKEY_ACTIONS,
  HotkeyManager,
  normalizeAccelerator,
  acceleratorIdentity,
};
