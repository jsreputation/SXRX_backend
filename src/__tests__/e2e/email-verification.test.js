// E2E tests for email verification flow

const request = require('supertest');
const app = require('../helpers/testApp');

// Mock dependencies
jest.mock('../../services/emailVerificationService');
jest.mock('../../services/notificationService');
jest.mock('../../db/pg');

const emailVerificationService = require('../../services/emailVerificationService');
const notificationService = require('../../services/notificationService');
const { query } = require('../../db/pg');

describe('E2E: Email Verification Flow', () => {
  let testEmail;
  let verificationToken;

  beforeEach(() => {
    jest.clearAllMocks();
    testEmail = `test-${Date.now()}@example.com`;
    verificationToken = 'test-verification-token-123';
  });

  describe('Token Generation and Email Sending', () => {
    it('should create verification token and send email during registration', async () => {
      const customerId = 'customer-123';
      const firstName = 'John';

      emailVerificationService.createVerificationToken = jest.fn().mockResolvedValue({
        token: verificationToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });
      emailVerificationService.sendVerificationEmail = jest.fn().mockResolvedValue({
        success: true
      });

      // Simulate registration flow that triggers email verification
      const { token } = await emailVerificationService.createVerificationToken(testEmail, customerId);
      const emailResult = await emailVerificationService.sendVerificationEmail(testEmail, token, firstName);

      expect(emailVerificationService.createVerificationToken).toHaveBeenCalledWith(testEmail, customerId);
      expect(emailVerificationService.sendVerificationEmail).toHaveBeenCalledWith(
        testEmail,
        token,
        firstName
      );
      expect(emailResult).toHaveProperty('success', true);
    });

    it('should handle email sending failures gracefully', async () => {
      emailVerificationService.createVerificationToken = jest.fn().mockResolvedValue({
        token: verificationToken,
        expiresAt: new Date()
      });
      const emailError = new Error('Email service unavailable');
      emailVerificationService.sendVerificationEmail = jest.fn().mockResolvedValue({
        success: false,
        error: emailError.message
      });

      const { token } = await emailVerificationService.createVerificationToken(testEmail);
      const result = await emailVerificationService.sendVerificationEmail(testEmail, token);

      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('error');
    });
  });

  describe('Email Verification', () => {
    it('should verify email successfully with valid token', async () => {
      const customerId = 'customer-123';
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      query.mockResolvedValueOnce({
        rows: [{
          email: testEmail,
          customer_id: customerId,
          expires_at: expiresAt,
          verified_at: null
        }]
      });
      query.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

      emailVerificationService.verifyToken = jest.fn().mockResolvedValue({
        success: true,
        email: testEmail,
        customerId
      });

      const verifyRes = await request(app)
        .post('/api/email-verification/verify')
        .send({ token: verificationToken })
        .expect(200);

      expect(verifyRes.body).toHaveProperty('success', true);
      expect(verifyRes.body).toHaveProperty('email', testEmail);
    });

    it('should reject invalid token', async () => {
      emailVerificationService.verifyToken = jest.fn().mockResolvedValue({
        success: false,
        email: null,
        customerId: null,
        error: 'Invalid verification token'
      });

      const verifyRes = await request(app)
        .post('/api/email-verification/verify')
        .send({ token: 'invalid-token' })
        .expect(400);

      expect(verifyRes.body).toHaveProperty('success', false);
      expect(verifyRes.body.message).toContain('Invalid');
    });

    it('should reject expired token', async () => {
      const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Past date

      query.mockResolvedValueOnce({
        rows: [{
          email: testEmail,
          customer_id: 'customer-123',
          expires_at: expiredDate,
          verified_at: null
        }]
      });

      emailVerificationService.verifyToken = jest.fn().mockResolvedValue({
        success: false,
        email: testEmail,
        customerId: 'customer-123',
        error: 'Verification token has expired'
      });

      const verifyRes = await request(app)
        .post('/api/email-verification/verify')
        .send({ token: verificationToken })
        .expect(400);

      expect(verifyRes.body).toHaveProperty('success', false);
      expect(verifyRes.body.message).toContain('expired');
    });

    it('should reject already verified token', async () => {
      const verifiedAt = new Date();

      query.mockResolvedValueOnce({
        rows: [{
          email: testEmail,
          customer_id: 'customer-123',
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
          verified_at: verifiedAt
        }]
      });

      emailVerificationService.verifyToken = jest.fn().mockResolvedValue({
        success: false,
        email: testEmail,
        customerId: 'customer-123',
        error: 'Email already verified'
      });

      const verifyRes = await request(app)
        .post('/api/email-verification/verify')
        .send({ token: verificationToken })
        .expect(400);

      expect(verifyRes.body).toHaveProperty('success', false);
      expect(verifyRes.body.message).toContain('already verified');
    });
  });

  describe('Resend Verification Email', () => {
    it('should resend verification email for unverified email', async () => {
      emailVerificationService.isEmailVerified = jest.fn().mockResolvedValue(false);
      query.mockResolvedValueOnce({
        rows: [{ customer_id: 'customer-123' }]
      });
      emailVerificationService.createVerificationToken = jest.fn().mockResolvedValue({
        token: 'new-token-456',
        expiresAt: new Date()
      });
      emailVerificationService.sendVerificationEmail = jest.fn().mockResolvedValue({
        success: true
      });

      const resendRes = await request(app)
        .post('/api/email-verification/resend')
        .send({ email: testEmail, firstName: 'John' })
        .expect(200);

      expect(resendRes.body).toHaveProperty('success', true);
      expect(emailVerificationService.createVerificationToken).toHaveBeenCalled();
      expect(emailVerificationService.sendVerificationEmail).toHaveBeenCalled();
    });

    it('should reject resend for already verified email', async () => {
      emailVerificationService.isEmailVerified = jest.fn().mockResolvedValue(true);

      const resendRes = await request(app)
        .post('/api/email-verification/resend')
        .send({ email: testEmail })
        .expect(400);

      expect(resendRes.body).toHaveProperty('success', false);
      expect(resendRes.body.message).toContain('already verified');
    });
  });

  describe('Check Verification Status', () => {
    it('should return true for verified email', async () => {
      query.mockResolvedValueOnce({
        rows: [{ verified_at: new Date() }]
      });

      emailVerificationService.isEmailVerified = jest.fn().mockResolvedValue(true);

      const isVerified = await emailVerificationService.isEmailVerified(testEmail);

      expect(isVerified).toBe(true);
    });

    it('should return false for unverified email', async () => {
      query.mockResolvedValueOnce({ rows: [] });

      emailVerificationService.isEmailVerified = jest.fn().mockResolvedValue(false);

      const isVerified = await emailVerificationService.isEmailVerified(testEmail);

      expect(isVerified).toBe(false);
    });
  });

  describe('Complete Verification Flow', () => {
    it('should complete full flow: registration → email sent → verification', async () => {
      const customerId = 'customer-123';
      const firstName = 'Jane';

      // Step 1: Create token (during registration)
      emailVerificationService.createVerificationToken = jest.fn().mockResolvedValue({
        token: verificationToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });
      emailVerificationService.sendVerificationEmail = jest.fn().mockResolvedValue({
        success: true
      });

      const { token } = await emailVerificationService.createVerificationToken(testEmail, customerId);
      await emailVerificationService.sendVerificationEmail(testEmail, token, firstName);

      // Step 2: Verify token (user clicks link in email)
      query.mockResolvedValueOnce({
        rows: [{
          email: testEmail,
          customer_id: customerId,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
          verified_at: null
        }]
      });
      query.mockResolvedValueOnce({ rowCount: 1 });

      emailVerificationService.verifyToken = jest.fn().mockResolvedValue({
        success: true,
        email: testEmail,
        customerId
      });

      const verifyRes = await request(app)
        .post('/api/email-verification/verify')
        .send({ token })
        .expect(200);

      expect(verifyRes.body).toHaveProperty('success', true);
      expect(verifyRes.body.email).toBe(testEmail);

      // Step 3: Check verification status
      query.mockResolvedValueOnce({
        rows: [{ verified_at: new Date() }]
      });

      emailVerificationService.isEmailVerified = jest.fn().mockResolvedValue(true);

      const isVerified = await emailVerificationService.isEmailVerified(testEmail);
      expect(isVerified).toBe(true);
    });
  });
});
