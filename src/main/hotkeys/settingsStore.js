const fs = require('fs');
const path = require('path');

class JsonSettingsStore {
  /**
   * @param {{ filePath: string, logger?: Pick<Console, 'warn' | 'error'> }} options
   */
  constructor({ filePath, logger = console }) {
    this.filePath = filePath;
    this.logger = logger;
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      this.logger.warn('[hotkeys] Could not read hotkey settings. Falling back to defaults.', error);
      return null;
    }
  }

  save(settings) {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2));
      fs.renameSync(tempPath, this.filePath);
      return { success: true };
    } catch (error) {
      this.logger.error('[hotkeys] Could not persist hotkey settings.', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = { JsonSettingsStore };
