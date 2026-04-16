'use strict';

const { hashPin, checkPin, sanitize } = require('../lib/auth');

async function authRoutes(app) {
  // POST /instructor/login
  app.post('/instructor/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { pin } = req.body || {};
    if (!pin) return reply.code(400).send({ error: 'pin is required' });

    const db = app.db;
    let row = db.prepare('SELECT pin_hash FROM instructor WHERE id = 1').get();

    // First run: bootstrap the instructor PIN from env
    if (!row) {
      const envPin = process.env.INSTRUCTOR_PIN;
      if (!envPin) {
        return reply.code(500).send({ error: 'INSTRUCTOR_PIN not configured' });
      }
      const pin_hash = await hashPin(envPin);
      db.prepare('INSERT INTO instructor (id, pin_hash) VALUES (1, ?)').run(pin_hash);
      row = { pin_hash };
    }

    const valid = await checkPin(pin, row.pin_hash);
    if (!valid) return reply.code(401).send({ error: 'Invalid PIN' });

    const token = app.jwt.sign({ role: 'instructor' }, { expiresIn: '8h' });
    return { token };
  });

  // POST /join
  app.post('/join', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { session_pin, username: rawUsername } = req.body || {};
    if (!session_pin || !rawUsername) {
      return reply.code(400).send({ error: 'session_pin and username are required' });
    }

    const username = sanitize(rawUsername.trim());
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
