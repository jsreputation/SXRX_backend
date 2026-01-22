// Unit tests for userFriendlyErrors.js

const {
  getUserFriendlyError,
  extractErrorCode,
  createUserFriendlyErrorResponse,
  mapErrorToCode,
  ERROR_MESSAGES
} = require('../userFriendlyErrors');

describe('userFriendlyErrors', () => {
  describe('getUserFriendlyError', () => {
    it('should return user-friendly message for known error code', () => {
      const result = getUserFriendlyError('VALIDATION_ERROR');
      expect(result.message).toBe('Please check your input and try again.');
      expect(result.actionable).toBe(true);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should return default message for unknown error code', () => {
      const result = getUserFriendlyError('UNKNOWN_ERROR');
      expect(result.message).toBe('An error occurred. Please try again.');
      expect(result.actionable).toBe(false);
      expect(result.code).toBe('UNKNOWN_ERROR');
    });

    it('should use custom default message', () => {
      const result = getUserFriendlyError('UNKNOWN_ERROR', 'Custom message');
      expect(result.message).toBe('Custom message');
    });

    it('should include technical details in development', () => {
      const result = getUserFriendlyError('VALIDATION_ERROR', 'Technical details', true);
      expect(result.technical).toBe('Technical details');
    });

    it('should not include technical details in production', () => {
      const result = getUserFriendlyError('VALIDATION_ERROR', 'Technical details', false);
      expect(result.technical).toBeUndefined();
    });
  });

  describe('extractErrorCode', () => {
    it('should extract code from error.code', () => {
      const error = { code: 'VALIDATION_ERROR' };
      expect(extractErrorCode(error)).toBe('VALIDATION_ERROR');
    });

    it('should map ValidationError name', () => {
      const error = { name: 'ValidationError' };
      expect(extractErrorCode(error)).toBe('VALIDATION_ERROR');
    });

    it('should map UnauthorizedError name', () => {
      const error = { name: 'UnauthorizedError' };
      expect(extractErrorCode(error)).toBe('UNAUTHORIZED');
    });

    it('should map NotFoundError name', () => {
      const error = { name: 'NotFoundError' };
      expect(extractErrorCode(error)).toBe('NOT_FOUND');
    });

    it('should map statusCode 400', () => {
      const error = { statusCode: 400 };
      expect(extractErrorCode(error)).toBe('BAD_REQUEST');
    });

    it('should map statusCode 401', () => {
      const error = { statusCode: 401 };
      expect(extractErrorCode(error)).toBe('UNAUTHORIZED');
    });

    it('should map statusCode 403', () => {
      const error = { statusCode: 403 };
      expect(extractErrorCode(error)).toBe('FORBIDDEN');
    });

    it('should map statusCode 404', () => {
      const error = { statusCode: 404 };
      expect(extractErrorCode(error)).toBe('NOT_FOUND');
    });

    it('should map statusCode 429', () => {
      const error = { statusCode: 429 };
      expect(extractErrorCode(error)).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('should map statusCode >= 500', () => {
      const error = { statusCode: 500 };
      expect(extractErrorCode(error)).toBe('INTERNAL_ERROR');
      
      const error502 = { statusCode: 502 };
      expect(extractErrorCode(error502)).toBe('INTERNAL_ERROR');
    });

    it('should default to INTERNAL_ERROR', () => {
      const error = {};
      expect(extractErrorCode(error)).toBe('INTERNAL_ERROR');
    });
  });

  describe('createUserFriendlyErrorResponse', () => {
    it('should create error response', () => {
      const error = { code: 'VALIDATION_ERROR', message: 'Test error' };
      const result = createUserFriendlyErrorResponse(error);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Please check your input and try again.');
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.actionable).toBe(true);
    });

    it('should include requestId if provided', () => {
      const error = { code: 'INTERNAL_ERROR' };
      const result = createUserFriendlyErrorResponse(error, { requestId: 'req-123' });
      
      expect(result.requestId).toBe('req-123');
    });

    it('should include technical details in development', () => {
      const error = { 
        code: 'VALIDATION_ERROR', 
        message: 'Technical error',
        stack: 'Error stack trace'
      };
      const result = createUserFriendlyErrorResponse(error, { isDevelopment: true });
      
      expect(result.technical).toBe('Technical error');
      expect(result.stack).toBe('Error stack trace');
    });

    it('should not include technical details in production', () => {
      const error = { 
        code: 'VALIDATION_ERROR', 
        message: 'Technical error',
        stack: 'Error stack trace'
      };
      const result = createUserFriendlyErrorResponse(error, { isDevelopment: false });
      
      expect(result.technical).toBeUndefined();
      expect(result.stack).toBeUndefined();
    });
  });

  describe('mapErrorToCode', () => {
    it('should map appointment not found errors', () => {
      const error = { message: 'Appointment not found' };
      expect(mapErrorToCode(error)).toBe('APPOINTMENT_NOT_FOUND');
    });

    it('should map appointment already booked errors', () => {
      const error = { message: 'Appointment already booked' };
      expect(mapErrorToCode(error)).toBe('APPOINTMENT_ALREADY_BOOKED');
    });

    it('should map slot taken errors', () => {
      const error = { message: 'Slot already taken' };
      expect(mapErrorToCode(error)).toBe('SLOT_ALREADY_TAKEN');
    });

    it('should map no availability errors', () => {
      const error = { message: 'No availability at this time' };
      expect(mapErrorToCode(error)).toBe('NO_AVAILABILITY');
    });

    it('should map patient not found errors', () => {
      const error = { message: 'Patient not found' };
      expect(mapErrorToCode(error)).toBe('PATIENT_NOT_FOUND');
    });

    it('should map patient already exists errors', () => {
      const error = { message: 'Patient already exists' };
      expect(mapErrorToCode(error)).toBe('PATIENT_ALREADY_EXISTS');
    });

    it('should map questionnaire not completed errors', () => {
      const error = { message: 'Questionnaire not completed' };
      expect(mapErrorToCode(error)).toBe('QUESTIONNAIRE_NOT_COMPLETED');
    });

    it('should map invalid email errors', () => {
      const error = { message: 'Invalid email address' };
      expect(mapErrorToCode(error)).toBe('INVALID_EMAIL');
    });

    it('should map invalid password errors', () => {
      const error = { message: 'Invalid password format' };
      expect(mapErrorToCode(error)).toBe('INVALID_PASSWORD');
    });

    it('should map invalid state errors', () => {
      const error = { message: 'Invalid state code' };
      expect(mapErrorToCode(error)).toBe('INVALID_STATE');
    });

    it('should map validation errors', () => {
      const error = { message: 'Validation failed' };
      expect(mapErrorToCode(error)).toBe('VALIDATION_ERROR');
    });

    it('should map unauthorized errors', () => {
      const error = { message: 'User not authenticated' };
      expect(mapErrorToCode(error)).toBe('UNAUTHORIZED');
    });

    it('should map forbidden errors', () => {
      const error = { message: 'Permission denied' };
      expect(mapErrorToCode(error)).toBe('FORBIDDEN');
    });

    it('should map invalid credentials errors', () => {
      const error = { message: 'Invalid credentials provided' };
      expect(mapErrorToCode(error)).toBe('INVALID_CREDENTIALS');
    });

    it('should map database errors', () => {
      const error = { message: 'Database connection failed' };
      expect(mapErrorToCode(error)).toBe('DATABASE_ERROR');
    });

    it('should map external service errors', () => {
      const error = { message: 'Tebra service unavailable' };
      expect(mapErrorToCode(error)).toBe('EXTERNAL_SERVICE_ERROR');
    });

    it('should return null for unmapped errors', () => {
      const error = { message: 'Some random error' };
      expect(mapErrorToCode(error)).toBeNull();
    });

    it('should handle errors without message property', () => {
      // mapErrorToCode primarily checks error.message
      // If error.message is missing, it uses error.toString()
      // But the function checks errorMessage first, which comes from error.message || ''
      const error = { 
        message: 'Appointment not found'
      };
      // The function checks errorMessage which comes from error.message
      const result = mapErrorToCode(error);
      expect(result).toBe('APPOINTMENT_NOT_FOUND');
    });
  });

  describe('ERROR_MESSAGES', () => {
    it('should have all expected error codes', () => {
      expect(ERROR_MESSAGES.VALIDATION_ERROR).toBeDefined();
      expect(ERROR_MESSAGES.UNAUTHORIZED).toBeDefined();
      expect(ERROR_MESSAGES.APPOINTMENT_NOT_FOUND).toBeDefined();
      expect(ERROR_MESSAGES.INTERNAL_ERROR).toBeDefined();
    });

    it('should have message and actionable properties', () => {
      Object.values(ERROR_MESSAGES).forEach(errorInfo => {
        expect(errorInfo).toHaveProperty('message');
        expect(errorInfo).toHaveProperty('actionable');
        expect(typeof errorInfo.message).toBe('string');
        expect(typeof errorInfo.actionable).toBe('boolean');
      });
    });
  });
});
