'use strict';

const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

async function hashPin(pin) {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

function checkPin(pin, hash) {
  return bcrypt.compare(pin, hash);
}

async function requireInstructor(req, reply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  if (req.user.role !== 'instructor') {
    return reply.code(403).send({ error: 'Forbidden' });
  }
}

async function requireStudent(req, reply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  if (req.user.role !== 'student') {
    return reply.code(403).send({ error: 'Forbidden' });
  }
}

module.exports = { hashPin, checkPin, requireInstructor, requireStudent };
