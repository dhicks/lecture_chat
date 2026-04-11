# TODO

## Phase 5 — Student frontend

- **Logout via username click** (`public/app.js` + new route `DELETE /session/leave`): Clicking the username badge in the chat header opens a native `<dialog>` with "Log out" and "Cancel" buttons. On log out: call `DELETE /session/leave` (removes the row from `session_users` so the username is freed), clear `localStorage`, return to join screen. Server route requires a valid student JWT; extracts `session_id` and `username` from the token claims.

- **Poll re-voting** (`public/app.js` + `routes/polls.js`): After voting, show the options again with the current selection highlighted so students can change their answer. Requires server-side change: replace INSERT in `/vote` with INSERT OR REPLACE (upsert) to allow overwriting a prior vote.

- **Dismiss poll results** (`public/app.js` PollCard): After `poll_closed` results are shown, add a "Dismiss" button so students can hide the results card without reloading.

## Phase 6 — Instructor dashboard

See CLAUDE.md for full spec.
