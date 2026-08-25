'use strict';

// Encode HTML special characters to prevent stored XSS if user content is ever
// rendered in an unescaped context (defence in depth alongside Preact's escaping).
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function sanitize(str) {
  return str.replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
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

async function requireStudentOrInstructor(req, reply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  if (req.user.role !== 'student' && req.user.role !== 'instructor') {
    return reply.code(403).send({ error: 'Forbidden' });
  }
}

module.exports = { requireInstructor, requireStudent, requireStudentOrInstructor, sanitize };
