'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const Fastify = require('fastify');
const Database = require('better-sqlite3');
const { migrate } = require('./db/migrate');
const { loadRoster } = require('./lib/roster');

const {
  INSTRUCTOR_PIN,
  JWT_SECRET,
  PORT = 80,
  DB_PATH = './data/chat.db',
  ROSTER_PATH = './data/roster.csv',
  TRUST_PROXY_HOPS = '0',
} = process.env;

if (!INSTRUCTOR_PIN) {
  console.error('ERROR: INSTRUCTOR_PIN env var is required');
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET env var is required');
  process.exit(1);
}

// Fail at startup if the roster is missing or malformed, rather than at the
// first student login. /join re-reads the file, so later edits need no restart.
try {
  const enrolled = loadRoster(ROSTER_PATH);
  console.log(`Loaded roster: ${enrolled.size} student IDs from ${path.resolve(ROSTER_PATH)}`);
} catch (err) {
  console.error(`ERROR: cannot load roster: ${err.message}`);
  process.exit(1);
}

const trustProxyHops = Number(TRUST_PROXY_HOPS);
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
  console.error('ERROR: TRUST_PROXY_HOPS must be a non-negative integer');
  process.exit(1);
}

// Ensure data directory exists
const dbDir = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dbDir)) {
  console.error(`ERROR: DB directory does not exist: ${dbDir}`);
  process.exit(1);
}

// Open DB and run migration
const db = new Database(DB_PATH);
migrate(db);

// Build Fastify app.
// trustProxy makes req.ip the client address that the last trusted proxy saw
// (from X-Forwarded-For) instead of the proxy's own address. The message log
// and the rate limiter for unauthenticated requests both use req.ip. A fixed
// hop count, not `true`, so a client cannot choose its own logged IP by
// sending an X-Forwarded-For header.
const app = Fastify({ logger: true, trustProxy: trustProxyHops });

// Rate-limit key. Students on one campus network may share a single public IP,
// so requests carrying a valid student token are limited per student ID, not
// per IP. Everything else (/join, instructor login, missing or invalid tokens)
// is limited per IP. The token is verified, not just decoded: a forged token
// must not be able to choose its own bucket.
function rateLimitKey(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    try {
      const claims = app.jwt.verify(header.slice('Bearer '.length));
      if (claims.role === 'student' && claims.student_id) return `student:${claims.student_id}`;
    } catch {
      // invalid or expired token: fall through to the IP key
    }
  }
  return req.ip;
}

// Plugins
app.register(require('@fastify/jwt'), { secret: JWT_SECRET });
app.register(require('@fastify/cookie'));
app.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/',
});
app.register(require('@fastify/rate-limit'), {
  global: true,
  max: 60,
  timeWindow: '1 minute',
  keyGenerator: rateLimitKey,
  errorResponseBuilder: (_req, context) => ({
    statusCode: context.statusCode,
    error: `Too many requests — try again in ${context.after}`,
  }),
});

// Make db available to routes via decorator
app.decorate('db', db);
app.decorate('rosterPath', ROSTER_PATH);

// Routes (stubs — filled in later phases)
app.register(require('./routes/auth'),     { prefix: '/' });
app.register(require('./routes/session'),  { prefix: '/session' });
app.register(require('./routes/messages'), { prefix: '/' });
app.register(require('./routes/reactions'),{ prefix: '/' });
app.register(require('./routes/polls'),    { prefix: '/' });
app.register(require('./routes/stream'),   { prefix: '/' });

// Health check
app.get('/healthz', async () => ({ status: 'ok' }));

// Start
app.listen({ port: Number(PORT), host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => app.close().then(() => { db.close(); process.exit(0); }));
}
