'use strict';

const clients = new Map(); // Map<session_id, Set<{ reply, role }>>

function addClient(sessionId, reply, role) {
  if (!clients.has(sessionId)) clients.set(sessionId, new Set());
  clients.get(sessionId).add({ reply, role });
}

function removeClient(sessionId, reply) {
  const set = clients.get(sessionId);
  if (!set) return;
  for (const entry of set) {
    if (entry.reply === reply) { set.delete(entry); break; }
  }
  if (set.size === 0) clients.delete(sessionId);
}

function broadcast(sessionId, event) {
  const set = clients.get(sessionId);
  if (!set) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  const dead = [];
  for (const entry of set) {
    try { entry.reply.raw.write(data); }
    catch { dead.push(entry); }
  }
  for (const entry of dead) removeClient(sessionId, entry.reply);
}

// Send an event only to instructor SSE connections.
function broadcastToInstructors(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const [sessionId, set] of clients.entries()) {
    const dead = [];
    for (const entry of set) {
      if (entry.role === 'instructor') {
        try { entry.reply.raw.write(data); }
        catch { dead.push(entry); }
      }
    }
    for (const entry of dead) removeClient(sessionId, entry.reply);
  }
}

module.exports = { addClient, removeClient, broadcast, broadcastToInstructors };
