'use strict';

const { requireStudent } = require('../lib/auth');
const { broadcast } = require('../lib/sse');

async function messageRoutes(app) {
  // Inline preHandler: accept student or instructor JWT
  async function requireStudentOrInstructor(req, reply) {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    if (req.user.role !== 'student' && req.user.role !== 'instructor') {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  }

  // GET /messages — last 50 top-level messages with replies and reaction counts
  app.get('/messages', { preHandler: requireStudentOrInstructor }, (req, reply) => {
    const db = app.db;

    // Instructors have no session_id in their JWT; resolve from active session
    let session_id;
    if (req.user.role === 'instructor') {
      const session = db.prepare('SELECT id FROM chat_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get();
      if (!session) return reply.send({ messages: [], active_poll: null });
      session_id = session.id;
    } else {
      session_id = req.user.session_id;
    }

    const topLevel = db.prepare(`
      SELECT id, username, body, parent_id, created_at
      FROM messages
      WHERE session_id = ? AND parent_id IS NULL
      ORDER BY created_at DESC LIMIT 50
    `).all(session_id).reverse();

    if (topLevel.length === 0) {
      const emptyPollRow = db.prepare(`
        SELECT id, prompt, options FROM polls
        WHERE session_id = ? AND closed_at IS NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(session_id);
      const active_poll = emptyPollRow
        ? { id: emptyPollRow.id, prompt: emptyPollRow.prompt, options: JSON.parse(emptyPollRow.options) }
        : null;
      return reply.send({ messages: [], active_poll });
    }

    const topIds = topLevel.map(m => m.id);
    const placeholders = topIds.map(() => '?').join(',');

    const replies = db.prepare(`
      SELECT id, username, body, parent_id, created_at
      FROM messages
      WHERE parent_id IN (${placeholders})
      ORDER BY created_at ASC
    `).all(...topIds);

    const allIds = [...topIds, ...replies.map(r => r.id)];
    const reactionRows = allIds.length
      ? db.prepare(`
          SELECT message_id, emoji, COUNT(*) as count
          FROM reactions
          WHERE message_id IN (${allIds.map(() => '?').join(',')})
          GROUP BY message_id, emoji
        `).all(...allIds)
      : [];

    // Build reactions map: message_id -> { emoji: count }
    const reactionsMap = {};
    for (const row of reactionRows) {
      if (!reactionsMap[row.message_id]) reactionsMap[row.message_id] = {};
      reactionsMap[row.message_id][row.emoji] = row.count;
    }

    // Group replies by parent_id
    const repliesMap = {};
    for (const r of replies) {
      if (!repliesMap[r.parent_id]) repliesMap[r.parent_id] = [];
      repliesMap[r.parent_id].push({ ...r, reactions: reactionsMap[r.id] || {} });
    }

    const messages = topLevel.map(m => ({
      ...m,
      reactions: reactionsMap[m.id] || {},
      replies: repliesMap[m.id] || [],
    }));

    const activePollRow = db.prepare(`
      SELECT id, prompt, options FROM polls
      WHERE session_id = ? AND closed_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `).get(session_id);

    let active_poll = null;
    if (activePollRow) {
      const opts = JSON.parse(activePollRow.options);
      active_poll = { id: activePollRow.id, prompt: activePollRow.prompt, options: opts };
      // Instructors see current vote tally immediately; students never see counts until poll closes
      if (req.user.role === 'instructor') {
        const tallyRows = db.prepare(
          'SELECT choice, COUNT(*) as votes FROM poll_votes WHERE poll_id = ? GROUP BY choice'
        ).all(activePollRow.id);
        const tallyMap = {};
        for (const row of tallyRows) tallyMap[row.choice] = row.votes;
        active_poll.tally = opts.map((option, i) => ({ option, votes: tallyMap[i] || 0 }));
      }
    }

    return reply.send({ messages, active_poll });
  });

  // POST /message — post a new message or reply
  app.post('/message', { preHandler: requireStudent, config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, (req, reply) => {
    const { session_id, username } = req.user;
    const { body, parent_id } = req.body || {};
    const db = app.db;

    const session = db.prepare('SELECT ended_at FROM chat_sessions WHERE id = ?').get(session_id);
    if (!session || session.ended_at) return reply.code(403).send({ error: 'Session has ended' });

    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      return reply.code(400).send({ error: 'body is required' });
    }
    if (body.length > 1000) {
      return reply.code(400).send({ error: 'body must be 1000 characters or fewer' });
    }

    let resolvedParentId = null;
    if (parent_id != null) {
      const parent = db.prepare(
        'SELECT id, session_id, parent_id FROM messages WHERE id = ?'
      ).get(parent_id);

      if (!parent || parent.session_id !== session_id) {
        return reply.code(400).send({ error: 'invalid parent_id' });
      }
      if (parent.parent_id !== null) {
        return reply.code(400).send({ error: 'replies cannot be nested' });
      }
      resolvedParentId = parent.id;
    }

    const result = db.prepare(
      'INSERT INTO messages (session_id, username, body, parent_id) VALUES (?, ?, ?, ?)'
    ).run(session_id, username, body.trim(), resolvedParentId);

    const message = db.prepare(
      'SELECT id, session_id, username, body, parent_id, created_at FROM messages WHERE id = ?'
    ).get(result.lastInsertRowid);

    broadcast(session_id, { type: 'message_new', message: { ...message, reactions: {} } });

    return reply.code(201).send({ message: { ...message, reactions: {} } });
  });
}

module.exports = messageRoutes;
