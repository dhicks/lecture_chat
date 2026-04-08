'use strict';

const fs = require('fs');
const path = require('path');

function migrate(db) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
}

module.exports = { migrate };
