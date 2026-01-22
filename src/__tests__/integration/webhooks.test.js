// Integration tests for webhook endpoints

const request = require('supertest');
const crypto = require('crypto');
const app = require('../helpers/testApp');

// Mock external services
jest.mock('../../services/tebraService');
jest.mock('../../services/questionnaireCompletionService');
jest.mock('../../services/customerPatientMapService');
jest.mock('../../services/notificationService');
jest.mock('../../db/pg');

const tebraService = require('../../services/tebraService');
const questionnaireCompletionService = require('../../services/questionnaireCompletionService');
const customerPatientMapService = require('../../services/customerPatientMapService');

// Helper to generate webhook signature
function generateShopifySignature(body, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body, 'utf8');
  return hmac.digest('base64');
}

function generateRevenueHuntSignature(body, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body, 'utf8');
  return hmac.digest('hex');
}

describe('POST /webhooks/revenue-hunt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.REVENUEHUNT_WEBHOOK_SECRET = 'test-secret';
  });

  it('should process questionnaire completion successfully', async () => {
    const quizData = {
      quizId: 'quiz-123',
      answers: { question1: 'answer1' },
      customerId: 'customer-123',
      productId: 'product-123'
    };

    const body = JSON.stringify(quizData);
    const signature = generateRevenueHuntSignature(body, process.env.REVENUEHUNT_WEBHOOK_SECRET);

    questionnaireCompletionService.recordCompletion = jest.fn().mockResolvedValue({
      completionId: 'completion-123',
      hasRedFlags: false
    });

    tebraService.createPatient = jest.fn().mockResolvedValue({ PatientId: 'patient-123' });
    customerPatientMapService.upsert = jest.fn().mockResolvedValue(true);

    const res = await request(app)
      .post('/webhooks/revenue-hunt')
      .set('X-RevenueHunt-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(quizData)
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(questionnaireCompletionService.recordCompletion).toHaveBeenCalled();
  });

  it('should return 401 for invalid signature', async () => {
    const quizData = { quizId: 'quiz-123' };
    const body = JSON.stringify(quizData);

    const res = await request(app)
      .post('/webhooks/revenue-hunt')
      .set('X-RevenueHunt-Signature', 'invalid-signature')
      .set('Content-Type', 'application/json')
      .send(quizData)
      .expect(401);

    expect(res.body).toHaveProperty('success', false);
  });

  it('should handle red flags and return consultation scheduling', async () => {
    const quizData = {
      quizId: 'quiz-123',
      answers: { question1: 'answer1' },
      customerId: 'customer-123',
      productId: 'product-123'
    };

    const body = JSON.stringify(quizData);
    const signature = generateRevenueHuntSignature(body, process.env.REVENUEHUNT_WEBHOOK_SECRET);

    questionnaireCompletionService.recordCompletion = jest.fn().mockResolvedValue({
      completionId: 'completion-123',
      hasRedFlags: true
    });

    tebraService.createPatient = jest.fn().mockResolvedValue({ PatientId: 'patient-123' });
    tebraService.getAvailability = jest.fn().mockResolvedValue({
      availability: [
        {
          startTime: '2024-02-15T10:00:00Z',
          endTime: '2024-02-15T10:30:00Z'
        }
      ]
    });

    const res = await request(app)
      .post('/webhooks/revenue-hunt')
      .set('X-RevenueHunt-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(quizData)
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('action', 'schedule_consultation');
    expect(res.body).toHaveProperty('availableSlots');
  });

  it('should return 400 for invalid payload', async () => {
    const quizData = {}; // Missing required fields

    const body = JSON.stringify(quizData);
    const signature = generateRevenueHuntSignature(body, process.env.REVENUEHUNT_WEBHOOK_SECRET);

    const res = await request(app)
      .post('/webhooks/revenue-hunt')
      .set('X-RevenueHunt-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(quizData)
      .expect(400);

    expect(res.body).toHaveProperty('success', false);
  });
});

describe('POST /webhooks/shopify/orders/created', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SHOPIFY_WEBHOOK_SECRET = 'test-shopify-secret';
  });

  it('should process Shopify order webhook successfully', async () => {
    const orderData = {
      id: 'order-123',
      email: 'customer@example.com',
      line_items: [
        {
          product_id: 'product-123',
          properties: [
            { name: '_appointmentId', value: 'appointment-123' }
          ]
        }
      ],
      shipping_address: {
        province_code: 'CA',
        country_code: 'US'
      }
    };

    const body = JSON.stringify(orderData);
    const signature = generateShopifySignature(body, process.env.SHOPIFY_WEBHOOK_SECRET);

    tebraService.getAppointment = jest.fn().mockResolvedValue({
      AppointmentId: 'appointment-123',
      StartTime: '2024-02-15T10:00:00Z'
    });

    customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-123');

    const res = await request(app)
      .post('/webhooks/shopify/orders/created')
      .set('X-Shopify-Hmac-SHA256', signature)
      .set('X-Shopify-Shop-Domain', 'test-shop.myshopify.com')
      .set('Content-Type', 'application/json')
      .send(orderData)
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
  });

  it('should return 401 for invalid Shopify signature', async () => {
    const orderData = { id: 'order-123' };

    const res = await request(app)
      .post('/webhooks/shopify/orders/created')
      .set('X-Shopify-Hmac-SHA256', 'invalid-signature')
      .set('X-Shopify-Shop-Domain', 'test-shop.myshopify.com')
      .set('Content-Type', 'application/json')
      .send(orderData)
      .expect(401);

    expect(res.body).toHaveProperty('success', false);
  });

  it('should handle orders without appointment data', async () => {
    const orderData = {
      id: 'order-123',
      email: 'customer@example.com',
      line_items: [],
      shipping_address: {
        province_code: 'CA'
      }
    };

    const body = JSON.stringify(orderData);
    const signature = generateShopifySignature(body, process.env.SHOPIFY_WEBHOOK_SECRET);

    const res = await request(app)
      .post('/webhooks/shopify/orders/created')
      .set('X-Shopify-Hmac-SHA256', signature)
      .set('X-Shopify-Shop-Domain', 'test-shop.myshopify.com')
      .set('Content-Type', 'application/json')
      .send(orderData)
      .expect(200);

    // Should still succeed but not process appointment
    expect(res.body).toHaveProperty('success', true);
  });
});

describe('GET /webhooks/shopify/health', () => {
  it('should return health status', async () => {
    const res = await request(app)
      .get('/webhooks/shopify/health')
      .expect(200);

    expect(res.body).toHaveProperty('status');
  });
});
