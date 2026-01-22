// backend/src/services/twoFactorAuthService.js
// TOTP-based 2FA with QR code generation and backup codes

const crypto = require('crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const logger = require('../utils/logger');
const db = require('../db/pg');

/**
 * Two-Factor Authentication Service
 */
class TwoFactorAuthService {
  /**
   * Generate TOTP secret for a user
   * @param {string} userId - User ID
   * @param {string} userEmail - User email (for QR code label)
   * @returns {Promise<Object>} Secret and QR code data URL
   */
  async generateSecret(userId, userEmail) {
    try {
      const secret = speakeasy.generateSecret({
        name: `SXRX (${userEmail})`,
        issuer: 'SXRX',
        length: 32
      });

      // Store secret in database (encrypted)
      const encryptionService = require('./encryptionService');
      const encryptedSecret = encryptionService.encrypt(secret.base32);

      await db.query(
        `INSERT INTO user_2fa (user_id, secret, enabled, created_at)
         VALUES ($1, $2, false, NOW())
         ON CONFLICT (user_id) 
         DO UPDATE SET secret = $2, enabled = false, updated_at = NOW()`,
        [userId, encryptedSecret]
      );

      // Generate QR code
      const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url);

      // Generate backup codes
      const backupCodes = this.generateBackupCodes();

      // Store backup codes (hashed)
      const hashedCodes = backupCodes.map(code => {
        const hash = crypto.createHash('sha256');
        hash.update(code);
        return hash.digest('hex');
      });

      await db.query(
        `UPDATE user_2fa SET backup_codes = $1 WHERE user_id = $2`,
        [JSON.stringify(hashedCodes), userId]
      );

      return {
        secret: secret.base32,
        qrCode: qrCodeDataUrl,
        backupCodes: backupCodes, // Return plain codes only once
        manualEntryKey: secret.base32
      };
    } catch (error) {
      logger.error('[2FA] Failed to generate secret', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Verify TOTP token
   * @param {string} userId - User ID
   * @param {string} token - TOTP token
   * @returns {Promise<boolean>} True if token is valid
   */
  async verifyToken(userId, token) {
    try {
      // Get user's 2FA secret
      const result = await db.query(
        `SELECT secret, backup_codes FROM user_2fa WHERE user_id = $1 AND enabled = true`,
        [userId]
      );

      if (!result.rows || result.rows.length === 0) {
        return false;
      }

      const row = result.rows[0];
      const encryptionService = require('./encryptionService');
      const secret = encryptionService.decrypt(row.secret);

      if (!secret) {
        logger.error('[2FA] Failed to decrypt secret', { userId });
        return false;
      }

      // Verify TOTP token
      const verified = speakeasy.totp.verify({
        secret: secret,
        encoding: 'base32',
        token: token,
        window: 2 // Allow 2 time steps before/after
      });

      if (verified) {
        return true;
      }

      // Check backup codes if TOTP failed
      if (row.backup_codes) {
        const backupCodes = JSON.parse(row.backup_codes);
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        
        if (backupCodes.includes(tokenHash)) {
          // Remove used backup code
          const updatedCodes = backupCodes.filter(code => code !== tokenHash);
          await db.query(
            `UPDATE user_2fa SET backup_codes = $1 WHERE user_id = $2`,
            [JSON.stringify(updatedCodes), userId]
          );
          
          logger.info('[2FA] Backup code used', { userId });
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('[2FA] Failed to verify token', { userId, error: error.message });
      return false;
    }
  }

  /**
   * Enable 2FA for a user (after verification)
   * @param {string} userId - User ID
   * @param {string} token - TOTP token to verify
   * @returns {Promise<boolean>} True if enabled successfully
   */
  async enable2FA(userId, token) {
    try {
      // Verify token first
      const isValid = await this.verifyToken(userId, token);
      
      if (!isValid) {
        return false;
      }

      // Enable 2FA
      await db.query(
        `UPDATE user_2fa SET enabled = true, enabled_at = NOW() WHERE user_id = $1`,
        [userId]
      );

      logger.info('[2FA] 2FA enabled for user', { userId });
      return true;
    } catch (error) {
      logger.error('[2FA] Failed to enable 2FA', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Disable 2FA for a user
   * @param {string} userId - User ID
   * @param {string} token - TOTP token or backup code for verification
   * @returns {Promise<boolean>} True if disabled successfully
   */
  async disable2FA(userId, token) {
    try {
      // Verify token first
      const isValid = await this.verifyToken(userId, token);
      
      if (!isValid) {
        return false;
      }

      // Disable 2FA
      await db.query(
        `UPDATE user_2fa SET enabled = false, disabled_at = NOW() WHERE user_id = $1`,
        [userId]
      );

      logger.info('[2FA] 2FA disabled for user', { userId });
      return true;
    } catch (error) {
      logger.error('[2FA] Failed to disable 2FA', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Check if 2FA is enabled for a user
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} True if 2FA is enabled
   */
  async is2FAEnabled(userId) {
    try {
      const result = await db.query(
        `SELECT enabled FROM user_2fa WHERE user_id = $1`,
        [userId]
      );

      return result.rows && result.rows.length > 0 && result.rows[0].enabled === true;
    } catch (error) {
      logger.error('[2FA] Failed to check 2FA status', { userId, error: error.message });
      return false;
    }
  }

  /**
   * Generate backup codes
   * @param {number} count - Number of codes to generate (default: 10)
   * @returns {string[]} Array of backup codes
   */
  generateBackupCodes(count = 10) {
    const codes = [];
    for (let i = 0; i < count; i++) {
      // Generate 8-character alphanumeric code
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      codes.push(code);
    }
    return codes;
  }

  /**
   * Regenerate backup codes
   * @param {string} userId - User ID
   * @param {string} token - TOTP token for verification
   * @returns {Promise<string[]>} New backup codes
   */
  async regenerateBackupCodes(userId, token) {
    try {
      // Verify token first
      const isValid = await this.verifyToken(userId, token);
      
      if (!isValid) {
        throw new Error('Invalid token');
      }

      // Generate new backup codes
      const backupCodes = this.generateBackupCodes();
      const hashedCodes = backupCodes.map(code => {
        const hash = crypto.createHash('sha256');
        hash.update(code);
        return hash.digest('hex');
      });

      await db.query(
        `UPDATE user_2fa SET backup_codes = $1 WHERE user_id = $2`,
        [JSON.stringify(hashedCodes), userId]
      );

      logger.info('[2FA] Backup codes regenerated', { userId });
      return backupCodes;
    } catch (error) {
      logger.error('[2FA] Failed to regenerate backup codes', { userId, error: error.message });
      throw error;
    }
  }
}

// Singleton instance
const twoFactorAuthService = new TwoFactorAuthService();

module.exports = twoFactorAuthService;
