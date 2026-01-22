// Unit tests for errorHandler.js

const { createErrorResponse, ErrorCodes, errorHandler } = require('../errorHandler');

describe('errorHandler', () => {
  describe('createErrorResponse', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test';
    });

    it('should create error response with default values', () => {
      const result = createErrorResponse('Test error');
      
      expect(result).toHaveProperty('response');
      expect(result).toHaveProperty('statusCode', 500);
      expect(result.response).toHaveProperty('success', false);
      expect(result.response).toHaveProperty('message');
    });

    it('should include user-friendly message', () => {
      const result = createErrorResponse('Test error');
      
      expect(result.response.message).toBeTruthy();
      expect(typeof result.response.message).toBe('string');
    });

    it('should use provided error code', () => {
      const result = createErrorResponse('Test error', {
        code: ErrorCodes.VALIDATION_ERROR
      });
      
      expect(result.response.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('should use provided status code', () => {
      const result = createErrorResponse('Test error', {
        statusCode: 400
      });
      
      expect(result.statusCode).toBe(400);
    });

    it('should include details when provided', () => {
      const details = { field: 'email', reason: 'invalid format' };
      const result = createErrorResponse('Test error', { details });
      
      expect(result.response.details).toEqual(details);
    });

    it('should include requestId when provided', () => {
      const requestId = 'req-123';
      const result = createErrorResponse('Test error', { requestId });
      
      expect(result.response.requestId).toBe(requestId);
    });

    it('should handle Error objects', () => {
      const error = new Error('Test error message');
      const result = createErrorResponse(error);
      
      expect(result.response).toHaveProperty('message');
      expect(result.response.message).toBeTruthy();
    });

    it('should handle string errors', () => {
      const result = createErrorResponse('String error message');
      
      expect(result.response).toHaveProperty('message');
      expect(result.response.message).toBeTruthy();
    });

    it('should not include technical error in production', () => {
      process.env.NODE_ENV = 'production';
      const result = createErrorResponse('Test error');
      
      expect(result.response).not.toHaveProperty('error');
    });

    it('should map validation errors correctly', () => {
      const error = { name: 'ValidationError', message: 'Invalid input' };
      const result = createErrorResponse(error, {
        statusCode: 400
      });
      
      expect(result.response.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('should map not found errors correctly', () => {
      const error = { name: 'NotFoundError', message: 'Resource not found' };
      const result = createErrorResponse(error, {
        statusCode: 404
      });
      
      expect(result.response.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  describe('ErrorCodes', () => {
    it('should have all expected error codes', () => {
      expect(ErrorCodes).toHaveProperty('VALIDATION_ERROR');
      expect(ErrorCodes).toHaveProperty('UNAUTHORIZED');
      expect(ErrorCodes).toHaveProperty('FORBIDDEN');
      expect(ErrorCodes).toHaveProperty('NOT_FOUND');
      expect(ErrorCodes).toHaveProperty('CONFLICT');
      expect(ErrorCodes).toHaveProperty('INTERNAL_ERROR');
    });
  });

  describe('errorHandler middleware', () => {
    let req, res, next;

    beforeEach(() => {
      req = {
        requestId: 'test-request-id'
      };
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };
      next = jest.fn();
      process.env.NODE_ENV = 'test';
    });

    it('should handle errors and send response', () => {
      const error = new Error('Test error');
      const handler = errorHandler();
      
      handler(error, req, res, next);
      
      expect(res.status).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
      expect(res.json.mock.calls[0][0]).toHaveProperty('success', false);
      expect(res.json.mock.calls[0][0]).toHaveProperty('message');
    });

    it('should use 500 status for unhandled errors', () => {
      const error = new Error('Test error');
      const handler = errorHandler();
      
      handler(error, req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should use error statusCode if provided', () => {
      const error = new Error('Test error');
      error.statusCode = 400;
      const handler = errorHandler();
      
      handler(error, req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should include requestId in response', () => {
      const error = new Error('Test error');
      const handler = errorHandler();
      
      handler(error, req, res, next);
      
      expect(res.json.mock.calls[0][0]).toHaveProperty('requestId', 'test-request-id');
    });

    it('should handle errors without requestId', () => {
      req.requestId = null;
      const error = new Error('Test error');
      const handler = errorHandler();
      
      handler(error, req, res, next);
      
      expect(res.json).toHaveBeenCalled();
    });
  });
});
