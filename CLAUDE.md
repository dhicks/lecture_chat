# Lecture Chat System — CLAUDE.md

## Project Overview

A lightweight, real-time chat system for use during large university lectures. Students join via a browser with a session PIN (shown on lecture slides) and a username — no accounts required. The instructor controls the session from a separate dashboard.

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

**Instructor PIN** (6 digits, set at first run via env var `INSTRUCTOR_PIN`)
- Logs into the instructor dashboard
- Hashed with bcrypt and stored in DB on first use
- Issues a signed JWT (`role: instructor`) on login

**Session PIN** (4 digits, randomly generated per session)
- Displayed on lecture slides
- Students enter PIN + username to join
- Invalidated when instructor ends the session

### Session lifecycle

1. Instructor logs in → hits dashboard
2. Instructor clicks "Start Session" → 4-digit PIN generated, displayed prominently
3. Students navigate to the app URL, enter PIN + username → issued a JWT (`role: student, session_id, username`)
4. Instructor clicks "End Session" → session marked closed, PIN invalidated, no new joins accepted
5. Instructor can export the session log at any time

---

## Database Schema

```sql
-- Instructor credential (single row)
CREATE TABLE instructor (
  id          INTEGER PRIMARY KEY,
  pin_hash    TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

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
  joined_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(session_id, username)
);

-- Messages (top-level and threaded replies)
CREATE TABLE messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES chat_sessions(id),
  username    TEXT NOT NULL,
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
| POST | `/join` | Verify session PIN + username → return student JWT |

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
INSTRUCTOR_PIN=123456      # 6-digit instructor PIN (required on first run)
JWT_SECRET=<random string> # Secret for signing JWTs
PORT=3000
DB_PATH=./data/chat.db     # Path for SQLite file — ensure this is on a persistent volume
```

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
│   └── auth.js            # JWT helpers, PIN hashing
├── public/
│   ├── index.html         # Student app
│   ├── instructor.html    # Instructor dashboard
│   ├── app.js             # Student frontend logic
│   └── instructor.js      # Instructor frontend logic
├── .env
└── package.json
```

---

## TODO

### Phase 0 — Project setup
- [x] `npm init`, install dependencies: `fastify`, `better-sqlite3`, `@fastify/jwt`, `@fastify/static`, `@fastify/cookie`, `bcrypt`
- [x] Create `.env` with `INSTRUCTOR_PIN`, `JWT_SECRET`, `PORT`, `DB_PATH`
- [x] Write `db/schema.sql` and `db/migrate.js` (runs automatically on startup)
- [x] Stub `server.js` — registers plugins, mounts routes, runs migration

#### Verify Phase 0
- [x] `node server.js` starts without errors
- [x] SQLite file exists at `DB_PATH` after startup
- [x] All expected tables present: `sqlite3 data/chat.db ".tables"`
- [x] `curl http://localhost:3000/healthz` returns 200

### Phase 1 — Auth & sessions
- [x] `POST /instructor/login` — hash-compare PIN, return instructor JWT
- [x] `POST /session/start` — generate 4-digit PIN, insert session row, return PIN
- [x] `POST /session/end` — set `ended_at`, broadcast `session_ended` SSE event
- [x] `POST /join` — validate session PIN (session must be active), enforce username uniqueness per session, return student JWT
- [x] Fastify preHandler hooks to guard instructor vs. student routes

#### Verify Phase 1
- [x] Wrong instructor PIN → 401: `curl -X POST localhost:3000/instructor/login -H "Content-Type: application/json" -d '{"pin":"000000"}'`
- [x] Correct instructor PIN → JWT returned
- [x] `POST /session/start` with instructor JWT → 4-digit PIN in response; row in `chat_sessions` table
- [x] `POST /join` with valid session PIN + username → student JWT returned
- [x] `POST /join` with same username again → 409 conflict
- [x] `POST /join` with wrong session PIN → 401
- [x] Student JWT rejected on instructor route: `POST /session/start` with student JWT → 403
- [ ] Instructor JWT rejected on student route: `POST /message` with instructor JWT → 403 (verified in Phase 2)
- [x] `POST /session/end` with instructor JWT → session row has `ended_at` set
- [x] `POST /join` on ended session → 401

