import { h, render } from 'https://esm.sh/preact@10';
import { useState, useEffect, useRef, useCallback } from 'https://esm.sh/preact@10/hooks';
import htm from 'https://esm.sh/htm@3';
const html = htm.bind(h);

// ── Constants ────────────────────────────────────────────────────────────────

const EMOJIS = ['👍', '👎', '❓', '😂', '🔥', '✅', '❌', '😊', '😕'];
const EMOJI_LABELS = {
  '👍': 'Thumbs up', '👎': 'Thumbs down', '❓': 'Question',
  '😂': 'Laughing',  '🔥': 'Fire',        '✅': 'Check mark',
  '❌': 'X mark',    '😊': 'Smiling',      '😕': 'Confused',
};

// ── Storage helpers ───────────────────────────────────────────────────────────

function loadSession() {
  try {
    const token    = localStorage.getItem('lc_token');
    const username = localStorage.getItem('lc_username');
    const pin      = localStorage.getItem('lc_pin');
    if (token && username) return { token, username, pin };
  } catch (_) {}
  return null;
}

function saveSession(token, username, pin) {
  localStorage.setItem('lc_token', token);
  localStorage.setItem('lc_username', username);
  if (pin) localStorage.setItem('lc_pin', pin);
}

function clearSession() {
  localStorage.removeItem('lc_token');
  localStorage.removeItem('lc_username');
  localStorage.removeItem('lc_pin');
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
  if (!res.ok) throw Object.assign(new Error(data.message || 'Request failed'), { status: res.status });
  return data;
}

// ── Fetch-based SSE client ────────────────────────────────────────────────────
// Native EventSource doesn't support Authorization header, so we use fetch +
// ReadableStream and parse the SSE protocol manually.

