// backend/src/middleware/requestId.js
// Simple correlation ID middleware. Sets req.id and X-Request-Id header.
const { randomUUID } = require('crypto');

module.exports = function requestId(req, res, next) {
  try {
    const incoming = req.header('X-Request-Id');
    const id = incoming && typeof incoming === 'string' && incoming.trim().length > 0
      ? incoming.trim()
      : randomUUID();
    req.id = id;
    res.setHeader('X-Request-Id', id);
  } catch (_) {
    // ignore
  }
  next();
};