# TODO

## Bugs

### **Intermittent: instructor and student views not always updating in real time** 

SSE events (new messages, reactions, polls) sometimes fail to appear without a page reload. This behavior appears to start and stop inconsistently. A potentially related point is that, if a session is active when the server is stopped, that session will be active when the server is restarted. 

Previous Claude Code sessions have considered the following causes: 

#### Ruled out (code changes made, browser issue persists)

1. **Server-side broadcast pipeline** — integration tests confirm all four SSE event types deliver correctly via Node's `fetch` + `ReadableStream` against the real Fastify server. Server is not dropping events.

2. **`broadcastToInstructors` dead client accumulation** — fixed (`lib/sse.js`), unit-tested, confirmed working.

3. **SSE client not reconnecting on clean server close** — fixed in `public/app.js` (post-loop reconnect block added), unit-tested, confirmed working.

4. **`handleSseEvent` stale closure** — analyzed; not a bug. All state updates use functional updaters (`setMessages(prev => ...)`), so the empty-dep `useCallback` is safe.

5. **`reply.hijack()` missing from stream route** — added to `routes/stream.js`; didn't resolve browser symptoms.

6. **`loadMessages().then(connectSse)` race** — fixed in `public/app.js`; SSE now registers before the message-fetch begins. Didn't resolve browser symptoms.

7. **`loadMessages()` replacing state** — fixed to merge instead of overwrite. Didn't resolve browser symptoms.

#### Identified, not yet tested

1. **Instructor's `createSseClient` missing the clean-close reconnect fix** — `public/instructor.js:89–94` only reconnects in the `catch` block; the `done: true` (clean close) path breaks out of the loop with no reconnect. The fix was applied to `app.js` but never ported to `instructor.js`.

2. **Instructor SSE not connected on initial load from localStorage** — the SSE effect (line 954) depends on `[session?.id]`. But the reconcile effect (line 877) runs concurrently and calls `/session/active`; if that response arrives and calls `setSession()` with the same `session.id`, the effect doesn't re-run. It's unclear whether the instructor's SSE is actually registered with the server by the time messages are being broadcast. No logging or diagnostics have been added to confirm.

3. **`/session/active` returns `{ id, pin }` but localStorage session was saved as `{ id, session_pin }`** — `SessionPanel` saves `{ id: data.session_id, pin: data.session_pin }` (line 243). The reconcile compare is `session.id !== serverSession.id`, which uses only `id`, so this mismatch wouldn't affect the comparison — but worth confirming the shapes are consistent throughout.

4. **Root cause of browser-specific failures still unknown** — all server-side tests pass; the bug is confirmed frontend-only, but no browser-side diagnostics (console logs on SSE connect/disconnect/event receipt) have been added to pinpoint exactly where the failure occurs.

#### Additional notes from previous sessions

##### What's already been changed (don't re-investigate or revert)

- `routes/stream.js` — `reply.hijack()` added before `reply.raw.writeHead()`
- `public/app.js` — `connectSse()` now called before `loadMessages()` in the mount effect; `loadMessages()` merges state instead of replacing it
- `public/app.js` — clean-close reconnect fix (post-loop reconnect block in `createSseClient`)
- `lib/sse.js` — `broadcastToInstructors` now removes dead clients on write failure
- `test/sse.test.js` and `test/integration.test.js` — new test files; `npm test` runs all 6 and passes

##### Recommended first step

Add `console.log` diagnostics in both `createSseClient` functions (connect attempt, successful connect, disconnect/error, each received event) before making any more code changes. The symptoms haven't been directly observed at the JS level — only inferred from UI behavior. Diagnostics should confirm whether SSE is connecting at all, disconnecting unexpectedly, or connecting but not receiving events.

##### Key symptom (reported after the fixes above were applied)

The problem is most visible after server restart with stale localStorage:
- Student view works correctly
- Instructor view requires a page refresh to see student posts
- Switching to a fresh browser (no localStorage) works correctly

This strongly suggests the bug is in the instructor dashboard's initialization path when restoring from localStorage, not in the general SSE machinery.

##### Test suite

`npm test` runs `test/sse.test.js` and `test/integration.test.js`. The integration tests use port 3999 and `/tmp/lecture_chat_integration_test.db` to avoid colliding with a running dev server.



---

## Phase 5 — Frontend (student)

Complete.

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
