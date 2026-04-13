# TODO

## Phase 5 — Frontend (student)

Complete. Outstanding polish item for a future pass:

- **Poll card compaction after voting** (`public/app.js` PollCard): After voting, collapse the poll card to a compact "Change your response" button rather than showing the full form with a note. Clicking the button re-expands the form.

### Verify Phase 5
- [ ] **A11y**: run with a screen reader (VoiceOver on macOS) — new messages announced, reactions announced, poll announced, session-end announced

---

## Phase 6 — Frontend (instructor dashboard)

- [ ] **Two-column layout** (`public/instructor.html`, `public/instructor.js`): Move the message feed to the right column alongside the session/poll controls, rather than below them.
- [ ] **Previous poll results visible** (`public/instructor.js`): After a poll is closed, its results should remain visible in the instructor dashboard (not disappear). Keep a `closedPolls` list and render it below the active poll card.
- [ ] **Export old sessions** (`routes/session.js`, `public/instructor.js`): Add a `GET /sessions` endpoint listing recent sessions. In the dashboard, show a list of past sessions each with a download button that triggers the existing export endpoint.
- [ ] Ability to collapse replies in instructor UI



### Verify Phase 6
- [x] Wrong instructor PIN shows error; correct PIN advances to dashboard
- [x] "Start Session" displays a 4-digit PIN; copy button copies it to clipboard
- [x] Student posts a message via a second browser tab → appears in instructor feed with timestamp
- [x] Create poll → poll card appears in dashboard with live vote counts
- [x] Student votes → count increments in instructor view without reload
- [x] Close poll → student view shows results; instructor panel reflects closed state
- [x] "End Session" button requires confirmation before firing
- [x] Export log downloads valid JSON containing all messages, replies, reactions, and poll results for the session
- [ ] **A11y**: navigate the full instructor flow using only a keyboard — no mouse required
- [ ] **A11y**: "End Session" confirmation dialog traps focus; Escape dismisses and returns focus to the button
- [ ] **A11y**: poll results bar chart is interpretable without sight (check via screen reader or axe)

---

## Phase 7 — Hardening

- [ ] Rate limiting via `@fastify/rate-limit` (per IP, per route)
- [ ] SSE reconnect logic on client (retry with exponential backoff)
- [ ] Validate all inputs (message length cap, poll option count, etc.)
- [ ] Ensure `DB_PATH` directory exists on startup; log a clear error if volume isn't persistent

### Verify Phase 7
- [ ] Rapid-fire 20 `POST /message` requests → rate limiter returns 429 after threshold
- [ ] Message body exceeding length cap → 400 with descriptive error
- [ ] Poll with 5 options → 400; poll with 1 option → 400
- [ ] Kill the server mid-SSE-stream, restart it → client reconnects automatically (observe in browser Network tab)
- [ ] Start server with `DB_PATH` pointing to a non-existent directory → clear error logged, process exits

---

## Phase 8 — Deployment

- [ ] Write `railway.toml` or `render.yaml` config
- [ ] Document persistent disk volume setup (mount at `/data`, set `DB_PATH=/data/chat.db`)
- [ ] Add a `/healthz` route for uptime monitoring

### Verify Phase 8
- [ ] Push to Railway/Render → deploy succeeds with no build errors
- [ ] `curl https://<deployed-url>/healthz` → 200
- [ ] Full happy path on production URL: instructor login → start session → student join → message → react → poll → end session
- [ ] Redeploy (push a trivial commit) → chat history still present after redeploy (confirms persistent volume is working)

---

## Phase 9 — README (user guide)

A `README.md` written for the instructor returning to this project months later with no memory of it.

- [ ] **Setup**: prerequisites (Node 20+, clone, `npm install`, copy `.env.example` → `.env`, fill in `INSTRUCTOR_PIN` and `JWT_SECRET`)
- [ ] **Running locally**: `npm start`, what URL to open
- [ ] **Running a session**: step-by-step — log in, start session, share PIN with students, create polls, close polls, end session, export log
- [ ] **Deployment**: how to push to Railway/Render, where to set env vars, persistent disk setup
- [ ] **Env var reference**: what each variable does, safe defaults vs. must-change

### Verify Phase 9
- [ ] Follow the README from scratch on a clean machine (or a fresh clone) — server starts and a session runs end-to-end without consulting any other docs
