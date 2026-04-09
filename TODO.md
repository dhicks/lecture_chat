# Pre-UI Bug Fixes

## Bugs

- [x] **SSE broadcast crash on broken client** (`lib/sse.js:21`): Fixed — each `reply.raw.write` is now wrapped in try/catch, dead client removed on failure.

- [x] **Students can post messages and reactions to ended sessions** (`routes/messages.js:90`, `routes/reactions.js:22`): Fixed — both routes now check `ended_at` before proceeding.

- [x] **Multiple active sessions can exist simultaneously** (`routes/session.js:11`): Fixed — `POST /start` now returns 409 if a session is already active.

- [x] **Poll creation not tied to a specific session** (`routes/polls.js:23`): Fixed — query now uses `ORDER BY started_at DESC LIMIT 1`, and the multiple-sessions guard makes this safe.

## Potential Issues

- [x] **`JWT_SECRET` undefined is only a warning, not a fatal error** (`server.js:22`): Fixed — now exits with error like `INSTRUCTOR_PIN`.

- [x] **Rejoining after clearing localStorage is impossible** (`routes/auth.js:49`): Fixed — on UNIQUE conflict, a new JWT is issued for the existing username.

- [x] **`message_id` validation inconsistent with `poll_id` validation** (`routes/reactions.js:15`): Fixed — now uses `isNaN(Number(message_id))`, consistent with polls.

## Minor

- [x] **SSE heartbeat doesn't catch write errors** (`routes/stream.js:20`): Fixed — try/catch added, clears interval and removes client on failure.

---

## Remaining Issues (found in second review)

- [x] **`POST /vote` doesn't check if session has ended** (`routes/polls.js:63`): Fixed — added the same `ended_at` check as `POST /message` and `POST /react`; returns 403 if session has ended.

- [~] **Rejoin allows username impersonation** (`routes/auth.js:49-58`): Accepted risk — in the lecture context, impersonation is low-stakes and the original student is never locked out (both devices receive valid JWTs). No action taken.
