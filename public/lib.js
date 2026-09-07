// ── Shared frontend utilities ─────────────────────────────────────────────────
// Used by both app.js (student) and instructor.js.

// ── API helpers ───────────────────────────────────────────────────────────────

export async function apiFetch(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (body != null) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}

// ── Fetch-based SSE client ────────────────────────────────────────────────────
// Native EventSource doesn't support Authorization header, so we use fetch +
// ReadableStream and parse the SSE protocol manually.
// `label` is used for console log prefixes (e.g. 'student' or 'instructor').
//
// Options:
//   onStatus(connected)        called only when the connected state changes
//   onFatal({ status, error }) called once when the server rejects the token;
//                              no further connection attempts are made
//   url                        overridable so Node tests can reach a stub server
//   disconnectGraceMs          delay before reporting a disconnect, so a fast
//                              reconnect doesn't flash the status indicator or
//                              churn its screen-reader announcement

export function createSseClient(token, onEvent, label = 'client', options = {}) {
  const {
    onStatus = null,
    onFatal = null,
    url = '/stream',
    disconnectGraceMs = 1500,
  } = options;

  let abortCtrl = null;
  let retryDelay = 250;
  let stopped = false;

  let connected = false;   // last state reported through onStatus
  let graceTimer = null;
  let retryTimer = null;

  function setStatus(next) {
    if (next === connected) return;
    connected = next;
    try { onStatus?.(next); } catch (_) {}
  }

  function markConnected() {
    clearTimeout(graceTimer);
    graceTimer = null;
    setStatus(true);
  }

  // Report a drop only if it outlasts the grace period; a reconnect within that
  // window cancels the timer via markConnected and is never reported at all.
  function markDisconnected() {
    if (!connected || graceTimer) return;
    if (disconnectGraceMs <= 0) { setStatus(false); return; }
    graceTimer = setTimeout(() => { graceTimer = null; setStatus(false); }, disconnectGraceMs);
  }

  // Cancellable so stop() doesn't leave a pending backoff timer behind.
  function sleep(ms) {
    return new Promise(resolve => { retryTimer = setTimeout(resolve, ms); });
  }

  async function connect() {
    if (stopped) return;
    abortCtrl = new AbortController();
    console.log(`[SSE:${label}] connecting…`);
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: abortCtrl.signal,
      });
      // The token is no longer usable — the session ended, or it expired.
      // Retrying cannot help, and would hold a rate-limit slot indefinitely.
      if (res.status === 401 || res.status === 403) {
        stopped = true;
        clearTimeout(graceTimer);
        graceTimer = null;
        setStatus(false);
        let body = {};
        try { body = await res.json(); } catch (_) {}
        console.log(`[SSE:${label}] auth rejected (${res.status}), not retrying`);
        onFatal?.({ status: res.status, error: body.error || 'Unauthorized' });
        return;
      }
      if (!res.ok || !res.body) throw new Error(`SSE status ${res.status}`);
      console.log(`[SSE:${label}] connected`);
      markConnected();
      retryDelay = 250; // reset on successful connect

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE events are separated by double newlines
        const parts = buffer.split('\n\n');
        buffer = parts.pop(); // keep incomplete trailing chunk
        for (const part of parts) {
          let data = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (data) {
            try {
              const evt = JSON.parse(data);
              console.log(`[SSE:${label}] event:`, evt);
              onEvent(evt);
            } catch (_) {}
          }
        }
      }
      // Server closed connection cleanly (done:true) — reconnect with backoff
      if (!stopped) {
        console.log(`[SSE:${label}] clean close, reconnecting in ${retryDelay}ms`);
        markDisconnected();
        await sleep(retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
        connect();
      }
    } catch (err) {
      if (err.name === 'AbortError' || stopped) return;
      console.log(`[SSE:${label}] error, reconnecting in ${retryDelay}ms:`, err);
      markDisconnected();
      // Reconnect with exponential backoff (cap at 30s)
      await sleep(retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
      connect();
    }
  }

  connect();
  return {
    stop() {
      stopped = true;
      clearTimeout(graceTimer);
      graceTimer = null;
      clearTimeout(retryTimer);
      retryTimer = null;
      setStatus(false);   // explicit teardown reports immediately, no grace
      abortCtrl?.abort();
    },
  };
}

// ── Time formatting ───────────────────────────────────────────────────────────
// SQLite stores timestamps as 'YYYY-MM-DD HH:MM:SS' with no timezone indicator.
// parseSqliteTimestamp appends 'Z' so the browser treats the value as UTC when
// constructing the Date object. Display methods (getHours, etc.) then return the
// user's local wall-clock time, which is the correct behavior for a lecture tool.

function parseSqliteTimestamp(iso) {
  if (!iso) return new Date(NaN);
  // If already has a timezone indicator, use as-is; otherwise append Z for UTC.
  return new Date(/[Z+\-]\d*$/.test(iso) ? iso : iso + 'Z');
}

export function formatTime(iso) {
  const d = parseSqliteTimestamp(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso) {
  const d = parseSqliteTimestamp(iso);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
