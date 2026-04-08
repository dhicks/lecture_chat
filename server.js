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
  PORT = 3000,
  DB_PATH = './data/chat.db',
} = process.env;

if (!INSTRUCTOR_PIN) {
  console.error('ERROR: INSTRUCTOR_PIN env var is required');
  process.exit(1);
}
if (!JWT_SECRET || JWT_SECRET === 'changeme_replace_with_random_string') {
  console.warn('WARNING: JWT_SECRET is not set or is using the default value');
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

// Build Fastify app
const app = Fastify({ logger: true });

// Plugins
app.register(require('@fastify/jwt'), { secret: JWT_SECRET });
app.register(require('@fastify/cookie'));
app.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/',
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
