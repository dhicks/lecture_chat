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
   ROSTER_PATH=./data/roster.csv  # CSV of enrolled student IDs (see "Student roster" below)
   ```

   To generate a good `JWT_SECRET`, run:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Copy the output into your `.env` file.

4. Create the student roster (see [Student roster](#student-roster)). The server does not start without it.

5. Verify the setup by running the test suites:

   ```bash
   # Unit and integration tests
   npm test

   # End-to-end regression test (run from the project root)
   bash test/regression.sh
   ```

   Both should pass with no errors.

---

## Student roster

Students join with their numeric student ID, the session PIN, and a username of their choice. The server checks the ID against a CSV file, `data/roster.csv` by default (change the location with `ROSTER_PATH`). The `data/` directory is not committed to git.

The file needs a header row with a column named `student_id`. Other columns are ignored, so you can export the roster from a spreadsheet as-is:

```
student_id,name
1234567,Jane Doe
0004321,Rick Roe
```

- IDs are compared as text, so leading zeros matter: `0004321` and `4321` are different IDs.
- The file is re-read on every student login. To add or remove a student, edit the file; no restart is needed.
- If the file is missing, empty, or has no `student_id` column, the server exits at startup with an error message.

### What is logged

Each message is saved with the sender's student ID and the IP address of the device that sent it. Both appear in the exported session log (`student_id` and `ip_address` on each message and reply). Students see only usernames. The join screen tells students that their ID and IP address are recorded.

The IP address is the address at the moment the message was sent. Students on the same campus network may share an IP address, and a phone switching between Wi-Fi and cellular changes it. Reactions and poll votes are stored with usernames only.

For the logged IP to be the student's and not the hosting provider's proxy, `TRUST_PROXY_HOPS` must match the number of proxies in front of the server: `0` locally, and on Railway a value that you confirm against a real request (expected: `1`).

### Rate limits

Once a student has joined, limits (12 messages per minute, 5 live-stream connections per minute) apply to that student's ID, not to their IP address. Students who share one IP address, such as a class on campus wifi, do not share a limit. Requests without a valid student token, such as joining and instructor login, are limited per IP address. Joining allows 300 requests per minute per IP address so a whole class can join at the start of a lecture; instructor login allows 5.

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

To close the server, use `Ctrl + \`

---

## Running a session

### 1. Log in

Open the instructor dashboard and enter your 6-digit instructor PIN. Click **Sign in**.

### 2. Start a session

Click **Start session**. A 4-digit session PIN appears in large text. This is what students will use to join.

### 3. Share the PIN with students

- Click **Copy PIN** to copy it to your clipboard
- Paste it into your lecture slides, write it on the board, or project the dashboard itself
- Students go to your app URL, enter their student ID, the PIN, and a username, and they're in

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
| `ROSTER_PATH` | `/data/roster.csv` |
| `TRUST_PROXY_HOPS` | `1` (confirm; see [What is logged](#what-is-logged)) |

The roster file must exist on the persistent volume at `ROSTER_PATH` before the deploy starts; the server exits at startup without it.

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
| `ROSTER_PATH` | No | `./data/roster.csv` | CSV file of enrolled students, with a `student_id` column. Re-read on every student login. The file must exist at startup. |
| `TRUST_PROXY_HOPS` | No | `0` | Number of proxies in front of the server. Determines the client IP that is logged with each message and used to rate-limit requests without a student token. |
