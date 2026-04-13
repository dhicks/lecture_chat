import { h, render } from 'https://esm.sh/preact@10';
import { useState, useEffect, useRef, useCallback } from 'https://esm.sh/preact@10/hooks';
import htm from 'https://esm.sh/htm@3';
const html = htm.bind(h);

// ── Storage helpers ───────────────────────────────────────────────────────────

function loadInstructorSession() {
  try {
    const token   = localStorage.getItem('lc_instructor_token');
    const session = localStorage.getItem('lc_instructor_session');
    if (token) return { token, session: session ? JSON.parse(session) : null };
  } catch (_) {}
  return null;
}

function saveInstructorToken(token) {
  localStorage.setItem('lc_instructor_token', token);
}

function saveInstructorActiveSession(session) {
  localStorage.setItem('lc_instructor_session', JSON.stringify(session));
}

function clearInstructorActiveSession() {
  localStorage.removeItem('lc_instructor_session');
}

function clearInstructorSession() {
  localStorage.removeItem('lc_instructor_token');
  localStorage.removeItem('lc_instructor_session');
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch(path, { token, method = 'GET', body } = {}) {
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
// Mirrors app.js exactly (no build step to share modules).

function createSseClient(token, onEvent) {
  let abortCtrl = null;
  let retryDelay = 250;
  let stopped = false;

  async function connect() {
    if (stopped) return;
    abortCtrl = new AbortController();
    try {
      const res = await fetch('/stream', {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: abortCtrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`SSE status ${res.status}`);
      retryDelay = 250;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) {
          let data = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (data) {
            try { onEvent(JSON.parse(data)); } catch (_) {}
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError' || stopped) return;
      await new Promise(r => setTimeout(r, retryDelay));
      retryDelay = Math.min(retryDelay * 2, 30000);
      connect();
    }
  }

  connect();
  return { stop() { stopped = true; abortCtrl?.abort(); } };
}

// ── Time formatting ───────────────────────────────────────────────────────────

function formatTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Components ────────────────────────────────────────────────────────────────

// LoginScreen ─────────────────────────────────────────────────────────────────

function LoginScreen({ onLoggedIn }) {
  const [pin, setPin]   = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const headingRef      = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!pin.trim()) {
      setError('Please enter your instructor PIN.');
      return;
    }
    setBusy(true);
    try {
      const data = await apiFetch('/instructor/login', { method: 'POST', body: { pin: pin.trim() } });
      saveInstructorToken(data.token);
      onLoggedIn(data.token);
    } catch (err) {
      if (err.status === 401) setError('Incorrect PIN. Please try again.');
      else setError('Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  return html`
    <main class="login-screen">
      <h1 tabIndex="-1" ref=${headingRef}>Lecture Chat — Instructor</h1>
      <form class="login-form" onSubmit=${handleSubmit} novalidate>
        <div class="field">
          <label for="pin-input">Instructor PIN</label>
          <input
            id="pin-input"
            type="password"
            inputmode="numeric"
            autocomplete="current-password"
            placeholder="Enter your PIN"
            value=${pin}
            onInput=${e => setPin(e.target.value)}
            disabled=${busy}
            required
          />
        </div>
        ${error && html`
          <div class="alert alert-error" role="alert" aria-live="assertive">${error}</div>
        `}
        <button class="btn btn-primary" type="submit" disabled=${busy}>
          ${busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  `;
}

// EndSessionDialog ────────────────────────────────────────────────────────────

function EndSessionDialog({ onConfirm, onCancel, triggerRef, busy }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    function handleCancel(e) {
      e.preventDefault(); // prevent browser from closing before we handle it
      dismiss();
    }
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, []);

  function dismiss() {
    dialogRef.current?.close();
    triggerRef.current?.focus();
    onCancel();
  }

  async function handleConfirm() {
    await onConfirm();
    dialogRef.current?.close();
  }

  return html`
    <dialog
      ref=${dialogRef}
      class="end-session-dialog"
      aria-labelledby="end-session-title"
      aria-describedby="end-session-desc"
    >
      <h2 id="end-session-title">End session?</h2>
      <p id="end-session-desc">
        This will disconnect all students and close the session. This cannot be undone.
      </p>
      <div class="dialog-actions">
        <button class="btn btn-danger" onClick=${handleConfirm} disabled=${busy}>
          ${busy ? 'Ending…' : 'End session'}
        </button>
        <button class="btn btn-secondary" onClick=${dismiss} disabled=${busy}>
          Cancel
        </button>
      </div>
    </dialog>
  `;
}

// SessionPanel ────────────────────────────────────────────────────────────────

function SessionPanel({ token, session, onSessionStarted, onSessionEnded }) {
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState('');
  const [copied, setCopied]         = useState(false);
  const [showEndDialog, setShowEndDialog] = useState(false);
  const endBtnRef                   = useRef(null);

  async function handleStart() {
    setError('');
    setBusy(true);
    try {
      const data = await apiFetch('/session/start', { token, method: 'POST' });
      const newSession = { id: data.session_id, pin: data.session_pin };
      saveInstructorActiveSession(newSession);
      onSessionStarted(newSession);
    } catch (err) {
      if (err.status === 409) setError('A session is already active.');
      else setError('Failed to start session. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleEndConfirm() {
    setBusy(true);
    try {
      await apiFetch('/session/end', { token, method: 'POST' });
      clearInstructorActiveSession();
      onSessionEnded();
    } catch (err) {
      setError('Failed to end session.');
    } finally {
      setBusy(false);
      setShowEndDialog(false);
    }
  }

  async function handleCopy() {
    if (!session?.pin) return;
    try {
      await navigator.clipboard.writeText(session.pin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      setError('Could not copy to clipboard.');
    }
  }

  return html`
    <section class="card" aria-labelledby="session-panel-title">
      <h2 class="card-title" id="session-panel-title">Session</h2>

      ${error && html`
        <div class="alert alert-error" role="alert" aria-live="assertive" style="margin-bottom:0.75rem;">
          ${error}
        </div>
      `}

      ${session
        ? html`
          <div class="session-pin-display">
            <span class="session-pin" aria-label=${`Session PIN: ${session.pin.split('').join(' ')}`}>
              ${session.pin}
            </span>
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              onClick=${handleCopy}
              aria-label="Copy PIN to clipboard"
            >
              ${copied ? '✓ Copied' : 'Copy PIN'}
            </button>
          </div>
          <p class="session-meta" aria-live="polite">
            ${copied ? 'PIN copied to clipboard.' : 'Share this PIN with your students.'}
          </p>
          <div class="session-actions" style="margin-top:0.75rem;">
            <button
              ref=${endBtnRef}
              class="btn btn-danger btn-sm"
              type="button"
              onClick=${() => setShowEndDialog(true)}
              disabled=${busy}
            >
              End session
            </button>
          </div>

          ${showEndDialog && html`
            <${EndSessionDialog}
              onConfirm=${handleEndConfirm}
              onCancel=${() => setShowEndDialog(false)}
              triggerRef=${endBtnRef}
              busy=${busy}
            />
          `}
        `
        : html`
          <p class="session-meta" style="margin-bottom:0.75rem;">No active session.</p>
          <button
            class="btn btn-primary"
            type="button"
            onClick=${handleStart}
            disabled=${busy}
          >
            ${busy ? 'Starting…' : 'Start session'}
          </button>
        `
      }
    </section>
  `;
}

// ActivePollCard ──────────────────────────────────────────────────────────────

function ActivePollCard({ token, poll, onPollClosed }) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const totalVotes = poll.tally ? poll.tally.reduce((s, r) => s + r.votes, 0) : 0;

  async function handleClose() {
    setError('');
    setBusy(true);
    try {
      const data = await apiFetch(`/poll/${poll.id}/close`, { token, method: 'POST' });
      onPollClosed(data.poll);
    } catch (err) {
      setError('Failed to close poll.');
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div class="active-poll-card" role="region" aria-labelledby=${`poll-${poll.id}-title`}>
      <p class="poll-prompt" id=${`poll-${poll.id}-title`}>${poll.prompt}</p>

      ${error && html`
        <div class="alert alert-error" role="alert" style="margin-bottom:0.5rem;">${error}</div>
      `}

      ${poll.tally && html`
        <p class="sr-only" aria-live="polite" aria-atomic="true">
          ${totalVotes} vote${totalVotes !== 1 ? 's' : ''} so far.
        </p>
        <div>
          ${poll.tally.map((row, i) => {
            const pct = totalVotes > 0 ? Math.round((row.votes / totalVotes) * 100) : 0;
            return html`
              <div key=${i} class="tally-row">
                <div class="tally-label">
                  <span>${row.option}</span>
                  <span>${row.votes} vote${row.votes !== 1 ? 's' : ''} (${pct}%)</span>
                </div>
                <div class="tally-bar-track" role="presentation">
                  <div class="tally-bar-fill" style=${`width:${pct}%`}></div>
                </div>
              </div>
            `;
          })}
        </div>
        <!-- Screen-reader accessible table alternative -->
        <table class="sr-only">
          <caption>Live vote counts for: ${poll.prompt}</caption>
          <thead><tr><th>Option</th><th>Votes</th><th>Percent</th></tr></thead>
          <tbody>
            ${poll.tally.map((row, i) => {
              const pct = totalVotes > 0 ? Math.round((row.votes / totalVotes) * 100) : 0;
              return html`<tr key=${i}><td>${row.option}</td><td>${row.votes}</td><td>${pct}%</td></tr>`;
            })}
          </tbody>
        </table>
      `}

      <p style="font-size:0.85rem; color:var(--muted); margin-top:0.5rem;">
        ${totalVotes} vote${totalVotes !== 1 ? 's' : ''} so far — results hidden from students until you close.
      </p>
      <button
        class="btn btn-secondary btn-sm"
        type="button"
        onClick=${handleClose}
        disabled=${busy}
        style="margin-top:0.6rem;"
      >
        ${busy ? 'Closing…' : 'Close poll & show results'}
      </button>
    </div>
  `;
}

// ClosedPollsList ─────────────────────────────────────────────────────────────

function ClosedPollsList({ polls }) {
  const [expandedId, setExpandedId] = useState(null);

  function toggle(id) {
    setExpandedId(prev => prev === id ? null : id);
  }

  return html`
    <div class="closed-polls-list">
      <p class="closed-polls-heading">
        Closed poll${polls.length !== 1 ? 's' : ''} (${polls.length})
      </p>
      ${polls.map(poll => {
        const isOpen = expandedId === poll.id;
        const resultsId = `closed-poll-results-${poll.id}`;
        const totalVotes = poll.results.reduce((s, r) => s + r.votes, 0);
        return html`
          <div key=${poll.id}>
            <button
              class="closed-poll-toggle"
              type="button"
              aria-expanded=${isOpen}
              aria-controls=${resultsId}
              onClick=${() => toggle(poll.id)}
            >
              <span aria-hidden="true">${isOpen ? '▾' : '▸'}</span>
              ${poll.prompt}
            </button>
            <div id=${resultsId} class="closed-poll-results" hidden=${!isOpen}>
              ${poll.results.map((row, i) => {
                const pct = totalVotes > 0 ? Math.round((row.votes / totalVotes) * 100) : 0;
                return html`
                  <div key=${i} class="tally-row">
                    <div class="tally-label">
                      <span>${row.option}</span>
                      <span>${row.votes} vote${row.votes !== 1 ? 's' : ''} (${pct}%)</span>
                    </div>
                    <div class="tally-bar-track" role="presentation">
                      <div class="tally-bar-fill" style=${`width:${pct}%`}></div>
                    </div>
                  </div>
                `;
              })}
              <table class="sr-only">
                <caption>Results for: ${poll.prompt}</caption>
                <thead><tr><th>Option</th><th>Votes</th><th>Percent</th></tr></thead>
                <tbody>
                  ${poll.results.map((row, i) => {
                    const pct = totalVotes > 0 ? Math.round((row.votes / totalVotes) * 100) : 0;
                    return html`<tr key=${i}><td>${row.option}</td><td>${row.votes}</td><td>${pct}%</td></tr>`;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

// PollPanel ───────────────────────────────────────────────────────────────────

function PollPanel({ token, sessionId, activePoll, closedPolls, onPollCreated, onPollClosed }) {
  const [prompt, setPrompt]     = useState('');
  const [options, setOptions]   = useState(['', '']);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');

  function updateOption(i, val) {
    setOptions(prev => prev.map((o, idx) => idx === i ? val : o));
  }

  function addOption() {
    if (options.length < 4) setOptions(prev => [...prev, '']);
  }

  function removeOption(i) {
    if (options.length > 2) setOptions(prev => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    const cleanPrompt  = prompt.trim();
    const cleanOptions = options.map(o => o.trim()).filter(o => o.length > 0);
    if (!cleanPrompt) { setError('Please enter a poll question.'); return; }
    if (cleanOptions.length < 2) { setError('Please provide at least 2 options.'); return; }
    setBusy(true);
    try {
      const data = await apiFetch('/poll', {
        token,
        method: 'POST',
        body: { prompt: cleanPrompt, options: cleanOptions },
      });
      setPrompt('');
      setOptions(['', '']);
      setSuccess('Poll created and sent to students.');
      onPollCreated(data.poll);
    } catch (err) {
      if (err.status === 404) setError('No active session — start a session first.');
      else setError('Failed to create poll. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return html`
    <section class="card" aria-labelledby="poll-panel-title">
      <h2 class="card-title" id="poll-panel-title">Polls</h2>

      ${!sessionId && html`
        <p style="font-size:0.9rem; color:var(--muted);">Start a session to create polls.</p>
      `}

      ${sessionId && !activePoll && html`
        <form class="poll-builder-form" onSubmit=${handleSubmit} novalidate>
          <div class="field">
            <label for="poll-prompt">Question</label>
            <input
              id="poll-prompt"
              type="text"
              placeholder="Ask a question…"
              value=${prompt}
              onInput=${e => setPrompt(e.target.value)}
              disabled=${busy}
              maxlength="300"
            />
          </div>

          <fieldset style="border:none; padding:0;">
            <legend style="font-size:0.9rem; font-weight:600; color:var(--muted); margin-bottom:0.4rem;">
              Options (2–4)
            </legend>
            ${options.map((opt, i) => html`
              <div key=${i} class="option-row" style="margin-bottom:0.4rem;">
                <label for=${`option-${i}`} class="sr-only">Option ${i + 1}</label>
                <input
                  id=${`option-${i}`}
                  type="text"
                  placeholder=${`Option ${i + 1}`}
                  value=${opt}
                  onInput=${e => updateOption(i, e.target.value)}
                  disabled=${busy}
                  maxlength="200"
                />
                ${options.length > 2 && html`
                  <button
                    class="btn-icon"
                    type="button"
                    aria-label=${`Remove option ${i + 1}`}
                    onClick=${() => removeOption(i)}
                    disabled=${busy}
                  >−</button>
                `}
              </div>
            `)}
            ${options.length < 4 && html`
              <button
                class="btn btn-secondary btn-sm"
                type="button"
                onClick=${addOption}
                disabled=${busy}
                style="margin-top:0.1rem;"
              >
                + Add option
              </button>
            `}
          </fieldset>

          ${error && html`
            <div class="alert alert-error" role="alert" aria-live="assertive">${error}</div>
          `}
          ${success && html`
            <div class="alert alert-success" role="status" aria-live="polite">${success}</div>
          `}

          <button
            class="btn btn-primary"
            type="submit"
            disabled=${busy || !prompt.trim()}
          >
            ${busy ? 'Creating…' : 'Send poll to students'}
          </button>
        </form>
      `}

      ${activePoll && html`
        <${ActivePollCard}
          token=${token}
          poll=${activePoll}
          onPollClosed=${onPollClosed}
        />
      `}

      ${closedPolls?.length > 0 && html`
        <${ClosedPollsList} polls=${closedPolls} />
      `}
    </section>
  `;
}

// MessageFeed ─────────────────────────────────────────────────────────────────

function MessageFeed({ messages }) {
  const feedRef = useRef(null);
  const [expandedReplies, setExpandedReplies] = useState(new Set());

  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  function toggleReplies(msgId) {
    setExpandedReplies(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  }

  return html`
    <section class="card" aria-labelledby="feed-title">
      <h2 class="card-title" id="feed-title">Messages</h2>
      <div
        ref=${feedRef}
        class="feed-scroll"
        aria-label="Message feed"
        aria-live="polite"
        aria-relevant="additions"
        role="log"
      >
        ${messages.length === 0
          ? html`<p class="feed-empty">No messages yet.</p>`
          : messages.map(msg => {
            const replyCount = (msg.replies || []).length;
            const isExpanded = expandedReplies.has(msg.id);
            const repliesId = `replies-${msg.id}`;
            return html`
              <div key=${msg.id} class="feed-item">
                <div class="feed-meta">
                  <span class="feed-author">${msg.username}</span>
                  <time class="feed-time" datetime=${msg.created_at}>
                    ${formatTime(msg.created_at)}
                  </time>
                </div>
                <p class="feed-body">${msg.body}</p>
                ${replyCount > 0 && html`
                  <button
                    class="btn-replies-toggle"
                    type="button"
                    aria-expanded=${isExpanded}
                    aria-controls=${repliesId}
                    onClick=${() => toggleReplies(msg.id)}
                  >
                    ${isExpanded ? '▾' : '▸'} ${replyCount} repl${replyCount === 1 ? 'y' : 'ies'}
                  </button>
                  <div id=${repliesId} hidden=${!isExpanded}>
                    ${(msg.replies || []).map(r => html`
                      <div key=${r.id} class="feed-item is-reply">
                        <div class="feed-meta">
                          <span class="feed-author">↳ ${r.username}</span>
                          <time class="feed-time" datetime=${r.created_at}>
                            ${formatTime(r.created_at)}
                          </time>
                        </div>
                        <p class="feed-body">${r.body}</p>
                      </div>
                    `)}
                  </div>
                `}
              </div>
            `;
          })
        }
      </div>
    </section>
  `;
}

// ExportButton ────────────────────────────────────────────────────────────────

function ExportButton({ token, sessionId }) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  async function handleExport() {
    if (!sessionId) return;
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/session/${sessionId}/export`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `session-${sessionId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (_) {
      setError('Export failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!sessionId) return null;

  return html`
    <div style="display:flex; flex-direction:column; gap:0.5rem; align-items:flex-start;">
      <button
        class="btn btn-secondary btn-sm"
        type="button"
        onClick=${handleExport}
        disabled=${busy}
      >
        ${busy ? 'Exporting…' : 'Export session log (JSON)'}
      </button>
      ${error && html`
        <div class="alert alert-error" role="alert" aria-live="assertive">${error}</div>
      `}
    </div>
  `;
}

// SessionHistory ──────────────────────────────────────────────────────────────

function SessionHistory({ token, sessions, total, currentPage, pageSize, onPrev, onNext }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError]   = useState('');

  const totalPages = Math.ceil(total / pageSize) || 1;

  async function downloadSession(id, label) {
    setBusyId(id);
    setError('');
    try {
      const res = await fetch(`/session/${id}/export`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `session-${id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (_) {
      setError('Export failed. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  return html`
    <section class="card" aria-labelledby="session-history-title">
      <h2 class="card-title" id="session-history-title">Past sessions</h2>
      ${error && html`
        <div class="alert alert-error" role="alert" aria-live="assertive">${error}</div>
      `}
      ${sessions.length === 0
        ? html`<p style="font-size:0.9rem; color:var(--muted);">No past sessions yet.</p>`
        : html`
          <ul class="session-history-list">
            ${sessions.map(s => {
              const label = formatDateTime(s.started_at);
              const isBusy = busyId === s.id;
              return html`
                <li key=${s.id} class="session-history-item">
                  <div class="session-history-info">
                    <strong>${label}</strong>
                    <span class="session-history-stats">
                      ${s.message_count} message${s.message_count !== 1 ? 's' : ''} · ${s.poll_count} poll${s.poll_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <button
                    class="btn btn-secondary btn-sm"
                    type="button"
                    aria-label=${`Export session from ${label}`}
                    onClick=${() => downloadSession(s.id, label)}
                    disabled=${isBusy}
                  >
                    ${isBusy ? 'Exporting…' : 'Export'}
                  </button>
                </li>
              `;
            })}
          </ul>
          ${totalPages > 1 && html`
            <div class="session-history-pagination" role="navigation" aria-label="Session history pages">
              <button
                class="btn btn-secondary btn-sm"
                type="button"
                aria-label="Previous page"
                onClick=${onPrev}
                disabled=${currentPage === 0}
              >◀</button>
              <span class="session-history-page-info" aria-live="polite">
                Page ${currentPage + 1} of ${totalPages}
              </span>
              <button
                class="btn btn-secondary btn-sm"
                type="button"
                aria-label="Next page"
                onClick=${onNext}
                disabled=${currentPage + 1 >= totalPages}
              >▶</button>
            </div>
          `}
        `
      }
    </section>
  `;
}

// DashboardScreen ─────────────────────────────────────────────────────────────

function DashboardScreen({ token, initialSession, onLogout }) {
  const [session, setSession]       = useState(initialSession);
  const [messages, setMessages]     = useState([]);
  const [activePoll, setActivePoll] = useState(null);
  const [closedPolls, setClosedPolls] = useState([]);
  const [pastSessions, setPastSessions] = useState([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [currentPage, setCurrentPage]   = useState(0);
  const PAGE_SIZE = 10;

  const sseRef = useRef(null);

  function loadSessions(page) {
    apiFetch(`/session?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, { token })
      .then(({ sessions, total }) => {
        setPastSessions(sessions);
        setSessionTotal(total);
        setCurrentPage(page);
      })
      .catch(() => {});
  }

  // ── Reconcile session state with server on mount ────────────────────────────
  // localStorage may be stale (session started in another tab/via curl, or server restarted).

  useEffect(() => {
    apiFetch('/session/active', { token })
      .then(({ session: serverSession, active_poll, closed_polls }) => {
        if (serverSession) {
          // Server has an active session — use it regardless of localStorage
          if (!session || session.id !== serverSession.id) {
            saveInstructorActiveSession(serverSession);
            setSession(serverSession);
          }
          if (active_poll) setActivePoll(active_poll);
          if (closed_polls?.length) setClosedPolls(closed_polls);
        } else {
          // No active session on server — clear any stale localStorage state
          if (session) {
            clearInstructorActiveSession();
            setSession(null);
          }
        }
      })
      .catch(err => {
        if (err.status === 401) onLogout();
      });
  }, []);

  // ── Load past sessions when no active session ──────────────────────────────

  useEffect(() => {
    if (session) return;
    setCurrentPage(0);
    loadSessions(0);
  }, [session?.id ?? null]);

  // ── SSE event handler ───────────────────────────────────────────────────────

  const handleSseEvent = useCallback((event) => {
    switch (event.type) {
      case 'message_new':
        setMessages(prev => {
          const msg = event.message;
          if (msg.parent_id) {
            return prev.map(m =>
              m.id === msg.parent_id
                ? { ...m, replies: [...(m.replies || []), msg] }
                : m
            );
          }
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, { ...msg, replies: [] }];
        });
        break;
      case 'vote_update':
        setActivePoll(prev => {
          if (!prev || prev.id !== event.poll_id) return prev;
          return { ...prev, tally: event.tally };
        });
        break;
      case 'poll_new':
        setActivePoll({ ...event.poll, tally: event.poll.options.map(option => ({ option, votes: 0 })) });
        break;
      case 'poll_closed':
        if (event.poll) {
          setClosedPolls(prev =>
            prev.some(p => p.id === event.poll.id) ? prev : [...prev, event.poll]
          );
        }
        setActivePoll(null);
        break;
      case 'session_ended':
        clearInstructorActiveSession();
        setSession(null);
        sseRef.current?.stop();
        break;
    }
  }, []);

  // ── Connect SSE and load messages on session change ─────────────────────────

  useEffect(() => {
    if (!session) return;

    (async () => {
      try {
        const data = await apiFetch('/messages', { token });
        const normalized = (data.messages || []).map(m => ({ ...m, replies: m.replies || [] }));
        setMessages(normalized);
        if (data.active_poll) {
          // active_poll from instructor includes tally
          setActivePoll(data.active_poll);
        }
      } catch (err) {
        if (err.status === 401) { onLogout(); return; }
      }
    })();

    sseRef.current?.stop();
    sseRef.current = createSseClient(token, handleSseEvent);

    return () => sseRef.current?.stop();
  }, [session?.id]);

  function handleSessionStarted(newSession) {
    setSession(newSession);
    setMessages([]);
    setActivePoll(null);
    setClosedPolls([]);
  }

  function handleSessionEnded() {
    setSession(null);
    setMessages([]);
    setActivePoll(null);
    setClosedPolls([]);
    sseRef.current?.stop();
  }

  function handlePollCreated(poll) {
    // SSE poll_new event will set the active poll; no extra state update needed
  }

  function handlePollClosed() {
    // SSE poll_closed event will clear the active poll; no extra state update needed
  }

  return html`
    <div class="dashboard">
      <header class="dash-header">
        <h1>Lecture Chat — Instructor</h1>
        <button
          class="btn btn-secondary btn-sm"
          type="button"
          onClick=${onLogout}
          aria-label="Log out"
        >
          Log out
        </button>
      </header>

      <main class="dash-main">
        <div class="dash-left">
          <${SessionPanel}
            token=${token}
            session=${session}
            onSessionStarted=${handleSessionStarted}
            onSessionEnded=${handleSessionEnded}
          />

          ${session && html`
            <${PollPanel}
              token=${token}
              sessionId=${session.id}
              activePoll=${activePoll}
              closedPolls=${closedPolls}
              onPollCreated=${handlePollCreated}
              onPollClosed=${handlePollClosed}
            />

            <${ExportButton} token=${token} sessionId=${session.id} />
          `}
        </div>

        <div class="dash-right">
          ${session
            ? html`<${MessageFeed} messages=${messages} />`
            : html`<${SessionHistory}
                token=${token}
                sessions=${pastSessions}
                total=${sessionTotal}
                currentPage=${currentPage}
                pageSize=${PAGE_SIZE}
                onPrev=${() => loadSessions(currentPage - 1)}
                onNext=${() => loadSessions(currentPage + 1)}
              />`
          }
        </div>
      </main>
    </div>
  `;
}

// ── App root ──────────────────────────────────────────────────────────────────

function App() {
  const saved = loadInstructorSession();
  const [screen, setScreen] = useState(saved?.token ? 'dashboard' : 'login');
  const [token, setToken]   = useState(saved?.token || null);
  const initialSession      = saved?.session || null;

  function handleLoggedIn(newToken) {
    setToken(newToken);
    setScreen('dashboard');
  }

  function handleLogout() {
    clearInstructorSession();
    setToken(null);
    setScreen('login');
  }

  if (screen === 'login') {
    return html`<${LoginScreen} onLoggedIn=${handleLoggedIn} />`;
  }
  return html`
    <${DashboardScreen}
      token=${token}
      initialSession=${initialSession}
      onLogout=${handleLogout}
    />
  `;
}

// ── Mount ─────────────────────────────────────────────────────────────────────

render(h(App, null), document.getElementById('app'));
