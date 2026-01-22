// Legacy health test - now using integration/health.test.js
// Keeping this file for backward compatibility

const request = require('supertest');
const app = require('./helpers/testApp');

describe('Health Check Endpoint (Legacy)', () => {
  it('should return health status', async () => {
    const res = await request(app).get('/health');
    
    expect(res.statusCode).toBeGreaterThanOrEqual(200);
    expect(res.statusCode).toBeLessThan(500);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('uptime');
  });

  it('should return welcome message on root', async () => {
    const res = await request(app).get('/');
    
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(res.body.message).toContain('SXRX');
  });
});

