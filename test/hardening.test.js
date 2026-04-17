'use strict';

// Hardening tests: input validation and startup error handling.
//
// Input validation is already implemented in the routes; these tests prevent
// regressions. The happy paths (valid inputs returning 2xx) are covered by
// integration.test.js, so only rejection cases are tested here.
//
// SSE reconnect logic is covered by sse.test.js (lines 73-165), which verifies
// the clean-close reconnect pattern end-to-end — no gap to fill here.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { unlink } = require('node:fs/promises');
const path = require('node:path');

const TEST_DB = '/tmp/lecture_chat_hardening_test.db';

let serverProcess;
let BASE;
let iToken;
let sToken;

// ── Server fixture ────────────────────────────────────────────────────────────

before(async () => {
  serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      INSTRUCTOR_PIN: '123456',
      JWT_SECRET:     'test-hardening-secret-xyz',
      PORT:           '0',  // OS picks a free port
      DB_PATH:        TEST_DB,
    },
    stdio: 'pipe',
  });

  // Capture actual port from Fastify's JSON log line, drain stderr
  BASE = await new Promise((resolve, reject) => {
    let buf = '';
    const timeout = setTimeout(() => reject(new Error('timed out waiting for server port')), 5000);
    serverProcess.stdout.on('data', chunk => {
      buf += chunk.toString();
      for (const line of buf.split('\n')) {
        try {
          const obj = JSON.parse(line);
          const match = typeof obj.msg === 'string' && obj.msg.match(/:(\d+)$/);
          if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
        } catch {}
      }
    });
    serverProcess.on('exit', code => { clearTimeout(timeout); reject(new Error(`server exited with code ${code}`)); });
  });
  serverProcess.stderr.on('data', () => {});

  const healthRes = await fetch(`${BASE}/healthz`);
  assert.ok(healthRes.ok, 'server should be healthy before tests run');

  // Instructor token
  const loginRes = await apiPost('/instructor/login', { pin: '123456' });
  assert.equal(loginRes.status, 200, 'instructor login should succeed');
  ({ token: iToken } = await loginRes.json());

  // Active session + student token
  const sessionRes = await apiPost('/session/start', {}, iToken);
  assert.equal(sessionRes.status, 200, 'session/start should succeed');
  const { session_pin } = await sessionRes.json();

  const joinRes = await apiPost('/join', { session_pin, username: 'hardening-user' });
  assert.equal(joinRes.status, 200, 'join should succeed');
  ({ token: sToken } = await joinRes.json());
});

after(async () => {
  serverProcess?.kill();
  await unlink(TEST_DB).catch(() => {});
});

async function apiPost(route, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${BASE}${route}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

// ── POST /message — body length ───────────────────────────────────────────────

test('POST /message rejects body over 1000 characters with 400', async () => {
  const res = await apiPost('/message', { body: 'x'.repeat(1001) }, sToken);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error, 'response should include an error field');
});

test('POST /message rejects blank body with 400', async () => {
  const res = await apiPost('/message', { body: '   ' }, sToken);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error);
});

test('POST /message accepts body at exactly 1000 characters with 201', async () => {
  const res = await apiPost('/message', { body: 'y'.repeat(1000) }, sToken);
  assert.equal(res.status, 201);
});

// ── POST /poll — options count ────────────────────────────────────────────────

test('POST /poll rejects 1-option poll with 400', async () => {
  const res = await apiPost('/poll', { prompt: 'One option?', options: ['Only'] }, iToken);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error);
});

test('POST /poll rejects 5-option poll with 400', async () => {
  const res = await apiPost('/poll', {
    prompt: 'Too many?',
    options: ['A', 'B', 'C', 'D', 'E'],
  }, iToken);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error);
});

test('POST /poll rejects a poll with an empty-string option with 400', async () => {
  const res = await apiPost('/poll', {
    prompt: 'Empty option?',
    options: ['Valid', ''],
  }, iToken);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error);
});

test('POST /poll accepts 2-option poll with 201', async () => {
  const res = await apiPost('/poll', {
    prompt: `Valid 2-option poll ${Date.now()}`,
    options: ['Yes', 'No'],
  }, iToken);
  assert.equal(res.status, 201);
  // Close so the next poll test can create a new one
  const { poll } = await res.json();
  await apiPost(`/poll/${poll.id}/close`, {}, iToken);
});

