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

export function createSseClient(token, onEvent, label = 'client') {
  let abortCtrl = null;
  let retryDelay = 250;
  let stopped = false;

  async function connect() {
    if (stopped) return;
    abortCtrl = new AbortController();
    console.log(`[SSE:${label}] connecting…`);
    try {
      const res = await fetch('/stream', {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: abortCtrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`SSE status ${res.status}`);
      console.log(`[SSE:${label}] connected`);
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
        await new Promise(r => setTimeout(r, retryDelay));
        retryDelay = Math.min(retryDelay * 2, 30000);
        connect();
      }
    } catch (err) {
      if (err.name === 'AbortError' || stopped) return;
      console.log(`[SSE:${label}] error, reconnecting in ${retryDelay}ms:`, err);
      // Reconnect with exponential backoff (cap at 30s)
      await new Promise(r => setTimeout(r, retryDelay));
      retryDelay = Math.min(retryDelay * 2, 30000);
      connect();
    }
  }

  connect();
  return { stop() { stopped = true; abortCtrl?.abort(); } };
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
