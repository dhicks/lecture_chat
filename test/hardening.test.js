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

const TEST_PORT = 3998;
const BASE      = `http://127.0.0.1:${TEST_PORT}`;
const TEST_DB   = '/tmp/lecture_chat_hardening_test.db';

let serverProcess;
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
      PORT:           String(TEST_PORT),
      DB_PATH:        TEST_DB,
    },
    stdio: 'pipe',
  });

  serverProcess.stdout.on('data', () => {});
  serverProcess.stderr.on('data', () => {});

  // Poll /healthz until ready (max 5s)
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
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
});

test('POST /poll accepts 4-option poll with 201', async () => {
  const res = await apiPost('/poll', {
    prompt: `Valid 4-option poll ${Date.now()}`,
    options: ['A', 'B', 'C', 'D'],
  }, iToken);
  assert.equal(res.status, 201);
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

// ── DB_PATH startup check ─────────────────────────────────────────────────────

test('server exits with code 1 and logs an error when DB_PATH directory does not exist', async () => {
  const badProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      INSTRUCTOR_PIN: '654321',
      JWT_SECRET:     'test-dbpath-secret-xyz',
      PORT:           '3997',
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
