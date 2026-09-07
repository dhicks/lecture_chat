'use strict';

// SSE tests — client reconnect/status behaviour and server-side client cleanup.
//
// The client tests exercise the real createSseClient from public/lib.js rather
// than a copy of its logic. lib.js is an ES module with no framework imports,
// so Node can import() it directly; its `url` option is what lets these tests
// point it at a local stub server instead of the relative '/stream' path.

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { addClient, removeClient, broadcastToInstructors } = require('../lib/sse');

// pathToFileURL matters here: the repo path contains a space.
const libPath = pathToFileURL(path.join(__dirname, '..', 'public', 'lib.js')).href;
let createSseClient;

// Start a stub SSE server; returns its base URL and a close function.
async function startStub(handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/stream`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

function sseHead(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
}

// Poll until `predicate()` is true, or throw after `timeoutMs`.
async function waitFor(predicate, message, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error(`timeout: ${message}`);
}

before(async () => {
  ({ createSseClient } = await import(libPath));
  assert.equal(typeof createSseClient, 'function', 'lib.js should export createSseClient');
});

// ── Bug 2: broadcastToInstructors should remove dead clients ─────────────────
//
// Expected result: FAIL on current code (badReply is called twice, not once).

test('broadcastToInstructors removes a client whose write throws', () => {
  // Use a unique sessionId to avoid cross-test contamination of the module-level Map
  const sessionId = `test-bug2-${Date.now()}-${Math.random()}`;

  const goodWrites = [];
  const goodReply = {
    raw: { write(data) { goodWrites.push(data); } },
  };

  let badWriteCount = 0;
  const badReply = {
    raw: {
      write() {
        badWriteCount++;
        throw new Error('simulated broken pipe');
      },
    },
  };

  addClient(sessionId, goodReply, 'instructor');
  addClient(sessionId, badReply, 'instructor');

  // First broadcast: badReply throws, should be removed from registry
  broadcastToInstructors({ type: 'first' });

  // Second broadcast: badReply should NOT be called again (already removed)
  broadcastToInstructors({ type: 'second' });

  // Cleanup goodReply (it never throws, so it won't self-remove)
  removeClient(sessionId, goodReply);

  assert.equal(goodWrites.length, 2, 'goodReply should receive both broadcasts');
  assert.equal(badWriteCount, 1, 'badReply should only be called once — removed after first failure');
});

// ── Reconnect after a clean server close ──────────────────────────────────────
//
// A clean close (reader.read() returns done:true) is not an exception, so the
// reconnect has to happen after the read loop as well as in the catch block.
//
//   Connection 1 → sends {type:"ping"}, then closes
//   Connection 2 → sends {type:"pong"}, then closes

test('SSE client reconnects after clean server close and receives subsequent events', async () => {
  let connectionCount = 0;
  const events = [];

  const stub = await startStub((req, res) => {
    connectionCount++;
    sseHead(res);
    res.write(connectionCount === 1 ? 'data: {"type":"ping"}\n\n' : 'data: {"type":"pong"}\n\n');
    setTimeout(() => res.end(), 50);
  });

  const client = createSseClient('test-token', e => events.push(e), 'test', { url: stub.url });

  try {
    await waitFor(() => events.some(e => e.type === 'pong'), 'pong not received within 3s');
  } finally {
    client.stop();
    await stub.close();
  }

  assert.ok(events.some(e => e.type === 'ping'), 'first connection should deliver ping');
  assert.ok(events.some(e => e.type === 'pong'), 'reconnected second connection should deliver pong');
  assert.ok(connectionCount >= 2, `expected at least 2 connections (got ${connectionCount})`);
});

// ── A rejected token stops the client ─────────────────────────────────────────
//
// A token for an ended session can never succeed. Retrying it forever would
// burn a /stream rate-limit slot every backoff cycle, so 401 must be terminal.

test('SSE client stops retrying after a 401 and reports it as fatal', async () => {
  let requestCount = 0;
  const statuses = [];
  const fatals = [];

  const stub = await startStub((req, res) => {
    requestCount++;
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session has ended' }));
  });

  const client = createSseClient('dead-token', () => {}, 'test', {
    url: stub.url,
    disconnectGraceMs: 0,
    onStatus: v => statuses.push(v),
    onFatal: f => fatals.push(f),
  });

  try {
    await waitFor(() => fatals.length > 0, 'onFatal was never called');
    // Initial backoff is 250ms, so a retrying client would reach 3+ requests here.
    await new Promise(r => setTimeout(r, 1000));
  } finally {
    client.stop();
    await stub.close();
  }

  assert.equal(requestCount, 1, `expected exactly 1 request, got ${requestCount}`);
  assert.equal(fatals.length, 1, 'onFatal should fire exactly once');
  assert.equal(fatals[0].status, 401);
  assert.equal(fatals[0].error, 'Session has ended');
  assert.ok(!statuses.includes(true), 'should never report a connected state');
});

// ── Status callback tracks connect and disconnect ─────────────────────────────
//
// Connection 2 answers 401 so the reconnect loop terminates deterministically
// rather than the test racing an open-ended retry cycle.

test('SSE client reports connected then disconnected through onStatus', async () => {
  let connectionCount = 0;
  const statuses = [];

  const stub = await startStub((req, res) => {
    connectionCount++;
    if (connectionCount === 1) {
      sseHead(res);
      res.write('data: {"type":"ping"}\n\n');
      setTimeout(() => res.end(), 50);
      return;
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session has ended' }));
  });

  const client = createSseClient('test-token', () => {}, 'test', {
    url: stub.url,
    disconnectGraceMs: 0,
    onStatus: v => statuses.push(v),
  });

  try {
    await waitFor(() => statuses.length >= 2, `onStatus fired ${statuses.length} times, expected 2`);
  } finally {
    client.stop();
    await stub.close();
  }

  assert.deepEqual(statuses.slice(0, 2), [true, false]);
});

// ── The grace period suppresses reconnect flicker ─────────────────────────────
//
// Without it, every transient reconnect turns the indicator red and re-announces
// itself to a screen reader. A drop that recovers inside the window is never
// reported at all.

test('SSE client does not report a disconnect that recovers within the grace period', async () => {
  let connectionCount = 0;
  const statuses = [];

  const stub = await startStub((req, res) => {
    connectionCount++;
    sseHead(res);
    res.write(`data: {"type":"tick","n":${connectionCount}}\n\n`);
    // Close connection 1 promptly; the client's 250ms backoff reconnects well
    // inside the 2000ms grace window below.
    if (connectionCount === 1) setTimeout(() => res.end(), 50);
  });

  const client = createSseClient('test-token', () => {}, 'test', {
    url: stub.url,
    disconnectGraceMs: 2000,
    onStatus: v => statuses.push(v),
  });

  try {
    await waitFor(() => connectionCount >= 2, 'client did not reconnect');
    await new Promise(r => setTimeout(r, 300));
  } finally {
    client.stop();
    await stub.close();
  }

  // stop() reports false, so only inspect what happened before teardown.
  const beforeStop = statuses.slice(0, statuses.length - 1);
  assert.ok(!beforeStop.includes(false), `expected no disconnect report, got ${JSON.stringify(statuses)}`);
  assert.equal(beforeStop[0], true, 'should have reported the initial connect');
});
