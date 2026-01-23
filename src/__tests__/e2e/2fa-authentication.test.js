// E2E tests for 2FA authentication flow

const request = require('supertest');
const app = require('../helpers/testApp');

// Mock dependencies
jest.mock('../../services/twoFactorAuthService');
jest.mock('../../services/authService');
jest.mock('../../services/encryptionService');
jest.mock('../../db/pg');

const twoFactorAuthService = require('../../services/twoFactorAuthService');
const authService = require('../../services/authService');
const { query } = require('../../db/pg');

describe('E2E: 2FA Authentication Flow', () => {
  let userId;
  let userEmail;
  let accessToken;
  let secret;
  let qrCode;
  let backupCodes;

  beforeEach(() => {
    jest.clearAllMocks();
    userId = 'user-123';
    userEmail = 'user@example.com';
    accessToken = 'mock-access-token';
    secret = 'MFRGG43FMZQXIZLTON2GK5DVMVXGKZJZ';
    qrCode = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...';
    backupCodes = ['BACKUP123', 'BACKUP456', 'BACKUP789'];
  });

  describe('2FA Setup Flow', () => {
    it('should generate 2FA secret and QR code', async () => {
      twoFactorAuthService.generateSecret = jest.fn().mockResolvedValue({
        secret,
        qrCode,
        backupCodes,
        manualEntryKey: secret
      });

      const generateRes = await request(app)
        .post('/api/2fa/generate')
        .set('Authorization', `Bearer ${accessToken}`)
        .send()
        .expect(200);

      expect(generateRes.body).toHaveProperty('success', true);
      expect(generateRes.body).toHaveProperty('secret');
      expect(generateRes.body).toHaveProperty('qrCode');
      expect(generateRes.body).toHaveProperty('backupCodes');
      expect(Array.isArray(generateRes.body.backupCodes)).toBe(true);
      expect(generateRes.body.backupCodes.length).toBeGreaterThan(0);
    });

    it('should enable 2FA after token verification', async () => {
      const totpToken = '123456';

      twoFactorAuthService.enable2FA = jest.fn().mockResolvedValue(true);

      const enableRes = await request(app)
        .post('/api/2fa/enable')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ token: totpToken })
        .expect(200);

      expect(enableRes.body).toHaveProperty('success', true);
      expect(enableRes.body.message).toContain('enabled');
      expect(twoFactorAuthService.enable2FA).toHaveBeenCalledWith(userId, totpToken);
    });

    it('should reject invalid token during enable', async () => {
      const invalidToken = '000000';

      twoFactorAuthService.enable2FA = jest.fn().mockResolvedValue(false);

      const enableRes = await request(app)
        .post('/api/2fa/enable')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ token: invalidToken })
        .expect(400);

      expect(enableRes.body).toHaveProperty('success', false);
      expect(enableRes.body.message).toContain('Invalid token');
    });
  });

  describe('2FA Login Flow', () => {
    it('should require 2FA token after password authentication', async () => {
      // Step 1: User logs in with email/password
      const loginCredentials = {
        email: userEmail,
        password: 'TestPassword123!'
      };

      authService.authenticateUser = jest.fn().mockResolvedValue({
        user: {
          id: userId,
          email: userEmail,
          has2FA: true
        },
        requires2FA: true
      });

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send(loginCredentials)
        .expect(200);

      expect(loginRes.body).toHaveProperty('requires2FA', true);
      expect(loginRes.body).not.toHaveProperty('accessToken'); // No token until 2FA verified

      // Step 2: User provides 2FA token
      const totpToken = '123456';

      twoFactorAuthService.verifyToken = jest.fn().mockResolvedValue(true);
      authService.generateTokens = jest.fn().mockResolvedValue({
        accessToken: 'final-access-token',
        refreshToken: 'refresh-token-123'
      });

      const verifyRes = await request(app)
        .post('/api/2fa/verify')
        .set('Authorization', `Bearer ${accessToken}`) // Temporary token from step 1
        .send({ token: totpToken })
        .expect(200);

      expect(verifyRes.body).toHaveProperty('success', true);
      expect(twoFactorAuthService.verifyToken).toHaveBeenCalledWith(userId, totpToken);
    });

    it('should reject invalid 2FA token during login', async () => {
      const invalidToken = '000000';

      twoFactorAuthService.verifyToken = jest.fn().mockResolvedValue(false);

      const verifyRes = await request(app)
        .post('/api/2fa/verify')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ token: invalidToken })
        .expect(401);

      expect(verifyRes.body).toHaveProperty('success', false);
      expect(verifyRes.body.message).toContain('Invalid token');
    });

    it('should allow login with backup code', async () => {
      const backupCode = 'BACKUP123';

      // Mock backup code verification
      query.mockResolvedValueOnce({
        rows: [{
          secret: 'encrypted-secret',
          backup_codes: JSON.stringify([
            'a1b2c3d4e5f6', // Hashed version of BACKUP123
            'f6e5d4c3b2a1'
          ])
        }]
      });

      twoFactorAuthService.verifyToken = jest.fn().mockImplementation(async (userId, token) => {
        // Simulate backup code check
        if (token === backupCode) {
          return true; // Backup code accepted
        }
        return false;
      });

      const verifyRes = await request(app)
        .post('/api/2fa/verify')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ token: backupCode })
        .expect(200);

      expect(verifyRes.body).toHaveProperty('success', true);
    });
  });

  describe('2FA Status and Management', () => {
    it('should check 2FA status', async () => {
      twoFactorAuthService.is2FAEnabled = jest.fn().mockResolvedValue(true);

      const statusRes = await request(app)
        .get('/api/2fa/status')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(statusRes.body).toHaveProperty('enabled', true);
      expect(twoFactorAuthService.is2FAEnabled).toHaveBeenCalledWith(userId);
    });

    it('should disable 2FA with password confirmation', async () => {
      const password = 'TestPassword123!';

      authService.verifyPassword = jest.fn().mockResolvedValue(true);
      twoFactorAuthService.disable2FA = jest.fn().mockResolvedValue(true);

      const disableRes = await request(app)
        .post('/api/2fa/disable')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ password })
        .expect(200);

      expect(disableRes.body).toHaveProperty('success', true);
      expect(twoFactorAuthService.disable2FA).toHaveBeenCalledWith(userId);
    });

    it('should reject disable request with wrong password', async () => {
      const wrongPassword = 'WrongPassword123!';

      authService.verifyPassword = jest.fn().mockResolvedValue(false);

      const disableRes = await request(app)
        .post('/api/2fa/disable')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ password: wrongPassword })
        .expect(401);

      expect(disableRes.body).toHaveProperty('success', false);
      expect(twoFactorAuthService.disable2FA).not.toHaveBeenCalled();
    });
  });

  describe('Complete 2FA Lifecycle', () => {
    it('should complete full lifecycle: generate → enable → verify → disable', async () => {
      // Step 1: Generate secret
      twoFactorAuthService.generateSecret = jest.fn().mockResolvedValue({
        secret,
        qrCode,
        backupCodes,
        manualEntryKey: secret
      });

      const generateRes = await request(app)
        .post('/api/2fa/generate')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(generateRes.body).toHaveProperty('success', true);

      // Step 2: Enable 2FA
      const totpToken = '123456';
      twoFactorAuthService.enable2FA = jest.fn().mockResolvedValue(true);

      await request(app)
        .post('/api/2fa/enable')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ token: totpToken })
        .expect(200);

      // Step 3: Verify 2FA during login
      twoFactorAuthService.verifyToken = jest.fn().mockResolvedValue(true);

      await request(app)
        .post('/api/2fa/verify')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ token: totpToken })
        .expect(200);

      // Step 4: Disable 2FA
      authService.verifyPassword = jest.fn().mockResolvedValue(true);
      twoFactorAuthService.disable2FA = jest.fn().mockResolvedValue(true);

      await request(app)
        .post('/api/2fa/disable')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ password: 'TestPassword123!' })
        .expect(200);

      expect(twoFactorAuthService.generateSecret).toHaveBeenCalled();
      expect(twoFactorAuthService.enable2FA).toHaveBeenCalled();
      expect(twoFactorAuthService.verifyToken).toHaveBeenCalled();
      expect(twoFactorAuthService.disable2FA).toHaveBeenCalled();
    });
  });

  describe('2FA Error Handling', () => {
    it('should handle service errors gracefully', async () => {
      const error = new Error('2FA service unavailable');
      twoFactorAuthService.generateSecret = jest.fn().mockRejectedValue(error);

      const generateRes = await request(app)
        .post('/api/2fa/generate')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(500);

      expect(generateRes.body).toHaveProperty('success', false);
      expect(generateRes.body.message).toContain('Failed');
    });

    it('should handle missing authentication', async () => {
      const generateRes = await request(app)
        .post('/api/2fa/generate')
        .expect(401);

      expect(generateRes.body).toHaveProperty('success', false);
    });
  });
});
