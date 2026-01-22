// backend/src/utils/userFriendlyErrors.js
// User-friendly error messages for API responses

/**
 * Map technical error codes to user-friendly messages
 */
const ERROR_MESSAGES = {
  // Validation errors
  VALIDATION_ERROR: {
    message: 'Please check your input and try again.',
    actionable: true
  },
  INVALID_EMAIL: {
    message: 'Please enter a valid email address.',
    actionable: true
  },
  INVALID_PASSWORD: {
    message: 'Password must be at least 6 characters and contain uppercase, lowercase, and a number.',
    actionable: true
  },
  MISSING_REQUIRED_FIELD: {
    message: 'Please fill in all required fields.',
    actionable: true
  },
  INVALID_STATE: {
    message: 'Please select a valid state.',
    actionable: true
  },
  INVALID_DATE: {
    message: 'Please select a valid date.',
    actionable: true
  },
  INVALID_TIME: {
    message: 'Please select a valid time slot.',
    actionable: true
  },

  // Authentication errors
  UNAUTHORIZED: {
    message: 'You need to sign in to access this.',
    actionable: true
  },
  FORBIDDEN: {
    message: 'You don\'t have permission to perform this action.',
    actionable: false
  },
  INVALID_CREDENTIALS: {
    message: 'Email or password is incorrect. Please try again.',
    actionable: true
  },
  TOKEN_EXPIRED: {
    message: 'Your session has expired. Please sign in again.',
    actionable: true
  },

  // Appointment errors
  APPOINTMENT_NOT_FOUND: {
    message: 'Appointment not found. It may have been cancelled or does not exist.',
    actionable: false
  },
  APPOINTMENT_ALREADY_BOOKED: {
    message: 'This time slot is no longer available. Please select another time.',
    actionable: true
  },
  APPOINTMENT_CANNOT_BE_CANCELLED: {
    message: 'This appointment cannot be cancelled. Please contact support for assistance.',
    actionable: true
  },
  APPOINTMENT_CANNOT_BE_RESCHEDULED: {
    message: 'This appointment cannot be rescheduled. Please contact support for assistance.',
    actionable: true
  },
  INVALID_APPOINTMENT_TIME: {
    message: 'The selected time is not available. Please choose another time slot.',
    actionable: true
  },
  APPOINTMENT_TOO_SOON: {
    message: 'Appointments must be booked at least 24 hours in advance.',
    actionable: true
  },
  APPOINTMENT_TOO_FAR: {
    message: 'Appointments can only be booked up to 30 days in advance.',
    actionable: true
  },

  // Availability errors
  NO_AVAILABILITY: {
    message: 'No appointments are available at this time. Please try again later or select a different date.',
    actionable: true
  },
  SLOT_ALREADY_TAKEN: {
    message: 'This time slot was just booked by another patient. Please select another time.',
    actionable: true
  },

  // Patient errors
  PATIENT_NOT_FOUND: {
    message: 'Patient record not found. Please contact support.',
    actionable: true
  },
  PATIENT_ALREADY_EXISTS: {
    message: 'An account with this email already exists. Please sign in instead.',
    actionable: true
  },
  QUESTIONNAIRE_NOT_COMPLETED: {
    message: 'Please complete the questionnaire before booking an appointment.',
    actionable: true
  },

  // Order errors
  ORDER_NOT_FOUND: {
    message: 'Order not found.',
    actionable: false
  },
  ORDER_ALREADY_PROCESSED: {
    message: 'This order has already been processed.',
    actionable: false
  },
  INVALID_ORDER: {
    message: 'Invalid order. Please contact support.',
    actionable: true
  },

  // System errors
  INTERNAL_ERROR: {
    message: 'Something went wrong. Please try again in a few moments.',
    actionable: true
  },
  SERVICE_UNAVAILABLE: {
    message: 'Service is temporarily unavailable. Please try again later.',
    actionable: true
  },
  DATABASE_ERROR: {
    message: 'We\'re experiencing technical difficulties. Please try again in a few moments.',
    actionable: true
  },
  EXTERNAL_SERVICE_ERROR: {
    message: 'We\'re having trouble connecting to our services. Please try again later.',
    actionable: true
  },

  // Webhook errors
  WEBHOOK_VERIFICATION_FAILED: {
    message: 'Webhook verification failed.',
    actionable: false
  },
  INVALID_WEBHOOK_PAYLOAD: {
    message: 'Invalid webhook payload.',
    actionable: false
  },

  // Rate limiting
  RATE_LIMIT_EXCEEDED: {
    message: 'Too many requests. Please wait a moment and try again.',
    actionable: true
  },

  // Generic
  NOT_FOUND: {
    message: 'The requested resource was not found.',
    actionable: false
  },
  BAD_REQUEST: {
    message: 'Invalid request. Please check your input and try again.',
    actionable: true
  }
};

/**
 * Get user-friendly error message
 * @param {string} errorCode - Technical error code
 * @param {string} defaultMessage - Default message if code not found
 * @param {boolean} isDevelopment - Whether in development mode
 * @returns {Object} User-friendly error object
 */
