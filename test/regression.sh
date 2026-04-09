#!/usr/bin/env bash
# Regression test for lecture_chat — Phases 1–4
# Usage: bash test/regression.sh
# Must be run from the project root.

set -euo pipefail

BASE="http://localhost:3000"
SSE_LOG="/tmp/lecture_chat_sse.log"
BODY="/tmp/lecture_chat_body.json"
FAILURES=0
SERVER_PID=""

# ── helpers ────────────────────────────────────────────────────────────────────

check() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS: $label"
  else
    echo "FAIL: $label  (expected=$expected  got=$actual)"
    FAILURES=$((FAILURES + 1))
  fi
}

# Returns HTTP status code; body goes to $BODY
http() {
  local method="$1"; shift
  curl -s -o "$BODY" -w "%{http_code}" -X "$method" "$@"
}

# grep SSE log for a JSON event matching a jq filter (returns 0/1)
sse_has() {
  local filter="$1"
  grep -o 'data: .*' "$SSE_LOG" 2>/dev/null \
    | sed 's/^data: //' \
    | jq -e "$filter" >/dev/null 2>&1
}

cleanup() {
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
  # kill any leftover SSE curl
  pkill -f "curl.*stream" 2>/dev/null || true
}
trap cleanup EXIT

# ── start server ───────────────────────────────────────────────────────────────

echo "── Setup ──────────────────────────────────────────────────────────────────"
pkill -f "node server.js" 2>/dev/null || true
sleep 0.5
rm -f data/chat.db

node server.js >/tmp/lecture_chat_server.log 2>&1 &
SERVER_PID=$!

# wait for server to be ready
for i in $(seq 1 20); do
  curl -sf "$BASE/healthz" >/dev/null 2>&1 && break
  sleep 0.3
done
echo "Server PID $SERVER_PID ready"

# ── Phase 0 ────────────────────────────────────────────────────────────────────

echo ""
echo "── Phase 0: project setup ─────────────────────────────────────────────────"

STATUS=$(http GET "$BASE/healthz")
check "healthz → 200" "200" "$STATUS"

TABLES=$(sqlite3 data/chat.db ".tables" 2>/dev/null | tr ' ' '\n' | sort | tr '\n' ' ' | xargs)
for tbl in chat_sessions instructor messages poll_votes polls reactions session_users; do
  [[ "$TABLES" == *"$tbl"* ]] \
    && echo "PASS: table $tbl exists" \
    || { echo "FAIL: table $tbl missing"; FAILURES=$((FAILURES + 1)); }
done

# ── Auth setup ─────────────────────────────────────────────────────────────────

echo ""
echo "── Phase 1: auth & sessions ───────────────────────────────────────────────"

STATUS=$(http POST "$BASE/instructor/login" -H "Content-Type: application/json" -d '{"pin":"000000"}')
check "wrong instructor PIN → 401" "401" "$STATUS"

STATUS=$(http POST "$BASE/instructor/login" -H "Content-Type: application/json" -d '{"pin":"123456"}')
check "correct instructor PIN → 200" "200" "$STATUS"
INST=$(jq -r .token "$BODY")
[[ -n "$INST" && "$INST" != "null" ]] \
  && echo "PASS: instructor JWT returned" \
  || { echo "FAIL: instructor JWT missing"; FAILURES=$((FAILURES + 1)); }

STATUS=$(http POST "$BASE/session/start" -H "Authorization: Bearer $INST")
check "session/start → 200" "200" "$STATUS"
PIN=$(jq -r .session_pin "$BODY")
SESSION_ID=$(jq -r .session_id "$BODY")
[[ "$PIN" =~ ^[0-9]{4}$ ]] \
  && echo "PASS: 4-digit PIN returned ($PIN)" \
  || { echo "FAIL: PIN not 4 digits ($PIN)"; FAILURES=$((FAILURES + 1)); }

STATUS=$(http POST "$BASE/join" -H "Content-Type: application/json" \
  -d "{\"session_pin\":\"$PIN\",\"username\":\"alice\"}")
