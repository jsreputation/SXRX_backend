// backend/src/utils/errorHandler.js
// Standardized error response format across all endpoints

const { createUserFriendlyErrorResponse, mapErrorToCode } = require('./userFriendlyErrors');

/**
 * Standard error response format
 * @typedef {Object} ErrorResponse
 * @property {boolean} success - Always false for errors
 * @property {string} message - User-friendly error message
 * @property {string} [error] - Technical error message (only in development)
 * @property {string} [code] - Error code for programmatic handling
 * @property {Object} [details] - Additional error details
 * @property {string} [requestId] - Request ID for tracing
 */

/**
 * Create standardized error response
 * @param {Error|string} error - Error object or message
 * @param {Object} options - Additional options
 * @param {string} options.code - Error code
 * @param {number} options.statusCode - HTTP status code
 * @param {Object} options.details - Additional details
 * @param {string} options.requestId - Request ID
 * @returns {Object} Standardized error response
 */
function createErrorResponse(error, options = {}) {
  const {
    code = 'INTERNAL_ERROR',
    statusCode = 500,
    details = {},
    requestId = null
  } = options;

  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  // Use user-friendly error messages
  const mappedCode = mapErrorToCode({ ...error, statusCode, code }) || code;
  const friendlyError = createUserFriendlyErrorResponse(
    { ...error, statusCode, code: mappedCode },
    { isDevelopment, requestId }
  );
  
  // Add details if provided
  if (Object.keys(details).length > 0) {
    friendlyError.details = details;
  }

  return {
    response: friendlyError,
    statusCode
  };
}

/**
 * Common error codes
 */
const ErrorCodes = {
  // Validation errors (400)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',
  
  // Authentication errors (401)
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  
  // Authorization errors (403)
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  
  // Not found errors (404)
  NOT_FOUND: 'NOT_FOUND',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  
  // Conflict errors (409)
  CONFLICT: 'CONFLICT',
  DUPLICATE_RESOURCE: 'DUPLICATE_RESOURCE',
  
  // External service errors (502, 503)
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  
  // Internal errors (500)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  
  // Business logic errors
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  INVALID_STATE: 'INVALID_STATE',
  OPERATION_NOT_ALLOWED: 'OPERATION_NOT_ALLOWED'
};

/**
 * Map HTTP status codes to error codes
 */
const StatusCodeToErrorCode = {
  400: ErrorCodes.VALIDATION_ERROR,
  401: ErrorCodes.UNAUTHORIZED,
  403: ErrorCodes.FORBIDDEN,
  404: ErrorCodes.NOT_FOUND,
  409: ErrorCodes.CONFLICT,
  500: ErrorCodes.INTERNAL_ERROR,
  502: ErrorCodes.EXTERNAL_SERVICE_ERROR,
  503: ErrorCodes.SERVICE_UNAVAILABLE
};

/**
 * Express middleware for standardized error handling
 */
function errorHandler(err, req, res, next) {
  const requestId = req.id || null;
  
  // If response already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(err);
  }

  // Capture error with Sentry (if enabled)
  try {
    const errorTracking = require('./errorTracking');
    errorTracking.captureException(err, {
      request: req,
      user: req.user ? {
        id: req.user.id,
        email: req.user.email,
        customerId: req.user.customerId
      } : null,
      tags: {
        route: req.path,
        method: req.method
      },
      extra: {
        requestId,
        body: req.body,
        query: req.query
      }
    });
  } catch (trackingError) {
    // Non-critical - continue with error handling even if tracking fails
  }

  // Determine error code and status
  let statusCode = err.statusCode || err.status || 500;
  let errorCode = err.code || StatusCodeToErrorCode[statusCode] || ErrorCodes.INTERNAL_ERROR;
  
  // Handle specific error types
  if (err.name === 'ValidationError' || err.name === 'CastError') {
    statusCode = 400;
    errorCode = ErrorCodes.VALIDATION_ERROR;
  } else if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorCode = ErrorCodes.UNAUTHORIZED;
  } else if (err.code && err.code.startsWith('PGSQL_') || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    // PostgreSQL database errors
    statusCode = 500;
    errorCode = ErrorCodes.DATABASE_ERROR;
  } else if (err.code === '23505') {
    // PostgreSQL unique constraint violation
    statusCode = 409;
    errorCode = ErrorCodes.DUPLICATE_RESOURCE;
  } else if (err.code === '23503') {
    // PostgreSQL foreign key constraint violation
    statusCode = 400;
    errorCode = ErrorCodes.VALIDATION_ERROR;
  }

  // Use user-friendly error messages (already imported at top)
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  // Try to map error to a more specific code
  const mappedCode = mapErrorToCode({ ...err, statusCode, code: errorCode }) || errorCode;
  
  const errorResponse = createUserFriendlyErrorResponse(
    { ...err, statusCode, code: mappedCode },
    { isDevelopment, requestId }
  );
  
  errorResponse.statusCode = statusCode;

  res.status(statusCode).json(errorResponse);
}

/**
 * Create success response
 * @param {*} data - Response data
 * @param {Object} options - Additional options
 * @param {string} options.message - Success message
 * @param {string} options.requestId - Request ID
 * @returns {Object} Standardized success response
 */
function createSuccessResponse(data, options = {}) {
  const { message = 'Operation successful', requestId = null } = options;
  
  const response = {
    success: true,
    message,
    ...(requestId && { requestId })
  };

  // If data is an object, merge it; otherwise wrap it
  if (data !== null && data !== undefined) {
    if (typeof data === 'object' && !Array.isArray(data)) {
      Object.assign(response, data);
    } else {
      response.data = data;
    }
  }

  return response;
}

/**
 * Async error wrapper for route handlers
 * Wraps async route handlers to catch errors and pass to error handler
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  createErrorResponse,
  createSuccessResponse,
  errorHandler,
  asyncHandler,
  ErrorCodes,
  StatusCodeToErrorCode
};
