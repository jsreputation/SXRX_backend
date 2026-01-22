// backend/src/services/encryptionService.js
// Data encryption at rest for sensitive PII fields

const crypto = require('crypto');
const logger = require('../utils/logger');

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const SALT_LENGTH = 64; // 512 bits
const TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

/**
 * Encryption service for sensitive PII data
 */
class EncryptionService {
  constructor() {
    // Get encryption key from environment variable
    // In production, this should be a strong, randomly generated key stored securely
    this.encryptionKey = process.env.ENCRYPTION_KEY;
    
    if (!this.encryptionKey) {
      logger.warn('[ENCRYPTION] ENCRYPTION_KEY not set, encryption disabled');
      this.enabled = false;
    } else {
      // Derive a consistent key from the environment variable
      this.key = this.deriveKey(this.encryptionKey);
      this.enabled = true;
      logger.info('[ENCRYPTION] Encryption service initialized');
    }
  }

  /**
   * Derive encryption key from password using PBKDF2
   * @param {string} password - Password/key material
   * @returns {Buffer} Derived key
   */
  deriveKey(password) {
    const salt = crypto.createHash('sha256').update(password).digest();
    return crypto.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, 'sha512');
  }

  /**
   * Encrypt sensitive data
   * @param {string} plaintext - Data to encrypt
   * @returns {string|null} Encrypted data (base64 encoded) or null if encryption disabled
   */
  encrypt(plaintext) {
    if (!this.enabled || !plaintext) {
      return plaintext; // Return as-is if encryption disabled or empty
    }

    try {
      // Generate random IV
      const iv = crypto.randomBytes(IV_LENGTH);
      
      // Create cipher
      const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
      
      // Encrypt
      let encrypted = cipher.update(plaintext, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      
      // Get authentication tag
      const tag = cipher.getAuthTag();
      
      // Combine IV, tag, and encrypted data
      const combined = Buffer.concat([
        iv,
        tag,
        Buffer.from(encrypted, 'base64')
      ]);
      
      return combined.toString('base64');
    } catch (error) {
      logger.error('[ENCRYPTION] Encryption failed', { error: error.message });
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decrypt sensitive data
   * @param {string} ciphertext - Encrypted data (base64 encoded)
   * @returns {string|null} Decrypted data or null if decryption fails
   */
  decrypt(ciphertext) {
    if (!this.enabled || !ciphertext) {
      return ciphertext; // Return as-is if encryption disabled or empty
    }

    try {
      // Decode from base64
      const combined = Buffer.from(ciphertext, 'base64');
      
      // Extract IV, tag, and encrypted data
      const iv = combined.slice(0, IV_LENGTH);
      const tag = combined.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const encrypted = combined.slice(IV_LENGTH + TAG_LENGTH);
      
      // Create decipher
      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);
      
      // Decrypt
      let decrypted = decipher.update(encrypted, null, 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      logger.error('[ENCRYPTION] Decryption failed', { error: error.message });
      // If decryption fails, it might be unencrypted data (for migration)
      // Return null to indicate failure
      return null;
    }
  }

  /**
   * Encrypt object fields (selective encryption)
   * @param {Object} obj - Object to encrypt
   * @param {string[]} fields - Field names to encrypt
   * @returns {Object} Object with encrypted fields
   */
  encryptFields(obj, fields) {
    if (!this.enabled || !obj) {
      return obj;
    }

    const encrypted = { ...obj };
    
    for (const field of fields) {
      if (encrypted[field] && typeof encrypted[field] === 'string') {
        encrypted[field] = this.encrypt(encrypted[field]);
      }
    }
    
    return encrypted;
  }

  /**
   * Decrypt object fields (selective decryption)
   * @param {Object} obj - Object to decrypt
   * @param {string[]} fields - Field names to decrypt
   * @returns {Object} Object with decrypted fields
   */
  decryptFields(obj, fields) {
    if (!this.enabled || !obj) {
      return obj;
    }

    const decrypted = { ...obj };
    
    for (const field of fields) {
      if (decrypted[field] && typeof decrypted[field] === 'string') {
        const decryptedValue = this.decrypt(decrypted[field]);
        if (decryptedValue !== null) {
          decrypted[field] = decryptedValue;
        }
        // If decryption fails, keep original (might be unencrypted for migration)
      }
    }
    
    return decrypted;
  }

  /**
   * Check if data is encrypted (heuristic check)
   * @param {string} data - Data to check
   * @returns {boolean} True if data appears to be encrypted
   */
  isEncrypted(data) {
    if (!data || typeof data !== 'string') {
      return false;
    }
    
    // Encrypted data is base64 and has minimum length
    // This is a heuristic - encrypted data will be longer than plaintext
    try {
      const decoded = Buffer.from(data, 'base64');
      // Encrypted data should be at least IV + TAG + some encrypted content
      return decoded.length >= (IV_LENGTH + TAG_LENGTH + 1);
    } catch (error) {
      return false;
    }
  }

  /**
   * Hash sensitive data (one-way, for searching/indexing)
   * @param {string} plaintext - Data to hash
   * @returns {string} Hashed value (base64 encoded)
   */
  hash(plaintext) {
    if (!plaintext) {
      return null;
    }
    
    // Use SHA-256 for hashing (one-way)
    const hash = crypto.createHash('sha256');
    hash.update(plaintext);
    return hash.digest('base64');
  }
}

// Singleton instance
const encryptionService = new EncryptionService();

module.exports = encryptionService;
