// Unit tests for emailVerificationService

const EmailVerificationService = require('../../../services/emailVerificationService');

// Mock dependencies
jest.mock('../../../db/pg');
jest.mock('../../../services/notificationService');
jest.mock('../../../utils/logger');

const { query } = require('../../../db/pg');
const notificationService = require('../../../services/notificationService');

describe('EmailVerificationService', () => {
  let emailVerificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    emailVerificationService = require('../../../services/emailVerificationService');
    process.env.FRONTEND_URL = 'https://test.myshopify.com';
  });

  describe('generateToken', () => {
    it('should generate a random token', () => {
      const token1 = emailVerificationService.generateToken();
      const token2 = emailVerificationService.generateToken();

      expect(token1).toBeDefined();
      expect(token2).toBeDefined();
      expect(token1).not.toBe(token2);
      expect(token1.length).toBe(64); // 32 bytes = 64 hex characters
    });
  });

  describe('createVerificationToken', () => {
    it('should create and store verification token', async () => {
      const email = 'test@example.com';
      const customerId = 'customer-123';
      const mockToken = 'test-token-123';
      
      emailVerificationService.generateToken = jest.fn().mockReturnValue(mockToken);
      query.mockResolvedValueOnce({ rowCount: 1 }); // DELETE
      query.mockResolvedValueOnce({ rowCount: 1 }); // INSERT

      const result = await emailVerificationService.createVerificationToken(email, customerId);

      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenNthCalledWith(
        1,
        'DELETE FROM email_verifications WHERE email = $1 AND verified_at IS NULL',
        [email]
      );
      expect(query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO email_verifications'),
        expect.arrayContaining([email, mockToken, customerId])
      );
      expect(result).toHaveProperty('token', mockToken);
      expect(result).toHaveProperty('expiresAt');
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should create token without customer ID', async () => {
      const email = 'test@example.com';
      const mockToken = 'test-token-123';
      
      emailVerificationService.generateToken = jest.fn().mockReturnValue(mockToken);
      query.mockResolvedValueOnce({ rowCount: 1 });
      query.mockResolvedValueOnce({ rowCount: 1 });

      const result = await emailVerificationService.createVerificationToken(email);

      expect(result).toHaveProperty('token', mockToken);
      expect(result).toHaveProperty('expiresAt');
    });

    it('should handle database errors', async () => {
      const email = 'test@example.com';
      const error = new Error('Database error');
      query.mockRejectedValueOnce(error);

      await expect(emailVerificationService.createVerificationToken(email)).rejects.toThrow(error);
    });
  });

  describe('sendVerificationEmail', () => {
    it('should send verification email successfully', async () => {
      const email = 'test@example.com';
      const token = 'test-token-123';
      const firstName = 'John';
      
      notificationService.sendEmail = jest.fn().mockResolvedValue({ success: true });

      const result = await emailVerificationService.sendVerificationEmail(email, token, firstName);

      expect(notificationService.sendEmail).toHaveBeenCalledWith({
        to: email,
        subject: 'Verify Your Email Address - SXRX',
        text: expect.stringContaining('Welcome to SXRX'),
        html: expect.stringContaining('Hi John,')
      });
      expect(result).toEqual({ success: true });
    });

    it('should send email without first name', async () => {
      const email = 'test@example.com';
      const token = 'test-token-123';
      
      notificationService.sendEmail = jest.fn().mockResolvedValue({ success: true });

      const result = await emailVerificationService.sendVerificationEmail(email, token);

      expect(notificationService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('Hi there,')
        })
      );
      expect(result).toEqual({ success: true });
    });

    it('should include verification URL in email', async () => {
      const email = 'test@example.com';
      const token = 'test-token-123';
      const expectedUrl = `${process.env.FRONTEND_URL}/account/verify-email?token=${token}`;
      
      notificationService.sendEmail = jest.fn().mockResolvedValue({ success: true });

      await emailVerificationService.sendVerificationEmail(email, token);

      expect(notificationService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining(expectedUrl),
          text: expect.stringContaining(expectedUrl)
        })
      );
    });

    it('should handle email sending errors', async () => {
      const email = 'test@example.com';
      const token = 'test-token-123';
      const error = new Error('Email service error');
      
      notificationService.sendEmail = jest.fn().mockRejectedValue(error);

      const result = await emailVerificationService.sendVerificationEmail(email, token);

      expect(result).toEqual({ success: false, error: error.message });
    });
  });

  describe('verifyToken', () => {
    it('should verify valid token successfully', async () => {
      const token = 'valid-token-123';
      const email = 'test@example.com';
      const customerId = 'customer-123';
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1); // Future date

      query.mockResolvedValueOnce({
        rows: [{
          email,
          customer_id: customerId,
          expires_at: expiresAt,
          verified_at: null
        }]
      });
      query.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

      const result = await emailVerificationService.verifyToken(token);

      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE email_verifications'),
        [token]
      );
      expect(result).toEqual({
        success: true,
        email,
        customerId
      });
    });

    it('should return error for invalid token', async () => {
      const token = 'invalid-token';
      
      query.mockResolvedValueOnce({ rows: [] });

      const result = await emailVerificationService.verifyToken(token);

      expect(result).toEqual({
        success: false,
        email: null,
        customerId: null,
        error: 'Invalid verification token'
      });
    });

    it('should return error for already verified token', async () => {
      const token = 'already-verified-token';
      const email = 'test@example.com';
      const verifiedAt = new Date();

      query.mockResolvedValueOnce({
        rows: [{
          email,
          customer_id: 'customer-123',
          expires_at: new Date(),
          verified_at: verifiedAt
        }]
      });

      const result = await emailVerificationService.verifyToken(token);

      expect(result).toEqual({
        success: false,
        email,
        customerId: 'customer-123',
        error: 'Email already verified'
      });
    });

    it('should return error for expired token', async () => {
      const token = 'expired-token';
      const email = 'test@example.com';
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() - 1); // Past date

      query.mockResolvedValueOnce({
        rows: [{
          email,
          customer_id: 'customer-123',
          expires_at: expiresAt,
          verified_at: null
        }]
      });

      const result = await emailVerificationService.verifyToken(token);

      expect(result).toEqual({
        success: false,
        email,
        customerId: 'customer-123',
        error: 'Verification token has expired'
      });
    });

    it('should handle database errors', async () => {
      const token = 'test-token';
      const error = new Error('Database error');
      
      query.mockRejectedValueOnce(error);

      const result = await emailVerificationService.verifyToken(token);

      expect(result).toEqual({
        success: false,
        email: null,
        customerId: null,
        error: error.message
      });
    });
  });

  describe('isEmailVerified', () => {
    it('should return true for verified email', async () => {
      const email = 'verified@example.com';
      
      query.mockResolvedValueOnce({
        rows: [{ verified_at: new Date() }]
      });

      const result = await emailVerificationService.isEmailVerified(email);

      expect(result).toBe(true);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT verified_at'),
        [email]
      );
    });

    it('should return false for unverified email', async () => {
      const email = 'unverified@example.com';
      
      query.mockResolvedValueOnce({ rows: [] });

      const result = await emailVerificationService.isEmailVerified(email);

      expect(result).toBe(false);
    });

    it('should handle database errors', async () => {
      const email = 'test@example.com';
      const error = new Error('Database error');
      
      query.mockRejectedValueOnce(error);

      const result = await emailVerificationService.isEmailVerified(email);

      expect(result).toBe(false);
    });
  });

  describe('resendVerificationEmail', () => {
    it('should resend verification email for unverified email', async () => {
      const email = 'test@example.com';
      const firstName = 'John';
      const customerId = 'customer-123';
      const mockToken = 'new-token-123';

      emailVerificationService.isEmailVerified = jest.fn().mockResolvedValue(false);
      query.mockResolvedValueOnce({
        rows: [{ customer_id: customerId }]
      });
      emailVerificationService.createVerificationToken = jest.fn().mockResolvedValue({
        token: mockToken,
        expiresAt: new Date()
      });
      emailVerificationService.sendVerificationEmail = jest.fn().mockResolvedValue({ success: true });

      const result = await emailVerificationService.resendVerificationEmail(email, firstName);

      expect(emailVerificationService.isEmailVerified).toHaveBeenCalledWith(email);
      expect(emailVerificationService.createVerificationToken).toHaveBeenCalledWith(email, customerId);
      expect(emailVerificationService.sendVerificationEmail).toHaveBeenCalledWith(email, mockToken, firstName);
      expect(result).toEqual({ success: true });
    });

    it('should return error for already verified email', async () => {
      const email = 'verified@example.com';
      
      emailVerificationService.isEmailVerified = jest.fn().mockResolvedValue(true);

      const result = await emailVerificationService.resendVerificationEmail(email);

      expect(result).toEqual({
        success: false,
        error: 'Email is already verified'
      });
      expect(emailVerificationService.createVerificationToken).not.toHaveBeenCalled();
    });

    it('should handle errors during resend', async () => {
      const email = 'test@example.com';
      const error = new Error('Service error');
      
      emailVerificationService.isEmailVerified = jest.fn().mockResolvedValue(false);
      query.mockRejectedValueOnce(error);

      const result = await emailVerificationService.resendVerificationEmail(email);

      expect(result).toEqual({
        success: false,
        error: error.message
      });
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should delete expired unverified tokens', async () => {
      query.mockResolvedValueOnce({ rowCount: 5 });

      const result = await emailVerificationService.cleanupExpiredTokens();

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM email_verifications'),
        []
      );
      expect(result).toEqual({ deleted: 5 });
    });

    it('should handle errors during cleanup', async () => {
      const error = new Error('Database error');
      query.mockRejectedValueOnce(error);

      const result = await emailVerificationService.cleanupExpiredTokens();

      expect(result).toEqual({ deleted: 0 });
    });
  });
});
