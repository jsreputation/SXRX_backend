// backend/src/services/emailVerificationService.js
// Service for handling email verification tokens

const crypto = require('crypto');
const { query } = require('../db/pg');
const notificationService = require('./notificationService');
const logger = require('../utils/logger');

class EmailVerificationService {
  constructor() {
    // Token expiration: 24 hours
    this.TOKEN_EXPIRY_HOURS = 24;
    this.FRONTEND_URL = process.env.FRONTEND_URL || process.env.SHOPIFY_STORE || 'https://example.myshopify.com';
  }

  /**
   * Generate a secure random token
   * @returns {string} Random token
   */
  generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create and store a verification token for an email
   * @param {string} email - User email address
   * @param {string} customerId - Shopify customer ID (optional)
   * @returns {Promise<{token: string, expiresAt: Date}>}
   */
  async createVerificationToken(email, customerId = null) {
    try {
      const token = this.generateToken();
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + this.TOKEN_EXPIRY_HOURS);

      // Delete any existing unverified tokens for this email
      await query(
        'DELETE FROM email_verifications WHERE email = $1 AND verified_at IS NULL',
        [email]
      );

      // Insert new token
      await query(
        `INSERT INTO email_verifications (email, token, customer_id, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [email, token, customerId, expiresAt]
      );

      logger.info('[EMAIL_VERIFICATION] Created verification token', { email, customerId });

      return {
        token,
        expiresAt
      };
    } catch (error) {
      logger.error('[EMAIL_VERIFICATION] Failed to create token', { error: error.message, email });
      throw error;
    }
  }

  /**
   * Send verification email to user
   * @param {string} email - User email address
   * @param {string} token - Verification token
   * @param {string} firstName - User's first name (optional)
   * @returns {Promise<{success: boolean}>}
   */
  async sendVerificationEmail(email, token, firstName = null) {
    try {
      const verificationUrl = `${this.FRONTEND_URL}/account/verify-email?token=${token}`;
      
      const subject = 'Verify Your Email Address - SXRX';
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verify Your Email</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">Welcome to SXRX!</h1>
          </div>
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
            <p>${firstName ? `Hi ${firstName},` : 'Hi there,'}</p>
            <p>Thank you for registering with SXRX. To complete your registration and activate your account, please verify your email address by clicking the button below:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationUrl}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">Verify Email Address</a>
            </div>
            <p style="font-size: 12px; color: #666;">Or copy and paste this link into your browser:</p>
            <p style="font-size: 12px; color: #667eea; word-break: break-all;">${verificationUrl}</p>
            <p style="font-size: 12px; color: #666; margin-top: 30px;">This verification link will expire in ${this.TOKEN_EXPIRY_HOURS} hours.</p>
            <p style="font-size: 12px; color: #666;">If you didn't create an account with SXRX, please ignore this email.</p>
          </div>
        </body>
        </html>
      `;

      const text = `
Welcome to SXRX!

Thank you for registering. To complete your registration, please verify your email address by visiting:

${verificationUrl}

This link will expire in ${this.TOKEN_EXPIRY_HOURS} hours.

If you didn't create an account with SXRX, please ignore this email.
      `.trim();

      await notificationService.sendEmail({
        to: email,
        subject,
        text,
        html
      });

      logger.info('[EMAIL_VERIFICATION] Verification email sent', { email });
      return { success: true };
    } catch (error) {
      logger.error('[EMAIL_VERIFICATION] Failed to send verification email', { error: error.message, email });
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify an email token
   * @param {string} token - Verification token
   * @returns {Promise<{success: boolean, email: string|null, customerId: string|null}>}
   */
  async verifyToken(token) {
    try {
      const { rows } = await query(
        `SELECT email, customer_id, expires_at, verified_at
         FROM email_verifications
         WHERE token = $1
         LIMIT 1`,
        [token]
      );

      if (rows.length === 0) {
        return {
          success: false,
          email: null,
          customerId: null,
          error: 'Invalid verification token'
        };
      }

      const verification = rows[0];

      // Check if already verified
      if (verification.verified_at) {
        return {
          success: false,
          email: verification.email,
          customerId: verification.customer_id,
          error: 'Email already verified'
        };
      }

      // Check if expired
      const expiresAt = new Date(verification.expires_at);
      if (expiresAt < new Date()) {
        return {
          success: false,
          email: verification.email,
          customerId: verification.customer_id,
          error: 'Verification token has expired'
        };
      }

      // Mark as verified
      await query(
        `UPDATE email_verifications
         SET verified_at = NOW(), updated_at = NOW()
         WHERE token = $1`,
        [token]
      );

      logger.info('[EMAIL_VERIFICATION] Email verified', { email: verification.email, customerId: verification.customer_id });

      return {
        success: true,
        email: verification.email,
        customerId: verification.customer_id
      };
    } catch (error) {
      logger.error('[EMAIL_VERIFICATION] Failed to verify token', { error: error.message, token });
      return {
        success: false,
        email: null,
        customerId: null,
        error: error.message
      };
    }
  }

  /**
   * Check if an email is verified
   * @param {string} email - Email address to check
   * @returns {Promise<boolean>}
   */
  async isEmailVerified(email) {
    try {
      const { rows } = await query(
        `SELECT verified_at
         FROM email_verifications
         WHERE email = $1 AND verified_at IS NOT NULL
         ORDER BY verified_at DESC
         LIMIT 1`,
        [email]
      );

      return rows.length > 0;
    } catch (error) {
      logger.error('[EMAIL_VERIFICATION] Failed to check verification status', { error: error.message, email });
      return false;
    }
  }

  /**
   * Resend verification email
   * @param {string} email - Email address
   * @param {string} firstName - User's first name (optional)
   * @returns {Promise<{success: boolean}>}
   */
  async resendVerificationEmail(email, firstName = null) {
    try {
      // Check if already verified
      const isVerified = await this.isEmailVerified(email);
      if (isVerified) {
        return {
          success: false,
          error: 'Email is already verified'
        };
      }

      // Get customer ID if available
      const { rows } = await query(
        `SELECT customer_id
         FROM email_verifications
         WHERE email = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [email]
      );

      const customerId = rows.length > 0 ? rows[0].customer_id : null;

      // Create new token and send email
      const { token } = await this.createVerificationToken(email, customerId);
      await this.sendVerificationEmail(email, token, firstName);

      return { success: true };
    } catch (error) {
      logger.error('[EMAIL_VERIFICATION] Failed to resend verification email', { error: error.message, email });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Clean up expired tokens (should be run periodically via cron)
   * @returns {Promise<{deleted: number}>}
   */
  async cleanupExpiredTokens() {
    try {
      const { rowCount } = await query(
        `DELETE FROM email_verifications
         WHERE expires_at < NOW() AND verified_at IS NULL`,
        []
      );

      logger.info('[EMAIL_VERIFICATION] Cleaned up expired tokens', { deleted: rowCount });
      return { deleted: rowCount };
    } catch (error) {
      logger.error('[EMAIL_VERIFICATION] Failed to cleanup expired tokens', { error: error.message });
      return { deleted: 0 };
    }
  }
}

module.exports = new EmailVerificationService();
