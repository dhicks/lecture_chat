'use strict';

// Phase 2 will implement the real SSE client registry.
// For now, broadcast is a no-op so Phase 1 routes can call it safely.
function broadcast(sessionId, event) {
  // no-op stub
}

module.exports = { broadcast };
