# Lecture Chat System — CLAUDE.md

## Project Overview

A lightweight, real-time chat system for use during large university lectures. Students join via a browser with their student ID, a session PIN (shown on lecture slides), and a username — no accounts required. The ID is checked against a roster CSV. The instructor controls the session from a separate dashboard.

---

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js | v20+ |
| Framework | Fastify | Lighter than Express; good SSE support |
| Database | SQLite via `better-sqlite3` | File-based, zero infrastructure, persistent logs |
| Auth tokens | `@fastify/jwt` | Signed JWTs for instructor + student sessions |
| Frontend | Vanilla JS + Preact via CDN | No build step; served as static files |
| CSS | Pico.css or hand-rolled | Minimal, mobile-friendly |
| Hosting | Railway or Render | Persistent disk volume required for SQLite |

No Redis, no message broker, no separate DB server.

---

## Auth Model

### Two roles, two PINs

**Instructor PIN** (6 digits, set via env var `INSTRUCTOR_PIN`)
- Logs into the instructor dashboard
- Read from the environment on every login; never stored in the database
- Change the env var and restart the server to change the PIN
- Compared in constant time (`crypto.timingSafeEqual`) so response timing does not leak the PIN
- Issues a signed JWT (`role: instructor`) on login

**Session PIN** (4 digits, randomly generated per session)
- Displayed on lecture slides
- Students enter student ID + PIN + username to join
- Invalidated when instructor ends the session

**Student ID** (numeric, up to 20 digits)
- Checked against the roster CSV at `ROSTER_PATH` (header row with a `student_id` column; other columns ignored)
- Compared as text, so leading zeros matter
- The roster is re-read on every `/join`, so edits need no restart; the server exits at startup if the file is missing or malformed
- Stored on `session_users` and `messages`, and carried in the student JWT (`student_id`). Tokens without it are rejected by `requireStudent`
- Never sent to students: `GET /messages`, `POST /message` responses, and SSE events do not include `student_id` or `ip_address`. Only the instructor export does
- One ID may join a session under several usernames; the username stays unique per session

### Session lifecycle

1. Instructor logs in → hits dashboard
2. Instructor clicks "Start Session" → 4-digit PIN generated, displayed prominently
3. Students navigate to the app URL, enter student ID + PIN + username → issued a JWT (`role: student, session_id, username, student_id`)
4. Instructor clicks "End Session" → session marked closed, PIN invalidated, no new joins accepted
5. Instructor can export the session log at any time

---

## Database Schema

```sql
-- No instructor table: the instructor PIN lives in the INSTRUCTOR_PIN env var

-- Chat sessions
CREATE TABLE chat_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_pin TEXT NOT NULL,
  started_at  TEXT DEFAULT (datetime('now')),
  ended_at    TEXT
);

-- Joined students (per session)
CREATE TABLE session_users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES chat_sessions(id),
  username    TEXT NOT NULL,
  student_id  TEXT,             -- from the roster; NULL for rows created before roster login
  joined_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(session_id, username)
);

-- Messages (top-level and threaded replies)
CREATE TABLE messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES chat_sessions(id),
  username    TEXT NOT NULL,
  student_id  TEXT,             -- sender's roster ID; NULL for older rows
  ip_address  TEXT,             -- req.ip when the message was posted; NULL for older rows
  body        TEXT NOT NULL,
  parent_id   INTEGER REFERENCES messages(id),  -- NULL = top-level
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Emoji reactions on messages
CREATE TABLE reactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL REFERENCES messages(id),
  username    TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(message_id, username, emoji)
);

-- Polls
CREATE TABLE polls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES chat_sessions(id),
  prompt      TEXT NOT NULL,
  options     TEXT NOT NULL,  -- JSON array of strings
  created_at  TEXT DEFAULT (datetime('now')),
  closed_at   TEXT            -- NULL = still open; results hidden from students until closed
);

-- Poll votes (one per user per poll)
CREATE TABLE poll_votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id     INTEGER NOT NULL REFERENCES polls(id),
  username    TEXT NOT NULL,
  choice      INTEGER NOT NULL,  -- index into options array
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(poll_id, username)
);
```

---

## API Routes

All student routes require a valid student JWT. All instructor routes require a valid instructor JWT.

### Public (no auth)
| Method | Route | Description |
|---|---|---|
| POST | `/instructor/login` | Verify instructor PIN → return instructor JWT |
| POST | `/join` | Verify student ID (on roster) + session PIN + username → return student JWT. 300/min per client IP (a class behind one campus NAT address must be able to join together) |

