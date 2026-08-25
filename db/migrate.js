'use strict';

const fs = require('fs');
const path = require('path');

function migrate(db) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);

  // The instructor PIN moved from a bcrypt hash in this table to the
  // INSTRUCTOR_PIN environment variable, read on each login. Drop the table so
  // existing databases stop carrying a stale hash.
  db.exec('DROP TABLE IF EXISTS instructor');

  db.pragma('foreign_keys = ON');
}

module.exports = { migrate };
