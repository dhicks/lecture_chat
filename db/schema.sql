PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS instructor (
  id          INTEGER PRIMARY KEY,
  pin_hash    TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_pin TEXT NOT NULL,
  started_at  TEXT DEFAULT (datetime('now')),
  ended_at    TEXT
);

CREATE TABLE IF NOT EXISTS session_users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES chat_sessions(id),
  username    TEXT NOT NULL,
  joined_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(session_id, username)
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES chat_sessions(id),
  username    TEXT NOT NULL,
  body        TEXT NOT NULL,
  parent_id   INTEGER REFERENCES messages(id),
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL REFERENCES messages(id),
  username    TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(message_id, username, emoji)
);

CREATE TABLE IF NOT EXISTS polls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES chat_sessions(id),
  prompt      TEXT NOT NULL,
  options     TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  closed_at   TEXT
);

CREATE TABLE IF NOT EXISTS poll_votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id     INTEGER NOT NULL REFERENCES polls(id),
  username    TEXT NOT NULL,
  choice      INTEGER NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(poll_id, username)
);
