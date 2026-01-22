// backend/src/services/authService.js
// Authentication service with refresh token support

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../db/pg');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || JWT_SECRET + '-refresh';
const ACCESS_TOKEN_EXPIRY = parseInt(process.env.ACCESS_TOKEN_EXPIRY) || 3600; // 1 hour
const REFRESH_TOKEN_EXPIRY = parseInt(process.env.REFRESH_TOKEN_EXPIRY) || 7 * 24 * 3600; // 7 days
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT) || 30 * 60 * 1000; // 30 minutes

// Initialize refresh tokens table
async function initializeRefreshTokensTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id SERIAL PRIMARY KEY,
      token_hash VARCHAR(255) UNIQUE NOT NULL,
      user_id VARCHAR(255) NOT NULL,
      user_type VARCHAR(50) NOT NULL, -- 'shopify_customer', 'admin', etc.
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMP,
      revoked_at TIMESTAMP,
      device_info TEXT,
      ip_address VARCHAR(45)
    );
    
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id, user_type) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at) WHERE revoked_at IS NULL;
  `;
  
  try {
    await query(sql);
    logger.info('[AUTH] Refresh tokens table initialized');
  } catch (error) {
    logger.error('[AUTH] Failed to initialize refresh tokens table', { error: error.message });
    throw error;
  }
}

// Initialize on module load
initializeRefreshTokensTable().catch(err => {
  logger.warn('[AUTH] Refresh tokens table initialization failed (non-critical)', { error: err.message });
});

/**
 * Generate access token
 * @param {Object} payload - Token payload
 * @param {Object} options - Token options
 * @returns {string} JWT access token
 */
function generateAccessToken(payload, options = {}) {
  const expiresIn = options.expiresIn || ACCESS_TOKEN_EXPIRY;
  
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn,
    issuer: 'sxrx-backend',
    audience: 'sxrx-frontend'
  });
}

/**
 * Generate refresh token
 * @param {Object} payload - Token payload
 * @returns {string} JWT refresh token
 */
function generateRefreshToken(payload) {
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
    issuer: 'sxrx-backend',
    audience: 'sxrx-frontend'
  });
}

/**
 * Hash refresh token for storage
 * @param {string} token - Refresh token
 * @returns {string} Hashed token
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Store refresh token in database
 * @param {Object} params - Token parameters
 * @returns {Promise<string>} Refresh token
 */
async function storeRefreshToken({ userId, userType, deviceInfo, ipAddress }) {
  const payload = {
    userId,
    userType,
    jti: crypto.randomBytes(16).toString('hex') // JWT ID for token rotation
  };
  
  const refreshToken = generateRefreshToken(payload);
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY * 1000);
  
  const sql = `
    INSERT INTO refresh_tokens (token_hash, user_id, user_type, expires_at, device_info, ip_address)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (token_hash) DO NOTHING
    RETURNING id
  `;
  
  try {
    await query(sql, [tokenHash, userId, userType, expiresAt, deviceInfo || null, ipAddress || null]);
    logger.info('[AUTH] Refresh token stored', { userId, userType });
    return refreshToken;
  } catch (error) {
    logger.error('[AUTH] Failed to store refresh token', { error: error.message });
    throw error;
  }
}

/**
 * Verify and refresh access token
 * @param {string} refreshToken - Refresh token
 * @param {string} ipAddress - Client IP address
 * @returns {Promise<Object>} New access and refresh tokens
 */
async function refreshAccessToken(refreshToken, ipAddress = null) {
  try {
    // Verify refresh token
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET, {
      issuer: 'sxrx-backend',
      audience: 'sxrx-frontend'
    });
    
    const tokenHash = hashToken(refreshToken);
    
    // Check if token exists and is not revoked
    const sql = `
      SELECT * FROM refresh_tokens
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()
    `;
    
    const { rows } = await query(sql, [tokenHash]);
    
    if (rows.length === 0) {
      throw new Error('Refresh token not found or expired');
    }
    
    const tokenRecord = rows[0];
    
    // Check if user matches
    if (tokenRecord.user_id !== decoded.userId || tokenRecord.user_type !== decoded.userType) {
      throw new Error('Token user mismatch');
    }
    
    // Revoke old token (token rotation)
    await query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
      [tokenHash]
    );
    
    // Generate new tokens
    const newPayload = {
      userId: decoded.userId,
      userType: decoded.userType,
      email: decoded.email
    };
    
    const newAccessToken = generateAccessToken(newPayload);
    const newRefreshToken = await storeRefreshToken({
      userId: decoded.userId,
      userType: decoded.userType,
      deviceInfo: tokenRecord.device_info,
      ipAddress: ipAddress || tokenRecord.ip_address
    });
    
    // Update last used timestamp
    await query(
      'UPDATE refresh_tokens SET last_used_at = NOW() WHERE token_hash = $1',
      [hashToken(newRefreshToken)]
    );
    
    logger.info('[AUTH] Access token refreshed', { userId: decoded.userId });
    
    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRY
    };
  } catch (error) {
    logger.error('[AUTH] Failed to refresh access token', { error: error.message });
    throw error;
  }
}

/**
 * Revoke refresh token
 * @param {string} refreshToken - Refresh token to revoke
 * @returns {Promise<boolean>} Success status
 */
async function revokeRefreshToken(refreshToken) {
  try {
    const tokenHash = hashToken(refreshToken);
    
    const sql = `
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE token_hash = $1 AND revoked_at IS NULL
    `;
    
    const result = await query(sql, [tokenHash]);
    
    if (result.rowCount > 0) {
      logger.info('[AUTH] Refresh token revoked');
      return true;
    }
    
    return false;
  } catch (error) {
    logger.error('[AUTH] Failed to revoke refresh token', { error: error.message });
    throw error;
  }
}

/**
 * Revoke all refresh tokens for a user
 * @param {string} userId - User ID
 * @param {string} userType - User type
 * @returns {Promise<number>} Number of tokens revoked
 */
async function revokeAllUserTokens(userId, userType) {
  try {
    const sql = `
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE user_id = $1 AND user_type = $2 AND revoked_at IS NULL
    `;
    
    const result = await query(sql, [userId, userType]);
    
    logger.info('[AUTH] All user tokens revoked', { userId, userType, count: result.rowCount });
    return result.rowCount || 0;
  } catch (error) {
    logger.error('[AUTH] Failed to revoke all user tokens', { error: error.message });
    throw error;
  }
}

/**
 * Clean up expired tokens
 * @returns {Promise<number>} Number of tokens cleaned up
 */
async function cleanupExpiredTokens() {
  try {
    const sql = `
      DELETE FROM refresh_tokens
      WHERE expires_at < NOW() OR revoked_at < NOW() - INTERVAL '30 days'
    `;
    
    const result = await query(sql);
    
    logger.info('[AUTH] Expired tokens cleaned up', { count: result.rowCount || 0 });
    return result.rowCount || 0;
  } catch (error) {
    logger.error('[AUTH] Failed to cleanup expired tokens', { error: error.message });
    return 0;
  }
}

/**
 * Verify access token
 * @param {string} token - Access token
 * @returns {Object} Decoded token payload
 */
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: 'sxrx-backend',
      audience: 'sxrx-frontend'
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Access token expired');
    }
    throw error;
  }
}

// Run cleanup job periodically (every hour)
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    cleanupExpiredTokens().catch(err => {
      logger.warn('[AUTH] Token cleanup job failed', { error: err.message });
    });
  }, 60 * 60 * 1000); // Every hour
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  storeRefreshToken,
  refreshAccessToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  verifyAccessToken,
  cleanupExpiredTokens
};
