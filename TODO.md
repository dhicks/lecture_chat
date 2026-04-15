# TODO

## Bugs

### **Intermittent: instructor and student views not always updating in real time**

Not currently manifesting on `view_updating` branch after porting the clean-close reconnect fix to `public/instructor.js` and adding SSE diagnostics to both views. Not confirmed resolved — behavior was intermittent before. Full investigation notes and console diagnostic guide: [`docs/sse-bug.md`](docs/sse-bug.md).

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

- [ ] Rate limiting via `@fastify/rate-limit` (per IP, per route)
- [x] SSE reconnect logic on client (retry with exponential backoff)
- [x] Validate all inputs (message length cap, poll option count, etc.)
- [x] Ensure `DB_PATH` directory exists on startup; log a clear error if volume isn't persistent

### Verify Phase 7
- [ ] Rapid-fire 20 `POST /message` requests → rate limiter returns 429 after threshold
- [x] Message body exceeding length cap → 400 with descriptive error (`test/hardening.test.js`)
- [x] Poll with 5 options → 400; poll with 1 option → 400 (`test/hardening.test.js`)
- [x] Kill the server mid-SSE-stream, restart it → client reconnects automatically (`test/sse.test.js`)
- [x] Start server with `DB_PATH` pointing to a non-existent directory → clear error logged, process exits (`test/hardening.test.js`)

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
