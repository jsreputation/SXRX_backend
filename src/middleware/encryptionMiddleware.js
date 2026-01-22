// backend/src/middleware/encryptionMiddleware.js
// Middleware to automatically encrypt/decrypt sensitive fields in requests/responses

const encryptionService = require('../services/encryptionService');
const logger = require('../utils/logger');

// Fields that should be encrypted at rest
const SENSITIVE_FIELDS = [
  'ssn',
  'socialSecurityNumber',
  'social_security_number',
  'phone',
  'phoneNumber',
  'phone_number',
  'email', // Optional - can be encrypted if required
  'dateOfBirth',
  'date_of_birth',
  'dob',
  'address',
  'streetAddress',
  'street_address',
  'city',
  'zipCode',
  'zip_code',
  'postalCode',
  'postal_code',
  'insuranceId',
  'insurance_id',
  'medicalRecordNumber',
  'medical_record_number'
];

/**
 * Middleware to encrypt sensitive fields in request body before saving
 */
function encryptRequestBody(req, res, next) {
  if (!encryptionService.enabled || !req.body) {
    return next();
  }

  try {
    req.body = encryptionService.encryptFields(req.body, SENSITIVE_FIELDS);
    next();
  } catch (error) {
    logger.error('[ENCRYPTION_MIDDLEWARE] Failed to encrypt request body', { error: error.message });
    next(error);
  }
}

/**
 * Middleware to decrypt sensitive fields in response
 */
function decryptResponseBody(req, res, next) {
  if (!encryptionService.enabled) {
    return next();
  }

  const originalJson = res.json.bind(res);
  
  res.json = function(data) {
    if (data && typeof data === 'object') {
      // Decrypt if it's a single object
      if (Array.isArray(data)) {
        data = data.map(item => 
          encryptionService.decryptFields(item, SENSITIVE_FIELDS)
        );
      } else {
        data = encryptionService.decryptFields(data, SENSITIVE_FIELDS);
      }
    }
    
    return originalJson(data);
  };
  
  next();
}

/**
 * Selective encryption middleware (for specific routes)
 * @param {string[]} fields - Fields to encrypt/decrypt
 * @returns {Function} Middleware function
 */
function selectiveEncryption(fields) {
  return {
    encrypt: (req, res, next) => {
      if (!encryptionService.enabled || !req.body) {
        return next();
      }
      
      try {
        req.body = encryptionService.encryptFields(req.body, fields);
        next();
      } catch (error) {
        logger.error('[ENCRYPTION_MIDDLEWARE] Failed to encrypt', { error: error.message });
        next(error);
      }
    },
    
    decrypt: (req, res, next) => {
      if (!encryptionService.enabled) {
        return next();
      }
      
      const originalJson = res.json.bind(res);
      
      res.json = function(data) {
        if (data && typeof data === 'object') {
          if (Array.isArray(data)) {
            data = data.map(item => 
              encryptionService.decryptFields(item, fields)
            );
          } else {
            data = encryptionService.decryptFields(data, fields);
          }
        }
        
        return originalJson(data);
      };
      
      next();
    }
  };
}

module.exports = {
  encryptRequestBody,
  decryptResponseBody,
  selectiveEncryption,
  SENSITIVE_FIELDS
};
