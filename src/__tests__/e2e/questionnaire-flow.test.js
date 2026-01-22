// E2E tests for questionnaire completion flow

const request = require('supertest');
const crypto = require('crypto');
const app = require('../helpers/testApp');

// Mock external services
jest.mock('../../services/tebraService');
jest.mock('../../services/questionnaireCompletionService');
jest.mock('../../services/customerPatientMapService');
jest.mock('../../services/availabilityService');
jest.mock('../../services/notificationService');
jest.mock('../../db/pg');

const tebraService = require('../../services/tebraService');
const questionnaireCompletionService = require('../../services/questionnaireCompletionService');
const customerPatientMapService = require('../../services/customerPatientMapService');
const availabilityService = require('../../services/availabilityService');

// Helper to generate webhook signature
function generateRevenueHuntSignature(body, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body, 'utf8');
  return hmac.digest('hex');
}

describe('E2E: Questionnaire Flow - No Red Flags', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.REVENUEHUNT_WEBHOOK_SECRET = 'test-secret';
  });

  it('should complete full questionnaire flow: quiz → webhook → checkout', async () => {
    // Step 1: User completes questionnaire (simulated via webhook)
    const quizData = {
      quizId: 'quiz-123',
      productId: 'product-123',
      customerId: 'customer-123',
      purchaseType: 'subscription',
      answers: {
        question1: 'answer1',
        question2: 'answer2'
      },
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      state: 'CA'
    };

    const body = JSON.stringify(quizData);
    const signature = generateRevenueHuntSignature(body, process.env.REVENUEHUNT_WEBHOOK_SECRET);

    // Mock services
    questionnaireCompletionService.recordCompletion = jest.fn().mockResolvedValue({
      completionId: 'completion-123',
      hasRedFlags: false
    });

    tebraService.createPatient = jest.fn().mockResolvedValue({
      PatientId: 'patient-123',
      FirstName: quizData.firstName,
      LastName: quizData.lastName
    });

    customerPatientMapService.upsert = jest.fn().mockResolvedValue(true);
    tebraService.createDocument = jest.fn().mockResolvedValue({ DocumentId: 'doc-123' });

    // Step 2: Send questionnaire webhook
    const webhookRes = await request(app)
      .post('/webhooks/revenue-hunt')
      .set('X-RevenueHunt-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(quizData)
      .expect(200);

    expect(webhookRes.body).toHaveProperty('success', true);
    expect(webhookRes.body).toHaveProperty('action', 'proceed_to_checkout');
    expect(questionnaireCompletionService.recordCompletion).toHaveBeenCalled();
    expect(tebraService.createPatient).toHaveBeenCalled();
    expect(tebraService.createDocument).toHaveBeenCalled();

    // Step 3: Verify patient was created and mapped
    expect(customerPatientMapService.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        shopifyCustomerId: quizData.customerId,
        tebraPatientId: 'patient-123',
        email: quizData.email
      })
    );
  });

  it('should handle questionnaire with red flags: quiz → webhook → consultation scheduling', async () => {
    const quizData = {
      quizId: 'quiz-123',
      productId: 'product-123',
      customerId: 'customer-123',
      purchaseType: 'subscription',
      answers: {
        question1: 'answer1',
        question2: 'answer2'
      },
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      state: 'CA',
      redFlags: ['High blood pressure', 'Recent surgery']
    };

    const body = JSON.stringify(quizData);
    const signature = generateRevenueHuntSignature(body, process.env.REVENUEHUNT_WEBHOOK_SECRET);

    // Mock services for red flag scenario
    questionnaireCompletionService.recordCompletion = jest.fn().mockResolvedValue({
      completionId: 'completion-123',
      hasRedFlags: true,
      redFlags: quizData.redFlags
    });

    tebraService.createPatient = jest.fn().mockResolvedValue({
      PatientId: 'patient-123'
    });

    customerPatientMapService.upsert = jest.fn().mockResolvedValue(true);
    tebraService.createDocument = jest.fn().mockResolvedValue({ DocumentId: 'doc-123' });

    const mockSlots = [
      {
        startTime: '2024-02-15T10:00:00Z',
        endTime: '2024-02-15T10:30:00Z',
        providerId: 'provider-123'
      },
      {
        startTime: '2024-02-15T14:00:00Z',
        endTime: '2024-02-15T14:30:00Z',
        providerId: 'provider-123'
      }
    ];

    tebraService.getAvailability = jest.fn().mockResolvedValue({
      availability: mockSlots,
      totalCount: 2
    });

    availabilityService.filterAvailability = jest.fn().mockResolvedValue(mockSlots);

    // Step 2: Send questionnaire webhook
    const webhookRes = await request(app)
      .post('/webhooks/revenue-hunt')
      .set('X-RevenueHunt-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(quizData)
      .expect(200);

    expect(webhookRes.body).toHaveProperty('success', true);
    expect(webhookRes.body).toHaveProperty('action', 'schedule_consultation');
    expect(webhookRes.body).toHaveProperty('availableSlots');
    expect(webhookRes.body.availableSlots).toBeInstanceOf(Array);
    expect(webhookRes.body.availableSlots.length).toBeGreaterThan(0);
    expect(tebraService.getAvailability).toHaveBeenCalled();
    expect(availabilityService.filterAvailability).toHaveBeenCalled();
  });

  it('should handle questionnaire completion for existing patient', async () => {
    const quizData = {
      quizId: 'quiz-123',
      productId: 'product-123',
      customerId: 'customer-123',
      email: 'existing@example.com',
      state: 'CA'
    };

    const body = JSON.stringify(quizData);
    const signature = generateRevenueHuntSignature(body, process.env.REVENUEHUNT_WEBHOOK_SECRET);

    // Mock existing patient lookup
    customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('existing-patient-123');
    tebraService.getPatient = jest.fn().mockResolvedValue({
      PatientId: 'existing-patient-123',
      FirstName: 'John',
      LastName: 'Doe'
    });

    questionnaireCompletionService.recordCompletion = jest.fn().mockResolvedValue({
      completionId: 'completion-123',
      hasRedFlags: false
    });

    tebraService.createDocument = jest.fn().mockResolvedValue({ DocumentId: 'doc-123' });

    const webhookRes = await request(app)
      .post('/webhooks/revenue-hunt')
      .set('X-RevenueHunt-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(quizData)
      .expect(200);

    expect(webhookRes.body).toHaveProperty('success', true);
    expect(customerPatientMapService.getPatientId).toHaveBeenCalled();
    // Should update existing patient, not create new one
    expect(tebraService.createPatient).not.toHaveBeenCalled();
  });
});
