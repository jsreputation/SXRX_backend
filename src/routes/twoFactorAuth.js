// backend/src/routes/twoFactorAuth.js
// Routes for two-factor authentication

const express = require('express');
const router = express.Router();
const twoFactorAuthService = require('../services/twoFactorAuthService');
const { auth: authenticateToken } = require('../middleware/shopifyTokenAuth');
const logger = require('../utils/logger');

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
