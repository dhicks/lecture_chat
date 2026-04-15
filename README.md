# Lecture Chat

A lightweight, real-time chat system for use during large university lectures. Students join via a browser with a session PIN shown on the lecture slides and a self-chosen username — no accounts required. The instructor controls the session from a separate dashboard.

## Features

- **Live message feed** with reply threads (one level deep)
- **Emoji reactions** on any message (toggled, broadcast in real time)
- **Polls** — instructor creates, students vote; results hidden until instructor closes the poll
- **Session log export** (JSON) after class
- **No accounts** — students authenticate with a session PIN + username only
- SSE-based real-time updates; no WebSocket dependency
- WCAG 2.1 AA accessible

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20+ |
| Framework | Fastify |
| Database | SQLite via `better-sqlite3` |
| Auth | `@fastify/jwt` (signed JWTs) |
| Frontend | Vanilla JS + Preact via CDN (no build step) |
| Hosting | Railway (configured) |

## Quick start (local)

```bash
git clone <repo-url>
cd lecture_chat
npm install
cp .env.example .env        # then edit .env
npm start                   # server runs on http://localhost:3000
```

Open `http://localhost:3000/instructor.html` in one tab (instructor dashboard) and `http://localhost:3000` in another (student view).

See [docs/instructor-guide.md](docs/instructor-guide.md) for full setup, session workflow, deployment, and environment variable reference.
