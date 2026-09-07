'use strict';

const { requireStudentOrInstructor } = require('../lib/auth');
const { addClient, removeClient } = require('../lib/sse');

async function streamRoutes(app) {
  app.get('/stream', { preHandler: requireStudentOrInstructor, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, (req, reply) => {
    const { role } = req.user;

    let session_id;
    if (role === 'instructor') {
      const session = app.db
        .prepare('SELECT id FROM chat_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1')
        .get();
      if (!session) return reply.code(404).send({ error: 'No active session' });
      session_id = session.id;
    } else {
      session_id = req.user.session_id;
      // A student token outlives its session, so a leftover tab would otherwise
      // register as a live client on a session that has already ended.
      // 401 rather than the 403 used in routes/messages.js for this condition:
      // the frontend already treats 401 as "this token is dead, go rejoin".
      const session = app.db
        .prepare('SELECT id, ended_at FROM chat_sessions WHERE id = ?')
        .get(session_id);
      if (!session || session.ended_at) {
        return reply.code(401).send({ error: 'Session has ended' });
      }
    }

    reply.hijack(); // Take full control — prevent Fastify from finalizing the response
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    reply.raw.write(': connected\n\n');

    addClient(session_id, reply, role);

    const heartbeat = setInterval(() => {
      try { reply.raw.write(': heartbeat\n\n'); }
      catch { clearInterval(heartbeat); removeClient(session_id, reply); }
    }, 30_000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      removeClient(session_id, reply);
    });
  });
}

module.exports = streamRoutes;
