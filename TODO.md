# TODO

## Bugs

- **Regression: `POST /join` duplicate username returns 409 instead of 200** — `test/regression.sh` expects a student rejoining with the same username to get a fresh JWT (200); server currently rejects with 409 "Username already taken". Needs investigation in `routes/auth.js`.

- **Regression: `POST /vote` duplicate returns 201 instead of 409; vote counts wrong** — test expects a second vote from the same user to be rejected (409); server returns 201 and silently replaces the prior vote (`INSERT OR REPLACE` in `routes/polls.js`). Related to the Phase 5 "poll re-voting" polish item — need to decide intended behavior and align the implementation and test.

- **Intermittent: student view not updating in real time** — SSE events (new messages, reactions, polls) sometimes fail to appear on the student side without a page reload. Observed 2026-04-12 evening, stopped, then recurred 2026-04-13 morning. Needs a reliable reproduction case before attempting a fix. Suspected areas: SSE reconnect logic in `public/app.js` `createSseClient`, or the server-side broadcast in `lib/sse.js` dropping clients silently.

---

## Phase 5 — Frontend (student)

Complete. Outstanding polish item for a future pass:

- **Poll card compaction after voting** (`public/app.js` PollCard): After voting, collapse the poll card to a compact "Change your response" button rather than showing the full form with a note. Clicking the button re-expands the form.

### Verify Phase 5
- [ ] **A11y**: run with a screen reader (VoiceOver on macOS) — new messages announced, reactions announced, poll announced, session-end announced

---

## Phase 6 — Frontend (instructor dashboard)

- [x] **Two-column layout** (`public/instructor.html`, `public/instructor.js`): Move the message feed to the right column alongside the session/poll controls, rather than below them.
- [x] **Previous poll results visible** (`public/instructor.js`): After a poll is closed, its results should remain visible in the instructor dashboard (not disappear). Keep a `closedPolls` list and render it below the active poll card.
- [x] **Export old sessions** (`routes/session.js`, `public/instructor.js`): Add a `GET /sessions` endpoint listing recent sessions. In the dashboard, show a list of past sessions each with a download button that triggers the existing export endpoint.
- [x] Ability to collapse replies in instructor message feed



### Verify Phase 6
- [x] **A11y**: navigate the full instructor flow using only a keyboard — no mouse required
- [x] **A11y**: "End Session" confirmation dialog traps focus; Escape dismisses and returns focus to the button
- [ ] **A11y**: poll results bar chart is interpretable without sight (check via screen reader or axe)
- [ ] **A11y**: message panel is interpretable without sight (check via screen reader or axe)

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
