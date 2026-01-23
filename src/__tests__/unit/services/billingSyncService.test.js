// Unit tests for billingSyncService

const billingSyncService = require('../../../services/billingSyncService');

// Mock dependencies
jest.mock('../../../db/pg');

const { query } = require('../../../db/pg');

describe('billingSyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ensureInit', () => {
    it('should initialize database table on first call', async () => {
      query.mockResolvedValueOnce({ rowCount: 1 });

      await billingSyncService.ensureInit();

      expect(query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS billing_sync'));
    });

    it('should not reinitialize on subsequent calls', async () => {
      query.mockResolvedValueOnce({ rowCount: 1 });
      
      await billingSyncService.ensureInit();
      jest.clearAllMocks();
      
      await billingSyncService.ensureInit();

      expect(query).not.toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      const error = new Error('Database error');
      query.mockRejectedValueOnce(error);

      await expect(billingSyncService.ensureInit()).rejects.toThrow(error);
    });
  });

  describe('upsertByEventId', () => {
    it('should insert new record when event ID does not exist', async () => {
      const eventId = 'evt_test_123';
      const data = {
        stripe_payment_intent_id: 'pi_test_123',
        stripe_customer_email: 'customer@example.com',
        tebra_patient_id: 'patient-123',
        amount_cents: 5000,
        currency: 'USD',
        status: 'completed'
      };

      query.mockResolvedValueOnce({ rows: [] }); // SELECT - no existing
      query.mockResolvedValueOnce({ 
        rows: [{
          id: 1,
          stripe_event_id: eventId,
          ...data
        }]
      }); // INSERT

      const result = await billingSyncService.upsertByEventId(eventId, data);

      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenNthCalledWith(
        1,
        'SELECT * FROM billing_sync WHERE stripe_event_id=$1',
        [eventId]
      );
      expect(result).toHaveProperty('stripe_event_id', eventId);
      expect(result).toHaveProperty('stripe_payment_intent_id', data.stripe_payment_intent_id);
    });

    it('should update existing record when event ID exists', async () => {
      const eventId = 'evt_test_123';
      const existingData = {
        id: 1,
        stripe_event_id: eventId,
        stripe_payment_intent_id: 'pi_old',
        tebra_patient_id: 'patient-old',
        amount_cents: 1000,
        status: 'pending'
      };
      const updateData = {
        stripe_payment_intent_id: 'pi_new',
        tebra_patient_id: 'patient-new',
        amount_cents: 5000,
        status: 'completed'
      };

      query.mockResolvedValueOnce({ rows: [existingData] }); // SELECT - existing
      query.mockResolvedValueOnce({ 
        rows: [{
          ...existingData,
          ...updateData
        }]
      }); // UPDATE

      const result = await billingSyncService.upsertByEventId(eventId, updateData);

      expect(query).toHaveBeenCalledTimes(2);
      expect(result).toHaveProperty('stripe_payment_intent_id', 'pi_new');
      expect(result).toHaveProperty('status', 'completed');
    });

    it('should merge data with existing record', async () => {
      const eventId = 'evt_test_123';
      const existingData = {
        id: 1,
        stripe_event_id: eventId,
        stripe_customer_email: 'old@example.com',
        tebra_patient_id: 'patient-123',
        amount_cents: 1000
      };
      const updateData = {
        amount_cents: 5000,
        status: 'completed'
      };

      query.mockResolvedValueOnce({ rows: [existingData] });
      query.mockResolvedValueOnce({ 
        rows: [{
          ...existingData,
          ...updateData,
          stripe_customer_email: 'old@example.com' // Should preserve existing
        }]
      });

      const result = await billingSyncService.upsertByEventId(eventId, updateData);

      expect(result).toHaveProperty('amount_cents', 5000);
      expect(result).toHaveProperty('stripe_customer_email', 'old@example.com');
    });
  });

  describe('upsertByPaymentIntentId', () => {
    it('should insert new record when payment intent does not exist', async () => {
      const paymentIntentId = 'pi_test_123';
      const data = {
        stripe_customer_email: 'customer@example.com',
        tebra_patient_id: 'patient-123',
        amount_cents: 5000
      };

      query.mockResolvedValueOnce({ rows: [] }); // SELECT - no existing
      query.mockResolvedValueOnce({ 
        rows: [{
          id: 1,
          stripe_payment_intent_id: paymentIntentId,
          ...data
        }]
      }); // INSERT

      const result = await billingSyncService.upsertByPaymentIntentId(paymentIntentId, data);

      expect(query).toHaveBeenCalledTimes(2);
      expect(result).toHaveProperty('stripe_payment_intent_id', paymentIntentId);
    });

    it('should update existing record when payment intent exists', async () => {
      const paymentIntentId = 'pi_test_123';
      const existingData = {
        id: 1,
        stripe_event_id: 'evt_existing',
        stripe_payment_intent_id: paymentIntentId,
        tebra_patient_id: 'patient-old',
        status: 'pending'
      };
      const updateData = {
        tebra_patient_id: 'patient-new',
        status: 'completed'
      };

      query.mockResolvedValueOnce({ rows: [existingData] }); // SELECT
      query.mockResolvedValueOnce({ 
        rows: [{
          ...existingData,
          ...updateData
        }]
      }); // UPDATE

      const result = await billingSyncService.upsertByPaymentIntentId(paymentIntentId, updateData);

      expect(result).toHaveProperty('status', 'completed');
      expect(result).toHaveProperty('stripe_event_id', 'evt_existing'); // Preserved
    });

    it('should generate event ID if not provided for new record', async () => {
      const paymentIntentId = 'pi_test_123';
      const data = {
        tebra_patient_id: 'patient-123'
      };

      query.mockResolvedValueOnce({ rows: [] }); // SELECT
      query.mockResolvedValueOnce({ 
        rows: [{
          id: 1,
          stripe_event_id: expect.stringContaining('evt_sync_'),
          stripe_payment_intent_id: paymentIntentId
        }]
      }); // INSERT

      const result = await billingSyncService.upsertByPaymentIntentId(paymentIntentId, data);

      expect(result.stripe_event_id).toContain('evt_sync_');
      expect(result.stripe_event_id).toContain(paymentIntentId);
    });
  });

  describe('getRecentForEmail', () => {
    it('should retrieve recent billing records for email', async () => {
      const email = 'customer@example.com';
      const mockRecords = [
        {
          id: 1,
          stripe_customer_email: email,
          stripe_payment_intent_id: 'pi_1',
          amount_cents: 5000
        },
        {
          id: 2,
          stripe_customer_email: email,
          stripe_payment_intent_id: 'pi_2',
          amount_cents: 3000
        }
      ];

      query.mockResolvedValueOnce({ rows: mockRecords });

      const result = await billingSyncService.getRecentForEmail(email, 20);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM'),
        [email, 20]
      );
      expect(result).toEqual(mockRecords);
    });

    it('should use default limit when not provided', async () => {
      const email = 'customer@example.com';
      query.mockResolvedValueOnce({ rows: [] });

      await billingSyncService.getRecentForEmail(email);

      expect(query).toHaveBeenCalledWith(
        expect.any(String),
        [email, 20]
      );
    });

    it('should handle database errors', async () => {
      const email = 'customer@example.com';
      const error = new Error('Database error');
      query.mockRejectedValueOnce(error);

      await expect(billingSyncService.getRecentForEmail(email)).rejects.toThrow(error);
    });
  });

  describe('getByEventId', () => {
    it('should retrieve record by event ID', async () => {
      const eventId = 'evt_test_123';
      const mockRecord = {
        id: 1,
        stripe_event_id: eventId,
        stripe_payment_intent_id: 'pi_test_123'
      };

      query.mockResolvedValueOnce({ rows: [mockRecord] });

      const result = await billingSyncService.getByEventId(eventId);

      expect(query).toHaveBeenCalledWith(
        'SELECT * FROM billing_sync WHERE stripe_event_id=$1',
        [eventId]
      );
      expect(result).toEqual(mockRecord);
    });

    it('should return null when record not found', async () => {
      const eventId = 'evt_nonexistent';
      query.mockResolvedValueOnce({ rows: [] });

      const result = await billingSyncService.getByEventId(eventId);

      expect(result).toBeNull();
    });
  });

  describe('updateByEventId', () => {
    it('should update existing record', async () => {
      const eventId = 'evt_test_123';
      const existingData = {
        id: 1,
        stripe_event_id: eventId,
        tebra_patient_id: 'patient-old',
        status: 'pending'
      };
      const updateData = {
        tebra_patient_id: 'patient-new',
        status: 'completed'
      };

      query.mockResolvedValueOnce({ rows: [existingData] }); // getByEventId
      query.mockResolvedValueOnce({ 
        rows: [{
          ...existingData,
          ...updateData
        }]
      }); // UPDATE

      const result = await billingSyncService.updateByEventId(eventId, updateData);

      expect(query).toHaveBeenCalledTimes(2);
      expect(result).toHaveProperty('status', 'completed');
      expect(result).toHaveProperty('tebra_patient_id', 'patient-new');
    });

    it('should return null when record does not exist', async () => {
      const eventId = 'evt_nonexistent';
      query.mockResolvedValueOnce({ rows: [] }); // getByEventId

      const result = await billingSyncService.updateByEventId(eventId, { status: 'completed' });

      expect(result).toBeNull();
      expect(query).toHaveBeenCalledTimes(1); // Only getByEventId, no UPDATE
    });

    it('should merge update data with existing data', async () => {
      const eventId = 'evt_test_123';
      const existingData = {
        id: 1,
        stripe_event_id: eventId,
        stripe_customer_email: 'old@example.com',
        amount_cents: 1000
      };
      const updateData = {
        amount_cents: 5000
        // stripe_customer_email not provided, should preserve existing
      };

      query.mockResolvedValueOnce({ rows: [existingData] });
      query.mockResolvedValueOnce({ 
        rows: [{
          ...existingData,
          amount_cents: 5000,
          stripe_customer_email: 'old@example.com'
        }]
      });

      const result = await billingSyncService.updateByEventId(eventId, updateData);

      expect(result).toHaveProperty('amount_cents', 5000);
      expect(result).toHaveProperty('stripe_customer_email', 'old@example.com');
    });
  });
});