### Phase 2 — Core chat
- [ ] `lib/sse.js` — maintain a `Map` of `session_id → Set<response>`, expose `broadcast(session_id, event)`
- [ ] `GET /stream` — register client in SSE map, send heartbeat every 30s, clean up on close
- [ ] `GET /messages` — return last 50 messages for session (with reply counts and reaction counts)
- [ ] `POST /message` — insert message, broadcast `message_new`
- [ ] Reply support — accept optional `parent_id`; validate it belongs to same session

#### Verify Phase 2
- [ ] Open SSE stream in terminal: `curl -N localhost:3000/stream -H "Authorization: Bearer <student_jwt>"` — connection stays open
- [ ] Heartbeat comment (`: heartbeat`) appears in the SSE stream every 30s
- [ ] `POST /message` with student JWT → message appears in SSE stream immediately
- [ ] `GET /messages` returns the posted message with correct fields
- [ ] Post a reply with `parent_id` set → appears in `GET /messages` under parent
- [ ] Post a reply with a `parent_id` from a different session → 400/404
- [ ] Closing the curl stream (Ctrl-C) → server removes client cleanly (no crash; confirm via server logs)

### Phase 3 — Reactions
- [ ] `POST /react` — upsert/delete reaction (toggle), broadcast `reaction_update` with new counts for that message
- [ ] Aggregate reaction counts in the `/messages` response

#### Verify Phase 3
- [ ] `POST /react` with `{message_id, emoji: "👍"}` → `reaction_update` event appears in SSE stream with count 1
- [ ] Same request again (toggle off) → `reaction_update` event with count 0; row removed from `reactions` table
- [ ] `GET /messages` includes reaction counts for each message
- [ ] Two different users reacting with the same emoji → count 2; one toggles off → count 1
- [ ] Invalid emoji (not in fixed set) → 400

### Phase 4 — Polls
- [ ] `POST /poll` — insert poll, broadcast `poll_new` (options only, no vote counts)
- [ ] `POST /vote` — insert vote (enforce UNIQUE constraint), return current vote count to instructor only
- [ ] `POST /poll/:id/close` — set `closed_at`, broadcast `poll_closed` with full results
- [ ] `/messages` and SSE events include active poll state for students joining mid-session

#### Verify Phase 4
- [ ] `POST /poll` with instructor JWT → `poll_new` event appears in SSE stream; event contains options but no vote counts
- [ ] `POST /vote` with student JWT → vote recorded; second vote by same user → 409
- [ ] Vote counts visible via instructor query before poll closes; not exposed to student JWT
- [ ] `POST /poll/:id/close` → `poll_closed` event broadcast with full results including counts
- [ ] New student joins after poll created but before close → `GET /messages` (or SSE connect) includes active poll
- [ ] `POST /vote` on a closed poll → 400

### Phase 5 — Frontend (student)
- [ ] Join screen: PIN + username form → store JWT in `localStorage`
- [ ] Chat feed: render messages, replies (collapsed), reactions
- [ ] SSE listener: handle all event types, update UI reactively
- [ ] Emoji reaction bar on each message (fixed set, toggle behavior)
- [ ] Reply thread toggle — "N replies" expands inline
- [ ] Poll card: show options, submit vote, show "waiting for results" state, then show results bar chart on `poll_closed`
- [ ] Reconnect: on load, check `localStorage` for JWT; re-fetch last 50 messages; re-establish SSE

#### Verify Phase 5
- [ ] Join screen: wrong PIN shows error message; correct PIN + username advances to chat
- [ ] JWT and username present in `localStorage` after join (check via browser DevTools → Application)
- [ ] Post a message via curl → appears in browser without page reload
- [ ] React to a message → count updates immediately; click again → toggles off
- [ ] Expand reply thread → replies appear inline
- [ ] Create a poll via curl → voting card appears; vote → card shows "waiting for results"
- [ ] Close poll via curl → results bar chart appears
- [ ] Hard-reload the page → chat feed restores last 50 messages; SSE reconnects (check Network tab)
- [ ] End session via curl → student UI shows session-ended state

