'use strict';

const { requireStudent } = require('../lib/auth');
const { broadcast } = require('../lib/sse');

const VALID_EMOJIS = new Set(['👍', '👎', '❓', '😂', '🔥', '✅', '❌', '😊', '😕']);

async function reactionRoutes(app) {
  // POST /react — toggle an emoji reaction on a message
  app.post('/react', { preHandler: requireStudent, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, (req, reply) => {
    const { session_id, username } = req.user;
    const { message_id, emoji } = req.body || {};
    const db = app.db;

    if (message_id == null || isNaN(Number(message_id))) {
      return reply.code(400).send({ error: 'message_id is required' });
    }
    if (!emoji || !VALID_EMOJIS.has(emoji)) {
      return reply.code(400).send({ error: 'invalid emoji' });
    }

    const session = db.prepare('SELECT ended_at FROM chat_sessions WHERE id = ?').get(session_id);
    if (!session || session.ended_at) return reply.code(403).send({ error: 'Session has ended' });

    const member = db.prepare('SELECT id FROM session_users WHERE session_id = ? AND username = ?').get(session_id, username);
    if (!member) return reply.code(403).send({ error: 'Session membership required' });

    const mid = Number(message_id);
    const message = db.prepare(
      'SELECT id, session_id FROM messages WHERE id = ?'
    ).get(mid);

    if (!message || message.session_id !== session_id) {
      return reply.code(404).send({ error: 'message not found' });
    }

    const existing = db.prepare(
      'SELECT id FROM reactions WHERE message_id = ? AND username = ? AND emoji = ?'
    ).get(mid, username, emoji);

    if (existing) {
      db.prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
    } else {
      db.prepare(
        'INSERT INTO reactions (message_id, username, emoji) VALUES (?, ?, ?)'
      ).run(mid, username, emoji);
    }

    const counts = db.prepare(
      'SELECT emoji, COUNT(*) as count FROM reactions WHERE message_id = ? GROUP BY emoji'
    ).all(mid);

    const reactions = Object.fromEntries(counts.map(r => [r.emoji, r.count]));

    broadcast(session_id, { type: 'reaction_update', message_id: mid, reactions });

    return reply.send({ message_id: mid, reactions });
  });
}

module.exports = reactionRoutes;
