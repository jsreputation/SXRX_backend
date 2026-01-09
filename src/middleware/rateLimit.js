// backend/src/middleware/rateLimit.js
// Minimal in-memory rate limiter (IP/email aware) to protect sensitive endpoints
// Note: For production, prefer a distributed store like Redis.

const buckets = new Map(); // key -> number[] of epoch ms timestamps

function cleanupOld(now, arr, windowMs) {
  while (arr.length && now - arr[0] > windowMs) arr.shift();
  return arr;
}

function createRateLimiter({ windowMs = 60_000, max = 10, keyGenerator }) {
  return function rateLimiter(req, res, next) {
    try {
      const now = Date.now();
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      const email = req.body?.email && typeof req.body.email === 'string' ? req.body.email.toLowerCase() : null;
      const key = (keyGenerator && keyGenerator(req)) || `${req.method}:${req.baseUrl || ''}${req.path}:${email || ''}:${ip}`;

      const arr = buckets.get(key) || [];
      cleanupOld(now, arr, windowMs);
      if (arr.length >= max) {
        const retryAfterSec = Math.ceil((windowMs - (now - arr[0])) / 1000);
        res.setHeader('Retry-After', String(retryAfterSec));
        return res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' });
      }
      arr.push(now);
      buckets.set(key, arr);
      next();
    } catch (e) {
      // Fail-open on limiter errors
      next();
    }
  };
}

module.exports = { createRateLimiter };