# TODO

## Bugs

### **Intermittent: student view not always updating in real time**

Root cause still **unknown**. Narrowed considerably: a failing server log shows the student's browser never issues `GET /stream` at all — no request, no error, no rate limit. Not reproducible on demand; clean Chrome and clean Firefox both work.

Not fixed, but no longer silent: both views now show a connection dot (blue = connected, red = not), so the next occurrence is visible immediately and distinguishes "stream is down" from "stream is up but the UI isn't rendering". Ruled-out hypotheses and a diagnostic guide: [`docs/sse-bug.md`](docs/sse-bug.md).

- [ ] Capture DevTools console + Network evidence from the student tab the next time a red dot appears during a real session

### Rate limiting is keyed per IP, not per user

`@fastify/rate-limit` uses `req.ip` and `server.js` sets no `trustProxy`. Behind Railway's proxy every request carries the proxy's address, so all buckets are shared by the whole class: 5 `/stream` connections/min and 12 messages/min **total**. Same problem for a lecture hall behind campus NAT. Not the cause of the bug above (no 429 in the failing log), but a real production defect.

- [ ] Set `trustProxy` in `server.js` so limits apply per student
- [ ] Re-tune the `/stream` limit — request count is a poor fit for a long-lived stream

### Smaller gaps found alongside the SSE work

- [ ] `GET /messages` has no `ended_at` check for students, so a leftover tab still renders a stale feed on load (`/stream` now rejects these with 401, so the banner covers it)
- [ ] `GET /stream` does not check `session_users` membership, so a student who used `DELETE /session/leave` can still open a stream on a live session (`routes/messages.js:152` guards this correctly)
- [ ] Graceful shutdown hangs: the `SIGTERM`/`SIGINT` handler awaits `app.close()`, which never resolves while hijacked SSE responses are open. Needs the open streams closed first.
- [ ] `lib/sse.js` `broadcast()` detects dead clients by catching a throw from `reply.raw.write()`, but Node returns `false` and emits `'error'` asynchronously instead of throwing — so that cleanup path never runs in production. Cleanup currently happens only via `req.raw.on('close')`. The unit test passes because its mock throws.

---

## Phase 5 — Frontend (student)
### Verify Phase 5
- [ ] **A11y**: run with a screen reader (VoiceOver on macOS) — new messages announced, reactions announced, poll announced, session-end announced

---

## Phase 6 — Frontend (instructor dashboard)
### Verify Phase 6
- [ ] **A11y**: poll results bar chart is interpretable without sight (check via screen reader or axe)
- [ ] **A11y**: message panel is interpretable without sight (check via screen reader or axe)

---

## Phase 7 — Hardening

- [x] Rate limiting via `@fastify/rate-limit` (per IP, per route)
- [x] SSE reconnect logic on client (retry with exponential backoff)
- [x] Validate all inputs (message length cap, poll option count, etc.)
- [x] Ensure `DB_PATH` directory exists on startup; log a clear error if volume isn't persistent

### Verify Phase 7
- [x] Rapid-fire `POST /message` requests → rate limiter returns 429 after 12/min (1 per 5s)
- [x] Message body exceeding length cap → 400 with descriptive error (`test/hardening.test.js`)
- [x] Poll with 13 options → 400; poll with 1 option → 400 (`test/hardening.test.js`)
- [x] Kill the server mid-SSE-stream, restart it → client reconnects automatically (`test/sse.test.js`)
- [x] Start server with `DB_PATH` pointing to a non-existent directory → clear error logged, process exits (`test/hardening.test.js`)

---

## Testing Notes

- `test/regression.sh` is not wired into `npm test` — run it manually before deploy to exercise the full happy-path end-to-end flow.

---

## Phase 8 — Deployment

- [x] Write `railway.toml` or `render.yaml` config
- [x] Document persistent disk volume setup (mount at `/data`, set `DB_PATH=/data/chat.db`)
- [x] Add a `/healthz` route for uptime monitoring

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
