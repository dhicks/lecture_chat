'use strict';

const crypto = require('crypto');

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
  app.post('/join', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { session_pin, username: rawUsername } = req.body || {};
    if (!session_pin || !rawUsername) {
      return reply.code(400).send({ error: 'session_pin and username are required' });
    }

    const username = rawUsername.trim();
    if (!username) return reply.code(400).send({ error: 'username is required' });
    if (username.length > 64) return reply.code(400).send({ error: 'username must be 64 characters or fewer' });

    const db = app.db;
    const session = db
      .prepare('SELECT id FROM chat_sessions WHERE session_pin = ? AND ended_at IS NULL')
      .get(session_pin);

    if (!session) return reply.code(401).send({ error: 'Invalid or expired session PIN' });

    try {
      db.prepare('INSERT INTO session_users (session_id, username) VALUES (?, ?)').run(session.id, username);
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return reply.code(409).send({ error: 'Username already taken in this session' });
      }
      throw err;
    }

    const token = app.jwt.sign(
      { role: 'student', session_id: session.id, username },
      { expiresIn: '4h' }
    );
    return { token };
  });
}

module.exports = authRoutes;
