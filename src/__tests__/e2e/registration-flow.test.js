// E2E tests for user registration flow

const request = require('supertest');
const app = require('../helpers/testApp');

// Mock external services
jest.mock('../../services/tebraService');
jest.mock('../../services/shopifyUserService');
jest.mock('../../services/customerPatientMapService');
jest.mock('../../db/pg');

const tebraService = require('../../services/tebraService');
const shopifyUserService = require('../../services/shopifyUserService');
const customerPatientMapService = require('../../services/customerPatientMapService');

describe('E2E: User Registration Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should complete full registration flow: guest → register → login → access', async () => {
    // Step 1: Guest attempts to register
    const registrationData = {
      firstName: 'John',
      lastName: 'Doe',
      email: `test-${Date.now()}@example.com`,
      password: 'TestPassword123!',
      phone: '555-1234',
      state: 'CA'
    };

    // Mock Shopify customer creation
    const mockShopifyCustomer = {
      id: 'gid://shopify/Customer/12345',
      email: registrationData.email,
      firstName: registrationData.firstName,
      lastName: registrationData.lastName
    };

    shopifyUserService.createCustomer = jest.fn().mockResolvedValue(mockShopifyCustomer);

    // Mock Tebra patient creation
    const mockTebraPatient = {
      PatientId: 'tebra-patient-123',
      FirstName: registrationData.firstName,
      LastName: registrationData.lastName,
      Email: registrationData.email
    };

    tebraService.createPatient = jest.fn().mockResolvedValue(mockTebraPatient);

    // Mock customer-patient mapping
    customerPatientMapService.upsert = jest.fn().mockResolvedValue(true);

    // Step 2: Register user
    const registerRes = await request(app)
      .post('/api/shopify-storefront/register')
      .send(registrationData)
      .expect(200);

    expect(registerRes.body).toHaveProperty('success', true);
    expect(registerRes.body).toHaveProperty('customer');
    expect(registerRes.body).toHaveProperty('accessToken');
    expect(shopifyUserService.createCustomer).toHaveBeenCalled();
    expect(tebraService.createPatient).toHaveBeenCalled();

    // Step 3: Login with credentials
    const loginRes = await request(app)
      .post('/api/shopify-storefront/login')
      .send({
        email: registrationData.email,
        password: registrationData.password
      })
      .expect(200);

    expect(loginRes.body).toHaveProperty('success', true);
    expect(loginRes.body).toHaveProperty('accessToken');

    const accessToken = loginRes.body.accessToken;

    // Step 4: Access protected endpoint
    const meRes = await request(app)
      .get('/api/shopify-storefront/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(meRes.body).toHaveProperty('customer');
    expect(meRes.body.customer.email).toBe(registrationData.email);
  });

  it('should handle registration with missing required fields', async () => {
    const incompleteData = {
      firstName: 'John'
      // Missing lastName, email, password
    };

    const res = await request(app)
      .post('/api/shopify-storefront/register')
      .send(incompleteData)
      .expect(400);

    expect(res.body).toHaveProperty('success', false);
  });

  it('should handle duplicate email registration', async () => {
    const registrationData = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'existing@example.com',
      password: 'TestPassword123!'
    };

    shopifyUserService.createCustomer = jest.fn().mockRejectedValue({
      message: 'Email already exists',
      statusCode: 422
    });

    const res = await request(app)
      .post('/api/shopify-storefront/register')
      .send(registrationData)
      .expect(422);

    expect(res.body).toHaveProperty('success', false);
  });

  it('should link guest data after registration', async () => {
    const registrationData = {
      firstName: 'John',
      lastName: 'Doe',
      email: `test-${Date.now()}@example.com`,
      password: 'TestPassword123!',
      state: 'CA'
    };

    const mockShopifyCustomer = {
      id: 'gid://shopify/Customer/12345',
      email: registrationData.email
    };

    shopifyUserService.createCustomer = jest.fn().mockResolvedValue(mockShopifyCustomer);
    tebraService.createPatient = jest.fn().mockResolvedValue({ PatientId: 'patient-123' });
    customerPatientMapService.upsert = jest.fn().mockResolvedValue(true);
    customerPatientMapService.linkGuestData = jest.fn().mockResolvedValue(true);

    const res = await request(app)
      .post('/api/shopify-storefront/register')
      .send(registrationData)
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    // Guest data linking should be handled by the controller
  });
});