check "/join valid → 200" "200" "$STATUS"
STU_ALICE=$(jq -r .token "$BODY")

STATUS=$(http POST "$BASE/join" -H "Content-Type: application/json" \
  -d "{\"session_pin\":\"$PIN\",\"username\":\"alice\"}")
check "/join duplicate username → 409" "409" "$STATUS"

STATUS=$(http POST "$BASE/join" -H "Content-Type: application/json" \
  -d '{"session_pin":"0000","username":"nobody"}')
check "/join wrong PIN → 401" "401" "$STATUS"

STATUS=$(http POST "$BASE/session/start" -H "Authorization: Bearer $STU_ALICE")
check "student JWT on instructor route → 403" "403" "$STATUS"

STATUS=$(http POST "$BASE/message" -H "Authorization: Bearer $INST" \
  -H "Content-Type: application/json" -d '{"body":"hi"}')
check "instructor JWT on student route → 403" "403" "$STATUS"

# join bob before opening SSE
STATUS=$(http POST "$BASE/join" -H "Content-Type: application/json" \
  -d "{\"session_pin\":\"$PIN\",\"username\":\"bob\"}")
check "/join bob → 200" "200" "$STATUS"
STU_BOB=$(jq -r .token "$BODY")

# ── Open SSE stream ────────────────────────────────────────────────────────────

echo ""
echo "── Opening SSE stream (alice) ─────────────────────────────────────────────"
> "$SSE_LOG"
curl -sN "$BASE/stream" -H "Authorization: Bearer $STU_ALICE" >> "$SSE_LOG" 2>&1 &
SSE_CURL_PID=$!
sleep 0.5
grep -q "connected" "$SSE_LOG" \
  && echo "PASS: SSE stream connected" \
  || { echo "FAIL: SSE stream did not connect"; FAILURES=$((FAILURES + 1)); }
echo "(skipping: heartbeat 30s — manual verification required)"

# ── Phase 2: core chat ─────────────────────────────────────────────────────────

echo ""
echo "── Phase 2: core chat ─────────────────────────────────────────────────────"

STATUS=$(http POST "$BASE/message" -H "Authorization: Bearer $STU_ALICE" \
  -H "Content-Type: application/json" -d '{"body":"Hello world"}')
check "POST /message → 201" "201" "$STATUS"
MSG_ID=$(jq -r .message.id "$BODY")
sleep 0.3
sse_has ".type == \"message_new\" and .message.body == \"Hello world\"" \
  && echo "PASS: message_new in SSE log" \
  || { echo "FAIL: message_new not in SSE log"; FAILURES=$((FAILURES + 1)); }

STATUS=$(http GET "$BASE/messages" -H "Authorization: Bearer $STU_ALICE")
check "GET /messages → 200" "200" "$STATUS"
GOT_BODY=$(jq -r ".messages[] | select(.id == $MSG_ID) | .body" "$BODY")
check "GET /messages contains posted message" "Hello world" "$GOT_BODY"

# reply in-session
STATUS=$(http POST "$BASE/message" -H "Authorization: Bearer $STU_BOB" \
  -H "Content-Type: application/json" \
  -d "{\"body\":\"reply here\",\"parent_id\":$MSG_ID}")
check "reply with valid parent_id → 201" "201" "$STATUS"
REPLY_ID=$(jq -r .message.id "$BODY")

STATUS=$(http GET "$BASE/messages" -H "Authorization: Bearer $STU_ALICE")
REPLY_FOUND=$(jq -r ".messages[] | select(.id == $MSG_ID) | .replies[] | select(.id == $REPLY_ID) | .id" "$BODY")
check "reply grouped under parent in GET /messages" "$REPLY_ID" "$REPLY_FOUND"

