'use strict';

const fs = require('fs');
const path = require('path');

function migrate(db) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);

  // The instructor PIN moved from a bcrypt hash in this table to the
  // INSTRUCTOR_PIN environment variable, read on each login. Drop the table so
  // existing databases stop carrying a stale hash.
  db.exec('DROP TABLE IF EXISTS instructor');

  // chat_disabled was added after the initial schema; CREATE TABLE IF NOT
  // EXISTS above won't add it to a database that already has chat_sessions.
  const chatSessionColumns = db.prepare('PRAGMA table_info(chat_sessions)').all();
  if (!chatSessionColumns.some(c => c.name === 'chat_disabled')) {
    db.exec('ALTER TABLE chat_sessions ADD COLUMN chat_disabled INTEGER NOT NULL DEFAULT 0');
  }

  db.pragma('foreign_keys = ON');
}

module.exports = { migrate };
