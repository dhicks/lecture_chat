'use strict';

const fs = require('fs');

// Split one CSV line into fields. Handles double-quoted fields (which may
// contain commas) and "" as an escaped quote. Roster lines never contain
// embedded newlines, so records are split on line breaks before this runs.
function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

// Read the roster CSV and return a Set of student ID strings. IDs stay strings
// so leading zeros are preserved. The file needs a header row with a column
// named "student_id"; other columns are ignored. Throws if the file cannot be
// read or has no student_id column.
function loadRoster(path) {
  // Excel and Google Sheets can prepend a byte-order mark to CSV exports
  const text = fs.readFileSync(path, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length === 0) throw new Error(`Roster file is empty: ${path}`);

  const header = parseCsvLine(lines[0]).map(name => name.trim().toLowerCase());
  const idColumn = header.indexOf('student_id');
  if (idColumn === -1) {
    throw new Error(`Roster file has no "student_id" column in its header row: ${path}`);
  }

  const ids = new Set();
  for (const line of lines.slice(1)) {
    const id = (parseCsvLine(line)[idColumn] || '').trim();
    if (id) ids.add(id);
  }
  return ids;
}

module.exports = { loadRoster };
