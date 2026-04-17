'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const Fastify = require('fastify');
const Database = require('better-sqlite3');
const { migrate } = require('./db/migrate');

const {
  INSTRUCTOR_PIN,
  JWT_SECRET,
  PORT = 80,
  DB_PATH = './data/chat.db',
} = process.env;

if (!INSTRUCTOR_PIN) {
  console.error('ERROR: INSTRUCTOR_PIN env var is required');
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET env var is required');
  process.exit(1);
}

// Open DB and run migration
const db = new Database(DB_PATH);
migrate(db);

// Build Fastify app
const app = Fastify({ logger: true });

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
  errorResponseBuilder: (_req, context) => ({
    error: `Too many requests — try again in ${context.after}`,
  }),
});

// Make db available to routes via decorator
app.decorate('db', db);

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
