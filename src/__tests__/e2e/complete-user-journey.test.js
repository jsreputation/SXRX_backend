// E2E tests for complete user journey (registration → questionnaire → booking → checkout)

const request = require('supertest');
const crypto = require('crypto');
const app = require('../helpers/testApp');

// Mock external services
jest.mock('../../services/tebraService');
jest.mock('../../services/shopifyUserService');
jest.mock('../../services/customerPatientMapService');
jest.mock('../../services/questionnaireCompletionService');
jest.mock('../../services/availabilityService');
jest.mock('../../services/appointmentEmailService');
jest.mock('../../services/notificationService');
jest.mock('../../db/pg');

const tebraService = require('../../services/tebraService');
const shopifyUserService = require('../../services/shopifyUserService');
const customerPatientMapService = require('../../services/customerPatientMapService');
const questionnaireCompletionService = require('../../services/questionnaireCompletionService');
const availabilityService = require('../../services/availabilityService');
const appointmentEmailService = require('../../services/appointmentEmailService');

// Helper to generate webhook signature
function generateRevenueHuntSignature(body, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body, 'utf8');
  return hmac.digest('hex');
}

describe('E2E: Complete User Journey - No Red Flags', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.REVENUEHUNT_WEBHOOK_SECRET = 'test-secret';
  });

  it('should complete full journey: register → questionnaire → checkout', async () => {
    const timestamp = Date.now();
    const testEmail = `test-${timestamp}@example.com`;

    // Step 1: User Registration
    const registrationData = {
      firstName: 'John',
      lastName: 'Doe',
      email: testEmail,
      password: 'TestPassword123!',
      state: 'CA'
    };

    const mockShopifyCustomer = {
      id: 'gid://shopify/Customer/12345',
      email: testEmail,
      firstName: registrationData.firstName,
      lastName: registrationData.lastName
    };

    shopifyUserService.createCustomer = jest.fn().mockResolvedValue(mockShopifyCustomer);
    tebraService.createPatient = jest.fn().mockResolvedValue({
      PatientId: 'patient-123',
      FirstName: registrationData.firstName,
      LastName: registrationData.lastName
    });
    customerPatientMapService.upsert = jest.fn().mockResolvedValue(true);

    const registerRes = await request(app)
      .post('/api/shopify-storefront/register')
      .send(registrationData)
      .expect(200);

    expect(registerRes.body).toHaveProperty('success', true);
    const accessToken = registerRes.body.accessToken;

    // Step 2: User completes questionnaire
    const quizData = {
      quizId: 'quiz-123',
      productId: 'product-123',
      customerId: '12345',
      purchaseType: 'subscription',
      answers: { question1: 'answer1' },
      firstName: registrationData.firstName,
      lastName: registrationData.lastName,
      email: testEmail,
      state: 'CA'
    };

    const body = JSON.stringify(quizData);
    const signature = generateRevenueHuntSignature(body, process.env.REVENUEHUNT_WEBHOOK_SECRET);

    questionnaireCompletionService.recordCompletion = jest.fn().mockResolvedValue({
      completionId: 'completion-123',
      hasRedFlags: false
    });

    customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-123');
    tebraService.getPatient = jest.fn().mockResolvedValue({
      PatientId: 'patient-123'
    });
    tebraService.createDocument = jest.fn().mockResolvedValue({ DocumentId: 'doc-123' });

    const webhookRes = await request(app)
      .post('/webhooks/revenue-hunt')
      .set('X-RevenueHunt-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(quizData)
      .expect(200);

    expect(webhookRes.body).toHaveProperty('success', true);
    expect(webhookRes.body).toHaveProperty('action', 'proceed_to_checkout');

    // Step 3: Verify user can access their data
    const meRes = await request(app)
      .get('/api/shopify-storefront/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(meRes.body).toHaveProperty('customer');
    expect(meRes.body.customer.email).toBe(testEmail);
  });

  it('should complete full journey with red flags: register → questionnaire → consultation → booking', async () => {
    const timestamp = Date.now();
    const testEmail = `test-redflags-${timestamp}@example.com`;

    // Step 1: User Registration
    const registrationData = {
      firstName: 'Jane',
      lastName: 'Smith',
      email: testEmail,
      password: 'TestPassword123!',
      state: 'CA'
    };

    shopifyUserService.createCustomer = jest.fn().mockResolvedValue({
      id: 'gid://shopify/Customer/67890',
      email: testEmail
    });

    tebraService.createPatient = jest.fn().mockResolvedValue({
      PatientId: 'patient-456'
    });

    customerPatientMapService.upsert = jest.fn().mockResolvedValue(true);

    const registerRes = await request(app)
      .post('/api/shopify-storefront/register')
      .send(registrationData)
      .expect(200);

    // Step 2: User completes questionnaire with red flags
    const quizData = {
      quizId: 'quiz-123',
      productId: 'product-123',
      customerId: '67890',
      purchaseType: 'subscription',
      answers: { question1: 'answer1' },
      firstName: registrationData.firstName,
      lastName: registrationData.lastName,
      email: testEmail,
      state: 'CA',
      redFlags: ['High blood pressure']
    };

    const body = JSON.stringify(quizData);
    const signature = generateRevenueHuntSignature(body, process.env.REVENUEHUNT_WEBHOOK_SECRET);

    questionnaireCompletionService.recordCompletion = jest.fn().mockResolvedValue({
      completionId: 'completion-456',
      hasRedFlags: true,
      redFlags: quizData.redFlags
    });

    customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-456');
    tebraService.createDocument = jest.fn().mockResolvedValue({ DocumentId: 'doc-456' });

    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const startTime = new Date(futureDate.setHours(14, 0, 0, 0)).toISOString();

    const mockSlots = [
      {
        startTime: startTime,
        endTime: new Date(new Date(startTime).getTime() + 30 * 60000).toISOString(),
        providerId: 'provider-123'
      }
    ];

    tebraService.getAvailability = jest.fn().mockResolvedValue({
      availability: mockSlots,
      totalCount: 1
    });

    availabilityService.filterAvailability = jest.fn().mockResolvedValue(mockSlots);

    const webhookRes = await request(app)
      .post('/webhooks/revenue-hunt')
      .set('X-RevenueHunt-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(quizData)
      .expect(200);

    expect(webhookRes.body).toHaveProperty('success', true);
    expect(webhookRes.body).toHaveProperty('action', 'schedule_consultation');
    expect(webhookRes.body).toHaveProperty('availableSlots');

    // Step 3: User books appointment
    const appointmentData = {
      patientId: 'patient-456',
      state: 'CA',
      startTime: startTime,
      appointmentName: 'Telemedicine Consultation',
      productId: 'product-123',
      purchaseType: 'subscription'
    };

    const mockAppointment = {
      AppointmentId: 'appointment-456',
      StartTime: startTime,
      EndTime: new Date(new Date(startTime).getTime() + 30 * 60000).toISOString()
    };

    tebraService.createAppointment = jest.fn().mockResolvedValue(mockAppointment);
    appointmentEmailService.sendConfirmation = jest.fn().mockResolvedValue(true);

    const bookingRes = await request(app)
      .post('/api/appointments/book')
      .send(appointmentData)
      .expect(200);

    expect(bookingRes.body).toHaveProperty('success', true);
    expect(bookingRes.body).toHaveProperty('appointmentId', 'appointment-456');
    expect(tebraService.createAppointment).toHaveBeenCalled();
    expect(appointmentEmailService.sendConfirmation).toHaveBeenCalled();
  });

  it('should handle guest user flow: attempt purchase → register → questionnaire → checkout', async () => {
    // This test simulates the flow where a guest tries to purchase,
    // gets redirected to register, then completes the flow

    const timestamp = Date.now();
    const testEmail = `guest-${timestamp}@example.com`;

    // Step 1: Guest attempts to register (after being redirected)
    const registrationData = {
      firstName: 'Guest',
      lastName: 'User',
      email: testEmail,
      password: 'TestPassword123!',
      state: 'CA'
    };

    shopifyUserService.createCustomer = jest.fn().mockResolvedValue({
      id: 'gid://shopify/Customer/guest-123',
      email: testEmail
    });

    tebraService.createPatient = jest.fn().mockResolvedValue({
      PatientId: 'patient-guest-123'
    });

    customerPatientMapService.upsert = jest.fn().mockResolvedValue(true);
    customerPatientMapService.linkGuestData = jest.fn().mockResolvedValue(true);

    const registerRes = await request(app)
      .post('/api/shopify-storefront/register')
      .send(registrationData)
      .expect(200);

    expect(registerRes.body).toHaveProperty('success', true);

    // Step 2: After login, user completes questionnaire
    const quizData = {
      quizId: 'quiz-123',
      productId: 'product-123',
      customerId: 'guest-123',
      purchaseType: 'subscription',
      answers: { question1: 'answer1' },
      email: testEmail,
      state: 'CA'
    };

    const body = JSON.stringify(quizData);
    const signature = generateRevenueHuntSignature(body, process.env.REVENUEHUNT_WEBHOOK_SECRET);

    questionnaireCompletionService.recordCompletion = jest.fn().mockResolvedValue({
      completionId: 'completion-guest-123',
      hasRedFlags: false
    });

    customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-guest-123');
    tebraService.createDocument = jest.fn().mockResolvedValue({ DocumentId: 'doc-guest-123' });

    const webhookRes = await request(app)
      .post('/webhooks/revenue-hunt')
      .set('X-RevenueHunt-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(quizData)
      .expect(200);

    expect(webhookRes.body).toHaveProperty('success', true);
    expect(webhookRes.body).toHaveProperty('action', 'proceed_to_checkout');

    // Verify guest data was linked
    expect(customerPatientMapService.linkGuestData).toHaveBeenCalled();
  });
});
