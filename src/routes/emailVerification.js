// backend/src/routes/emailVerification.js
// Routes for email verification

const express = require('express');
const router = express.Router();
const emailVerificationService = require('../services/emailVerificationService');
const { sanitizeRequestBody } = require('../middleware/validation');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/email-verification/verify:
 *   post:
 *     summary: Verify email address with token
 *     tags: [Authentication]
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
 *                 description: Verification token from email
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Invalid or expired token
 */
router.post('/verify', express.json({ limit: '10kb' }), sanitizeRequestBody, async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Verification token is required'
      });
    }

    const result = await emailVerificationService.verifyToken(token);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error || 'Invalid verification token'
      });
    }

    logger.info('[EMAIL_VERIFICATION] Email verified successfully', { email: result.email });

    res.json({
      success: true,
      message: 'Email verified successfully',
      email: result.email
    });
  } catch (error) {
    logger.error('[EMAIL_VERIFICATION] Verification error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to verify email. Please try again.'
    });
  }
});

/**
 * @swagger
 * /api/email-verification/resend:
 *   post:
 *     summary: Resend verification email
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               firstName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Verification email sent
 *       400:
 *         description: Email already verified or invalid request
 */
router.post('/resend', express.json({ limit: '10kb' }), sanitizeRequestBody, async (req, res) => {
  try {
    const { email, firstName } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required'
      });
    }

    const result = await emailVerificationService.resendVerificationEmail(email, firstName);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error || 'Failed to resend verification email'
      });
    }

    logger.info('[EMAIL_VERIFICATION] Verification email resent', { email });

    res.json({
      success: true,
      message: 'Verification email sent. Please check your inbox.'
    });
  } catch (error) {
    logger.error('[EMAIL_VERIFICATION] Resend error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to resend verification email. Please try again.'
    });
  }
});

/**
 * @swagger
 * /api/email-verification/status:
 *   get:
 *     summary: Check email verification status
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *           format: email
 *     responses:
 *       200:
 *         description: Verification status
 */
router.get('/status', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required'
      });
    }

    const isVerified = await emailVerificationService.isEmailVerified(email);

    res.json({
      success: true,
      email,
      verified: isVerified
    });
  } catch (error) {
    logger.error('[EMAIL_VERIFICATION] Status check error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to check verification status'
    });
  }
});

module.exports = router;
