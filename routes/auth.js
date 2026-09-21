'use strict';

const crypto = require('crypto');
const { loadRoster } = require('../lib/roster');

// Constant-time string comparison. A plain `!==` returns as soon as two
// characters differ, leaking the PIN's length and matching prefix through
// response timing.
function pinsMatch(submitted, expected) {
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;  // timingSafeEqual throws on length mismatch
  return crypto.timingSafeEqual(a, b);
}

async function authRoutes(app) {
  // POST /instructor/login
  // The PIN is read from the environment on every request, so changing
  // INSTRUCTOR_PIN and restarting the server changes the PIN. It is never
  // stored in the database.
  app.post('/instructor/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { pin } = req.body || {};
    if (!pin) return reply.code(400).send({ error: 'pin is required' });

    // server.js exits at startup when this is unset; checked again here as defence in depth
    const expectedPin = process.env.INSTRUCTOR_PIN;
    if (!expectedPin) {
      return reply.code(500).send({ error: 'INSTRUCTOR_PIN not configured' });
    }

    if (!pinsMatch(pin, expectedPin)) return reply.code(401).send({ error: 'Invalid PIN' });

    const token = app.jwt.sign({ role: 'instructor' }, { expiresIn: '8h' });
    return { token };
  });

  // POST /join
  // The roster file is re-read on every request, so edits to it take effect
  // without a restart. Limited per client IP, and a whole class on campus wifi
  // may share one IP, so the limit must exceed the largest class that joins in
  // the same minute. It only slows guessing of IDs, which are logged when used.
  app.post('/join', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { student_id: rawStudentId, session_pin, username: rawUsername } = req.body || {};
    if (!rawStudentId || !session_pin || !rawUsername) {
      return reply.code(400).send({ error: 'student_id, session_pin, and username are required' });
    }
    if (typeof rawStudentId !== 'string' && typeof rawStudentId !== 'number') {
      return reply.code(400).send({ error: 'student_id must be numeric' });
    }

    // Numbers are accepted for curl convenience, but a JSON number would lose leading zeros
    const student_id = String(rawStudentId).trim();
    if (!/^\d{1,20}$/.test(student_id)) {
      return reply.code(400).send({ error: 'student_id must be numeric' });
    }

    const username = rawUsername.trim();
    if (!username) return reply.code(400).send({ error: 'username is required' });
    if (username.length > 64) return reply.code(400).send({ error: 'username must be 64 characters or fewer' });

    let roster;
    try {
      roster = loadRoster(app.rosterPath);
    } catch (err) {
      req.log.error({ err }, 'cannot load roster');
      return reply.code(500).send({ error: 'Class roster is unavailable' });
    }
    if (!roster.has(student_id)) {
      return reply.code(401).send({ error: 'Student ID not found on the class roster' });
    }

    const db = app.db;
    const session = db
      .prepare('SELECT id FROM chat_sessions WHERE session_pin = ? AND ended_at IS NULL')
      .get(session_pin);

    if (!session) return reply.code(401).send({ error: 'Invalid or expired session PIN' });

    try {
      db.prepare('INSERT INTO session_users (session_id, username, student_id) VALUES (?, ?, ?)')
        .run(session.id, username, student_id);
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return reply.code(409).send({ error: 'Username already taken in this session' });
      }
      throw err;
    }

    const token = app.jwt.sign(
      { role: 'student', session_id: session.id, username, student_id },
      { expiresIn: '4h' }
    );
    return { token };
  });
}

module.exports = authRoutes;
