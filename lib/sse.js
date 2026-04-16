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
  for (const { reply } of set) {
    try { reply.raw.write(data); }
    catch { removeClient(sessionId, reply); }
  }
}

// Send an event only to instructor SSE connections.
function broadcastToInstructors(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const [sessionId, set] of clients.entries()) {
    for (const { reply, role } of set) {
      if (role === 'instructor') {
        try { reply.raw.write(data); }
        catch { removeClient(sessionId, reply); }
      }
    }
  }
}

module.exports = { addClient, removeClient, broadcast, broadcastToInstructors };
