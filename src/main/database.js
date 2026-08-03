const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

let db;

// Default Gemini API keys shipped with the app itself — seeded once on first
// run (before any Supabase pull happens) so they show up in Settings right
// away. Supabase sync stays the secondary/backup source for keys added on
// other devices.
const DEFAULT_GEMINI_KEYS = [
  'AIzaSyDWovnlPLq91M9bm0MFPUbIWDgR_B428m0',
  'AIzaSyCPK4mu-gGPUxH-1qsIbfDS5JuBw2uICog',
  'AIzaSyC3nc1cZ2KjabKs5VxJT2I_eUXniDXvxBc',
  'AIzaSyA1D34Jv4M1ZqDpePWXx3K7UyzTs3Sr-MM',
  'AIzaSyBTnQk_Ea44re3M3-ZpUMHqe-lXCIzQLbA',
  'AIzaSyAqIsCbZQMjzhib0FG542DajwFg2RPowRU',
  'AIzaSyA4bGwXkgoExtGPYTc4Ba2UrgxxHh__apA',
];

function seedDefaultApiKeys() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM api_keys').get();
  if (c > 0) return;
  const createdAt = Date.now();
  DEFAULT_GEMINI_KEYS.forEach((key, i) => {
    db.prepare('INSERT INTO api_keys (id, provider, label, key_value, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(`key_seed_${i}`, 'gemini', `Key ${i + 1}`, key, i === 0 ? 1 : 0, createdAt);
  });
}

