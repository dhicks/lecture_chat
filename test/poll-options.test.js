'use strict';

// Tests for parseOptions (public/poll-options.js), which turns the poll
// options textarea into an array of option strings.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'poll-options.js')));

test('parses a dash list', async () => {
  const { parseOptions } = await load();
  assert.deepEqual(parseOptions('- A\n- B\n- C'), ['A', 'B', 'C']);
});

test('accepts *, + and - markers in one list', async () => {
  const { parseOptions } = await load();
  assert.deepEqual(parseOptions('* A\n+ B\n- C'), ['A', 'B', 'C']);
});

test('trims whitespace and skips blank lines', async () => {
  const { parseOptions } = await load();
  assert.deepEqual(parseOptions('  -   A  \n\n   \n- B\n'), ['A', 'B']);
});

test('keeps lines without a bullet', async () => {
  const { parseOptions } = await load();
  assert.deepEqual(parseOptions('A\n- B'), ['A', 'B']);
});

test('handles Windows line endings', async () => {
  const { parseOptions } = await load();
  assert.deepEqual(parseOptions('- A\r\n- B\r\n'), ['A', 'B']);
});

test('returns an empty array for empty input and drops lone markers', async () => {
  const { parseOptions } = await load();
  assert.deepEqual(parseOptions(''), []);
  assert.deepEqual(parseOptions('-\n- \n*'), []);
});

test('keeps hyphens inside an option and options that start with a hyphenated word', async () => {
  const { parseOptions } = await load();
  assert.deepEqual(parseOptions('- well-known\n-5 degrees'), ['well-known', '-5 degrees']);
});

test('does not cap the count (the caller enforces 2–12)', async () => {
  const { parseOptions } = await load();
  const text = Array.from({ length: 13 }, (_, i) => `- ${i}`).join('\n');
  assert.equal(parseOptions(text).length, 13);
});
