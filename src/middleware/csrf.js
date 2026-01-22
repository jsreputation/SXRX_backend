// backend/src/middleware/csrf.js
// CSRF protection middleware with token verification

const crypto = require('crypto');
const logger = require('../utils/logger');
const cacheService = require('../services/cacheService');

// CSRF token configuration
const CSRF_TOKEN_SECRET = process.env.CSRF_TOKEN_SECRET || process.env.JWT_SECRET || 'csrf-secret-change-in-production';
const CSRF_TOKEN_EXPIRY = parseInt(process.env.CSRF_TOKEN_EXPIRY) || 3600; // 1 hour
const CSRF_TOKEN_HEADER = 'X-CSRF-Token';
const CSRF_TOKEN_COOKIE = 'csrf-token';

/**
 * Generate CSRF token
 * @param {string} sessionId - Session identifier (user ID, IP, etc.)
 * @returns {string} CSRF token
 */
function generateCSRFToken(sessionId) {
  const timestamp = Date.now();
  const random = crypto.randomBytes(16).toString('hex');
  const data = `${sessionId}:${timestamp}:${random}`;
  
  const hmac = crypto.createHmac('sha256', CSRF_TOKEN_SECRET);
  hmac.update(data);
  const signature = hmac.digest('hex');
  
  const token = Buffer.from(`${data}:${signature}`).toString('base64');
  return token;
}

/**
 * Verify CSRF token
 * @param {string} token - CSRF token to verify
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if token is valid
 */
function verifyCSRFToken(token, sessionId) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parts = decoded.split(':');
    
    if (parts.length !== 4) {
      return false;
    }
    
    const [tokenSessionId, timestamp, random, signature] = parts;
    
    // Check session ID matches
    if (tokenSessionId !== sessionId) {
      return false;
    }
    
    // Check token expiry
    const tokenAge = Date.now() - parseInt(timestamp);
    if (tokenAge > CSRF_TOKEN_EXPIRY * 1000) {
      return false;
    }
    
    // Verify signature
    const data = `${tokenSessionId}:${timestamp}:${random}`;
    const hmac = crypto.createHmac('sha256', CSRF_TOKEN_SECRET);
    hmac.update(data);
    const expectedSignature = hmac.digest('hex');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    logger.warn('[CSRF] Token verification failed', { error: error.message });
    return false;
  }
}

/**
 * Get session identifier from request
 * @param {Object} req - Express request object
 * @returns {string} Session identifier
 */
function getSessionId(req) {
  // Prioritize user ID from JWT, then email, then IP
  if (req.user && req.user.id) {
    return `user:${req.user.id}`;
  }
  
  if (req.user && req.user.email) {
    return `email:${req.user.email}`;
  }
  
  if (req.body && req.body.email) {
    return `email:${req.body.email}`;
  }
  
  // Fallback to IP address
  const ip = req.ip || 
             req.connection?.remoteAddress || 
             req.headers['x-forwarded-for']?.split(',')[0] || 
             'unknown';
  
  return `ip:${ip}`;
}

/**
 * CSRF protection middleware
 * @param {Object} options - Middleware options
 * @param {boolean} options.requireToken - Whether to require token (default: true)
 * @param {string[]} options.excludedMethods - HTTP methods to exclude (default: ['GET', 'HEAD', 'OPTIONS'])
 * @param {string[]} options.excludedPaths - Path patterns to exclude
 * @returns {Function} Express middleware
 */
function csrfProtection(options = {}) {
  const {
    requireToken = true,
    excludedMethods = ['GET', 'HEAD', 'OPTIONS'],
    excludedPaths = []
  } = options;
  
  return async (req, res, next) => {
    // Skip CSRF check for excluded methods
    if (excludedMethods.includes(req.method)) {
      return next();
    }
    
    // Skip CSRF check for excluded paths
    if (excludedPaths.some(pattern => {
      if (typeof pattern === 'string') {
        return req.path === pattern || req.path.startsWith(pattern);
      }
      if (pattern instanceof RegExp) {
        return pattern.test(req.path);
      }
      return false;
    })) {
      return next();
    }
    
    // Skip CSRF check for public/health endpoints
    if (req.path === '/health' || 
        req.path === '/api/health' ||
        req.path.startsWith('/api/public/')) {
      return next();
    }
    
    const sessionId = getSessionId(req);
    
    // Get token from header or cookie
    const tokenFromHeader = req.headers[CSRF_TOKEN_HEADER.toLowerCase()] || 
                           req.headers['x-csrf-token'];
    const tokenFromCookie = req.cookies?.[CSRF_TOKEN_COOKIE];
    const token = tokenFromHeader || tokenFromCookie;
    
    if (!token) {
      if (requireToken) {
        logger.warn('[CSRF] Token missing', {
          path: req.path,
          method: req.method,
          sessionId: sessionId.substring(0, 20) + '...'
        });
        
        return res.status(403).json({
          success: false,
          error: 'CSRF_TOKEN_MISSING',
          message: 'CSRF token is required for this request'
        });
      } else {
        // Generate and set token if not required but missing
        const newToken = generateCSRFToken(sessionId);
        res.cookie(CSRF_TOKEN_COOKIE, newToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: CSRF_TOKEN_EXPIRY * 1000
        });
        return next();
      }
    }
    
    // Verify token
    const isValid = verifyCSRFToken(token, sessionId);
    
    if (!isValid) {
      logger.warn('[CSRF] Token verification failed', {
        path: req.path,
        method: req.method,
        sessionId: sessionId.substring(0, 20) + '...'
      });
      
      return res.status(403).json({
        success: false,
        error: 'CSRF_TOKEN_INVALID',
        message: 'Invalid or expired CSRF token'
      });
    }
    
    // Token is valid, continue
    next();
  };
}

/**
 * Middleware to generate and set CSRF token
 * @returns {Function} Express middleware
 */
function csrfTokenGenerator() {
  return (req, res, next) => {
    const sessionId = getSessionId(req);
    const token = generateCSRFToken(sessionId);
    
    // Set token in cookie
    res.cookie(CSRF_TOKEN_COOKIE, token, {
      httpOnly: false, // Allow JavaScript to read for header
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: CSRF_TOKEN_EXPIRY * 1000
    });
    
    // Also set in response header for easy access
    res.setHeader('X-CSRF-Token', token);
    
    // Make token available in response locals
    res.locals.csrfToken = token;
    
    next();
  };
}

/**
 * Get CSRF token endpoint handler
 */
function getCSRFToken(req, res) {
  const sessionId = getSessionId(req);
  const token = generateCSRFToken(sessionId);
  
  res.cookie(CSRF_TOKEN_COOKIE, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: CSRF_TOKEN_EXPIRY * 1000
  });
  
  res.json({
    success: true,
    token: token,
    expiresIn: CSRF_TOKEN_EXPIRY
  });
}

module.exports = {
  csrfProtection,
  csrfTokenGenerator,
  generateCSRFToken,
  verifyCSRFToken,
  getCSRFToken,
  CSRF_TOKEN_HEADER,
  CSRF_TOKEN_COOKIE
};
