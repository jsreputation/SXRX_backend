// Integration tests for Stripe webhook endpoint

const request = require('supertest');
const crypto = require('crypto');
const app = require('../../helpers/testApp');

// Mock external services
jest.mock('../../../services/tebraService');
jest.mock('../../../services/customerPatientMapService');
jest.mock('../../../db/pg');

const tebraService = require('../../../services/tebraService');
const customerPatientMapService = require('../../../services/customerPatientMapService');

// Helper to generate Stripe webhook signature
function generateStripeSignature(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  return { signature, timestamp };
}

describe('POST /webhooks/stripe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
  });

  describe('checkout.session.completed event', () => {
    it('should process checkout session completion successfully', async () => {
      const event = {
        id: 'evt_test_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            customer_email: 'customer@example.com',
            amount_total: 5000,
            currency: 'usd',
            metadata: {
              productId: 'product-123',
              appointmentId: 'appointment-123'
            }
          }
        }
      };

      const payload = JSON.stringify(event);
      const { signature, timestamp } = generateStripeSignature(payload, process.env.STRIPE_WEBHOOK_SECRET);

      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-123');
      tebraService.createDocument = jest.fn().mockResolvedValue({ id: 'doc-123' });

      const res = await request(app)
        .post('/webhooks/stripe')
        .set('stripe-signature', `t=${timestamp},v1=${signature}`)
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(200);

      expect(res.body).toHaveProperty('received', true);
      expect(customerPatientMapService.getPatientId).toHaveBeenCalled();
    });

    it('should create patient if not found', async () => {
      const event = {
        id: 'evt_test_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            customer_email: 'newcustomer@example.com',
            amount_total: 5000,
            currency: 'usd'
          }
        }
      };

      const payload = JSON.stringify(event);
      const { signature, timestamp } = generateStripeSignature(payload, process.env.STRIPE_WEBHOOK_SECRET);

      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue(null);
      tebraService.searchPatients = jest.fn().mockResolvedValue({ patients: [] });
      tebraService.createPatient = jest.fn().mockResolvedValue({ 
        id: 'new-patient-123',
        patientId: 'new-patient-123'
      });
      tebraService.createDocument = jest.fn().mockResolvedValue({ id: 'doc-123' });

      const res = await request(app)
        .post('/webhooks/stripe')
        .set('stripe-signature', `t=${timestamp},v1=${signature}`)
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(200);

      expect(res.body).toHaveProperty('received', true);
      expect(tebraService.createPatient).toHaveBeenCalled();
    });
  });

  describe('payment_intent.succeeded event', () => {
    it('should process payment intent success', async () => {
      const event = {
        id: 'evt_test_123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_123',
            receipt_email: 'customer@example.com',
            amount: 5000,
            currency: 'usd',
            metadata: {
              productId: 'product-123'
            }
          }
        }
      };

      const payload = JSON.stringify(event);
      const { signature, timestamp } = generateStripeSignature(payload, process.env.STRIPE_WEBHOOK_SECRET);

      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-123');
      tebraService.createDocument = jest.fn().mockResolvedValue({ id: 'doc-123' });

      const res = await request(app)
        .post('/webhooks/stripe')
        .set('stripe-signature', `t=${timestamp},v1=${signature}`)
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(200);

      expect(res.body).toHaveProperty('received', true);
    });
  });

  describe('Webhook signature verification', () => {
    it('should return 401 for invalid signature', async () => {
      const event = {
        id: 'evt_test_123',
        type: 'checkout.session.completed',
        data: { object: {} }
      };

      const payload = JSON.stringify(event);

      const res = await request(app)
        .post('/webhooks/stripe')
        .set('stripe-signature', 'invalid_signature')
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(401);

      expect(res.body).toHaveProperty('error');
    });

    it('should return 401 for missing signature', async () => {
      const event = {
        id: 'evt_test_123',
        type: 'checkout.session.completed',
        data: { object: {} }
      };

      const payload = JSON.stringify(event);

      const res = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(401);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('Error handling', () => {
    it('should handle Tebra service errors', async () => {
      const event = {
        id: 'evt_test_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            customer_email: 'customer@example.com'
          }
        }
      };

      const payload = JSON.stringify(event);
      const { signature, timestamp } = generateStripeSignature(payload, process.env.STRIPE_WEBHOOK_SECRET);

      customerPatientMapService.getPatientId = jest.fn().mockRejectedValue(new Error('Tebra error'));

      const res = await request(app)
        .post('/webhooks/stripe')
        .set('stripe-signature', `t=${timestamp},v1=${signature}`)
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });

    it('should handle invalid event type', async () => {
      const event = {
        id: 'evt_test_123',
        type: 'unknown.event.type',
        data: { object: {} }
      };

      const payload = JSON.stringify(event);
      const { signature, timestamp } = generateStripeSignature(payload, process.env.STRIPE_WEBHOOK_SECRET);

      const res = await request(app)
        .post('/webhooks/stripe')
        .set('stripe-signature', `t=${timestamp},v1=${signature}`)
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(200); // Should still return 200 but log unhandled event

      expect(res.body).toHaveProperty('received', true);
    });
  });
});
