const request = require('supertest');

// Note: This test requires the app to be properly configured
// You may need to mock the database connection for unit tests

describe('Health Check Endpoint', () => {
  let app;

  beforeAll(() => {
    // Suppress console logs during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  beforeEach(() => {
    // Reset modules to get fresh app instance
    jest.resetModules();
    app = require('../../index');
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

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