test('POST /poll accepts 4-option poll with 201', async () => {
  const res = await apiPost('/poll', {
    prompt: `Valid 4-option poll ${Date.now()}`,
    options: ['A', 'B', 'C', 'D'],
  }, iToken);
  assert.equal(res.status, 201);
  const { poll } = await res.json();
  await apiPost(`/poll/${poll.id}/close`, {}, iToken);
});

test('POST /poll returns 409 when a poll is already open', async () => {
  const res1 = await apiPost('/poll', { prompt: `First poll ${Date.now()}`, options: ['Yes', 'No'] }, iToken);
  assert.equal(res1.status, 201);
  const { poll: openPoll } = await res1.json();

  const res2 = await apiPost('/poll', { prompt: 'Second poll', options: ['A', 'B'] }, iToken);
  assert.equal(res2.status, 409);
  const body = await res2.json();
  assert.ok(body.error, 'response should include an error field');

  await apiPost(`/poll/${openPoll.id}/close`, {}, iToken);
});

// ── POST /react — emoji whitelist ─────────────────────────────────────────────

test('POST /react rejects an emoji outside the allowed set with 400', async () => {
  // Need a valid message_id to reach the emoji check
  const msgRes = await apiPost('/message', { body: 'reaction target' }, sToken);
  assert.equal(msgRes.status, 201);
  const { message } = await msgRes.json();

  const res = await apiPost('/react', { message_id: message.id, emoji: '🦄' }, sToken);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error);
});

test('POST /react accepts a valid emoji with 200', async () => {
  const msgRes = await apiPost('/message', { body: 'valid reaction target' }, sToken);
  assert.equal(msgRes.status, 201);
  const { message } = await msgRes.json();

  const res = await apiPost('/react', { message_id: message.id, emoji: '👍' }, sToken);
  assert.equal(res.status, 200);
});

// ── GET /messages — my_emojis (#5) ───────────────────────────────────────────

test('GET /messages returns my_emojis for the requesting student', async () => {
  // Post a message and react to it
  const msgRes = await apiPost('/message', { body: 'my-emojis test message' }, sToken);
  assert.equal(msgRes.status, 201);
  const { message } = await msgRes.json();

  const reactRes = await apiPost('/react', { message_id: message.id, emoji: '👍' }, sToken);
  assert.equal(reactRes.status, 200);

  // Fetch messages as the same student — should see my_emojis with 👍
  const headers = { Authorization: `Bearer ${sToken}` };
  const getRes = await fetch(`${BASE}/messages`, { headers });
  assert.equal(getRes.status, 200);
  const data = await getRes.json();

  const found = data.messages.find(m => m.id === message.id);
  assert.ok(found, 'message should appear in GET /messages response');
  assert.ok(Array.isArray(found.my_emojis), 'my_emojis should be an array');
  assert.ok(found.my_emojis.includes('👍'), 'my_emojis should include 👍');
});

// ── Ghost posting after leave (#6) ────────────────────────────────────────────
// This test must run last among sToken-using tests since it leaves the session.

test('POST /message returns 403 after student has left the session', async () => {
  // Leave the session using the shared student token
  const leaveRes = await fetch(`${BASE}/session/leave`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${sToken}` },
  });
  assert.equal(leaveRes.status, 200, 'leave should succeed');

  // Attempt to post with the now-stale token — should be rejected
  const postRes = await apiPost('/message', { body: 'ghost message' }, sToken);
  assert.equal(postRes.status, 403, 'ghost post should be rejected with 403');
  const body = await postRes.json();
  assert.ok(body.error, 'response should include an error field');
});



test('server exits with code 1 and logs an error when DB_PATH directory does not exist', async () => {
  const badProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      INSTRUCTOR_PIN: '654321',
      JWT_SECRET:     'test-dbpath-secret-xyz',
      PORT:           '0',
      DB_PATH:        '/tmp/nonexistent_dir_abc123xyz/chat.db',
    },
    stdio: 'pipe',
  });

  let stderr = '';
  badProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });

  const code = await new Promise(resolve => badProcess.on('close', resolve));

  assert.equal(code, 1, 'server should exit with code 1 when DB directory is missing');
  assert.ok(
    stderr.includes('ERROR') && stderr.includes('does not exist'),
    `stderr should include an error message (got: ${stderr.slice(0, 300)})`
  );
});
