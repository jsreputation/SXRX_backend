// backend/src/routes/twoFactorAuth.js
// Routes for two-factor authentication

const express = require('express');
const router = express.Router();
const twoFactorAuthService = require('../services/twoFactorAuthService');
const { auth: authenticateToken } = require('../middleware/shopifyTokenAuth');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/2fa/generate:
 *   post:
 *     summary: Generate 2FA secret and QR code
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 2FA secret generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 secret:
 *                   type: string
 *                   description: TOTP secret (base32)
 *                 qrCode:
 *                   type: string
 *                   format: data-url
 *                   description: QR code data URL for authenticator app
 *                 backupCodes:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Backup codes (shown only once)
 *                 manualEntryKey:
 *                   type: string
 *                   description: Secret key for manual entry
 *       400:
 *         description: User ID and email are required
 *       500:
 *         description: Failed to generate 2FA secret
 */
/**
 * Generate 2FA secret and QR code
 * POST /api/2fa/generate
 */
router.post('/generate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user.customerId;
    const userEmail = req.user.email;
    
    if (!userId || !userEmail) {
      return res.status(400).json({
        success: false,
        message: 'User ID and email are required'
      });
    }
    
    const result = await twoFactorAuthService.generateSecret(userId, userEmail);
    
    res.json({
      success: true,
      secret: result.secret,
      qrCode: result.qrCode,
      backupCodes: result.backupCodes,
      manualEntryKey: result.manualEntryKey
    });
  } catch (error) {
    logger.error('[2FA] Failed to generate secret', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to generate 2FA secret',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/2fa/enable:
 *   post:
 *     summary: Verify TOTP token and enable 2FA
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: TOTP token from authenticator app
 *     responses:
 *       200:
 *         description: 2FA enabled successfully
 *       400:
 *         description: Invalid token or missing required fields
 *       500:
 *         description: Failed to enable 2FA
 */
/**
 * Verify TOTP token and enable 2FA
 * POST /api/2fa/enable
 */
router.post('/enable', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user.customerId;
    const { token } = req.body;
    
    if (!userId || !token) {
      return res.status(400).json({
        success: false,
        message: 'User ID and token are required'
      });
    }
    
    const enabled = await twoFactorAuthService.enable2FA(userId, token);
    
    if (!enabled) {
      return res.status(400).json({
        success: false,
        message: 'Invalid token. Please verify your authenticator app.'
      });
    }
    
    res.json({
      success: true,
      message: '2FA enabled successfully'
    });
  } catch (error) {
    logger.error('[2FA] Failed to enable 2FA', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to enable 2FA',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/2fa/disable:
 *   post:
 *     summary: Disable 2FA for user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: TOTP token or backup code for verification
 *     responses:
 *       200:
 *         description: 2FA disabled successfully
 *       400:
 *         description: Invalid token or missing required fields
 *       500:
 *         description: Failed to disable 2FA
 */
/**
 * Disable 2FA
 * POST /api/2fa/disable
 */
router.post('/disable', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user.customerId;
    const { token } = req.body;
    
    if (!userId || !token) {
      return res.status(400).json({
        success: false,
        message: 'User ID and token are required'
      });
    }
    
    const disabled = await twoFactorAuthService.disable2FA(userId, token);
    
    if (!disabled) {
      return res.status(400).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    res.json({
      success: true,
      message: '2FA disabled successfully'
    });
  } catch (error) {
    logger.error('[2FA] Failed to disable 2FA', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to disable 2FA',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/2fa/verify:
 *   post:
 *     summary: Verify TOTP token (for login)
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: TOTP token or backup code
 *     responses:
 *       200:
 *         description: Token verified successfully
 *       401:
 *         description: Invalid token
 *       500:
 *         description: Failed to verify token
 */
/**
 * Verify TOTP token (for login)
 * POST /api/2fa/verify
 */
router.post('/verify', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user.customerId;
    const { token } = req.body;
    
    if (!userId || !token) {
      return res.status(400).json({
        success: false,
        message: 'User ID and token are required'
      });
    }
    
    const isValid = await twoFactorAuthService.verifyToken(userId, token);
    
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    res.json({
      success: true,
      message: 'Token verified successfully'
    });
  } catch (error) {
    logger.error('[2FA] Failed to verify token', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to verify token',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/2fa/status:
 *   get:
 *     summary: Check if 2FA is enabled for user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 2FA status retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 enabled:
 *                   type: boolean
 *       400:
 *         description: User ID is required
 *       500:
 *         description: Failed to check 2FA status
 */
/**
 * Check if 2FA is enabled
 * GET /api/2fa/status
 */
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user.customerId;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    const enabled = await twoFactorAuthService.is2FAEnabled(userId);
    
    res.json({
      success: true,
      enabled: enabled
    });
  } catch (error) {
    logger.error('[2FA] Failed to check 2FA status', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to check 2FA status',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/2fa/regenerate-backup-codes:
 *   post:
 *     summary: Regenerate backup codes for 2FA
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: Current TOTP token for verification
 *     responses:
 *       200:
 *         description: Backup codes regenerated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 backupCodes:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         description: Invalid token or missing required fields
 *       500:
 *         description: Failed to regenerate backup codes
 */
/**
 * Regenerate backup codes
 * POST /api/2fa/regenerate-backup-codes
 */
router.post('/regenerate-backup-codes', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user.customerId;
    const { token } = req.body;
    
    if (!userId || !token) {
      return res.status(400).json({
        success: false,
        message: 'User ID and token are required'
      });
    }
    
    const backupCodes = await twoFactorAuthService.regenerateBackupCodes(userId, token);
    
    res.json({
      success: true,
      backupCodes: backupCodes,
      message: 'Backup codes regenerated successfully'
    });
  } catch (error) {
    logger.error('[2FA] Failed to regenerate backup codes', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to regenerate backup codes',
      error: error.message
    });
  }
});

module.exports = router;
