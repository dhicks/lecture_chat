// ── Shared frontend components ────────────────────────────────────────────────
// Used by both app.js (student) and instructor.js.
//
// Kept separate from lib.js, which must stay free of Preact/htm imports so the
// test suite can import it in Node — Node cannot resolve https: specifiers.

import { h } from 'https://esm.sh/preact@10';
import htm from 'https://esm.sh/htm@3';
const html = htm.bind(h);

// ── ConnectionDot ─────────────────────────────────────────────────────────────
// Shows whether the SSE stream is currently connected. A dropped stream is
// otherwise silent: the page looks normal and simply stops updating.
//
// The dot element is itself the live region, and its accessible name comes from
// the visually-hidden text child. Changing the text content of a role="status"
// region announces reliably across screen readers; mutating an aria-label does
// not. State changes are infrequent, so a live region is appropriate here.

export function ConnectionDot({ connected }) {
  return html`
    <span
      class="conn-dot"
      data-connected=${String(connected)}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span class="sr-only">
        ${connected ? 'Live updates connected' : 'Live updates disconnected'}
      </span>
    </span>
  `;
}
