# SSE Real-Time Update Bug — Investigation Notes

## Symptom

SSE events (new messages, reactions, polls) sometimes fail to appear in the student view without a page reload. Behavior is intermittent.

**Sharpened 2026-09-07.** A server log captured during a failing run shows the precise shape of the failure: **the student's browser never issues `GET /stream` at all.** No request reaches the server, no error is raised, and no rate limit is hit. The instructor's stream, opened moments earlier, stays live throughout — which is why the instructor view keeps updating while the student view goes dead.

The reload that appears to "fix" it does not reconnect the stream. It repopulates the feed from `GET /messages`, so the view looks correct and is immediately stale again. That masking is why this bug has survived several investigation rounds.

A related point: if a session is active when the server is stopped, it remains active on restart.

---

## Current Status (2026-09-07)

Root cause **unknown and not reproducible on demand**. It depends on browser state: a clean Chrome and a clean Firefox both work correctly in every ordering and origin combination tried, including replays of the exact timeline from the failing server log.

Rather than continue chasing it, the failure has been made **visible**. See "Reading the connection dot" below.

---

## Ruled Out (2026-09-07 session)

Each of these was tested and disproved, not merely argued away:

1. **`/stream` rate limiting.** The failing server log contains no 429 of any kind. (The limit is real and can be triggered — 5 connections/minute per IP, easily exhausted by repeated reloads while hand-testing — but it is not what happened here.)
2. **The manual-testing reload loop.** Reproduced a 429 lockout deliberately by reloading six times in a minute; the symptoms differ from the reported ones and the server log shows the 429s.
3. **Firefox same-URL request coalescing.** Tested in real Firefox with the instructor holding `/stream` open and the student requesting the identical URL. The student connected normally.
4. **`localhost` vs `127.0.0.1` origin collision.** Tested both same-origin and cross-origin configurations in Firefox. Both worked.
5. **Server-side delivery.** Both streams receive every event when connected. Confirmed repeatedly.

---

## Separate Bug, Not a Cause of This One

`@fastify/rate-limit` keys on `req.ip`, and `server.js` sets no `trustProxy`. Behind Railway's proxy, `req.ip` is the *proxy's* address for every request, so all rate-limit buckets become global across all users: 5 `/stream` connections per minute and 12 messages per minute **for the entire class**. A lecture hall behind campus NAT has the same problem without any proxy.

This is disproved as the cause of the symptom above (no 429 in the log) but is a genuine production defect. Tracked in `TODO.md`.

---

## Changes Made (branch: `view_updating`)

1. **`public/instructor.js` — clean-close reconnect fix** — the `createSseClient` function was missing the post-loop reconnect block that `app.js` already had. When the server closes an SSE connection cleanly (`done: true`), `instructor.js` would silently drop the connection with no retry. The block was ported from `app.js`.

2. **`public/app.js` and `public/instructor.js` — console.log diagnostics** — added `[SSE:student]` / `[SSE:instructor]` logs at: connect attempt, successful connect, each received event, clean-close reconnect, and error/reconnect. The session-effect entry point in `instructor.js` also logs `session.id`.

The bug stopped manifesting after these changes, but it is not confirmed resolved — the behavior was intermittent before.

---

## Ruled Out (prior sessions)

1. **Server-side broadcast pipeline** — integration tests confirm all four SSE event types deliver correctly. Server is not dropping events.
2. **`broadcastToInstructors` dead client accumulation** — fixed in `lib/sse.js`, unit-tested.
3. **SSE client not reconnecting on clean server close (student)** — fixed in `public/app.js`.
4. **`handleSseEvent` stale closure** — not a bug; all state updates use functional updaters.
5. **`reply.hijack()` missing from stream route** — added to `routes/stream.js`; didn't resolve symptoms.
6. **`loadMessages().then(connectSse)` race** — fixed in `public/app.js`; didn't resolve symptoms.
7. **`loadMessages()` replacing state** — fixed to merge instead of overwrite; didn't resolve symptoms.

---

## Still Unconfirmed

1. **Instructor SSE not connected on initial load from localStorage** — the SSE effect depends on `[session?.id]`. The reconcile effect runs concurrently and calls `/session/active`; if that response arrives and calls `setSession()` with the same `session.id`, the effect doesn't re-run. The diagnostics added above will show whether `[SSE:instructor] session effect running` fires and whether `connecting…` follows.

2. **`/session/active` shape mismatch** — `SessionPanel` saves `{ id, pin }` but the reconcile effect receives `{ session_id, session_pin }`. The compare uses only `id`, so it likely doesn't affect behavior, but the shapes should be audited for consistency.

---

## Reading the Connection Dot

Both headers now carry a small dot showing whether the SSE stream is actually connected:

- **Solid blue disc** — connected, live updates are arriving.
- **Hollow red ring** — not connected. Anything on screen may be stale.
- **No dot at all** (instructor only) — no active session, so there is nothing to connect to.

The dot appears within about 1.5 seconds of a real disconnect; brief reconnects are deliberately not shown, to avoid flicker and repeated screen-reader announcements.

**If the bug returns, the dot answers the first question immediately: is the stream down, or is the stream up and the UI not rendering?** A red dot means the connection failed. A blue dot with a stale feed means something else is wrong, and the investigation should move to the rendering path.

## What to Check if the Bug Returns

With a red dot showing, open DevTools on the student tab:

**Console** — look for the `[SSE:student]` lines:
- No `connecting…` line at all → `connectSse()` never ran; the mount effect did not fire.
- `connecting…` with no `connected`, and nothing in the server log → the request was created but never dispatched by the browser. This is the state the original failing log implies.
- `auth rejected (401), not retrying` → the token is for an ended session; the banner should say so.

**Network tab** (turn on Persist Logs) — find the row for `stream`:
- absent → the browser never created the request
- present but pending/blocked with no status → created but never sent
- present with a status code → the server answered; the code says what happened

---

## Test Suite

`npm test` runs `test/sse.test.js` and `test/integration.test.js` (6 tests, port 3999, `/tmp/lecture_chat_integration_test.db`).
