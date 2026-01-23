// Integration tests for RevenueHunt v2 webhook endpoint
// Note: RevenueHunt v2 does not use webhook secrets/signatures

const request = require('supertest');
const app = require('../../helpers/testApp');

// Mock external services
jest.mock('../../../services/tebraService');
jest.mock('../../../services/questionnaireCompletionService');
jest.mock('../../../services/customerPatientMapService');
jest.mock('../../../services/notificationService');
jest.mock('../../../services/pharmacyService');
jest.mock('../../../db/pg');

const tebraService = require('../../../services/tebraService');
const questionnaireCompletionService = require('../../../services/questionnaireCompletionService');
const customerPatientMapService = require('../../../services/customerPatientMapService');
const pharmacyService = require('../../../services/pharmacyService');

describe('POST /webhooks/revenue-hunt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // RevenueHunt v2 doesn't require webhook secret - all requests are accepted
  });

  describe('Successful questionnaire processing', () => {
    it('should process questionnaire completion without red flags and proceed to checkout', async () => {
      const quizData = {
        quizId: 'quiz-123',
        answers: { question1: 'answer1' },
        customerId: 'customer-123',
        productId: 'product-123',
        email: 'customer@example.com',
        fullName: 'John Doe'
      };

      questionnaireCompletionService.recordCompletion = jest.fn().mockResolvedValue({
        completionId: 'completion-123',
        hasRedFlags: false
      });

      tebraService.createPatient = jest.fn().mockResolvedValue({ 
        id: 'patient-123',
        patientId: 'patient-123',
        practiceId: 'practice-123'
      });
      
      customerPatientMapService.upsert = jest.fn().mockResolvedValue(true);
      pharmacyService.submitPrescription = jest.fn().mockResolvedValue({ prescriptionId: 'prescription-123' });

      const res = await request(app)
        .post('/webhooks/revenue-hunt')
        .set('Content-Type', 'application/json')
        .send(quizData)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('action', 'proceed_to_checkout');
      expect(questionnaireCompletionService.recordCompletion).toHaveBeenCalled();
      expect(tebraService.createPatient).toHaveBeenCalled();
      expect(customerPatientMapService.upsert).toHaveBeenCalled();
      expect(pharmacyService.submitPrescription).toHaveBeenCalled();
    });

    it('should handle red flags and return consultation scheduling action', async () => {
      const quizData = {
        quizId: 'quiz-123',
        answers: { question1: 'answer1' },
        customerId: 'customer-123',
        productId: 'product-123',
        email: 'customer@example.com',
        fullName: 'John Doe',
        redFlags: ['high_risk', 'contraindication']
      };

      questionnaireCompletionService.recordCompletion = jest.fn().mockResolvedValue({
        completionId: 'completion-123',
        hasRedFlags: true,
        redFlags: ['high_risk', 'contraindication']
      });

      tebraService.createPatient = jest.fn().mockResolvedValue({ 
        id: 'patient-123',
        patientId: 'patient-123',
        practiceId: 'practice-123'
      });
      
      customerPatientMapService.upsert = jest.fn().mockResolvedValue(true);
      tebraService.getAvailability = jest.fn().mockResolvedValue({
        availability: [
          {
            startTime: '2024-02-15T10:00:00Z',
            endTime: '2024-02-15T10:30:00Z',
            providerId: 'provider-123',
            practiceId: 'practice-123'
          },
          {
            startTime: '2024-02-15T14:00:00Z',
            endTime: '2024-02-15T14:30:00Z',
            providerId: 'provider-123',
            practiceId: 'practice-123'
          }
        ]
      });

      const res = await request(app)
        .post('/webhooks/revenue-hunt')
        .set('Content-Type', 'application/json')
        .send(quizData)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('action', 'schedule_consultation');
      expect(res.body).toHaveProperty('availableSlots');
      expect(Array.isArray(res.body.availableSlots)).toBe(true);
      expect(res.body.availableSlots.length).toBeGreaterThan(0);
      expect(pharmacyService.submitPrescription).not.toHaveBeenCalled();
    });

    it('should create patient record if customer does not exist', async () => {
      const quizData = {
        quizId: 'quiz-123',
        answers: { question1: 'answer1' },
        customerId: 'new-customer-123',
        productId: 'product-123',
        email: 'newcustomer@example.com',
        fullName: 'New Customer',
        firstName: 'New',
        lastName: 'Customer'
      };

      questionnaireCompletionService.recordCompletion = jest.fn().mockResolvedValue({
        completionId: 'completion-123',
        hasRedFlags: false
      });

      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue(null);
      tebraService.createPatient = jest.fn().mockResolvedValue({ 
        id: 'new-patient-123',
        patientId: 'new-patient-123',
        practiceId: 'practice-123'
      });
      customerPatientMapService.upsert = jest.fn().mockResolvedValue(true);
      pharmacyService.submitPrescription = jest.fn().mockResolvedValue({ prescriptionId: 'prescription-123' });

      const res = await request(app)
        .post('/webhooks/revenue-hunt')
        .set('Content-Type', 'application/json')
        .send(quizData)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(tebraService.createPatient).toHaveBeenCalled();
      expect(customerPatientMapService.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'new-customer-123',
          patientId: 'new-patient-123'
        })
      );
    });
  });

  describe('Error handling', () => {
    it('should return 400 for invalid payload', async () => {
      const quizData = {}; // Missing required fields

      const res = await request(app)
        .post('/webhooks/revenue-hunt')
        .set('Content-Type', 'application/json')
        .send(quizData)
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('message');
    });

    it('should handle Tebra API errors gracefully', async () => {
      const quizData = {
        quizId: 'quiz-123',
        answers: { question1: 'answer1' },
        customerId: 'customer-123',
        productId: 'product-123',
        email: 'customer@example.com'
      };

      questionnaireCompletionService.recordCompletion = jest.fn().mockResolvedValue({
        completionId: 'completion-123',
        hasRedFlags: false
      });

      tebraService.createPatient = jest.fn().mockRejectedValue(new Error('Tebra API error'));
      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue(null);

      const res = await request(app)
        .post('/webhooks/revenue-hunt')
        .set('Content-Type', 'application/json')
        .send(quizData)
        .expect(500);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should handle questionnaire completion service errors', async () => {
      const quizData = {
        quizId: 'quiz-123',
        answers: { question1: 'answer1' },
        customerId: 'customer-123',
        productId: 'product-123',
        email: 'customer@example.com'
      };

      questionnaireCompletionService.recordCompletion = jest.fn().mockRejectedValue(new Error('Database error'));

      const res = await request(app)
        .post('/webhooks/revenue-hunt')
        .set('Content-Type', 'application/json')
        .send(quizData)
        .expect(500);

      expect(res.body).toHaveProperty('success', false);
    });
  });

  describe('Webhook retry logic', () => {
    it('should handle retry scenarios', async () => {
      const quizData = {
        quizId: 'quiz-123',
        answers: { question1: 'answer1' },
        customerId: 'customer-123',
        productId: 'product-123',
        email: 'customer@example.com'
      };

      // Simulate transient error on first call, success on retry
      let callCount = 0;
      questionnaireCompletionService.recordCompletion = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Transient error');
        }
        return Promise.resolve({
          completionId: 'completion-123',
          hasRedFlags: false
        });
      });

      // First attempt should fail
      const res1 = await request(app)
        .post('/webhooks/revenue-hunt')
        .set('Content-Type', 'application/json')
        .send(quizData)
        .expect(500);

      expect(res1.body).toHaveProperty('success', false);
    });
  });

  describe('Document creation', () => {
    it('should create questionnaire document in Tebra', async () => {
      const quizData = {
        quizId: 'quiz-123',
        answers: { question1: 'answer1', question2: 'answer2' },
        customerId: 'customer-123',
        productId: 'product-123',
        email: 'customer@example.com',
        fullName: 'John Doe',
        summary: 'Patient questionnaire summary'
      };

      questionnaireCompletionService.recordCompletion = jest.fn().mockResolvedValue({
        completionId: 'completion-123',
        hasRedFlags: false
      });

      tebraService.createPatient = jest.fn().mockResolvedValue({ 
        id: 'patient-123',
        patientId: 'patient-123',
        practiceId: 'practice-123'
      });
      
      customerPatientMapService.upsert = jest.fn().mockResolvedValue(true);
      tebraService.createDocument = jest.fn().mockResolvedValue({ id: 'doc-123' });
      pharmacyService.submitPrescription = jest.fn().mockResolvedValue({ prescriptionId: 'prescription-123' });

      const res = await request(app)
        .post('/webhooks/revenue-hunt')
        .set('Content-Type', 'application/json')
        .send(quizData)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(tebraService.createDocument).toHaveBeenCalled();
      const documentCall = tebraService.createDocument.mock.calls[0][0];
      expect(documentCall).toHaveProperty('patientId', 'patient-123');
      expect(documentCall).toHaveProperty('name', 'Online Questionnaire');
    });
  });
});