### Phase 6 — Frontend (instructor dashboard)
- [ ] Login screen → dashboard
- [ ] Session PIN displayed prominently with copy button
- [ ] Live message feed with timestamps (all messages, including replies)
- [ ] Create poll form (prompt + up to 4 options)
- [ ] Active poll panel: live vote counts (visible to instructor before close), close button
- [ ] End session button (with confirmation)
- [ ] Export log button — downloads JSON for current session

#### Verify Phase 6
- [ ] Wrong instructor PIN shows error; correct PIN advances to dashboard
- [ ] "Start Session" displays a 4-digit PIN; copy button copies it to clipboard
- [ ] Student posts a message via a second browser tab → appears in instructor feed with timestamp
- [ ] Create poll → poll card appears in dashboard with live vote counts
- [ ] Student votes → count increments in instructor view without reload
- [ ] Close poll → student view shows results; instructor panel reflects closed state
- [ ] "End Session" button requires confirmation before firing
- [ ] Export log downloads valid JSON containing all messages, replies, reactions, and poll results for the session

### Phase 7 — Hardening
- [ ] Rate limiting via `@fastify/rate-limit` (per IP, per route)
- [ ] Username conflict handling — reject duplicate usernames in same session with a clear error
- [ ] SSE reconnect logic on client (retry with exponential backoff)
- [ ] Validate all inputs (message length cap, poll option count, etc.)
- [ ] Ensure `DB_PATH` directory exists on startup; log a clear error if volume isn't persistent

#### Verify Phase 7
- [ ] Rapid-fire 20 `POST /message` requests → rate limiter returns 429 after threshold
- [ ] Message body exceeding length cap → 400 with descriptive error
- [ ] Poll with 5 options → 400; poll with 1 option → 400
- [ ] Kill the server mid-SSE-stream, restart it → client reconnects automatically (observe in browser Network tab)
- [ ] Start server with `DB_PATH` pointing to a non-existent directory → clear error logged, process exits

### Phase 8 — Deployment
- [ ] Write `railway.toml` or `render.yaml` config
- [ ] Document persistent disk volume setup (mount at `/data`, set `DB_PATH=/data/chat.db`)
- [ ] Add a `/healthz` route for uptime monitoring

#### Verify Phase 8
- [ ] Push to Railway/Render → deploy succeeds with no build errors
- [ ] `curl https://<deployed-url>/healthz` → 200
- [ ] Full happy path on production URL: instructor login → start session → student join → message → react → poll → end session
- [ ] Redeploy (push a trivial commit) → chat history still present after redeploy (confirms persistent volume is working)

### Phase 9 — README (user guide)
A `README.md` written for the instructor returning to this project months later with no memory of it.
- [ ] **Setup**: prerequisites (Node 20+, clone, `npm install`, copy `.env.example` → `.env`, fill in `INSTRUCTOR_PIN` and `JWT_SECRET`)
- [ ] **Running locally**: `npm start`, what URL to open
- [ ] **Running a session**: step-by-step — log in, start session, share PIN with students, create polls, close polls, end session, export log
- [ ] **Deployment**: how to push to Railway/Render, where to set env vars, persistent disk setup
- [ ] **Env var reference**: what each variable does, safe defaults vs. must-change

#### Verify Phase 9
- [ ] Follow the README from scratch on a clean machine (or a fresh clone) — server starts and a session runs end-to-end without consulting any other docs

---

## Implementation Notes

- **No nested threads** — replies are one level deep only. Simplifies both DB queries and UI.
- **Poll results hidden** — the `poll_closed` SSE event is the trigger; students never receive vote counts until then. The instructor's dashboard queries results directly.
- **SQLite concurrency** — enable WAL mode (`PRAGMA journal_mode=WAL`) for better read/write concurrency with multiple SSE connections.
- **JWT expiry** — student tokens can expire after 4 hours (reasonable lecture window). Instructor tokens after 8 hours.
- **No message deletion** — keep it simple; logs should be complete. Instructor can pin but not delete.
- **Session PIN collisions** — on `session/start`, check that the generated PIN isn't already in use by another active session (unlikely but possible).
