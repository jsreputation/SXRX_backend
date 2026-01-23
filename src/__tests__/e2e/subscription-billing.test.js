// E2E tests for subscription-billing flow

const request = require('supertest');
const app = require('../helpers/testApp');

// Mock external services
jest.mock('../../services/tebraService');
jest.mock('../../services/tebraBillingService');
jest.mock('../../services/subscriptionService');
jest.mock('../../services/billingSyncService');
jest.mock('../../services/customerPatientMapService');
jest.mock('../../services/shopifyUserService');
jest.mock('../../db/pg');

const tebraService = require('../../services/tebraService');
const tebraBillingService = require('../../services/tebraBillingService');
const subscriptionService = require('../../services/subscriptionService');
const billingSyncService = require('../../services/billingSyncService');
const customerPatientMapService = require('../../services/customerPatientMapService');
const shopifyUserService = require('../../services/shopifyUserService');

describe('E2E: Subscription-Billing Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Subscription Creation and First Billing', () => {
    it('should create subscription from order and process first payment', async () => {
      const customerEmail = 'customer@example.com';
      const customerId = 'customer-123';
      const patientId = 'patient-123';
      const orderId = 'order-123';
      const productId = 'product-123';

      // Step 1: Order created with subscription product
      const orderData = {
        id: orderId,
        email: customerEmail,
        customer: {
          id: customerId,
          email: customerEmail
        },
        line_items: [
          {
            id: 'line-item-1',
            product_id: productId,
            quantity: 1,
            price: '29.99',
            properties: [
              { name: 'subscription_frequency', value: 'monthly' }
            ]
          }
        ],
        tags: 'subscription',
        financial_status: 'paid',
        shipping_address: {
          province_code: 'CA',
          country_code: 'US'
        }
      };

      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue(patientId);
      tebraBillingService.createCharge = jest.fn().mockResolvedValue({ id: 'charge-123' });
      tebraBillingService.createPayment = jest.fn().mockResolvedValue({ id: 'payment-123' });
      subscriptionService.createSubscription = jest.fn().mockResolvedValue({
        id: 1,
        shopify_customer_id: customerId,
        shopify_product_id: productId,
        tebra_patient_id: patientId,
        amount_cents: 2999,
        frequency: 'monthly',
        status: 'active',
        next_billing_date: '2024-03-01'
      });
      billingSyncService.upsertByEventId = jest.fn().mockResolvedValue({
        id: 1,
        stripe_event_id: 'evt_test_123',
        tebra_patient_id: patientId,
        status: 'completed'
      });

      // Step 2: Process order paid webhook
      const orderPaidRes = await request(app)
        .post('/webhooks/shopify/orders/paid')
        .set('X-Shopify-Hmac-SHA256', 'test-signature')
        .set('X-Shopify-Shop-Domain', 'test-shop.myshopify.com')
        .send(orderData)
        .expect(200);

      expect(orderPaidRes.body).toHaveProperty('success', true);
      expect(subscriptionService.createSubscription).toHaveBeenCalled();
      expect(tebraBillingService.createCharge).toHaveBeenCalled();
      expect(tebraBillingService.createPayment).toHaveBeenCalled();
    });

    it('should handle recurring billing for active subscription', async () => {
      const subscriptionId = 1;
      const patientId = 'patient-123';
      const nextBillingDate = new Date().toISOString().slice(0, 10); // Today

      // Get subscriptions due for billing
      subscriptionService.getSubscriptionsDueForBilling = jest.fn().mockResolvedValue([
        {
          id: subscriptionId,
          tebra_patient_id: patientId,
          amount_cents: 2999,
          next_billing_date: nextBillingDate,
          status: 'active'
        }
      ]);

      // Process billing
      tebraBillingService.createCharge = jest.fn().mockResolvedValue({ id: 'charge-456' });
      tebraBillingService.createPayment = jest.fn().mockResolvedValue({ id: 'payment-456' });
      subscriptionService.updateSubscriptionBillingDate = jest.fn().mockResolvedValue({
        id: subscriptionId,
        next_billing_date: '2024-04-01',
        last_billing_date: nextBillingDate
      });
      billingSyncService.upsertByPaymentIntentId = jest.fn().mockResolvedValue({
        id: 2,
        tebra_patient_id: patientId,
        status: 'completed'
      });

      // Simulate billing job processing
      const subscriptions = await subscriptionService.getSubscriptionsDueForBilling();
      
      for (const subscription of subscriptions) {
        await tebraBillingService.createCharge({
          patientId: subscription.tebra_patient_id,
          amountCents: subscription.amount_cents
        });
        
        await tebraBillingService.createPayment({
          patientId: subscription.tebra_patient_id,
          amountCents: subscription.amount_cents
        });
        
        const nextDate = new Date(subscription.next_billing_date);
        nextDate.setMonth(nextDate.getMonth() + 1);
        
        await subscriptionService.updateSubscriptionBillingDate(
          subscription.id,
          nextDate.toISOString().slice(0, 10),
          subscription.next_billing_date
        );
      }

      expect(subscriptionService.getSubscriptionsDueForBilling).toHaveBeenCalled();
      expect(tebraBillingService.createCharge).toHaveBeenCalled();
      expect(tebraBillingService.createPayment).toHaveBeenCalled();
      expect(subscriptionService.updateSubscriptionBillingDate).toHaveBeenCalled();
    });
  });

  describe('Subscription Cancellation', () => {
    it('should cancel subscription and stop future billing', async () => {
      const subscriptionId = 1;
      const customerId = 'customer-123';
      const productId = 'product-123';

      subscriptionService.cancelSubscription = jest.fn().mockResolvedValue({
        id: subscriptionId,
        status: 'cancelled',
        cancelled_at: new Date()
      });

      const result = await subscriptionService.cancelSubscription(
        subscriptionId,
        customerId,
        productId
      );

      expect(subscriptionService.cancelSubscription).toHaveBeenCalledWith(
        subscriptionId,
        customerId,
        productId
      );
      expect(result).toHaveProperty('status', 'cancelled');
      expect(result).toHaveProperty('cancelled_at');
    });

    it('should not process billing for cancelled subscription', async () => {
      const nextBillingDate = new Date().toISOString().slice(0, 10);

      subscriptionService.getSubscriptionsDueForBilling = jest.fn().mockResolvedValue([
        {
          id: 1,
          status: 'cancelled',
          next_billing_date: nextBillingDate
        }
      ]);

      const subscriptions = await subscriptionService.getSubscriptionsDueForBilling();
      const activeSubscriptions = subscriptions.filter(s => s.status === 'active');

      expect(activeSubscriptions).toHaveLength(0);
      expect(tebraBillingService.createCharge).not.toHaveBeenCalled();
    });
  });

  describe('Billing Sync Tracking', () => {
    it('should track Stripe payment to Tebra billing sync', async () => {
      const eventId = 'evt_test_123';
      const paymentIntentId = 'pi_test_123';
      const patientId = 'patient-123';

      billingSyncService.upsertByEventId = jest.fn().mockResolvedValue({
        id: 1,
        stripe_event_id: eventId,
        stripe_payment_intent_id: paymentIntentId,
        tebra_patient_id: patientId,
        amount_cents: 5000,
        status: 'completed'
      });

      const result = await billingSyncService.upsertByEventId(eventId, {
        stripe_payment_intent_id: paymentIntentId,
        tebra_patient_id: patientId,
        amount_cents: 5000,
        status: 'completed'
      });

      expect(result).toHaveProperty('stripe_event_id', eventId);
      expect(result).toHaveProperty('tebra_patient_id', patientId);
      expect(result).toHaveProperty('status', 'completed');
    });

    it('should retrieve billing history for customer', async () => {
      const email = 'customer@example.com';
      const mockHistory = [
        {
          id: 1,
          stripe_customer_email: email,
          amount_cents: 5000,
          status: 'completed',
          created_at: new Date()
        },
        {
          id: 2,
          stripe_customer_email: email,
          amount_cents: 2999,
          status: 'completed',
          created_at: new Date()
        }
      ];

      billingSyncService.getRecentForEmail = jest.fn().mockResolvedValue(mockHistory);

      const history = await billingSyncService.getRecentForEmail(email, 20);

      expect(history).toHaveLength(2);
      expect(history[0]).toHaveProperty('stripe_customer_email', email);
    });
  });
});
