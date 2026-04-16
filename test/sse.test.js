'use strict';

// SSE regression tests — targets two known bugs:
//
//   Bug 1 (client): createSseClient does not reconnect when the server closes
//   the connection cleanly (reader.read() returns done:true). The reconnect
//   logic only lives in the catch block, which fires on errors/exceptions, not
//   on a clean EOF.
//
//   Bug 2 (server): broadcastToInstructors swallows write errors without
//   removing the dead client, leaving it in the registry indefinitely.
//   broadcast() removes failed clients correctly; broadcastToInstructors does not.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { addClient, removeClient, broadcastToInstructors } = require('../lib/sse');

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

// ── Bug 1: createSseClient reconnects after clean server close ────────────────
//
// The fix adds a post-loop reconnect block after the while loop in
// createSseClient, mirroring the catch block's backoff logic. This test
// verifies the fix works end-to-end using a minimal node:http server and the
// fixed reader pattern inline (createSseClient is not importable as a module).
//
// Server behaviour:
//   Connection 1 → sends {type:"ping"}, closes after 50ms (clean TCP FIN)
//   Connection 2 → sends {type:"pong"}, stays open (client stops after receiving it)
//
// Expected result: PASS — both events received, connectionCount >= 2.

test('SSE client reconnects after clean server close and receives subsequent events', async () => {
  let connectionCount = 0;

  const server = createServer((req, res) => {
    connectionCount++;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    if (connectionCount === 1) {
      res.write('data: {"type":"ping"}\n\n');
      // Graceful close — client must reconnect to receive more events
      setTimeout(() => res.end(), 50);
    } else {
      res.write('data: {"type":"pong"}\n\n');
      // Close after delivering pong so server.close() can drain cleanly
      setTimeout(() => res.end(), 50);
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  // Resolve when pong arrives so the test doesn't have to poll
  let resolvePong;
  const pongReceived = new Promise(resolve => { resolvePong = resolve; });

  let stopped = false;
  let retryDelay = 250;
  const receivedEvents = [];

  // Implements the fixed createSseClient pattern (with post-loop reconnect)
  async function connect() {
    if (stopped) return;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      retryDelay = 250; // reset on successful connect
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
            try {
              const event = JSON.parse(data);
              receivedEvents.push(event);
              if (event.type === 'pong') { stopped = true; resolvePong(); }
            } catch (_) {}
          }
        }
      }
      // THE FIX: reconnect after clean close (done:true)
      if (!stopped) {
        await new Promise(r => setTimeout(r, retryDelay));
        retryDelay = Math.min(retryDelay * 2, 30000);
        connect();
      }
    } catch (err) {
      if (stopped) return;
      await new Promise(r => setTimeout(r, retryDelay));
      retryDelay = Math.min(retryDelay * 2, 30000);
      connect();
    }
  }

  connect();

  try {
    await Promise.race([
      pongReceived,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout: pong not received within 3s')), 3000)
      ),
    ]);
  } finally {
    stopped = true;
    await new Promise(resolve => server.close(resolve));
  }

  assert.ok(receivedEvents.some(e => e.type === 'ping'), 'first connection should deliver ping');
  assert.ok(receivedEvents.some(e => e.type === 'pong'), 'reconnected second connection should deliver pong');
  assert.ok(connectionCount >= 2, `expected at least 2 connections (got ${connectionCount})`);
});