### Instructor only
| Method | Route | Description |
|---|---|---|
| POST | `/session/start` | Generate session PIN, create session record |
| POST | `/session/end` | Mark session ended, block new joins |
| POST | `/poll` | Create a new poll |
| POST | `/poll/:id/close` | Close poll (triggers results broadcast to students) |
| GET | `/session/:id/export` | Export full session log as JSON |

### Student (authenticated)
| Method | Route | Description |
|---|---|---|
| GET | `/stream` | SSE stream — receives all real-time events |
| GET | `/messages` | Fetch last N messages on join |
| POST | `/message` | Post a new message or reply |
| POST | `/react` | Add/remove an emoji reaction |
| POST | `/vote` | Submit a poll vote |

---

## SSE Event Types

The `/stream` endpoint pushes JSON events. The frontend switches on `event.type`:

```
message_new       New top-level message or reply
reaction_update   Updated reaction counts for a message_id
poll_new          A poll has been created (show voting UI)
poll_closed       A poll closed (show results)
chat_toggled      Instructor disabled/enabled chat ({ disabled: bool }); polls unaffected
session_ended     Instructor ended the session
```

---

## Frontend Screens

### Student flow
1. **Join screen** — Enter session PIN + username → validate → store JWT + username in `localStorage`
2. **Chat screen** — Message feed, emoji reactions, reply threads, active poll card (if any)
3. **Reconnect behavior** — On page reload, read JWT from `localStorage`; re-establish SSE; fetch last 50 messages

### Instructor flow
1. **Login screen** — Enter instructor PIN
2. **Dashboard** — Start session → PIN displayed prominently; live message feed with timestamps; create/close polls; end session; export log

---

## Emoji Reactions

Use a fixed set to keep the UI simple:

```
👍  👎  ❓  😂  🔥  ✅  ❌  😊  😕
```

Reactions are toggled: posting the same emoji twice removes it. Counts are aggregated server-side and broadcast via SSE `reaction_update` events.

---

## Polls

- Instructor creates a poll with a prompt and 2–4 options
- A `poll_new` SSE event delivers the poll to all connected students
- Students see a voting card; results are **hidden until the instructor closes the poll**
- On close, a `poll_closed` event broadcasts the final results to everyone
- Results displayed as a simple bar chart (inline SVG or CSS widths)

---

## Reply Threads

- Any top-level message can be replied to (one level deep only — no nested threads)
- Replies are stored with `parent_id` set
- Frontend groups replies under their parent, collapsed by default with a "N replies" toggle
- Useful for instructor to pose a question and collect free-text responses

---

## Configuration (Environment Variables)

```
INSTRUCTOR_PIN=123456      # 6-digit instructor PIN (required; read on every login)
JWT_SECRET=<random string> # Secret for signing JWTs
PORT=80
DB_PATH=./data/chat.db     # Path for SQLite file — ensure this is on a persistent volume
ROSTER_PATH=./data/roster.csv  # CSV of enrolled student IDs (header row with student_id column; required at startup)
TRUST_PROXY_HOPS=0         # Proxies in front of the server (default 0; Railway: 1, confirm). Sets req.ip for the message log and rate limiter
```

`req.ip` is logged with each message. Behind a proxy it is the proxy's address unless `TRUST_PROXY_HOPS` is set. A fixed count is used instead of `trustProxy: true` so clients cannot choose their own logged IP with an `X-Forwarded-For` header.

Rate limits (`rateLimitKey` in `server.js`): requests with a valid student token are keyed by `student_id`; all others by `req.ip`. Students on one campus network may share an IP, so per-IP keys would make the whole class share one bucket. The token is verified, not just decoded, so a forged token cannot pick its own bucket. One student ID joined under several usernames shares one bucket.