# cross-session: create a second session and get a message id from it
STATUS2=$(http POST "$BASE/instructor/login" -H "Content-Type: application/json" -d '{"pin":"123456"}')
INST2=$(jq -r .token "$BODY")
http POST "$BASE/session/start" -H "Authorization: Bearer $INST2" >/dev/null
PIN2=$(jq -r .session_pin "$BODY")
http POST "$BASE/join" -H "Content-Type: application/json" \
  -d "{\"session_pin\":\"$PIN2\",\"username\":\"charlie\"}" >/dev/null
STU_CHARLIE=$(jq -r .token "$BODY")
http POST "$BASE/message" -H "Authorization: Bearer $STU_CHARLIE" \
  -H "Content-Type: application/json" -d '{"body":"other session"}' >/dev/null
OTHER_MSG_ID=$(jq -r .message.id "$BODY")

STATUS=$(http POST "$BASE/message" -H "Authorization: Bearer $STU_ALICE" \
  -H "Content-Type: application/json" \
  -d "{\"body\":\"bad reply\",\"parent_id\":$OTHER_MSG_ID}")
check "reply to msg in different session → 400" "400" "$STATUS"

# ── Phase 3: reactions ─────────────────────────────────────────────────────────

echo ""
echo "── Phase 3: reactions ─────────────────────────────────────────────────────"

STATUS=$(http POST "$BASE/react" -H "Authorization: Bearer $STU_ALICE" \
  -H "Content-Type: application/json" \
  -d "{\"message_id\":$MSG_ID,\"emoji\":\"👍\"}")
check "POST /react 👍 → 200" "200" "$STATUS"
sleep 0.3
sse_has ".type == \"reaction_update\" and .message_id == $MSG_ID and .reactions[\"👍\"] == 1" \
  && echo "PASS: reaction_update count=1 in SSE log" \
  || { echo "FAIL: reaction_update count=1 not in SSE log"; FAILURES=$((FAILURES + 1)); }

# toggle off
STATUS=$(http POST "$BASE/react" -H "Authorization: Bearer $STU_ALICE" \
  -H "Content-Type: application/json" \
  -d "{\"message_id\":$MSG_ID,\"emoji\":\"👍\"}")
check "toggle 👍 off → 200" "200" "$STATUS"
sleep 0.3
sse_has ".type == \"reaction_update\" and .message_id == $MSG_ID and (.reactions[\"👍\"] == 0 or .reactions[\"👍\"] == null)" \
  && echo "PASS: reaction_update count=0 in SSE log" \
  || { echo "FAIL: reaction_update count=0 not in SSE log"; FAILURES=$((FAILURES + 1)); }
ROW_COUNT=$(sqlite3 data/chat.db \
  "SELECT COUNT(*) FROM reactions WHERE message_id=$MSG_ID AND username='alice' AND emoji='👍';")
check "reaction row removed from DB" "0" "$ROW_COUNT"

# two users react, one toggles off
http POST "$BASE/react" -H "Authorization: Bearer $STU_ALICE" \
  -H "Content-Type: application/json" -d "{\"message_id\":$MSG_ID,\"emoji\":\"👍\"}" >/dev/null
http POST "$BASE/react" -H "Authorization: Bearer $STU_BOB" \
  -H "Content-Type: application/json" -d "{\"message_id\":$MSG_ID,\"emoji\":\"👍\"}" >/dev/null
sleep 0.3
sse_has ".type == \"reaction_update\" and .reactions[\"👍\"] == 2" \
  && echo "PASS: two users → count=2 in SSE log" \
  || { echo "FAIL: count=2 not in SSE log"; FAILURES=$((FAILURES + 1)); }

http POST "$BASE/react" -H "Authorization: Bearer $STU_BOB" \
  -H "Content-Type: application/json" -d "{\"message_id\":$MSG_ID,\"emoji\":\"👍\"}" >/dev/null
sleep 0.3
sse_has ".type == \"reaction_update\" and .reactions[\"👍\"] == 1" \
  && echo "PASS: bob toggles off → count=1 in SSE log" \
  || { echo "FAIL: count=1 not seen in SSE log"; FAILURES=$((FAILURES + 1)); }

