'use strict';

const { addClient, removeClient } = require('../lib/sse');

async function streamRoutes(app) {
  // Accept both student and instructor JWTs
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

  app.get('/stream', { preHandler: requireStudentOrInstructor }, (req, reply) => {
    const { role } = req.user;

    let session_id;
    if (role === 'instructor') {
      const session = app.db
        .prepare('SELECT id FROM chat_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1')
        .get();
      if (!session) return reply.code(404).send({ error: 'No active session' });
      session_id = session.id;
      reply._isInstructor = true;
    } else {
      session_id = req.user.session_id;
    }

    reply.hijack(); // Take full control — prevent Fastify from finalizing the response
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    reply.raw.write(': connected\n\n');

    addClient(session_id, reply);

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