**Roster on Railway.** The roster is not in git (`data/` is ignored), so it goes onto the persistent volume with the Railway CLI ([docs](https://docs.railway.com/volumes)):

```bash
railway volume files upload ./data/roster.csv /roster.csv   # second path is inside the volume; volume mounted at /data → /data/roster.csv
railway volume browse /                                      # interactive TUI: browse, upload, download, edit, delete
```

Set `ROSTER_PATH=/data/roster.csv`. Re-upload to replace the roster; `/join` re-reads it, so no restart is needed. Volumes are mounted when the service starts, not at build time, so uploads need a running container. Because the server exits at startup without a roster, upload it before deploying a version that requires it. The volume-path form and this ordering are inferred from the docs and untested here.

---

## Project Structure

```
/
├── server.js              # Entry point
├── db/
│   ├── schema.sql         # Schema definition
│   └── migrate.js         # Run on startup to init DB
├── routes/
│   ├── auth.js            # /instructor/login, /join
│   ├── session.js         # /session/start, /session/end, /session/:id/export
│   ├── messages.js        # /messages, /message
│   ├── reactions.js       # /react
│   ├── polls.js           # /poll, /poll/:id/close, /vote
│   └── stream.js          # /stream (SSE)
├── lib/
│   ├── sse.js             # SSE client registry + broadcast helper
│   ├── auth.js            # JWT helpers, PIN hashing
│   └── roster.js          # Load enrolled student IDs from the roster CSV
├── public/
│   ├── index.html         # Student app
│   ├── instructor.html    # Instructor dashboard
│   ├── app.js             # Student frontend logic
│   └── instructor.js      # Instructor frontend logic
├── .env
└── package.json
```

---

## Development Phases

Phases 0–4 are complete. Outstanding work is tracked in `TODO.md`.

| Phase | Description | Status |
|---|---|---|
| 0 | Project setup (deps, DB migration, server stub) | ✅ Done |
| 1 | Auth & sessions (instructor login, student join, session lifecycle) | ✅ Done |
| 2 | Core chat (SSE stream, messages, replies) | ✅ Done |
| 3 | Reactions (toggle, broadcast, counts) | ✅ Done |
| 4 | Polls (create, vote, close, results) | ✅ Done |
| 5 | Student frontend (`public/index.html`, `public/app.js`) | 🔧 In progress |
| 6 | Instructor dashboard (`public/instructor.html`, `public/instructor.js`) | ⬜ Pending |
| 7 | Hardening (rate limiting, input validation, SSE reconnect) | ⬜ Pending |
| 8 | Deployment (Railway/Render config, persistent volume) | ⬜ Pending |
| 9 | README (user guide for the instructor) | ⬜ Pending |

---

## Implementation Notes

- **No nested threads** — replies are one level deep only. Simplifies both DB queries and UI.
- **Poll results hidden** — the `poll_closed` SSE event is the trigger; students never receive vote counts until then. The instructor's dashboard queries results directly.
- **SQLite concurrency** — enable WAL mode (`PRAGMA journal_mode=WAL`) for better read/write concurrency with multiple SSE connections.
- **JWT expiry** — student tokens can expire after 4 hours (reasonable lecture window). Instructor tokens after 8 hours.
- **No message deletion** — keep it simple; logs should be complete. Instructor can pin but not delete.
- **Session PIN collisions** — on `session/start`, check that the generated PIN isn't already in use by another active session (unlikely but possible).

### Accessibility (legal requirement — WCAG 2.1 AA)

The system must be usable by someone on a screen reader. Key patterns:

- **ARIA live regions** — the message feed uses `aria-live="polite"`; urgent alerts (session ended, errors) use `aria-live="assertive"`. Never put high-frequency updates (individual reaction counts) directly in a live region — collect them into a summary.
- **Emoji reaction buttons** — raw emoji are read inconsistently across screen readers. Always provide `aria-label` with a plain-English description and count (e.g., `aria-label="Thumbs up, 3 reactions"`), plus `aria-pressed` for toggle state.
- **Polls** — use `<fieldset>` + `<legend>` (poll prompt) + `<input type="radio">` for options. Never render a poll as a custom widget.
- **Poll results bar chart** — the visual bar chart must have a screen-reader-accessible alternative: either a visually-hidden `<table>` with the same data, or `aria-label` attributes on each bar that include the option text and percentage.
- **Reply thread toggle** — `aria-expanded` on the toggle button; `aria-controls` pointing to the reply list `id`.
- **Confirmation dialogs** — use the native `<dialog>` element. Trap focus inside while open; return focus to the trigger button on close.
- **Focus management** — after form submission advances the user to a new screen (join → chat), programmatically move focus to the first meaningful element (message input).
- **Semantic structure** — use landmark elements (`<main>`, `<header>`, `<nav>`, `<section>`) and real interactive elements (`<button>`, `<input>`, `<label>`). No `<div onclick>`.
- **Color contrast** — Pico.css defaults often fail WCAG AA for muted text (timestamps, counts). Override as needed. Do not rely on color alone to convey state.