function createSseClient(token, onEvent) {
  let abortCtrl = null;
  let retryDelay = 250;
  let stopped = false;

  async function connect() {
    if (stopped) return;
    abortCtrl = new AbortController();
    console.log('[SSE:student] connecting…');
    try {
      const res = await fetch('/stream', {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: abortCtrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`SSE status ${res.status}`);
      console.log('[SSE:student] connected');
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
              console.log('[SSE:student] event:', evt);
              onEvent(evt);
            } catch (_) {}
          }
        }
      }
      // Server closed connection cleanly (done:true) — reconnect with backoff
      if (!stopped) {
        console.log(`[SSE:student] clean close, reconnecting in ${retryDelay}ms`);
        await new Promise(r => setTimeout(r, retryDelay));
        retryDelay = Math.min(retryDelay * 2, 30000);
        connect();
      }
    } catch (err) {
      if (err.name === 'AbortError' || stopped) return;
      console.log(`[SSE:student] error, reconnecting in ${retryDelay}ms:`, err);
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

function formatTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Components ────────────────────────────────────────────────────────────────

// JoinScreen ──────────────────────────────────────────────────────────────────

function JoinScreen({ onJoined }) {
  const [pin, setPin]           = useState('');
  const [username, setUsername] = useState('');
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!pin.trim() || !username.trim()) {
      setError('Please enter both a session PIN and a username.');
      return;
    }
    setBusy(true);
    try {
      const data = await apiFetch('/join', {
        method: 'POST',
        body: { session_pin: pin.trim(), username: username.trim() },
      });
      saveSession(data.token, username.trim(), pin.trim());
      onJoined(data.token, username.trim(), pin.trim());
    } catch (err) {
      if (err.status === 401) setError('Invalid session PIN or session has ended.');
      else if (err.status === 409) setError('That username is already taken. Please choose another.');
      else setError('Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  return html`
    <main class="join-screen">
      <h1>Lecture Chat</h1>
      <form class="join-form" onSubmit=${handleSubmit} novalidate>
        <div class="field">
          <label for="pin-input">Session PIN</label>
          <input
            id="pin-input"
            type="text"
            inputmode="numeric"
            maxlength="4"
            autocomplete="off"
            placeholder="4-digit PIN"
            value=${pin}
            onInput=${e => setPin(e.target.value)}
            disabled=${busy}
            required
          />
        </div>
        <div class="field">
          <label for="username-input">Your name</label>
          <input
            id="username-input"
            type="text"
            autocomplete="off"
            placeholder="Enter your name"
            value=${username}
            onInput=${e => setUsername(e.target.value)}
            disabled=${busy}
            required
          />
        </div>
        ${error && html`
          <div class="alert alert-error" role="alert" aria-live="assertive">
            ${error}
          </div>
        `}
        <button class="btn btn-primary" type="submit" disabled=${busy}>
          ${busy ? 'Joining…' : 'Join session'}
        </button>
      </form>
    </main>
  `;
}

// ReactionBar ─────────────────────────────────────────────────────────────────

function ReactionBar({ messageId, reactions, myUsername, onReact, disabled }) {
  return html`
    <div class="reaction-bar" role="group" aria-label="Reactions">
      ${EMOJIS.map(emoji => {
        const count = reactions[emoji] || 0;
        const pressed = reactions['__mine_' + emoji] === true;
        const label = `${EMOJI_LABELS[emoji]}, ${count} reaction${count !== 1 ? 's' : ''}`;
        return html`
          <button
            key=${emoji}
            class="reaction-btn"
            type="button"
            aria-label=${label}
            aria-pressed=${String(pressed)}
            disabled=${disabled}
            onClick=${() => onReact(messageId, emoji)}
          >
            <span aria-hidden="true">${emoji}</span>
            ${count > 0 && html`<span class="reaction-count" aria-hidden="true">${count}</span>`}
          </button>
        `;
      })}
    </div>
  `;
}

// MessageItem ─────────────────────────────────────────────────────────────────

function MessageItem({ msg, isReply, username, onReact, onSendReply, sessionEnded }) {
  const [replyOpen, setReplyOpen]   = useState(false);
  const [replyText, setReplyText]   = useState('');
  const [replySending, setReplySending] = useState(false);
  const replyInputRef               = useRef(null);
  const replyListId                 = `replies-${msg.id}`;
  const replies                     = msg.replies || [];

  function toggleReplies() {
    const next = !replyOpen;
    setReplyOpen(next);
    if (next) {
      // Move focus to reply input when expanding
      setTimeout(() => replyInputRef.current?.focus(), 50);
    }
  }

  async function handleSendReply(e) {
    e.preventDefault();
    const text = replyText.trim();
    if (!text) return;
    setReplySending(true);
    try {
      await onSendReply(msg.id, text);
      setReplyText('');
    } finally {
      setReplySending(false);
    }
  }

  return html`
    <article class=${`message-item${isReply ? ' is-reply' : ''}`}>
      <div class="message-meta">
        <span class="message-author">${msg.username}</span>
        <time class="message-time" datetime=${msg.created_at}>${formatTime(msg.created_at)}</time>
      </div>
      <p class="message-body">${msg.body}</p>
      <${ReactionBar}
        messageId=${msg.id}
        reactions=${msg.reactions || {}}
        myUsername=${username}
        onReact=${onReact}
        disabled=${sessionEnded}
      />
      ${!isReply && html`
        <div class="reply-toggle-row">
          <button
            class="reply-toggle-btn"
            type="button"
            aria-expanded=${String(replyOpen)}
            aria-controls=${replyListId}
            onClick=${toggleReplies}
          >
            ${replyOpen
              ? 'Hide replies'
              : replies.length > 0
                ? `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`
                : 'Reply'}
          </button>
        </div>
        ${replyOpen && html`
          <ul id=${replyListId} class="reply-list" aria-label="Replies">
            ${replies.map(r => html`
              <li key=${r.id}>
                <${MessageItem}
                  msg=${r}
                  isReply=${true}
                  username=${username}
                  onReact=${onReact}
                  onSendReply=${onSendReply}
                  sessionEnded=${sessionEnded}
                />
              </li>
            `)}
          </ul>
          ${!sessionEnded && html`
            <form class="reply-form" onSubmit=${handleSendReply}>
              <input
                ref=${replyInputRef}
                type="text"
                placeholder="Write a reply…"
                aria-label="Reply to this message"
                value=${replyText}
                onInput=${e => setReplyText(e.target.value)}
                disabled=${replySending}
                maxlength="1000"
              />
              <button
                class="btn-reply-send"
                type="submit"
                aria-label="Send reply"
                disabled=${replySending || !replyText.trim()}
              >↵</button>
            </form>
          `}
        `}
      `}
    </article>
  `;
}

// MessageFeed ─────────────────────────────────────────────────────────────────

function MessageFeed({ messages, username, onReact, onSendReply, sessionEnded, feedRef, onScroll }) {
  return html`
    <section
      ref=${feedRef}
      class="message-feed"
      aria-label="Messages"
      aria-live="polite"
      aria-relevant="additions"
      onScroll=${onScroll}
    >
      ${messages.length === 0 && html`
        <p style="color: var(--muted); font-size: 0.9rem; text-align: center; margin-top: 2rem;">
          No messages yet. Be the first to say something!
        </p>
      `}
      ${messages.map(msg => html`
        <${MessageItem}
          key=${msg.id}
          msg=${msg}
          isReply=${false}
          username=${username}
          onReact=${onReact}
          onSendReply=${onSendReply}
          sessionEnded=${sessionEnded}
        />
      `)}
    </section>
  `;
}

// PollCard ────────────────────────────────────────────────────────────────────

function PollCard({ poll, results, voted, onVote }) {
  const [selected, setSelected]         = useState(null);
  const [submitting, setSubmitting]     = useState(false);
  const [dismissed, setDismissed]       = useState(false);
  // collapsed: true after voting — shows compact button instead of full form
  // initialized from voted prop to handle page-reload case
  const [collapsed, setCollapsed] = useState(!!voted);

  async function handleVote(e) {
    e.preventDefault();
    if (selected === null) return;
    setSubmitting(true);
    try {
      await onVote(poll.id, selected);
      setCollapsed(true);
    } catch (err) {
      if (err.status === 409) setCollapsed(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (results) {
    if (dismissed) return null;
    // results = { id, prompt, results: [{ option, votes }] }
    const rows  = results.results || [];
    const total = rows.reduce((s, r) => s + r.votes, 0);
    return html`
      <div class="poll-card" role="region" aria-label="Poll results">
        <fieldset>
          <legend>📊 ${results.prompt || poll?.prompt || 'Poll results'}</legend>
          ${rows.map((r, i) => {
            const pct = total > 0 ? Math.round((r.votes / total) * 100) : 0;
            return html`
              <div key=${i} class="poll-result-row">
                <div class="poll-results-label">
                  <span>${r.option}</span>
                  <span>${r.votes} vote${r.votes !== 1 ? 's' : ''} (${pct}%)</span>
                </div>
                <div
                  class="poll-result-bar-track"
                  role="progressbar"
                  aria-valuenow=${pct}
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-label=${`${r.option}: ${pct}%`}
                >
                  <div class="poll-result-bar-fill" style=${`width:${pct}%`}></div>
                </div>
              </div>
            `;
          })}
          <!-- Screen-reader accessible table alternative -->
          <table class="sr-only">
            <caption>Poll results</caption>
            <thead><tr><th>Option</th><th>Votes</th><th>Percent</th></tr></thead>
            <tbody>
              ${rows.map((r, i) => {
                const pct = total > 0 ? Math.round((r.votes / total) * 100) : 0;
                return html`<tr key=${i}><td>${r.option}</td><td>${r.votes}</td><td>${pct}%</td></tr>`;
              })}
            </tbody>
          </table>
          <button class="btn btn-secondary poll-dismiss-btn" onClick=${() => setDismissed(true)}>
            Dismiss
          </button>
        </fieldset>
      </div>
    `;
  }

  if (!poll) return null;

  if (collapsed) {
    return html`
      <div class="poll-card poll-card--compact" role="region" aria-label="Active poll">
        <p class="poll-voted-summary">✓ ${poll.prompt}</p>
        <button class="btn btn-secondary" onClick=${() => setCollapsed(false)}>
          Change your response
        </button>
      </div>
    `;
  }

  // Show open voting UI
  return html`
    <div class="poll-card" role="region" aria-label="Active poll">
      <form onSubmit=${handleVote}>
        <fieldset>
          <legend>${poll.prompt}</legend>
          <div class="poll-options">
            ${poll.options.map((opt, i) => html`
              <label key=${i} class="poll-option-label">
                <input
                  type="radio"
                  name=${`poll-${poll.id}`}
                  value=${i}
                  checked=${selected === i}
                  onChange=${() => setSelected(i)}
                  disabled=${submitting}
                />
                ${opt}
              </label>
            `)}
          </div>
          <button
            class="btn btn-primary"
            type="submit"
            disabled=${selected === null || submitting}
          >
            ${submitting ? 'Submitting…' : 'Submit vote'}
          </button>
        </fieldset>
      </form>
    </div>
  `;
}

// MessageInput ────────────────────────────────────────────────────────────────

function MessageInput({ onSend, sessionEnded, inputRef }) {
  const [text, setText]     = useState('');
  const [sending, setSending] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending || sessionEnded) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setText('');
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    // Enter (without Shift) = submit; Shift+Enter = newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return html`
    <div class="input-bar">
      <form class="input-bar-form" onSubmit=${handleSubmit}>
        <textarea
          ref=${inputRef}
          id="message-input"
          rows="1"
          placeholder=${sessionEnded ? 'Session has ended' : 'Type a message… (Enter to send)'}
          aria-label="Message"
          value=${text}
          onInput=${e => setText(e.target.value)}
          onKeyDown=${handleKeyDown}
          disabled=${sessionEnded || sending}
          maxlength="1000"
        ></textarea>
        <button
          class="btn-send-main"
          type="submit"
          aria-label="Send message"
          disabled=${!text.trim() || sessionEnded || sending}
        >↑</button>
      </form>
    </div>
  `;
}

// LogoutDialog ────────────────────────────────────────────────────────────────

function LogoutDialog({ onLogout, onCancel, triggerRef }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    // Browser fires 'cancel' on Escape and closes the dialog automatically
    function handleCancel() {
      triggerRef.current?.focus();
      onCancel();
    }
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, []);

  function dismiss() {
    dialogRef.current?.close();
    triggerRef.current?.focus();
    onCancel();
  }

  async function handleLogout() {
    dialogRef.current?.close();
    await onLogout();
  }

  return html`
    <dialog ref=${dialogRef} class="logout-dialog" aria-labelledby="logout-dialog-title">
      <h2 id="logout-dialog-title">Log out?</h2>
      <p>You will return to the join screen.</p>
      <div class="logout-dialog-actions">
        <button class="btn btn-danger" onClick=${handleLogout}>Log out</button>
        <button class="btn btn-secondary" onClick=${dismiss}>Cancel</button>
      </div>
    </dialog>
  `;
}

// ChatScreen ──────────────────────────────────────────────────────────────────

function ChatScreen({ token, username, pin, onSessionEnd }) {
  const [messages, setMessages]         = useState([]);
  const [activePoll, setActivePoll]     = useState(null);
  const [votedPollId, setVotedPollId]   = useState(null);
  const [pollResults, setPollResults]   = useState(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [loadError, setLoadError]       = useState('');

  const [showLogoutDialog, setShowLogoutDialog] = useState(false);

  const feedRef      = useRef(null);
  const inputRef     = useRef(null);
  const sseRef       = useRef(null);
  const logoutBtnRef = useRef(null);
  // Track whether user has scrolled up (to suppress auto-scroll)
  const userScrolledUp = useRef(false);

  // ── Scroll helpers ──────────────────────────────────────────────────────────

  function scrollToBottom(force = false) {
    const el = feedRef.current;
    if (!el) return;
    if (force || !userScrolledUp.current) {
      el.scrollTop = el.scrollHeight;
    }
  }

  function handleFeedScroll() {
    const el = feedRef.current;
    if (!el) return;
    const threshold = 80;
    userScrolledUp.current = el.scrollTop + el.clientHeight < el.scrollHeight - threshold;
  }

  // ── Message state helpers ───────────────────────────────────────────────────

  function addMessage(newMsg) {
    setMessages(prev => {
      if (newMsg.parent_id) {
        // Add as a reply to its parent
        return prev.map(m =>
          m.id === newMsg.parent_id
            ? { ...m, replies: [...(m.replies || []), newMsg] }
            : m
        );
      }
      // Top-level message — avoid duplicates
      if (prev.some(m => m.id === newMsg.id)) return prev;
      return [...prev, { ...newMsg, replies: newMsg.replies || [] }];
    });
  }

  function updateReactions(messageId, reactions) {
    setMessages(prev => prev.map(m => {
      if (m.id === messageId) return { ...m, reactions };
      // Also check replies
      const updatedReplies = (m.replies || []).map(r =>
        r.id === messageId ? { ...r, reactions } : r
      );
      return { ...m, replies: updatedReplies };
    }));
  }

  // ── SSE event handler ───────────────────────────────────────────────────────

  const handleSseEvent = useCallback((event) => {
    switch (event.type) {
      case 'message_new':
        addMessage(event.message);
        break;
      case 'reaction_update':
        updateReactions(event.message_id, event.reactions);
        break;
      case 'poll_new':
        setActivePoll(event.poll);
        setPollResults(null);
        break;
      case 'poll_closed':
        setActivePoll(null);
        setVotedPollId(null);
        setPollResults(event.poll);
        break;
      case 'session_ended':
        setSessionEnded(true);
        clearSession();
        sseRef.current?.stop();
        break;
    }
  }, []);

  // ── Load messages ───────────────────────────────────────────────────────────

  async function loadMessages() {
    try {
      const data = await apiFetch('/messages', { token });
      // Normalize: add empty replies array if absent
      const normalized = (data.messages || []).map(m => ({
        ...m,
        replies: m.replies || [],
      }));
      // Merge with any SSE-delivered messages that arrived before this fetch resolved
      setMessages(prev => {
        const ids = new Set(normalized.map(m => m.id));
        const sseOnly = prev.filter(m => !ids.has(m.id));
        return [...normalized, ...sseOnly].sort((a, b) => a.id - b.id);
      });
      if (data.active_poll) setActivePoll(data.active_poll);
    } catch (err) {
      if (err.status === 401) {
        clearSession();
        onSessionEnd();
        return;
      }
      setLoadError('Failed to load messages. Please reload the page.');
    }
  }

  // ── Connect SSE ─────────────────────────────────────────────────────────────

  function connectSse() {
    sseRef.current?.stop();
    sseRef.current = createSseClient(token, handleSseEvent);
  }

  // ── On mount ────────────────────────────────────────────────────────────────

  useEffect(() => {
    connectSse(); // Register with server immediately — don't wait for message load
    loadMessages();
    setTimeout(() => inputRef.current?.focus(), 100);
    return () => sseRef.current?.stop();
  }, []);

  // ── Auto-scroll when messages change ────────────────────────────────────────

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // ── API actions ─────────────────────────────────────────────────────────────

  async function handleSend(body) {
    await apiFetch('/message', { token, method: 'POST', body: { body } });
    // SSE will deliver the message_new event; no local state update needed
  }

  async function handleSendReply(parentId, body) {
    await apiFetch('/message', { token, method: 'POST', body: { body, parent_id: parentId } });
  }

  async function handleReact(messageId, emoji) {
    await apiFetch('/react', { token, method: 'POST', body: { message_id: messageId, emoji } });
    // SSE will deliver reaction_update
  }

  async function handleVote(pollId, choice) {
    await apiFetch('/vote', { token, method: 'POST', body: { poll_id: pollId, choice } });
    setVotedPollId(pollId);
  }

  async function handleLogout() {
    try {
      await apiFetch('/session/leave', { token, method: 'DELETE' });
    } catch (_) {
      // Clear local session regardless of server response
    }
    clearSession();
    onSessionEnd();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return html`
    <main class="chat-shell">
      <header class="chat-header">
        <h1>Lecture Chat</h1>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0.1rem;">
          ${pin && html`<span style="font-size:0.75rem; font-weight:700; color:var(--accent); letter-spacing:0.1em;">PIN: ${pin}</span>`}
          <button
            ref=${logoutBtnRef}
            class="username-badge"
            aria-label=${`Signed in as ${username}. Click to log out.`}
            onClick=${() => setShowLogoutDialog(true)}
          >
            ${username}
          </button>
        </div>
      </header>

      ${showLogoutDialog && html`
        <${LogoutDialog}
          onLogout=${handleLogout}
          onCancel=${() => setShowLogoutDialog(false)}
          triggerRef=${logoutBtnRef}
        />
      `}

      ${loadError && html`
        <div class="alert alert-error" role="alert" aria-live="assertive" style="margin: 0.75rem;">
          ${loadError}
        </div>
      `}

      <${MessageFeed}
        messages=${messages}
        username=${username}
        onReact=${handleReact}
        onSendReply=${handleSendReply}
        sessionEnded=${sessionEnded}
        feedRef=${feedRef}
        onScroll=${handleFeedScroll}
      />

      ${(activePoll || pollResults) && html`
        <${PollCard}
          poll=${activePoll}
          results=${pollResults}
          voted=${votedPollId === activePoll?.id}
          onVote=${handleVote}
        />
      `}

      ${sessionEnded
        ? html`<div class="session-ended-banner" role="alert" aria-live="assertive">
            Session has ended. Thanks for participating!
          </div>`
        : html`<${MessageInput}
            onSend=${handleSend}
            sessionEnded=${sessionEnded}
            inputRef=${inputRef}
          />`
      }
    </main>
  `;
}

// ── App root ──────────────────────────────────────────────────────────────────

function App() {
  const saved = loadSession();
  const [screen, setScreen]   = useState(saved ? 'chat' : 'join');
  const [token, setToken]     = useState(saved?.token || null);
  const [username, setUsername] = useState(saved?.username || null);
  const [pin, setPin]         = useState(saved?.pin || null);

  function handleJoined(newToken, newUsername, newPin) {
    setToken(newToken);
    setUsername(newUsername);
    setPin(newPin);
    setScreen('chat');
  }

  function handleSessionEnd() {
    clearSession();
    setToken(null);
    setUsername(null);
    setPin(null);
    setScreen('join');
  }

  if (screen === 'join') {
    return html`<${JoinScreen} onJoined=${handleJoined} />`;
  }
  return html`<${ChatScreen} token=${token} username=${username} pin=${pin} onSessionEnd=${handleSessionEnd} />`;
}

// ── Mount ─────────────────────────────────────────────────────────────────────

render(h(App, null), document.getElementById('app'));
