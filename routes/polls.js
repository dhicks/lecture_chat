'use strict';

const { requireInstructor, requireStudent } = require('../lib/auth');
const { broadcast } = require('../lib/sse');

async function pollRoutes(app) {
  // POST /poll — instructor creates a poll
  app.post('/poll', { preHandler: requireInstructor }, (req, reply) => {
    const { prompt, options } = req.body || {};
    const db = app.db;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return reply.code(400).send({ error: 'prompt is required' });
    }
    if (!Array.isArray(options) || options.length < 2 || options.length > 4) {
      return reply.code(400).send({ error: 'options must be an array of 2–4 items' });
    }
    const cleanOptions = options.map(o => (typeof o === 'string' ? o.trim() : ''));
    if (cleanOptions.some(o => o.length === 0)) {
      return reply.code(400).send({ error: 'each option must be a non-empty string' });
    }

    const session = db.prepare('SELECT id FROM chat_sessions WHERE ended_at IS NULL').get();
    if (!session) return reply.code(404).send({ error: 'No active session' });

    const result = db.prepare(
      'INSERT INTO polls (session_id, prompt, options) VALUES (?, ?, ?)'
    ).run(session.id, prompt.trim(), JSON.stringify(cleanOptions));

    const poll = { id: result.lastInsertRowid, prompt: prompt.trim(), options: cleanOptions };
    broadcast(session.id, { type: 'poll_new', poll });

    return reply.code(201).send({ poll });
  });

  // POST /poll/:id/close — instructor closes a poll and broadcasts results
  app.post('/poll/:id/close', { preHandler: requireInstructor }, (req, reply) => {
    const pollId = Number(req.params.id);
    const db = app.db;

    const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
    if (!poll) return reply.code(404).send({ error: 'Poll not found' });
    if (poll.closed_at) return reply.code(400).send({ error: 'Poll already closed' });

    db.prepare("UPDATE polls SET closed_at = datetime('now') WHERE id = ?").run(pollId);

    const voteCounts = db.prepare(
      'SELECT choice, COUNT(*) as votes FROM poll_votes WHERE poll_id = ? GROUP BY choice'
    ).all(pollId);

    const options = JSON.parse(poll.options);
    const countMap = {};
    for (const row of voteCounts) countMap[row.choice] = row.votes;
    const results = options.map((option, i) => ({ option, votes: countMap[i] || 0 }));

    const payload = { id: poll.id, prompt: poll.prompt, results };
    broadcast(poll.session_id, { type: 'poll_closed', poll: payload });

    return reply.send({ poll: payload });
  });

  // POST /vote — student submits a vote
  app.post('/vote', { preHandler: requireStudent }, (req, reply) => {
    const { session_id, username } = req.user;
    const { poll_id, choice } = req.body || {};
    const db = app.db;

    if (poll_id == null || !Number.isInteger(Number(poll_id))) {
      return reply.code(400).send({ error: 'poll_id is required' });
    }
    if (choice == null || !Number.isInteger(Number(choice)) || Number(choice) < 0) {
      return reply.code(400).send({ error: 'choice must be a non-negative integer' });
    }

    const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(Number(poll_id));
    if (!poll || poll.session_id !== session_id) {
      return reply.code(404).send({ error: 'Poll not found' });
    }
    if (poll.closed_at) return reply.code(400).send({ error: 'Poll is closed' });

    const options = JSON.parse(poll.options);
    if (Number(choice) >= options.length) {
      return reply.code(400).send({ error: 'Invalid choice index' });
    }

    try {
      db.prepare(
        'INSERT INTO poll_votes (poll_id, username, choice) VALUES (?, ?, ?)'
      ).run(Number(poll_id), username, Number(choice));
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return reply.code(409).send({ error: 'Already voted on this poll' });
      }
      throw err;
    }

    return reply.code(201).send({ ok: true });
  });
}

module.exports = pollRoutes;
