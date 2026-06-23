const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

let db;

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
  `);

  // Initialize core memory row if it doesn't exist
  const mem = db.prepare('SELECT core_memory FROM memory WHERE id = 1').get();
  if (!mem) {
    db.prepare('INSERT INTO memory (id, core_memory) VALUES (1, ?)').run('');
  }
}

function getSessions() {
  return db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all();
}

function createSession(id, title, provider, model) {
  db.prepare('INSERT INTO sessions (id, title, provider, model, created_at) VALUES (?, ?, ?, ?, ?)').run(id, title, provider, model, Date.now());
  return { id, title, provider, model };
}

function getMessages(sessionId) {
  return db.prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC').all(sessionId);
}

function addMessage(sessionId, role, content) {
  db.prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(sessionId, role, content, Date.now());
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

module.exports = {
  init,
  getSessions,
  createSession,
  getMessages,
  addMessage,
  getCoreMemory,
  updateCoreMemory,
  deleteSession
};
