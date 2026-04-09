'use strict';

const { requireStudent } = require('../lib/auth');
const { broadcast } = require('../lib/sse');

const VALID_EMOJIS = new Set(['👍', '👎', '❓', '😂', '🔥', '✅', '❌', '😊', '😕']);

async function reactionRoutes(app) {
  // POST /react — toggle an emoji reaction on a message
  app.post('/react', { preHandler: requireStudent }, (req, reply) => {
    const { session_id, username } = req.user;
    const { message_id, emoji } = req.body || {};
    const db = app.db;

    if (!message_id || typeof message_id !== 'number') {
      return reply.code(400).send({ error: 'message_id is required and must be a number' });
    }
    if (!emoji || !VALID_EMOJIS.has(emoji)) {
      return reply.code(400).send({ error: 'invalid emoji' });
    }

    const message = db.prepare(
      'SELECT id, session_id FROM messages WHERE id = ?'
    ).get(message_id);

    if (!message || message.session_id !== session_id) {
      return reply.code(404).send({ error: 'message not found' });
    }

    const existing = db.prepare(
      'SELECT id FROM reactions WHERE message_id = ? AND username = ? AND emoji = ?'
    ).get(message_id, username, emoji);

    if (existing) {
      db.prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
    } else {
      db.prepare(
        'INSERT INTO reactions (message_id, username, emoji) VALUES (?, ?, ?)'
      ).run(message_id, username, emoji);
    }

    const counts = db.prepare(
      'SELECT emoji, COUNT(*) as count FROM reactions WHERE message_id = ? GROUP BY emoji'
    ).all(message_id);

    const reactions = Object.fromEntries(counts.map(r => [r.emoji, r.count]));

    broadcast(session_id, { type: 'reaction_update', message_id, reactions });

    return reply.send({ message_id, reactions });
  });
}

module.exports = reactionRoutes;
