# Code Review — Lecture Chat (Round 3)

Reviewed 2026-04-16 against `main` at `0fcadef`.

---

## Open Items (acknowledged, not actioned)

### 1. CSRF / CORS (low risk, by design)

No CSRF token on state-mutating routes. Acceptable because:
- Auth is JWT-in-header (not cookie), so cross-site requests can't attach credentials automatically
- The session PIN is short-lived and not a high-value secret

### 2. Instructor PIN lifecycle (by design)

The instructor PIN is hashed and stored on first login but never rotated. Acceptable for a single-instructor lecture tool with a known deployment lifetime.

### 3. No indexes on frequently-queried columns (low priority)

`session_users(session_id, username)`, `messages(session_id)`, `reactions(message_id)`, and `poll_votes(poll_id)` are queried on every request but only have primary key indexes. SQLite handles small tables efficiently, so this is low priority until load testing shows a bottleneck.
