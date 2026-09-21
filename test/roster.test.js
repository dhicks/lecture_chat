'use strict';

// Tests for roster-checked student login, and for logging student ID and
// client IP with each message. Each server is spawned with its own database
// and roster copy in a temporary directory.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { migrate } = require('../db/migrate');

const ROOT = path.join(__dirname, '..');
const JWT_SECRET = 'test-roster-secret-xyz';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lecture_chat_roster_'));

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

// ── Helpers ───────────────────────────────────────────────────────────────────

function writeRoster(name, text) {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, text);
  return file;
}

// Spawn server.js with test defaults; resolves { proc, base } once it listens.
async function spawnServer({ rosterPath, trustProxyHops, dbName }) {
  const proc = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      INSTRUCTOR_PIN: '123456',
      JWT_SECRET,
      PORT: '0',
      DB_PATH: path.join(tmpDir, dbName),
      ROSTER_PATH: rosterPath,
      ...(trustProxyHops === undefined ? {} : { TRUST_PROXY_HOPS: String(trustProxyHops) }),
    },
    stdio: 'pipe',
  });
  proc.stderr.on('data', () => {});

  const base = await new Promise((resolve, reject) => {
    let buf = '';
    const timeout = setTimeout(() => reject(new Error('timed out waiting for server port')), 5000);
    proc.stdout.on('data', chunk => {
      buf += chunk.toString();
      for (const line of buf.split('\n')) {
        try {
          const obj = JSON.parse(line);
          const match = typeof obj.msg === 'string' && obj.msg.match(/:(\d+)$/);
          if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
        } catch {}
      }
    });
    proc.on('exit', code => { clearTimeout(timeout); reject(new Error(`server exited with code ${code}`)); });
  });
  return { proc, base };
}

// Spawn server.js and collect its exit code and stderr (for startup failures).
function runUntilExit({ rosterPath }) {
  return new Promise(resolve => {
    const proc = spawn('node', ['server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        INSTRUCTOR_PIN: '123456',
        JWT_SECRET,
        PORT: '0',
        DB_PATH: path.join(tmpDir, 'startup-failure.db'),
        ROSTER_PATH: rosterPath,
      },
      stdio: 'pipe',
    });
    let stderr = '';
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
    proc.on('exit', code => resolve({ code, stderr }));
  });
}

function client(base) {
  async function post(route, body, { token, ip } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (ip) headers['X-Forwarded-For'] = ip;
    return fetch(`${base}${route}`, { method: 'POST', headers, body: JSON.stringify(body) });
  }
  async function get(route, token) {
    return fetch(`${base}${route}`, { headers: { Authorization: `Bearer ${token}` } });
  }
  return { post, get };
}

// Each join uses a distinct client IP so joins never share a rate-limit bucket.
let nextJoinIp = 1;
function joinIp() {
  return `192.0.2.${nextJoinIp++}`;
}

