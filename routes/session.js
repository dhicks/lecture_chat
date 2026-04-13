'use strict';

const { requireInstructor, requireStudent } = require('../lib/auth');
const { broadcast } = require('../lib/sse');

async function sessionRoutes(app) {
  // POST /session/start
  app.post('/start', { preHandler: requireInstructor }, async (req, reply) => {
    const db = app.db;

    const existing = db.prepare('SELECT id FROM chat_sessions WHERE ended_at IS NULL').get();
    if (existing) return reply.code(409).send({ error: 'A session is already active', session_id: existing.id });

    // Generate a 4-digit PIN not already in use by an active session
    let session_pin;
    do {
      session_pin = String(Math.floor(1000 + Math.random() * 9000));
    } while (
      db.prepare('SELECT id FROM chat_sessions WHERE session_pin = ? AND ended_at IS NULL').get(session_pin)
    );

    const result = db.prepare('INSERT INTO chat_sessions (session_pin) VALUES (?)').run(session_pin);
    return { session_id: result.lastInsertRowid, session_pin };
  });

  // POST /session/end
  app.post('/end', { preHandler: requireInstructor }, async (req, reply) => {
    const db = app.db;
    const session = db
      .prepare('SELECT id FROM chat_sessions WHERE ended_at IS NULL')
      .get();

    if (!session) return reply.code(404).send({ error: 'No active session' });

    db.prepare("UPDATE chat_sessions SET ended_at = datetime('now') WHERE id = ?").run(session.id);
    broadcast(session.id, { type: 'session_ended' });
    return { ok: true };
  });

  // DELETE /session/leave — student leaves the session (frees username slot)
  app.delete('/leave', { preHandler: requireStudent }, async (req, reply) => {
    const { session_id, username } = req.user;
    const db = app.db;
    db.prepare('DELETE FROM session_users WHERE session_id = ? AND username = ?')
      .run(session_id, username);
    return { ok: true };
  });

  // GET /session/:id/export — Phase 6
  app.get('/:id/export', { preHandler: requireInstructor }, async (req, reply) => {
    return reply.code(501).send({ error: 'Not implemented yet' });
  });
}

module.exports = sessionRoutes;
