'use strict';

const { requireStudent } = require('../lib/auth');
const { addClient, removeClient } = require('../lib/sse');

async function streamRoutes(app) {
  app.get('/stream', { preHandler: requireStudent }, (req, reply) => {
    const { session_id } = req.user;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    reply.raw.write(': connected\n\n');

    addClient(session_id, reply);

    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, 30_000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      removeClient(session_id, reply);
    });
  });
}

module.exports = streamRoutes;
