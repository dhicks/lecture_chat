'use strict';

const clients = new Map(); // Map<session_id, Set<reply>>

function addClient(sessionId, reply) {
  if (!clients.has(sessionId)) clients.set(sessionId, new Set());
  clients.get(sessionId).add(reply);
}

function removeClient(sessionId, reply) {
  const set = clients.get(sessionId);
  if (!set) return;
  set.delete(reply);
  if (set.size === 0) clients.delete(sessionId);
}

function broadcast(sessionId, event) {
  const set = clients.get(sessionId);
  if (!set) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const reply of set) reply.raw.write(data);
}

module.exports = { addClient, removeClient, broadcast };
