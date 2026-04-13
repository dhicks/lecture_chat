'use strict';

const { requireInstructor, requireStudent } = require('../lib/auth');
const { broadcast } = require('../lib/sse');

async function sessionRoutes(app) {
  // GET /session/active — returns current active session + active poll, or nulls
  app.get('/active', { preHandler: requireInstructor }, async (req, reply) => {
    const db = app.db;
    const session = db.prepare('SELECT id, session_pin FROM chat_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get();
    if (!session) return { session: null, active_poll: null };

    const pollRow = db.prepare(
      'SELECT id, prompt, options FROM polls WHERE session_id = ? AND closed_at IS NULL ORDER BY created_at DESC LIMIT 1'
    ).get(session.id);

    let active_poll = null;
    if (pollRow) {
      const opts = JSON.parse(pollRow.options);
      const tallyRows = db.prepare(
        'SELECT choice, COUNT(*) as votes FROM poll_votes WHERE poll_id = ? GROUP BY choice'
      ).all(pollRow.id);
      const tallyMap = {};
      for (const row of tallyRows) tallyMap[row.choice] = row.votes;
      active_poll = {
        id: pollRow.id,
        prompt: pollRow.prompt,
        options: opts,
        tally: opts.map((option, i) => ({ option, votes: tallyMap[i] || 0 })),
      };
    }

    const closedPollRows = db.prepare(
      'SELECT id, prompt, options FROM polls WHERE session_id = ? AND closed_at IS NOT NULL ORDER BY created_at ASC'
    ).all(session.id);

    const closed_polls = closedPollRows.map(p => {
      const opts = JSON.parse(p.options);
      const voteCounts = db.prepare(
        'SELECT choice, COUNT(*) as votes FROM poll_votes WHERE poll_id = ? GROUP BY choice'
      ).all(p.id);
      const countMap = {};
      for (const row of voteCounts) countMap[row.choice] = row.votes;
      return {
        id: p.id,
        prompt: p.prompt,
        results: opts.map((option, i) => ({ option, votes: countMap[i] || 0 })),
      };
    });

    return { session: { id: session.id, pin: session.session_pin }, active_poll, closed_polls };
  });

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

  // GET /session/ — paginated list of ended sessions with stats
  app.get('/', { preHandler: requireInstructor }, async (req, reply) => {
    const limit  = Math.min(parseInt(req.query.limit  ?? 20, 10), 100);
    const offset = parseInt(req.query.offset ?? 0, 10);
    const db = app.db;

    const { total } = db.prepare(
      `SELECT COUNT(*) AS total FROM chat_sessions WHERE ended_at IS NOT NULL`
    ).get();

    const sessions = db.prepare(`
      SELECT
        cs.id,
        cs.session_pin,
        cs.started_at,
        cs.ended_at,
        COUNT(DISTINCT m.id) AS message_count,
        COUNT(DISTINCT p.id) AS poll_count
      FROM chat_sessions cs
      LEFT JOIN messages m ON m.session_id = cs.id
      LEFT JOIN polls    p ON p.session_id = cs.id
      WHERE cs.ended_at IS NOT NULL
      GROUP BY cs.id
      ORDER BY cs.started_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    reply.send({ sessions, total });
  });

  // GET /session/:id/export — full session log as JSON
  app.get('/:id/export', { preHandler: requireInstructor }, async (req, reply) => {
    const sessionId = Number(req.params.id);
    const db = app.db;

    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId);
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const topMessages = db.prepare(
      'SELECT id, username, body, created_at FROM messages WHERE session_id = ? AND parent_id IS NULL ORDER BY created_at ASC'
    ).all(sessionId);

    const replies = db.prepare(
      'SELECT id, parent_id, username, body, created_at FROM messages WHERE session_id = ? AND parent_id IS NOT NULL ORDER BY created_at ASC'
    ).all(sessionId);

    const reactionRows = db.prepare(
      'SELECT r.message_id, r.emoji, COUNT(*) as count FROM reactions r JOIN messages m ON r.message_id = m.id WHERE m.session_id = ? GROUP BY r.message_id, r.emoji'
    ).all(sessionId);

    const reactionsMap = {};
    for (const row of reactionRows) {
      if (!reactionsMap[row.message_id]) reactionsMap[row.message_id] = {};
      reactionsMap[row.message_id][row.emoji] = row.count;
    }

    const replyMap = {};
    for (const r of replies) {
      if (!replyMap[r.parent_id]) replyMap[r.parent_id] = [];
      replyMap[r.parent_id].push({ ...r, reactions: reactionsMap[r.id] || {} });
    }

    const messages = topMessages.map(m => ({
      ...m,
      reactions: reactionsMap[m.id] || {},
      replies: replyMap[m.id] || [],
    }));

    const polls = db.prepare(
      'SELECT * FROM polls WHERE session_id = ? ORDER BY created_at ASC'
    ).all(sessionId);

    const pollsWithResults = polls.map(p => {
      const opts = JSON.parse(p.options);
      const voteCounts = db.prepare(
        'SELECT choice, COUNT(*) as votes FROM poll_votes WHERE poll_id = ? GROUP BY choice'
      ).all(p.id);
      const countMap = {};
      for (const row of voteCounts) countMap[row.choice] = row.votes;
      const results = opts.map((option, i) => ({ option, votes: countMap[i] || 0 }));
      return { id: p.id, prompt: p.prompt, created_at: p.created_at, closed_at: p.closed_at, results };
    });

    reply.header('Content-Disposition', `attachment; filename="session-${sessionId}.json"`);
    return {
      session: {
        id: session.id,
        session_pin: session.session_pin,
        started_at: session.started_at,
        ended_at: session.ended_at,
      },
      messages,
      polls: pollsWithResults,
    };
  });
}

module.exports = sessionRoutes;