function init() {
  const dbPath = path.join(app.getPath('userData'), 'ghost_ai.db');
  db = new Database(dbPath);

  // Use Write-Ahead Logging for better performance and concurrency
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      provider TEXT,
      model TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      role TEXT,
      content TEXT,
      created_at INTEGER,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      core_memory TEXT
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      provider TEXT,
      label TEXT,
      key_value TEXT,
      is_active INTEGER DEFAULT 0,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_session_id TEXT
    );
  `);

  // Migration: add sessions.tokens_used if it doesn't exist yet (older DBs won't have it).
  const sessionCols = db.prepare("PRAGMA table_info(sessions)").all();
  if (!sessionCols.some(c => c.name === 'tokens_used')) {
    db.exec('ALTER TABLE sessions ADD COLUMN tokens_used INTEGER DEFAULT 0');
  }

  // Migration: real per-key rate-limit quota (from the provider's own response headers),
  // as opposed to sessions.tokens_used which is per-conversation context usage.
  const apiKeyCols = db.prepare("PRAGMA table_info(api_keys)").all();
  if (!apiKeyCols.some(c => c.name === 'rl_limit_tokens')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN rl_limit_tokens INTEGER');
  }
  if (!apiKeyCols.some(c => c.name === 'rl_remaining_tokens')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN rl_remaining_tokens INTEGER');
  }
  if (!apiKeyCols.some(c => c.name === 'rl_updated_at')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN rl_updated_at INTEGER');
  }

  // Initialize core memory row if it doesn't exist
  const mem = db.prepare('SELECT core_memory FROM memory WHERE id = 1').get();
  if (!mem) {
    db.prepare('INSERT INTO memory (id, core_memory) VALUES (1, ?)').run('');
  }

  // Initialize app_state row if it doesn't exist
  const state = db.prepare('SELECT id FROM app_state WHERE id = 1').get();
  if (!state) {
    db.prepare('INSERT INTO app_state (id, last_session_id) VALUES (1, NULL)').run();
  }

  seedDefaultApiKeys();
}

function getSessions() {
  return db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all();
}

function createSession(id, title, provider, model) {
  const createdAt = Date.now();
  db.prepare('INSERT INTO sessions (id, title, provider, model, created_at) VALUES (?, ?, ?, ?, ?)').run(id, title, provider, model, createdAt);
  return { id, title, provider, model, created_at: createdAt, tokens_used: 0 };
}

function getMessages(sessionId) {
  return db.prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC').all(sessionId);
}

function addMessage(sessionId, role, content) {
  const createdAt = Date.now();
  db.prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(sessionId, role, content, createdAt);
  return createdAt;
}

function getCoreMemory() {
  const row = db.prepare('SELECT core_memory FROM memory WHERE id = 1').get();
  return row ? row.core_memory : '';
}

function updateCoreMemory(text) {
  db.prepare('UPDATE memory SET core_memory = ? WHERE id = 1').run(text);
}

function deleteSession(id) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

function updateSessionTokens(sessionId, tokens) {
  db.prepare('UPDATE sessions SET tokens_used = ? WHERE id = ?').run(tokens, sessionId);
}

function getLastSessionId() {
  const row = db.prepare('SELECT last_session_id FROM app_state WHERE id = 1').get();
  return row ? row.last_session_id : null;
}

function setLastSessionId(sessionId) {
  db.prepare('UPDATE app_state SET last_session_id = ? WHERE id = 1').run(sessionId);
}

function getApiKeys(provider) {
  return db.prepare('SELECT * FROM api_keys WHERE provider = ? ORDER BY created_at ASC').all(provider);
}

function getActiveApiKey(provider) {
  return db.prepare('SELECT * FROM api_keys WHERE provider = ? AND is_active = 1').get(provider);
}

function addApiKey(id, provider, label, keyValue, makeActive) {
  const createdAt = Date.now();
  if (makeActive) db.prepare('UPDATE api_keys SET is_active = 0 WHERE provider = ?').run(provider);
  db.prepare('INSERT INTO api_keys (id, provider, label, key_value, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, provider, label, keyValue, makeActive ? 1 : 0, createdAt);
  return { id, provider, label, key_value: keyValue, is_active: makeActive ? 1 : 0, created_at: createdAt };
}

function setActiveApiKey(id, provider) {
  db.prepare('UPDATE api_keys SET is_active = 0 WHERE provider = ?').run(provider);
  db.prepare('UPDATE api_keys SET is_active = 1 WHERE id = ?').run(id);
}

function deleteApiKey(id) {
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
}

// Real quota reported by the provider itself (rate-limit response headers), keyed to
// the actual API key value — persists across sessions/restarts, unlike sessions.tokens_used.
function updateApiKeyRateLimit(provider, keyValue, limit, remaining) {
  db.prepare('UPDATE api_keys SET rl_limit_tokens = ?, rl_remaining_tokens = ?, rl_updated_at = ? WHERE provider = ? AND key_value = ?')
    .run(limit ?? null, remaining ?? null, Date.now(), provider, keyValue);
}

function getAllApiKeys() {
  return db.prepare('SELECT * FROM api_keys').all();
}

// Cross-device merge helpers: only ever insert rows that don't already exist
// locally — local data always wins, this never overwrites anything.
function importSession(s) {
  db.prepare('INSERT OR IGNORE INTO sessions (id, title, provider, model, tokens_used, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(s.id, s.title, s.provider, s.model, s.tokens_used || 0, s.created_at);
}

function importMessage(sessionId, role, content, createdAt) {
  db.prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(sessionId, role, content, createdAt);
}

function importApiKey(k) {
  db.prepare('INSERT OR IGNORE INTO api_keys (id, provider, label, key_value, is_active, created_at, rl_limit_tokens, rl_remaining_tokens, rl_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(k.id, k.provider, k.label, k.key_value, k.is_active ? 1 : 0, k.created_at, k.rl_limit_tokens ?? null, k.rl_remaining_tokens ?? null, k.rl_updated_at ?? null);
}

module.exports = {
  init,
  getSessions,
  createSession,
  getMessages,
  addMessage,
  getCoreMemory,
  updateCoreMemory,
  deleteSession,
  updateSessionTokens,
  getLastSessionId,
  setLastSessionId,
  getApiKeys,
  getActiveApiKey,
  addApiKey,
  setActiveApiKey,
  deleteApiKey,
  updateApiKeyRateLimit,
  getAllApiKeys,
  importSession,
  importMessage,
  importApiKey
};