// A student JWT with the given claims, signed with the server's secret, for
// tokens that /join would never issue (e.g., issued before student IDs existed).
function signToken(claims, secret = JWT_SECRET) {
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...claims, iat: now, exp: now + 3600 })}`;
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

// Read SSE events from `token`'s stream until one matches or the timeout passes.
async function waitForSseEvent(base, token, predicate, timeoutMs = 3000) {
  const controller = new AbortController();
  const res = await fetch(`${base}/stream`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  assert.equal(res.status, 200, 'stream should connect');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  return {
    async next() {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) return null;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop();
          for (const part of parts) {
            const dataLine = part.split('\n').find(l => l.startsWith('data:'));
            if (!dataLine) continue;
            const event = JSON.parse(dataLine.slice(5).trim());
            if (predicate(event)) return event;
          }
        }
      } catch {
        return null;
      } finally {
        clearTimeout(deadline);
      }
    },
    stop: () => controller.abort(),
  };
}

// ── Main server: hops=1, editable roster ──────────────────────────────────────

const ROSTER_HEADER = 'student_id,name\n';
let rosterFile, main, api, instructorToken, sessionPin, sessionId;

before(async () => {
  rosterFile = writeRoster(
    'roster.csv',
    // 3000001-3000003 are used only by the rate-limit tests: limits are keyed per student ID
    ROSTER_HEADER + '1000001,Test One\n1000002,Test Two\n0000123,Leading Zeros\n3000001,Limit A\n3000002,Limit B\n3000003,Limit Mover\n'
  );
  main = await spawnServer({ rosterPath: rosterFile, trustProxyHops: 1, dbName: 'main.db' });
  api = client(main.base);

  const login = await api.post('/instructor/login', { pin: '123456' });
  assert.equal(login.status, 200);
  ({ token: instructorToken } = await login.json());

  const start = await api.post('/session/start', {}, { token: instructorToken });
  assert.equal(start.status, 200);
  ({ session_pin: sessionPin, session_id: sessionId } = await start.json());
});

after(() => main?.proc.kill());

function join(student_id, username, ip = joinIp()) {
  return api.post('/join', { student_id, session_pin: sessionPin, username }, { ip });
}

test('a student ID on the roster joins and receives a token', async () => {
  const res = await join('1000001', 'roster-valid');
  assert.equal(res.status, 200);
  assert.ok((await res.json()).token);
});

test('a student ID not on the roster is rejected with 401', async () => {
  const res = await join('9999999', 'roster-unknown');
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /roster/i);
});

test('a missing student ID is rejected with 400', async () => {
  const res = await api.post('/join', { session_pin: sessionPin, username: 'no-id' }, { ip: joinIp() });
  assert.equal(res.status, 400);
});

test('a non-numeric student ID is rejected with 400', async () => {
  for (const bad of ['abc123', '12 34', '-1000001', '1000001; DROP TABLE messages']) {
    const res = await join(bad, 'non-numeric');
    assert.equal(res.status, 400, `"${bad}" should be rejected`);
  }
});

test('leading zeros are significant: 0000123 joins, 123 does not', async () => {
  assert.equal((await join('0000123', 'zeros-a')).status, 200);
  assert.equal((await join('123', 'zeros-b')).status, 401);
});

test('the same student ID can join under two usernames; a taken username still returns 409', async () => {
  assert.equal((await join('1000002', 'same-id-one')).status, 200);
  assert.equal((await join('1000002', 'same-id-two')).status, 200);
  assert.equal((await join('1000001', 'same-id-one')).status, 409);
});

test('an ID added to the roster while the server runs is accepted on the next join', async () => {
  assert.equal((await join('5550001', 'late-add-before')).status, 401);
  fs.appendFileSync(rosterFile, '5550001,Late Addition\n');
  assert.equal((await join('5550001', 'late-add-after')).status, 200);
});

test('a roster file that disappears while the server runs makes /join return 500', async () => {
  const gone = writeRoster('vanishing.csv', ROSTER_HEADER + '1000001,Test One\n');
  const server = await spawnServer({ rosterPath: gone, dbName: 'vanishing.db' });
  try {
    const c = client(server.base);
    const { token } = await (await c.post('/instructor/login', { pin: '123456' })).json();
    const { session_pin } = await (await c.post('/session/start', {}, { token })).json();
    fs.rmSync(gone);
    const res = await c.post('/join', { student_id: '1000001', session_pin, username: 'x' });
    assert.equal(res.status, 500);
  } finally {
    server.proc.kill();
  }
});

test('a message is logged with the sender student ID and client IP, and the export shows both', async () => {
  const { token } = await (await join('1000001', 'logger-top')).json();
  const top = await api.post('/message', { body: 'logged top-level' }, { token, ip: '203.0.113.5' });
  assert.equal(top.status, 201);
  const { message } = await top.json();
  const reply = await api.post('/message', { body: 'logged reply', parent_id: message.id }, { token, ip: '203.0.113.6' });
  assert.equal(reply.status, 201);

  const exportRes = await api.get(`/session/${sessionId}/export`, instructorToken);
  assert.equal(exportRes.status, 200);
  const { messages } = await exportRes.json();
  const loggedTop = messages.find(m => m.id === message.id);
  assert.equal(loggedTop.student_id, '1000001');
  assert.equal(loggedTop.ip_address, '203.0.113.5');
  assert.equal(loggedTop.replies[0].student_id, '1000001');
  assert.equal(loggedTop.replies[0].ip_address, '203.0.113.6');
});

test('students never receive student_id or ip_address (POST response, GET /messages, SSE)', async () => {
  const { token: sender } = await (await join('1000001', 'leak-sender')).json();
  const { token: watcher } = await (await join('1000002', 'leak-watcher')).json();

  const stream = await waitForSseEvent(main.base, watcher, e => e.type === 'message_new');
  const post = await api.post('/message', { body: 'leak check' }, { token: sender, ip: '203.0.113.7' });
  assert.equal(post.status, 201);
  const postBody = await post.json();
  const event = await stream.next();
  stream.stop();

  const feed = await (await api.get('/messages', watcher)).json();
  assert.ok(event, 'watcher should receive message_new');
  for (const [label, payload] of [['POST /message', postBody], ['GET /messages', feed], ['SSE message_new', event]]) {
    const text = JSON.stringify(payload);
    assert.ok(!/student_id|ip_address|203\.0\.113\.7|1000001/.test(text), `${label} leaks student data: ${text}`);
  }
});

test('a token without student_id cannot post', async () => {
  const token = signToken({ role: 'student', session_id: sessionId, username: 'legacy-user' });
  const res = await api.post('/message', { body: 'from an old token' }, { token });
  assert.equal(res.status, 401);
});

// ── Rate limits ───────────────────────────────────────────────────────────────

test('a whole class behind one IP can join within a minute', async () => {
  const sharedIp = '203.0.113.40';
  for (let i = 0; i < 30; i++) {
    const res = await join('1000001', `class-joiner-${i}`, sharedIp);
    assert.equal(res.status, 200, `join ${i + 1} from the shared IP should succeed`);
  }
});

test('message limits are per student, so students behind one IP do not share a bucket', async () => {
  const sharedIp = '203.0.113.50';
  const { token: tokenA } = await (await join('3000001', 'limit-a')).json();
  const { token: tokenB } = await (await join('3000002', 'limit-b')).json();

  for (let i = 0; i < 12; i++) {
    const res = await api.post('/message', { body: `a${i}` }, { token: tokenA, ip: sharedIp });
    assert.equal(res.status, 201, `message ${i + 1} from student A should succeed`);
  }
  assert.equal((await api.post('/message', { body: 'a12' }, { token: tokenA, ip: sharedIp })).status, 429,
    '13th message from student A should be limited');
  assert.equal((await api.post('/message', { body: 'b0' }, { token: tokenB, ip: sharedIp })).status, 201,
    'student B on the same IP has their own bucket');
});

test('a student cannot escape their message limit by changing IP', async () => {
  const { token } = await (await join('3000003', 'limit-mover')).json();
  for (let i = 0; i < 12; i++) {
    assert.equal((await api.post('/message', { body: `m${i}` }, { token, ip: `203.0.113.${100 + i}` })).status, 201);
  }
  assert.equal((await api.post('/message', { body: 'm12' }, { token, ip: '203.0.113.200' })).status, 429);
});

test('forged tokens do not get their own rate-limit buckets', async () => {
  const ip = '203.0.113.60';
  const forged = id => signToken({ role: 'student', session_id: sessionId, username: `forged-${id}`, student_id: String(id) }, 'wrong-secret');
  let limited = null;
  for (let i = 0; i < 13; i++) {
    const res = await api.post('/message', { body: 'x' }, { token: forged(i), ip });
    if (res.status === 429) { limited = i + 1; break; }
    assert.equal(res.status, 401, 'a forged token is rejected');
  }
  assert.equal(limited, 13, 'forged tokens share the IP bucket, so the 13th request is limited');
});

// ── Default hops=0: a client-supplied X-Forwarded-For is ignored ──────────────

test('with TRUST_PROXY_HOPS unset, a spoofed X-Forwarded-For is not logged', async () => {
  const server = await spawnServer({ rosterPath: rosterFile, dbName: 'default-hops.db' });
  try {
    const c = client(server.base);
    const { token: iToken } = await (await c.post('/instructor/login', { pin: '123456' })).json();
    const { session_pin, session_id } = await (await c.post('/session/start', {}, { token: iToken })).json();
    const { token } = await (await c.post('/join', { student_id: '1000001', session_pin, username: 'spoofer' })).json();
    assert.equal((await c.post('/message', { body: 'spoof' }, { token, ip: '203.0.113.99' })).status, 201);

    const { messages } = await (await c.get(`/session/${session_id}/export`, iToken)).json();
    assert.match(messages[0].ip_address, /^(::ffff:)?127\.0\.0\.1$/);
  } finally {
    server.proc.kill();
  }
});

// ── Startup validation ────────────────────────────────────────────────────────

test('server exits with a clear error when the roster file is missing', async () => {
  const { code, stderr } = await runUntilExit({ rosterPath: path.join(tmpDir, 'does-not-exist.csv') });
  assert.equal(code, 1);
  assert.match(stderr, /cannot load roster/);
});

test('server exits with a clear error when the roster has no student_id column', async () => {
  const file = writeRoster('bad-header.csv', 'id,name\n1000001,Test One\n');
  const { code, stderr } = await runUntilExit({ rosterPath: file });
  assert.equal(code, 1);
  assert.match(stderr, /student_id/);
});

test('roster parsing handles a byte-order mark, CRLF line endings, quoted fields, and extra columns', async () => {
  const { loadRoster } = require('../lib/roster');
  const file = writeRoster(
    'excel-export.csv',
    '﻿name,Student_ID,email\r\n"Doe, Jane",1000001,jane@example.edu\r\n"Roe, Rick",0000123,\r\n\r\n'
  );
  assert.deepEqual([...loadRoster(file)].sort(), ['0000123', '1000001']);
});

// ── Migration ─────────────────────────────────────────────────────────────────

test('migration adds student_id and ip_address to a database created before they existed', () => {
  const dbFile = path.join(tmpDir, 'old-schema.db');
  const old = new Database(dbFile);
  old.exec(`
    CREATE TABLE chat_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, session_pin TEXT NOT NULL,
      started_at TEXT DEFAULT (datetime('now')), ended_at TEXT);
    CREATE TABLE session_users (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL,
      username TEXT NOT NULL, joined_at TEXT DEFAULT (datetime('now')), UNIQUE(session_id, username));
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL,
      username TEXT NOT NULL, body TEXT NOT NULL, parent_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
    INSERT INTO chat_sessions (session_pin) VALUES ('1234');
    INSERT INTO messages (session_id, username, body) VALUES (1, 'old-user', 'old message');
  `);

  migrate(old);
  migrate(old); // running twice must not fail

  const columns = table => old.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  assert.ok(columns('messages').includes('student_id'));
  assert.ok(columns('messages').includes('ip_address'));
  assert.ok(columns('session_users').includes('student_id'));

  const row = old.prepare('SELECT username, body, student_id, ip_address FROM messages').get();
  assert.deepEqual({ ...row }, { username: 'old-user', body: 'old message', student_id: null, ip_address: null });
  old.close();
});