STATUS=$(http GET "$BASE/messages" -H "Authorization: Bearer $STU_ALICE")
RXCOUNT=$(jq -r ".messages[] | select(.id == $MSG_ID) | .reactions[\"👍\"]" "$BODY")
check "GET /messages reaction count=1" "1" "$RXCOUNT"

STATUS=$(http POST "$BASE/react" -H "Authorization: Bearer $STU_ALICE" \
  -H "Content-Type: application/json" \
  -d "{\"message_id\":$MSG_ID,\"emoji\":\"🚫\"}")
check "invalid emoji → 400" "400" "$STATUS"

# ── Phase 4: polls ─────────────────────────────────────────────────────────────

echo ""
echo "── Phase 4: polls ─────────────────────────────────────────────────────────"

STATUS=$(http POST "$BASE/poll" -H "Authorization: Bearer $STU_ALICE" \
  -H "Content-Type: application/json" -d '{"prompt":"X","options":["A","B"]}')
check "student JWT on /poll → 403" "403" "$STATUS"

STATUS=$(http POST "$BASE/poll" -H "Authorization: Bearer $INST" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Too many","options":["A","B","C","D","E"]}')
check "/poll 5 options → 400" "400" "$STATUS"

STATUS=$(http POST "$BASE/poll" -H "Authorization: Bearer $INST" \
  -H "Content-Type: application/json" -d '{"prompt":"Too few","options":["A"]}')
check "/poll 1 option → 400" "400" "$STATUS"

STATUS=$(http POST "$BASE/poll" -H "Authorization: Bearer $INST" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Best language?","options":["Python","JS","Rust"]}')
check "POST /poll valid → 201" "201" "$STATUS"
POLL_ID=$(jq -r .poll.id "$BODY")
# confirm no results key in response
HAS_RESULTS=$(jq 'has("results")' "$BODY")
check "POST /poll response has no top-level results" "false" "$HAS_RESULTS"
sleep 0.3
sse_has ".type == \"poll_new\" and .poll.id == $POLL_ID and (.poll | has(\"results\") | not)" \
  && echo "PASS: poll_new in SSE (no results)" \
  || { echo "FAIL: poll_new not in SSE or has results"; FAILURES=$((FAILURES + 1)); }

STATUS=$(http GET "$BASE/messages" -H "Authorization: Bearer $STU_ALICE")
AP_ID=$(jq -r ".active_poll.id" "$BODY")
check "GET /messages active_poll present" "$POLL_ID" "$AP_ID"
AP_RESULTS=$(jq '.active_poll | has("results")' "$BODY")
check "active_poll has no results key" "false" "$AP_RESULTS"

STATUS=$(http POST "$BASE/vote" -H "Authorization: Bearer $STU_ALICE" \
  -H "Content-Type: application/json" -d "{\"poll_id\":$POLL_ID,\"choice\":0}")
check "POST /vote → 201" "201" "$STATUS"

STATUS=$(http POST "$BASE/vote" -H "Authorization: Bearer $STU_ALICE" \
  -H "Content-Type: application/json" -d "{\"poll_id\":$POLL_ID,\"choice\":1}")
check "POST /vote duplicate → 409" "409" "$STATUS"

# vote with poll from different session
# insert a poll directly into a fake session to avoid multi-session ambiguity in the API
OTHER_POLL_ID=$(sqlite3 data/chat.db \
  "INSERT INTO polls (session_id, prompt, options) VALUES (9999, 'Phantom', '[\"X\",\"Y\"]'); SELECT last_insert_rowid();")
STATUS=$(http POST "$BASE/vote" -H "Authorization: Bearer $STU_ALICE" \
  -H "Content-Type: application/json" -d "{\"poll_id\":$OTHER_POLL_ID,\"choice\":0}")
check "vote on poll from different session → 404" "404" "$STATUS"

STATUS=$(http POST "$BASE/vote" -H "Authorization: Bearer $STU_ALICE" \
  -H "Content-Type: application/json" -d "{\"poll_id\":$POLL_ID,\"choice\":99}")
check "vote invalid choice index → 400" "400" "$STATUS"

http POST "$BASE/vote" -H "Authorization: Bearer $STU_BOB" \
  -H "Content-Type: application/json" -d "{\"poll_id\":$POLL_ID,\"choice\":0}" >/dev/null

STATUS=$(http POST "$BASE/poll/$POLL_ID/close" -H "Authorization: Bearer $INST")
check "POST /poll/:id/close → 200" "200" "$STATUS"
CLOSE_RESULTS=$(jq '.poll.results | length' "$BODY")
check "close response has results array" "3" "$CLOSE_RESULTS"
PY_VOTES=$(jq -r '.poll.results[] | select(.option == "Python") | .votes' "$BODY")
check "Python vote count = 2" "2" "$PY_VOTES"
sleep 0.3
sse_has ".type == \"poll_closed\" and .poll.id == $POLL_ID and (.poll.results | length) == 3" \
  && echo "PASS: poll_closed in SSE with results" \
  || { echo "FAIL: poll_closed not in SSE or missing results"; FAILURES=$((FAILURES + 1)); }

STATUS=$(http GET "$BASE/messages" -H "Authorization: Bearer $STU_ALICE")
AP_AFTER=$(jq '.active_poll' "$BODY")
check "active_poll null after close" "null" "$AP_AFTER"

STATUS=$(http POST "$BASE/vote" -H "Authorization: Bearer $STU_BOB" \
  -H "Content-Type: application/json" -d "{\"poll_id\":$POLL_ID,\"choice\":2}")
check "vote on closed poll → 400" "400" "$STATUS"

# new open poll — mid-session join
STATUS=$(http POST "$BASE/poll" -H "Authorization: Bearer $INST" \
  -H "Content-Type: application/json" -d '{"prompt":"Cats or dogs?","options":["Cats","Dogs"]}')
POLL2_ID=$(jq -r .poll.id "$BODY")
http POST "$BASE/join" -H "Content-Type: application/json" \
  -d "{\"session_pin\":\"$PIN\",\"username\":\"diana\"}" >/dev/null
STU_DIANA=$(jq -r .token "$BODY")
STATUS=$(http GET "$BASE/messages" -H "Authorization: Bearer $STU_DIANA")
AP2_ID=$(jq -r ".active_poll.id" "$BODY")
check "mid-session joiner sees active_poll" "$POLL2_ID" "$AP2_ID"

# ── Phase 1: session end (last) ────────────────────────────────────────────────

echo ""
echo "── Phase 1: session end ───────────────────────────────────────────────────"

# end session 2 (charlie's) first — doesn't affect our primary session
http POST "$BASE/session/start" -H "Authorization: Bearer $INST" >/dev/null  # ignored, already ended
STATUS=$(http POST "$BASE/session/end" -H "Authorization: Bearer $INST")
check "POST /session/end → 200" "200" "$STATUS"
sleep 0.3
sse_has ".type == \"session_ended\"" \
  && echo "PASS: session_ended in SSE log" \
  || { echo "FAIL: session_ended not in SSE log"; FAILURES=$((FAILURES + 1)); }

ENDED=$(sqlite3 data/chat.db \
  "SELECT ended_at IS NOT NULL FROM chat_sessions WHERE id=$SESSION_ID;")
check "session row has ended_at set" "1" "$ENDED"

STATUS=$(http POST "$BASE/join" -H "Content-Type: application/json" \
  -d "{\"session_pin\":\"$PIN\",\"username\":\"latecomer\"}")
check "/join on ended session → 401" "401" "$STATUS"

echo "(skipping: SSE cleanup on disconnect — manual verification required)"

# ── Summary ────────────────────────────────────────────────────────────────────

echo ""
echo "───────────────────────────────────────────────────────────────────────────"
if [[ $FAILURES -eq 0 ]]; then
  echo "All checks passed."
  exit 0
else
  echo "$FAILURES check(s) FAILED."
  exit 1
fi
