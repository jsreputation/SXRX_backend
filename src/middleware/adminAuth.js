// backend/src/middleware/adminAuth.js
// API key authentication for admin endpoints

const logger = require('../utils/logger');

/**
 * Middleware to verify admin API key
 * Expects X-Admin-API-Key header
 */
function verifyAdminApiKey(req, res, next) {
  try {
    const adminApiKey = process.env.ADMIN_API_KEY;
    
    // If no API key configured, skip verification (development mode)
    if (!adminApiKey) {
      logger.warn('[ADMIN AUTH] Admin API key not configured - skipping verification');
      return next();
    }
    
    // Get API key from header
    const providedKey = req.get('X-Admin-API-Key') || req.get('Authorization')?.replace('Bearer ', '');
    
    if (!providedKey) {
      logger.warn('[ADMIN AUTH] Missing admin API key', {
        path: req.path,
        method: req.method,
        ip: req.ip
      });
      return res.status(401).json({
        success: false,
        message: 'Admin API key required',
        hint: 'Include X-Admin-API-Key header or Authorization: Bearer <key>'
      });
    }
    
    // Compare keys using constant-time comparison
    const isValid = require('crypto').timingSafeEqual(
      Buffer.from(providedKey),
      Buffer.from(adminApiKey)
    );
    
    if (!isValid) {
      logger.warn('[ADMIN AUTH] Invalid admin API key', {
        path: req.path,
        method: req.method,
        ip: req.ip
      });
      return res.status(403).json({
        success: false,
        message: 'Invalid admin API key'
      });
    }
    
    logger.debug('[ADMIN AUTH] Admin API key verified');
    next();
  } catch (error) {
    logger.errorWithContext(error, {
      operation: 'admin_auth_verification',
      path: req.path
    });
    return res.status(500).json({
      success: false,
      message: 'Authentication verification failed',
      error: error.message
    });
  }
}

module.exports = {
  verifyAdminApiKey
};
