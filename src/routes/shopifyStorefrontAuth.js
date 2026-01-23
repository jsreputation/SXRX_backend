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

/**
 * @swagger
 * /api/shopify-storefront/login:
 *   post:
 *     summary: Login with email and password
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *       401:
 *         description: Invalid credentials
 */
// Authentication routes
router.post('/login', authLimiter, express.json({ limit: '50kb' }), sanitizeRequestBody, shopifyStorefrontAuthController.login);

/**
 * @swagger
 * /api/shopify-storefront/register:
 *   post:
 *     summary: Register a new user account
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - firstName
 *               - lastName
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 format: password
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               state:
 *                 type: string
 *     responses:
 *       200:
 *         description: Registration successful
 *       400:
 *         description: Validation error
 */
router.post('/register', authLimiter, express.json({ limit: '50kb' }), sanitizeRequestBody, validateRegistration, shopifyStorefrontAuthController.register);

/**
 * @swagger
 * /api/shopify-storefront/logout:
 *   post:
 *     summary: Logout user and revoke tokens
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 */
router.post('/logout', auth, shopifyStorefrontAuthController.logout);

/**
 * @swagger
 * /api/shopify-storefront/me:
 *   get:
 *     summary: Get current authenticated user information
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User information retrieved
 *       401:
 *         description: Unauthorized
 */
router.get('/me', auth, shopifyStorefrontAuthController.getCurrentCustomer);

/**
 * @swagger
 * /api/shopify-storefront/refresh:
 *   post:
 *     summary: Refresh access token using refresh token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *       401:
 *         description: Invalid or expired refresh token
 */
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

/**
 * @swagger
 * /api/shopify-storefront/revoke:
 *   post:
 *     summary: Revoke refresh token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token revoked successfully
 *       500:
 *         description: Failed to revoke token
 */
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
