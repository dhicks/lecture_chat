# Instructor Guide

Everything you need to set up, run, and deploy the lecture chat system.

---

## Prerequisites

- **Node.js 20** or later ([download](https://nodejs.org/))
- **git** (to clone the repository)
- A terminal (Terminal.app on macOS, or the integrated terminal in your editor)

---

## Setup

1. Clone the repository and install dependencies:

   ```bash
   git clone <repo-url>
   cd lecture_chat
   npm install
   ```

2. Create your environment file:

   ```bash
   cp .env.example .env
   ```

3. Open `.env` in a text editor and fill in the required values:

   ```
   INSTRUCTOR_PIN=123456          # Choose a 6-digit PIN you'll use to log in
   JWT_SECRET=change-me           # A long random string (see below)
   PORT=80                         # Port the server listens on (80 is the standard HTTP port)
   DB_PATH=./data/chat.db         # Where the SQLite database is stored
   ```

   To generate a good `JWT_SECRET`, run:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Copy the output into your `.env` file.

4. Verify the setup by running the test suites:

   ```bash
   # Unit and integration tests
   npm test

   # End-to-end regression test (run from the project root)
   bash test/regression.sh
   ```

   Both should pass with no errors.

---

## Running locally

Start the server:

```bash
npm start
```

Then open two browser tabs:

| Tab | URL | Purpose |
|---|---|---|
| Instructor dashboard | `http://localhost/instructor.html` | Manage sessions, polls, and view messages |
| Student view | `http://localhost` | What students see on their devices |

---

## Running a session

### 1. Log in

Open the instructor dashboard and enter your 6-digit instructor PIN. Click **Sign in**.

### 2. Start a session

Click **Start session**. A 4-digit session PIN appears in large text. This is what students will use to join.

### 3. Share the PIN with students

- Click **Copy PIN** to copy it to your clipboard
- Paste it into your lecture slides, write it on the board, or project the dashboard itself
- Students go to your app URL, enter the PIN and a username, and they're in

### 4. Monitor the message feed

Student messages appear in real time in the Messages panel on the right. Replies are grouped under their parent message and can be expanded.

### 5. Create a poll

In the Polls panel:

1. Type your question (up to 300 characters)
2. Enter 2 to 4 answer options (click **Add option** for more, the **-** button to remove one)
3. Click **Send poll to students**

Students see a voting card. You see live vote tallies as they come in. Students do not see results until you close the poll.

### 6. Close the poll

Click **Close poll & show results**. Results (with vote counts and percentages) are instantly revealed to all students. Closed polls are archived in the "Closed polls" section at the bottom of the Polls panel.

### 7. End the session

Click **End session**. A confirmation dialog asks you to confirm -- this disconnects all students and cannot be undone. Once confirmed, the session is closed and no new students can join.

### 8. Export the session log

You can export at any time while the session is active by clicking **Export session log (JSON)** below the Polls panel. The file downloads as `session-<id>.json`.

After ending a session, the right panel switches to **Past sessions**, where you can export logs from any previous session.

---

## Deploying to Railway

### Initial setup

1. Create a [Railway](https://railway.com/) account and connect your GitHub repository
2. Railway will detect the `railway.toml` configuration automatically

### Set environment variables

In the Railway dashboard, add these variables to your service:

| Variable | Value |
|---|---|
| `INSTRUCTOR_PIN` | Your chosen 6-digit PIN |
| `JWT_SECRET` | A long random string (generate one as described in Setup) |
| `DB_PATH` | `/data/chat.db` |
| `PORT` | `80` |

To change the instructor PIN later, edit `INSTRUCTOR_PIN` and redeploy. The server reads it on every login, so the new PIN takes effect as soon as the deploy goes live.

### Persistent storage

The SQLite database must survive redeployments. In Railway:

1. Add a **Volume** to your service
2. Set the mount path to `/data`
3. This ensures `DB_PATH=/data/chat.db` points to persistent storage

Without this step, your chat history will be lost on every deploy.

### Health check

The app exposes a `/healthz` endpoint that Railway uses to verify the deploy succeeded. This is already configured in `railway.toml` -- no action needed.

### Deploying updates

Push to your connected branch. Railway rebuilds and deploys automatically. Verify with:

```bash
curl https://<your-app>.up.railway.app/healthz
```

A `200` response means the server is running.

---

## Environment variable reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `INSTRUCTOR_PIN` | Yes | -- | 6-digit PIN for instructor login. Read from the environment on every login. To change the PIN, edit this variable and redeploy. |
| `JWT_SECRET` | Yes | -- | Secret key for signing authentication tokens. Use a long random string. |
| `PORT` | No | `80` | Port the server listens on. |
| `DB_PATH` | No | `./data/chat.db` | Path to the SQLite database file. On Railway, set to `/data/chat.db` with a mounted volume. |
