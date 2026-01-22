// backend/src/routes/shopifyStorefrontAuth.js
const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const logger = require('../utils/logger');
const shopifyStorefrontAuthController = require('../controllers/shopifyStorefrontAuthController');
const { auth } = require('../middleware/shopifyTokenAuth');
const { createRateLimiter } = require('../middleware/rateLimit');
const { validateRegistration, sanitizeRequestBody } = require('../middleware/validation');

// Rate limiting: tighten login/register endpoints
const authLimiter = createRateLimiter({ windowMs: 60_000, max: 5 }); // 5 per minute per IP/email

// Authentication routes
router.post('/login', authLimiter, express.json({ limit: '50kb' }), sanitizeRequestBody, shopifyStorefrontAuthController.login);
router.post('/register', authLimiter, express.json({ limit: '50kb' }), sanitizeRequestBody, validateRegistration, shopifyStorefrontAuthController.register);
router.post('/logout', auth, shopifyStorefrontAuthController.logout);
router.get('/me', auth, shopifyStorefrontAuthController.getCurrentCustomer);

// Refresh token endpoint
router.post('/refresh', express.json(), async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }
    
    const ipAddress = req.ip || req.connection?.remoteAddress;
    const result = await authService.refreshAccessToken(refreshToken, ipAddress);
    
    res.json({
      success: true,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn
    });
  } catch (error) {
    logger.error('[AUTH] Refresh token error', { error: error.message });
    res.status(401).json({
      success: false,
      message: 'Invalid or expired refresh token'
    });
  }
});

// Revoke token endpoint
router.post('/revoke', express.json(), async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }
    
    await authService.revokeRefreshToken(refreshToken);
    
    res.json({
      success: true,
      message: 'Token revoked successfully'
    });
  } catch (error) {
    logger.error('[AUTH] Revoke token error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to revoke token'
    });
  }
});

module.exports = router;
