// Integration tests for Shopify webhook endpoints

const request = require('supertest');
const crypto = require('crypto');
const app = require('../../helpers/testApp');

// Mock external services
jest.mock('../../../services/tebraService');
jest.mock('../../../services/customerPatientMapService');
jest.mock('../../../db/pg');

const tebraService = require('../../../services/tebraService');
const customerPatientMapService = require('../../../services/customerPatientMapService');

// Helper to generate Shopify webhook signature
function generateShopifySignature(body, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body, 'utf8');
  return hmac.digest('base64');
}

describe('POST /webhooks/shopify/orders/created', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SHOPIFY_WEBHOOK_SECRET = 'test-shopify-secret';
  });

  describe('Successful order processing', () => {
    it('should process Shopify order with appointment data', async () => {
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
        StartTime: '2024-02-15T10:00:00Z',
        EndTime: '2024-02-15T10:30:00Z',
        PatientId: 'patient-123'
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
      expect(tebraService.getAppointment).toHaveBeenCalledWith('appointment-123');
    });

    it('should handle orders without appointment data', async () => {
      const orderData = {
        id: 'order-123',
        email: 'customer@example.com',
        line_items: [],
        shipping_address: {
          province_code: 'CA',
          country_code: 'US'
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

      expect(res.body).toHaveProperty('success', true);
      expect(tebraService.getAppointment).not.toHaveBeenCalled();
    });

    it('should handle multiple line items with appointments', async () => {
      const orderData = {
        id: 'order-123',
        email: 'customer@example.com',
        line_items: [
          {
            product_id: 'product-123',
            properties: [
              { name: '_appointmentId', value: 'appointment-123' }
            ]
          },
          {
            product_id: 'product-456',
            properties: [
              { name: '_appointmentId', value: 'appointment-456' }
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

      tebraService.getAppointment = jest.fn()
        .mockResolvedValueOnce({ AppointmentId: 'appointment-123' })
        .mockResolvedValueOnce({ AppointmentId: 'appointment-456' });

      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-123');

      const res = await request(app)
        .post('/webhooks/shopify/orders/created')
        .set('X-Shopify-Hmac-SHA256', signature)
        .set('X-Shopify-Shop-Domain', 'test-shop.myshopify.com')
        .set('Content-Type', 'application/json')
        .send(orderData)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(tebraService.getAppointment).toHaveBeenCalledTimes(2);
    });
  });

  describe('Webhook signature verification', () => {
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

    it('should return 401 for missing signature', async () => {
      const orderData = { id: 'order-123' };

      const res = await request(app)
        .post('/webhooks/shopify/orders/created')
        .set('X-Shopify-Shop-Domain', 'test-shop.myshopify.com')
        .set('Content-Type', 'application/json')
        .send(orderData)
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
    });
  });

  describe('Error handling', () => {
    it('should handle Tebra API errors gracefully', async () => {
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

      tebraService.getAppointment = jest.fn().mockRejectedValue(new Error('Tebra API error'));
      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-123');

      const res = await request(app)
        .post('/webhooks/shopify/orders/created')
        .set('X-Shopify-Hmac-SHA256', signature)
        .set('X-Shopify-Shop-Domain', 'test-shop.myshopify.com')
        .set('Content-Type', 'application/json')
        .send(orderData)
        .expect(500);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should handle missing patient mapping', async () => {
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
        PatientId: 'patient-123'
      });

      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue(null);

      const res = await request(app)
        .post('/webhooks/shopify/orders/created')
        .set('X-Shopify-Hmac-SHA256', signature)
        .set('X-Shopify-Shop-Domain', 'test-shop.myshopify.com')
        .set('Content-Type', 'application/json')
        .send(orderData)
        .expect(200);

      // Should still succeed but log warning about missing patient mapping
      expect(res.body).toHaveProperty('success', true);
    });
  });
});

describe('POST /webhooks/shopify/orders/paid', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SHOPIFY_WEBHOOK_SECRET = 'test-shopify-secret';
  });

  it('should process paid order webhook', async () => {
    const orderData = {
      id: 'order-123',
      email: 'customer@example.com',
      financial_status: 'paid',
      line_items: [
        {
          product_id: 'product-123',
          quantity: 1
        }
      ]
    };

    const body = JSON.stringify(orderData);
    const signature = generateShopifySignature(body, process.env.SHOPIFY_WEBHOOK_SECRET);

    customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-123');

    const res = await request(app)
      .post('/webhooks/shopify/orders/paid')
      .set('X-Shopify-Hmac-SHA256', signature)
      .set('X-Shopify-Shop-Domain', 'test-shop.myshopify.com')
      .set('Content-Type', 'application/json')
      .send(orderData)
      .expect(200);

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
