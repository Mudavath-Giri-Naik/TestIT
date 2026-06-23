export interface HotkeyConfig {
  id: string;
  action: string;
  label: string;
  accelerator: string;
  enabled: boolean;
  locked?: boolean;
  registered?: boolean;
  registrationError?: string | null;
}

export interface HotkeyResult<T = HotkeyConfig | HotkeyConfig[]> {
  success: boolean;
  data?: T;
  error?: string;
}

export declare const HOTKEY_ACTIONS: Readonly<Record<string, string>>;

export declare class HotkeyManager {
  registerHotkey(hotkey: Partial<HotkeyConfig>): HotkeyResult<HotkeyConfig>;
  unregisterHotkey(id: string): HotkeyResult<HotkeyConfig[]>;
  updateHotkey(id: string, updates: Partial<HotkeyConfig>): HotkeyResult<HotkeyConfig>;
  getRegisteredHotkeys(): HotkeyConfig[];
}
