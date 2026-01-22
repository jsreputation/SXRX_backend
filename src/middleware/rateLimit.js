// backend/src/middleware/rateLimit.js
// Enhanced rate limiter with Redis support for distributed limiting and per-user limits

const logger = require('../utils/logger');

// Fallback in-memory store for when Redis is unavailable
const buckets = new Map(); // key -> number[] of epoch ms timestamps

function cleanupOld(now, arr, windowMs) {
  while (arr.length && now - arr[0] > windowMs) arr.shift();
  return arr;
}

/**
 * Generate rate limit key from request
 * @param {Object} req - Express request object
 * @param {Function} keyGenerator - Custom key generator function
 * @returns {string} Rate limit key
 */
function generateKey(req, keyGenerator) {
  if (keyGenerator && typeof keyGenerator === 'function') {
    return keyGenerator(req);
  }
  
  // Try to get user ID from various sources
  const userId = req.user?.id || 
                 req.user?.customerId || 
                 req.user?.shopifyCustomerId ||
                 req.user?.sub ||
                 req.body?.customerId ||
                 req.params?.customerId ||
                 null;
  
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const email = req.body?.email && typeof req.body.email === 'string' ? req.body.email.toLowerCase() : null;
  const path = req.baseUrl || '' + req.path;
  
  // Prioritize user-based limiting over IP
  if (userId) {
    return `rate:user:${userId}:${req.method}:${path}`;
  } else if (email) {
    return `rate:email:${email}:${req.method}:${path}`;
  } else {
    return `rate:ip:${ip}:${req.method}:${path}`;
  }
}

/**
 * Rate limiter using Redis (distributed) with fallback to in-memory
 * @param {Object} options - Rate limiter options
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000)
 * @param {number} options.max - Maximum requests per window (default: 10)
 * @param {Function} options.keyGenerator - Custom key generator function
 * @param {boolean} options.useRedis - Whether to use Redis (default: true)
 * @returns {Function} Express middleware function
 */
function createRateLimiter({ windowMs = 60_000, max = 10, keyGenerator, useRedis = true }) {
  return async function rateLimiter(req, res, next) {
    try {
      const key = generateKey(req, keyGenerator);
      const now = Date.now();
      
      // Try Redis first if enabled
      if (useRedis) {
        try {
          const cacheService = require('../services/cacheService');
          if (cacheService.isAvailable()) {
            const redisKey = `rate:${key}`;
            
            // Get current count
            const count = await cacheService.client.get(redisKey);
            const currentCount = count ? parseInt(count) : 0;
            
            if (currentCount >= max) {
              // Calculate TTL
              const ttl = await cacheService.client.ttl(redisKey);
              const retryAfterSec = ttl > 0 ? ttl : Math.ceil(windowMs / 1000);
              
              // Add rate limit headers
              res.setHeader('X-RateLimit-Limit', String(max));
              res.setHeader('X-RateLimit-Remaining', '0');
              res.setHeader('X-RateLimit-Reset', String(Math.floor(now / 1000) + retryAfterSec));
              res.setHeader('Retry-After', String(retryAfterSec));
              
              logger.warn('[RATE_LIMIT] Rate limit exceeded', { key, count: currentCount, max });
              return res.status(429).json({ 
                success: false, 
                message: 'Too many requests. Please try again later.',
                error: 'RATE_LIMIT_EXCEEDED',
                retryAfter: retryAfterSec
              });
            }
            
            // Increment counter
            if (currentCount === 0) {
              // First request in window - set with TTL
              await cacheService.client.setEx(redisKey, Math.ceil(windowMs / 1000), '1');
            } else {
              // Increment existing counter
              await cacheService.client.incr(redisKey);
            }
            
            // Get updated count for headers
            const newCount = await cacheService.client.get(redisKey);
            const remaining = Math.max(0, max - parseInt(newCount || '0'));
            const ttl = await cacheService.client.ttl(redisKey);
            
            // Add rate limit headers
            res.setHeader('X-RateLimit-Limit', String(max));
            res.setHeader('X-RateLimit-Remaining', String(remaining));
            res.setHeader('X-RateLimit-Reset', String(Math.floor(now / 1000) + (ttl || Math.ceil(windowMs / 1000))));
            
            return next();
          }
        } catch (redisError) {
          logger.warn('[RATE_LIMIT] Redis error, falling back to in-memory', { error: redisError.message });
          // Fall through to in-memory implementation
        }
      }
      
      // Fallback to in-memory rate limiting
      const arr = buckets.get(key) || [];
      cleanupOld(now, arr, windowMs);
      
      if (arr.length >= max) {
        const retryAfterSec = Math.ceil((windowMs - (now - arr[0])) / 1000);
        res.setHeader('Retry-After', String(retryAfterSec));
        res.setHeader('X-RateLimit-Limit', String(max));
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset', String(Math.floor((arr[0] + windowMs) / 1000)));
        
        logger.warn('[RATE_LIMIT] Rate limit exceeded (in-memory)', { key, count: arr.length, max });
        return res.status(429).json({ 
          success: false, 
          message: 'Too many requests. Please try again later.',
          error: 'RATE_LIMIT_EXCEEDED',
          retryAfter: retryAfterSec
        });
      }
      
      arr.push(now);
      buckets.set(key, arr);
      
      // Add rate limit headers
      const remaining = max - arr.length;
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      res.setHeader('X-RateLimit-Reset', String(Math.floor((arr[0] + windowMs) / 1000)));
      
      next();
    } catch (e) {
      // Fail-open on limiter errors
      logger.error('[RATE_LIMIT] Error in rate limiter', { error: e.message });
      next();
    }
  };
}

module.exports = { createRateLimiter };