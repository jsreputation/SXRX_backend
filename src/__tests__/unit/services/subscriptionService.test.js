// Unit tests for subscriptionService

const subscriptionService = require('../../../services/subscriptionService');

// Mock dependencies
jest.mock('../../../db/pg');

const { query } = require('../../../db/pg');

describe('subscriptionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ensureInit', () => {
    it('should initialize database table on first call', async () => {
      query.mockResolvedValueOnce({ rowCount: 1 });

      await subscriptionService.ensureInit();

      expect(query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS subscriptions'));
    });

    it('should not reinitialize on subsequent calls', async () => {
      query.mockResolvedValueOnce({ rowCount: 1 });
      
      await subscriptionService.ensureInit();
      jest.clearAllMocks();
      
      await subscriptionService.ensureInit();

      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('createSubscription', () => {
    it('should create new subscription successfully', async () => {
      const subscriptionData = {
        shopifyCustomerId: 'customer-123',
        shopifyOrderId: 'order-123',
        shopifyProductId: 'product-123',
        tebraPatientId: 'patient-123',
        amountCents: 2999,
        currency: 'USD',
        frequency: 'monthly',
        nextBillingDate: '2024-03-01'
      };

      query.mockResolvedValueOnce({ rows: [] }); // Check existing
      query.mockResolvedValueOnce({ 
        rows: [{
          id: 1,
          ...subscriptionData,
          status: 'active',
          created_at: new Date()
        }]
      }); // INSERT

      const result = await subscriptionService.createSubscription(subscriptionData);

      expect(query).toHaveBeenCalledTimes(2);
      expect(result).toHaveProperty('id', 1);
      expect(result).toHaveProperty('tebra_patient_id', 'patient-123');
      expect(result).toHaveProperty('status', 'active');
    });

    it('should return existing subscription if already exists', async () => {
      const subscriptionData = {
        shopifyCustomerId: 'customer-123',
        shopifyProductId: 'product-123',
        tebraPatientId: 'patient-123',
        amountCents: 2999,
        nextBillingDate: '2024-03-01'
      };

      const existingSubscription = {
        id: 1,
        shopify_customer_id: 'customer-123',
        shopify_product_id: 'product-123',
        status: 'active'
      };

      query.mockResolvedValueOnce({ rows: [existingSubscription] }); // Check existing

      const result = await subscriptionService.createSubscription(subscriptionData);

      expect(query).toHaveBeenCalledTimes(1);
      expect(result).toEqual(existingSubscription);
    });

    it('should use default values for optional fields', async () => {
      const subscriptionData = {
        tebraPatientId: 'patient-123',
        amountCents: 2999,
        nextBillingDate: '2024-03-01'
      };

      query.mockResolvedValueOnce({ rows: [] }); // Check existing
      query.mockResolvedValueOnce({ 
        rows: [{
          id: 1,
          ...subscriptionData,
          currency: 'USD',
          frequency: 'monthly',
          status: 'active'
        }]
      }); // INSERT

      const result = await subscriptionService.createSubscription(subscriptionData);

      expect(result).toHaveProperty('currency', 'USD');
      expect(result).toHaveProperty('frequency', 'monthly');
      expect(result).toHaveProperty('status', 'active');
    });
  });

  describe('getActiveSubscriptions', () => {
    it('should retrieve all active subscriptions when no filters', async () => {
      const mockSubscriptions = [
        { id: 1, tebra_patient_id: 'patient-1', status: 'active' },
        { id: 2, tebra_patient_id: 'patient-2', status: 'active' }
      ];

      query.mockResolvedValueOnce({ rows: mockSubscriptions });

      const result = await subscriptionService.getActiveSubscriptions();

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("SELECT * FROM subscriptions WHERE status = 'active'"),
        []
      );
      expect(result).toEqual(mockSubscriptions);
    });

    it('should filter by tebraPatientId', async () => {
      const tebraPatientId = 'patient-123';
      const mockSubscriptions = [
        { id: 1, tebra_patient_id: tebraPatientId, status: 'active' }
      ];

      query.mockResolvedValueOnce({ rows: mockSubscriptions });

      const result = await subscriptionService.getActiveSubscriptions(tebraPatientId);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('tebra_patient_id = $1'),
        [tebraPatientId]
      );
      expect(result).toEqual(mockSubscriptions);
    });

    it('should filter by shopifyCustomerId', async () => {
      const shopifyCustomerId = 'customer-123';
      const mockSubscriptions = [
        { id: 1, shopify_customer_id: shopifyCustomerId, status: 'active' }
      ];

      query.mockResolvedValueOnce({ rows: mockSubscriptions });

      const result = await subscriptionService.getActiveSubscriptions(null, shopifyCustomerId);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('shopify_customer_id = $1'),
        [shopifyCustomerId]
      );
      expect(result).toEqual(mockSubscriptions);
    });

    it('should order by next_billing_date ASC', async () => {
      query.mockResolvedValueOnce({ rows: [] });

      await subscriptionService.getActiveSubscriptions();

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY next_billing_date ASC'),
        expect.any(Array)
      );
    });
  });

  describe('getSubscriptionsDueForBilling', () => {
    it('should retrieve subscriptions due for billing on given date', async () => {
      const billingDate = '2024-02-15';
      const mockSubscriptions = [
        { id: 1, next_billing_date: '2024-02-15', status: 'active' },
        { id: 2, next_billing_date: '2024-02-14', status: 'active' }
      ];

      query.mockResolvedValueOnce({ rows: mockSubscriptions });

      const result = await subscriptionService.getSubscriptionsDueForBilling(billingDate);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('next_billing_date <= $1'),
        [billingDate]
      );
      expect(result).toEqual(mockSubscriptions);
    });

    it('should use current date when date not provided', async () => {
      const today = new Date().toISOString().slice(0, 10);
      query.mockResolvedValueOnce({ rows: [] });

      await subscriptionService.getSubscriptionsDueForBilling();

      expect(query).toHaveBeenCalledWith(
        expect.any(String),
        [today]
      );
    });

    it('should only return active subscriptions', async () => {
      query.mockResolvedValueOnce({ rows: [] });

      await subscriptionService.getSubscriptionsDueForBilling();

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("status = 'active'"),
        expect.any(Array)
      );
    });
  });

  describe('updateSubscriptionBillingDate', () => {
    it('should update next billing date', async () => {
      const subscriptionId = 1;
      const nextBillingDate = '2024-03-01';
      const updatedSubscription = {
        id: subscriptionId,
        next_billing_date: nextBillingDate
      };

      query.mockResolvedValueOnce({ rows: [updatedSubscription] });

      const result = await subscriptionService.updateSubscriptionBillingDate(subscriptionId, nextBillingDate);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE subscriptions'),
        expect.arrayContaining([nextBillingDate, subscriptionId])
      );
      expect(result).toEqual(updatedSubscription);
    });

    it('should update both next and last billing dates', async () => {
      const subscriptionId = 1;
      const nextBillingDate = '2024-03-01';
      const lastBillingDate = '2024-02-01';
      const updatedSubscription = {
        id: subscriptionId,
        next_billing_date: nextBillingDate,
        last_billing_date: lastBillingDate
      };

      query.mockResolvedValueOnce({ rows: [updatedSubscription] });

      const result = await subscriptionService.updateSubscriptionBillingDate(
        subscriptionId,
        nextBillingDate,
        lastBillingDate
      );

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('last_billing_date'),
        expect.arrayContaining([nextBillingDate, lastBillingDate, subscriptionId])
      );
      expect(result).toEqual(updatedSubscription);
    });

    it('should return null when subscription not found', async () => {
      const subscriptionId = 999;
      query.mockResolvedValueOnce({ rows: [] });

      const result = await subscriptionService.updateSubscriptionBillingDate(subscriptionId, '2024-03-01');

      expect(result).toBeNull();
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel subscription by ID', async () => {
      const subscriptionId = 1;
      const cancelledSubscription = {
        id: subscriptionId,
        status: 'cancelled',
        cancelled_at: new Date()
      };

      query.mockResolvedValueOnce({ rows: [cancelledSubscription] });

      const result = await subscriptionService.cancelSubscription(subscriptionId);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE subscriptions SET status = \'cancelled\''),
        expect.arrayContaining([subscriptionId])
      );
      expect(result).toEqual(cancelledSubscription);
    });

    it('should cancel subscription by customer and product', async () => {
      const shopifyCustomerId = 'customer-123';
      const shopifyProductId = 'product-123';
      const cancelledSubscription = {
        id: 1,
        shopify_customer_id: shopifyCustomerId,
        shopify_product_id: shopifyProductId,
        status: 'cancelled'
      };

      query.mockResolvedValueOnce({ rows: [cancelledSubscription] });

      const result = await subscriptionService.cancelSubscription(null, shopifyCustomerId, shopifyProductId);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('shopify_customer_id = $1 AND shopify_product_id = $2'),
        [shopifyCustomerId, shopifyProductId]
      );
      expect(result).toEqual(cancelledSubscription);
    });

    it('should throw error when insufficient parameters provided', async () => {
      await expect(
        subscriptionService.cancelSubscription(null, 'customer-123')
      ).rejects.toThrow('Must provide subscriptionId or both shopifyCustomerId and shopifyProductId');
    });

    it('should return null when subscription not found', async () => {
      const subscriptionId = 999;
      query.mockResolvedValueOnce({ rows: [] });

      const result = await subscriptionService.cancelSubscription(subscriptionId);

      expect(result).toBeNull();
    });

    it('should set cancelled_at timestamp', async () => {
      const subscriptionId = 1;
      query.mockResolvedValueOnce({ 
        rows: [{
          id: subscriptionId,
          status: 'cancelled',
          cancelled_at: new Date()
        }]
      });

      await subscriptionService.cancelSubscription(subscriptionId);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('cancelled_at = NOW()'),
        expect.any(Array)
      );
    });
  });
});
