// backend/src/middleware/validation.js
// Input validation middleware using express-validator

const { body, param, query, validationResult } = require('express-validator');
const logger = require('../utils/logger');

/**
 * Middleware to handle validation errors
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('[VALIDATION] Validation failed', {
      path: req.path,
      method: req.method,
      errors: errors.array()
    });
    
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(err => ({
        field: err.path || err.param,
        message: err.msg,
        value: err.value
      }))
    });
  }
  next();
}

/**
 * Validation rules for appointment booking
 */
const validateAppointmentBooking = [
  // Allow booking without an existing Tebra patientId.
  // If patientId is not provided, patientEmail is required and backend will
  // lookup/create a patient record automatically.
  body('patientId')
    .optional()
    .isString()
    .withMessage('Patient ID must be a string'),
  
  body('patientEmail')
    .optional()
    .isEmail()
    .withMessage('Patient email must be a valid email address')
    .normalizeEmail(),
  
  body('firstName')
    .optional()
    .isString()
    .withMessage('First name must be a string')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('First name must be between 1 and 100 characters'),
  
  body('lastName')
    .optional()
    .isString()
    .withMessage('Last name must be a string')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Last name must be between 1 and 100 characters'),
  
  body('phone')
    .optional()
    .isString()
    .withMessage('Phone must be a string')
    .trim()
    .isLength({ min: 10, max: 20 })
    .withMessage('Phone must be between 10 and 20 characters'),
  
  body('state')
    .notEmpty()
    .withMessage('State is required')
    .isString()
    .withMessage('State must be a string')
    .isLength({ min: 2, max: 2 })
    .withMessage('State must be 2 characters (e.g., CA, TX)')
    .isUppercase()
    .withMessage('State must be uppercase'),
  
  body('startTime')
    .notEmpty()
    .withMessage('Start time is required')
    .isISO8601()
    .withMessage('Start time must be a valid ISO 8601 date string')
    .custom((value) => {
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        throw new Error('Invalid date format');
      }
      if (date.getTime() < Date.now()) {
        throw new Error('Start time must be in the future');
      }
      return true;
    }),
  
  body('endTime')
    .optional()
    .isISO8601()
    .withMessage('End time must be a valid ISO 8601 date string'),
  
  body('appointmentName')
    .optional()
    .isString()
    .withMessage('Appointment name must be a string')
    .isLength({ max: 200 })
    .withMessage('Appointment name must be less than 200 characters'),
  
  body('productId')
    .optional()
    .isString()
    .withMessage('Product ID must be a string'),
  
  body('purchaseType')
    .optional()
    .isIn(['subscription', 'one-time'])
    .withMessage('Purchase type must be either "subscription" or "one-time"'),

  body().custom((value, { req }) => {
    const hasPatientId = !!req.body.patientId;
    const hasEmail = !!req.body.patientEmail;
    if (!hasPatientId && !hasEmail) {
      throw new Error('Either patientId or patientEmail is required');
    }
    return true;
  }),
  
  handleValidationErrors
];

/**
 * Validation rules for availability endpoints
 */
const validateAvailabilityState = [
  param('state')
    .notEmpty()
    .withMessage('State is required')
    .isString()
    .withMessage('State must be a string')
    .isLength({ min: 2, max: 2 })
    .withMessage('State must be 2 characters')
    .isUppercase()
    .withMessage('State must be uppercase'),
  
  query('fromDate')
    .optional()
    .isISO8601()
    .withMessage('fromDate must be a valid ISO 8601 date (YYYY-MM-DD)'),
  
  query('toDate')
    .optional()
    .isISO8601()
    .withMessage('toDate must be a valid ISO 8601 date (YYYY-MM-DD)'),
  
  query('providerId')
    .optional()
    .isString()
    .withMessage('Provider ID must be a string'),
  
  handleValidationErrors
];

/**
 * Validation rules for registration
 */
