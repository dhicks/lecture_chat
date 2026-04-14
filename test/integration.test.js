'use strict';

// Integration tests for SSE event delivery using the real Fastify server
// and Node 20's fetch + ReadableStream (same API as the browser).
//
// Goal: reproduce the browser-reported symptoms:
//   A. Student doesn't see their own message_new after sending
//   B. Student misses poll_new when instructor creates a poll
//   C. Student misses poll_closed when instructor closes a poll
//   D. Student misses session_ended
//
// Tests that FAIL confirm a server-side delivery bug.
// Tests that PASS narrow the issue to browser/frontend-specific behavior.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn }  = require('node:child_process');
const { unlink } = require('node:fs/promises');
const path = require('node:path');

const TEST_PORT = 3999;
const BASE      = `http://127.0.0.1:${TEST_PORT}`;
const TEST_DB   = '/tmp/lecture_chat_integration_test.db';

// ── Server fixture + shared session setup ─────────────────────────────────────
// NOTE: multiple top-level before() hooks in node:test run concurrently.
// Keep server spawn and session setup in a single before() to ensure ordering.

let serverProcess;

before(async () => {
  serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      INSTRUCTOR_PIN: '123456',
      JWT_SECRET:     'test-integration-secret-xyz',
      PORT:           String(TEST_PORT),
      DB_PATH:        TEST_DB,
    },
    stdio: 'pipe',
  });

  // Drain stdout/stderr so the child process doesn't block on full pipe buffers
  serverProcess.stdout.on('data', () => {});
  serverProcess.stderr.on('data', () => {});

  // Poll /healthz until the server is ready (max 5s)
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  // Final check — throws if server never came up
  const res = await fetch(`${BASE}/healthz`);
  assert.ok(res.ok, 'server should be healthy before tests run');

  // Shared session used by Tests A–C (Test D creates its own)
  iToken     = await instructorLogin();
  const s    = await startSession(iToken);
  sessionPin = s.session_pin;
});

after(async () => {
  serverProcess?.kill();
  await unlink(TEST_DB).catch(() => {}); // ignore if already gone
});

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return res;
}

async function instructorLogin() {
  const res = await apiPost('/instructor/login', { pin: '123456' });
  assert.equal(res.status, 200, 'instructor login should succeed');
  const { token } = await res.json();
  return token;
}

async function startSession(iToken) {
  const res = await apiPost('/session/start', {}, iToken);
  assert.equal(res.status, 200, 'session/start should succeed');
  const { session_pin, session_id } = await res.json();
  return { session_pin, session_id };
}

async function endSession(iToken) {
  const res = await apiPost('/session/end', {}, iToken);
  assert.equal(res.status, 200, 'session/end should succeed');
}

async function joinSession(pin, username) {
  const res = await apiPost('/join', { session_pin: pin, username });
  assert.equal(res.status, 200, `join as ${username} should succeed`);
  const { token } = await res.json();
  return token;
}

// ── SSE event queue ───────────────────────────────────────────────────────────
//
// Wraps a ReadableStream reader with a background parse loop.
// waitFor(predicate, timeoutMs) resolves with the first matching event,
// checking already-received events first so there's no race between
// "start consuming" and "trigger action".