function getUserFriendlyError(errorCode, defaultMessage = null, isDevelopment = false) {
  const errorInfo = ERROR_MESSAGES[errorCode] || {
    message: defaultMessage || 'An error occurred. Please try again.',
    actionable: false
  };

  return {
    message: errorInfo.message,
    actionable: errorInfo.actionable,
    code: errorCode,
    // Include technical details in development
    ...(isDevelopment && defaultMessage ? { technical: defaultMessage } : {})
  };
}

/**
 * Extract error code from error object
 * @param {Error|Object} error - Error object
 * @returns {string} Error code
 */
function extractErrorCode(error) {
  if (error.code) return error.code;
  if (error.name === 'ValidationError') return 'VALIDATION_ERROR';
  if (error.name === 'UnauthorizedError') return 'UNAUTHORIZED';
  if (error.name === 'NotFoundError') return 'NOT_FOUND';
  if (error.statusCode === 400) return 'BAD_REQUEST';
  if (error.statusCode === 401) return 'UNAUTHORIZED';
  if (error.statusCode === 403) return 'FORBIDDEN';
  if (error.statusCode === 404) return 'NOT_FOUND';
  if (error.statusCode === 429) return 'RATE_LIMIT_EXCEEDED';
  if (error.statusCode >= 500) return 'INTERNAL_ERROR';
  
  return 'INTERNAL_ERROR';
}

/**
 * Create user-friendly error response
 * @param {Error|Object} error - Error object
 * @param {Object} options - Options
 * @param {boolean} options.isDevelopment - Whether in development mode
 * @param {string} options.requestId - Request ID for tracking
 * @returns {Object} User-friendly error response
 */
function createUserFriendlyErrorResponse(error, options = {}) {
  const { isDevelopment = false, requestId = null } = options;
  const errorCode = extractErrorCode(error);
  const friendlyError = getUserFriendlyError(
    errorCode,
    error.message || error.toString(),
    isDevelopment
  );

  const response = {
    success: false,
    message: friendlyError.message,
    code: errorCode,
    actionable: friendlyError.actionable
  };

  if (requestId) {
    response.requestId = requestId;
  }

  // Include technical details in development
  if (isDevelopment) {
    if (friendlyError.technical) {
      response.technical = friendlyError.technical;
    }
    if (error.stack) {
      response.stack = error.stack;
    }
  }

  return response;
}

/**
 * Map specific error messages to codes based on error content
 * @param {Error|Object} error - Error object
 * @returns {string} Error code
 */
function mapErrorToCode(error) {
  const errorMessage = (error.message || '').toLowerCase();
  const errorString = error.toString().toLowerCase();

  // Appointment-specific
  if (errorMessage.includes('appointment') && errorMessage.includes('not found')) {
    return 'APPOINTMENT_NOT_FOUND';
  }
  if (errorMessage.includes('appointment') && errorMessage.includes('already booked')) {
    return 'APPOINTMENT_ALREADY_BOOKED';
  }
  if (errorMessage.includes('appointment') && errorMessage.includes('cannot be cancelled')) {
    return 'APPOINTMENT_CANNOT_BE_CANCELLED';
  }
  if (errorMessage.includes('slot') && errorMessage.includes('taken')) {
    return 'SLOT_ALREADY_TAKEN';
  }
  if (errorMessage.includes('no availability') || errorMessage.includes('no slots')) {
    return 'NO_AVAILABILITY';
  }

  // Patient-specific
  if (errorMessage.includes('patient') && errorMessage.includes('not found')) {
    return 'PATIENT_NOT_FOUND';
  }
  if (errorMessage.includes('patient') && errorMessage.includes('already exists')) {
    return 'PATIENT_ALREADY_EXISTS';
  }
  if (errorMessage.includes('questionnaire') && errorMessage.includes('not completed')) {
    return 'QUESTIONNAIRE_NOT_COMPLETED';
  }

  // Validation
  if (errorMessage.includes('email') && (errorMessage.includes('invalid') || errorMessage.includes('required'))) {
    return 'INVALID_EMAIL';
  }
  if (errorMessage.includes('password') && (errorMessage.includes('invalid') || errorMessage.includes('required'))) {
    return 'INVALID_PASSWORD';
  }
  if (errorMessage.includes('state') && errorMessage.includes('invalid')) {
    return 'INVALID_STATE';
  }
  if (errorMessage.includes('validation') || errorMessage.includes('invalid input')) {
    return 'VALIDATION_ERROR';
  }

  // Authentication
  if (errorMessage.includes('unauthorized') || errorMessage.includes('not authenticated')) {
    return 'UNAUTHORIZED';
  }
  if (errorMessage.includes('forbidden') || errorMessage.includes('permission denied')) {
    return 'FORBIDDEN';
  }
  if (errorMessage.includes('invalid credentials') || errorMessage.includes('wrong password')) {
    return 'INVALID_CREDENTIALS';
  }

  // Database
  if (errorMessage.includes('database') || errorMessage.includes('connection')) {
    return 'DATABASE_ERROR';
  }

  // External services
  if (errorMessage.includes('tebra') || errorMessage.includes('external service')) {
    return 'EXTERNAL_SERVICE_ERROR';
  }

  return null; // Let extractErrorCode handle it
}

module.exports = {
  getUserFriendlyError,
  extractErrorCode,
  createUserFriendlyErrorResponse,
  mapErrorToCode,
  ERROR_MESSAGES
};
