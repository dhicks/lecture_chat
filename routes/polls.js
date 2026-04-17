'use strict';

const { requireInstructor, requireStudent, sanitize } = require('../lib/auth');
const { broadcast, broadcastToInstructors } = require('../lib/sse');

async function pollRoutes(app) {
  // POST /poll — instructor creates a poll
  app.post('/poll', { preHandler: requireInstructor, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, (req, reply) => {
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

    const session = db.prepare('SELECT id FROM chat_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get();
    if (!session) return reply.code(404).send({ error: 'No active session' });

    const openPoll = db.prepare('SELECT id FROM polls WHERE session_id = ? AND closed_at IS NULL').get(session.id);
    if (openPoll) return reply.code(409).send({ error: 'A poll is already open' });

    const sanitizedPrompt  = sanitize(prompt.trim());
    const sanitizedOptions = cleanOptions.map(o => sanitize(o));

    const result = db.prepare(
      'INSERT INTO polls (session_id, prompt, options) VALUES (?, ?, ?)'
    ).run(session.id, sanitizedPrompt, JSON.stringify(sanitizedOptions));

    const poll = { id: result.lastInsertRowid, prompt: sanitizedPrompt, options: sanitizedOptions };
    broadcast(session.id, { type: 'poll_new', poll });

    return reply.code(201).send({ poll });
  });

  // POST /poll/:id/close — instructor closes a poll and broadcasts results
  app.post('/poll/:id/close', { preHandler: requireInstructor, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, (req, reply) => {
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
  app.post('/vote', { preHandler: requireStudent, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, (req, reply) => {
    const { session_id, username } = req.user;
    const { poll_id, choice } = req.body || {};
    const db = app.db;

    const session = db.prepare('SELECT ended_at FROM chat_sessions WHERE id = ?').get(session_id);
    if (!session || session.ended_at) return reply.code(403).send({ error: 'Session has ended' });

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

    db.prepare(
      'INSERT OR REPLACE INTO poll_votes (poll_id, username, choice) VALUES (?, ?, ?)'
    ).run(Number(poll_id), username, Number(choice));

    // Broadcast live tally to instructor SSE connections only (students can't see results until poll closes)
    const tallyRows = db.prepare(
      'SELECT choice, COUNT(*) as votes FROM poll_votes WHERE poll_id = ? GROUP BY choice'
    ).all(Number(poll_id));
    const tallyMap = {};
    for (const row of tallyRows) tallyMap[row.choice] = row.votes;
    const tally = JSON.parse(poll.options).map((option, i) => ({ option, votes: tallyMap[i] || 0 }));
    broadcastToInstructors({ type: 'vote_update', poll_id: Number(poll_id), tally });

    return reply.code(201).send({ ok: true });
  });
}

module.exports = pollRoutes;
