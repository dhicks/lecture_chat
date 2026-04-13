# TODO

## Phase 5 — Frontend (student)

Complete. Outstanding polish item for a future pass:

- **Poll card compaction after voting** (`public/app.js` PollCard): After voting, collapse the poll card to a compact "Change your response" button rather than showing the full form with a note. Clicking the button re-expands the form.

### Verify Phase 5
- [x] Join screen: wrong PIN shows error message; correct PIN + username advances to chat
- [x] JWT and username present in `localStorage` after join
- [x] Post a message via curl → appears in browser without page reload
- [x] React to a message → count updates immediately; click again → toggles off
- [x] Expand reply thread → replies appear inline
- [x] Create a poll via curl → voting card appears; vote → card shows "waiting for results"
- [x] Close poll via curl → results bar chart appears
- [x] Hard-reload the page → chat feed restores last 50 messages; SSE reconnects
- [x] End session via curl → student UI shows session-ended state
- [x] **A11y**: navigate the full student flow using only a keyboard (Tab, Enter, Space) — no mouse required
- [x] Poll re-voting: vote → change answer → close poll → results reflect last vote
- [x] Dismiss poll results: close poll → "Dismiss" button hides results card
- [x] Logout: click username badge → dialog → "Log out" → localStorage cleared → join screen → rejoin with same username succeeds
- [ ] **A11y**: run with a screen reader (VoiceOver on macOS) — new messages announced, reactions announced, poll announced, session-end announced

---

## Phase 6 — Frontend (instructor dashboard)

- [x] Login screen → dashboard
- [x] Session PIN displayed prominently with copy button
- [x] Live message feed with timestamps (all messages, including replies)
- [x] Create poll form (prompt + up to 4 options)
- [x] Active poll panel: live vote counts (visible to instructor before close), close button
- [x] End session button (with confirmation)
- [x] Export log button — downloads JSON for current session
- [x] **A11y**: same semantic HTML and live region requirements as student frontend
- [x] **A11y**: live vote count updates announced via `aria-live="polite"` region (not the count inline, which would be too noisy — a summary region)
- [x] **A11y**: "End Session" confirmation dialog is a proper `<dialog>` element with focus trapped inside and returned to trigger button on dismiss
- [x] **A11y**: poll results bar chart has a text/table alternative (e.g., visually-hidden `<table>` or `aria-label` with percentages on each bar)

- [ ] **Two-column layout** (`public/instructor.html`, `public/instructor.js`): Move the message feed to the right column alongside the session/poll controls, rather than below them.
- [ ] **Previous poll results visible** (`public/instructor.js`): After a poll is closed, its results should remain visible in the instructor dashboard (not disappear). Keep a `closedPolls` list and render it below the active poll card.
- [ ] **Export old sessions** (`routes/session.js`, `public/instructor.js`): Add a `GET /sessions` endpoint listing recent sessions. In the dashboard, show a list of past sessions each with a download button that triggers the existing export endpoint.
- [ ] Ability to collapse replies in instructor UI



### Verify Phase 6
- [ ] Wrong instructor PIN shows error; correct PIN advances to dashboard
- [ ] "Start Session" displays a 4-digit PIN; copy button copies it to clipboard
- [ ] Student posts a message via a second browser tab → appears in instructor feed with timestamp
- [ ] Create poll → poll card appears in dashboard with live vote counts
- [ ] Student votes → count increments in instructor view without reload
- [ ] Close poll → student view shows results; instructor panel reflects closed state
- [ ] "End Session" button requires confirmation before firing
- [ ] Export log downloads valid JSON containing all messages, replies, reactions, and poll results for the session
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