const validateRegistration = [
  body('email')
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Email must be a valid email address')
    .normalizeEmail(),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number')
    .optional(), // Make optional if Shopify has its own validation
  
  body('firstName')
    .notEmpty()
    .withMessage('First name is required')
    .isString()
    .withMessage('First name must be a string')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('First name must be between 1 and 100 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('First name can only contain letters, spaces, hyphens, and apostrophes'),
  
  body('lastName')
    .notEmpty()
    .withMessage('Last name is required')
    .isString()
    .withMessage('Last name must be a string')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Last name must be between 1 and 100 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('Last name can only contain letters, spaces, hyphens, and apostrophes'),
  
  body('phone')
    .optional()
    .isString()
    .withMessage('Phone must be a string')
    .matches(/^[\d\s\-\+\(\)]+$/)
    .withMessage('Phone must be a valid phone number format'),
  
  body('state')
    .optional()
    .isString()
    .withMessage('State must be a string')
    .isLength({ min: 2, max: 2 })
    .withMessage('State must be 2 characters')
    .isUppercase()
    .withMessage('State must be uppercase'),
  
  body('acceptsMarketing')
    .optional()
    .isBoolean()
    .withMessage('acceptsMarketing must be a boolean'),
  
  handleValidationErrors
];

/**
 * Validation rules for availability settings update
 */
const validateAvailabilitySettings = [
  body('businessHours')
    .optional()
    .isObject()
    .withMessage('businessHours must be an object'),
  
  body('businessHours.*.start')
    .optional()
    .matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('Start time must be in HH:MM format (24-hour)'),
  
  body('businessHours.*.end')
    .optional()
    .matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('End time must be in HH:MM format (24-hour)'),
  
  body('businessHours.*.enabled')
    .optional()
    .isBoolean()
    .withMessage('enabled must be a boolean'),
  
  body('advanceBookingDays')
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage('advanceBookingDays must be between 1 and 365'),
  
  body('slotDuration')
    .optional()
    .isInt({ min: 15, max: 120 })
    .withMessage('slotDuration must be between 15 and 120 minutes'),
  
  body('bufferTime')
    .optional()
    .isInt({ min: 0, max: 60 })
    .withMessage('bufferTime must be between 0 and 60 minutes'),
  
  body('maxSlotsPerDay')
    .optional()
    .custom((value) => {
      if (value !== null && (!Number.isInteger(value) || value < 1)) {
        throw new Error('maxSlotsPerDay must be null or a positive integer');
      }
      return true;
    }),
  
  body('timezone')
    .optional()
    .isString()
    .withMessage('timezone must be a string')
    .isLength({ min: 1, max: 100 })
    .withMessage('timezone must be between 1 and 100 characters'),
  
  handleValidationErrors
];

/**
 * Validation rules for blocking dates
 */
const validateBlockDate = [
  body('date')
    .notEmpty()
    .withMessage('Date is required')
    .isISO8601()
    .withMessage('Date must be a valid ISO 8601 date (YYYY-MM-DD)')
    .custom((value) => {
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        throw new Error('Invalid date format');
      }
      return true;
    }),
  
  handleValidationErrors
];

/**
 * Validation rules for blocking time slots
 */
const validateBlockTimeSlot = [
  body('date')
    .notEmpty()
    .withMessage('Date is required')
    .isISO8601()
    .withMessage('Date must be a valid ISO 8601 date (YYYY-MM-DD)'),
  
  body('startTime')
    .notEmpty()
    .withMessage('Start time is required')
    .matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('Start time must be in HH:MM format (24-hour)'),
  
  body('endTime')
    .notEmpty()
    .withMessage('End time is required')
    .matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('End time must be in HH:MM format (24-hour)')
    .custom((value, { req }) => {
      if (req.body.startTime && value <= req.body.startTime) {
        throw new Error('End time must be after start time');
      }
      return true;
    }),
  
  handleValidationErrors
];

/**
 * Sanitize string inputs to prevent XSS
 */
function sanitizeString(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/[<>]/g, '') // Remove angle brackets
    .trim();
}

/**
 * Sanitize object recursively
 */
function sanitizeObject(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Middleware to sanitize request body
 */
function sanitizeRequestBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
}

module.exports = {
  handleValidationErrors,
  validateAppointmentBooking,
  validateAvailabilityState,
  validateRegistration,
  validateAvailabilitySettings,
  validateBlockDate,
  validateBlockTimeSlot,
  sanitizeRequestBody,
  sanitizeString,
  sanitizeObject
};
