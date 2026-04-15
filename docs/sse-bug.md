# SSE Real-Time Update Bug — Investigation Notes

## Symptom

SSE events (new messages, reactions, polls) sometimes fail to appear in student and instructor views without a page reload. Behavior is intermittent — present consistently on `main`, not observed on `view_updating` after the fixes below.

A related point: if a session is active when the server is stopped, it remains active on restart.

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

## What to Check if Bug Returns

Open browser DevTools console on both tabs. Look for:
- `[SSE:instructor] session effect running, session.id= X` — did the effect fire at all?
- `[SSE:instructor] connecting…` — did `createSseClient` get called?
- `[SSE:instructor] connected` — did the HTTP handshake succeed?
- `[SSE:instructor] event: {…}` — are events arriving but the UI not updating?
- `[SSE:instructor] clean close, reconnecting…` — did a server restart trigger a reconnect?

The diagnostics remain in place; no additional instrumentation is needed.

---

## Test Suite

`npm test` runs `test/sse.test.js` and `test/integration.test.js` (6 tests, port 3999, `/tmp/lecture_chat_integration_test.db`).