function makeEventQueue(reader) {
  const decoder = new TextDecoder();
  let buffer = '';
  const received  = [];
  const waiters   = []; // { predicate, resolve, reject }

  function dispatch(event) {
    received.push(event);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].predicate(event)) {
        waiters[i].resolve(event);
        waiters.splice(i, 1);
      }
    }
  }

  // Background read loop — fire and forget
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) {
          let data = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (data) {
            try { dispatch(JSON.parse(data)); } catch (_) {}
          }
        }
      }
    } catch (_) {}
  })();

  return {
    received,
    waitFor(predicate, timeoutMs = 2000) {
      const already = received.find(predicate);
      if (already) return Promise.resolve(already);
      return Promise.race([
        new Promise((resolve, reject) => waiters.push({ predicate, resolve, reject })),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`SSE timeout: no matching event in ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
    },
  };
}

async function connectSse(token) {
  const res = await fetch(`${BASE}/stream`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200, 'SSE connect should return 200');
  assert.ok(res.body, 'SSE response should have a body');
  const reader = res.body.getReader();
  const queue  = makeEventQueue(reader);
  const stop   = () => reader.cancel().catch(() => {});
  return { queue, stop };
}

// ── Shared session state (populated in the single before() above) ─────────────

let iToken;    // instructor JWT (valid for whole test run — 8h expiry)
let sessionPin;

// ── Test A: Student receives their own message via SSE ────────────────────────

test('A: student receives message_new for their own sent message', async () => {
  const sToken = await joinSession(sessionPin, 'alice-a');
  const { queue, stop } = await connectSse(sToken);

  try {
    const body = `hello-${Date.now()}`;
    const postRes = await apiPost('/message', { body }, sToken);
    assert.equal(postRes.status, 201, 'POST /message should return 201');

    const event = await queue.waitFor(
      e => e.type === 'message_new' && e.message?.body === body
    );
    assert.equal(event.type, 'message_new');
    assert.equal(event.message.body, body);
    assert.equal(event.message.username, 'alice-a');
  } finally {
    stop();
  }
});

// ── Test B: Student receives poll_new when instructor creates a poll ───────────

test('B: student receives poll_new when instructor creates a poll', async () => {
  const sToken = await joinSession(sessionPin, 'alice-b');
  const { queue, stop } = await connectSse(sToken);

  try {
    const prompt = `Poll B ${Date.now()}`;
    const pollRes = await apiPost(
      '/poll',
      { prompt, options: ['Yes', 'No'] },
      iToken
    );
    assert.equal(pollRes.status, 201, 'POST /poll should return 201');
    const { poll } = await pollRes.json();

    const event = await queue.waitFor(
      e => e.type === 'poll_new' && e.poll?.id === poll.id
    );
    assert.equal(event.type, 'poll_new');
    assert.equal(event.poll.id, poll.id);
    assert.equal(event.poll.prompt, prompt);
    assert.ok(!('results' in event.poll), 'poll_new should not include results');
  } finally {
    stop();
  }
});

// ── Test C: Student receives poll_closed with results ─────────────────────────

test('C: student receives poll_closed with results after instructor closes poll', async () => {
  const sToken = await joinSession(sessionPin, 'alice-c');
  const { queue, stop } = await connectSse(sToken);

  try {
    // Instructor creates poll
    const pollRes = await apiPost(
      '/poll',
      { prompt: `Poll C ${Date.now()}`, options: ['Alpha', 'Beta', 'Gamma'] },
      iToken
    );
    assert.equal(pollRes.status, 201);
    const { poll } = await pollRes.json();

    // Wait for poll_new before voting (confirms SSE is live)
    await queue.waitFor(e => e.type === 'poll_new' && e.poll?.id === poll.id);

    // Student votes
    const voteRes = await apiPost('/vote', { poll_id: poll.id, choice: 1 }, sToken);
    assert.equal(voteRes.status, 201, 'POST /vote should return 201');

    // Instructor closes poll
    const closeRes = await apiPost(`/poll/${poll.id}/close`, {}, iToken);
    assert.equal(closeRes.status, 200, 'POST /poll/:id/close should return 200');

    const event = await queue.waitFor(
      e => e.type === 'poll_closed' && e.poll?.id === poll.id
    );
    assert.equal(event.type, 'poll_closed');
    assert.ok(Array.isArray(event.poll.results), 'poll_closed should include results array');
    assert.equal(event.poll.results.length, 3);
  } finally {
    stop();
  }
});

// ── Test D: Student receives session_ended (separate session) ─────────────────

test('D: student receives session_ended when instructor ends session', async () => {
  // End the shared session first, then start a fresh one for this test
  await endSession(iToken);

  const { session_pin: pin2 } = await startSession(iToken);
  const sToken = await joinSession(pin2, 'alice-d');
  const { queue, stop } = await connectSse(sToken);

  try {
    await endSession(iToken);

    const event = await queue.waitFor(e => e.type === 'session_ended');
    assert.equal(event.type, 'session_ended');
  } finally {
    stop();
  }
});
