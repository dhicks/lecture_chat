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
  for (const reply of set) {
    try { reply.raw.write(data); }
    catch { removeClient(sessionId, reply); }
  }
}

// Send an event only to instructor SSE connections (reply._isInstructor === true).
function broadcastToInstructors(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const set of clients.values()) {
    for (const reply of set) {
      if (reply._isInstructor) {
        try { reply.raw.write(data); }
        catch { /* will be evicted on next heartbeat or broadcast */ }
      }
    }
  }
}

module.exports = { addClient, removeClient, broadcast, broadcastToInstructors };
