// Unit tests for billingController

const {
  handleShopifyOrderPaid,
  handleShopifyOrderCreated
} = require('../../../controllers/billingController');

// Mock dependencies
jest.mock('../../../services/tebraService');
jest.mock('../../../services/tebraBillingService');
jest.mock('../../../services/shopifyUserService');
jest.mock('../../../services/questionnaireCompletionService');
jest.mock('../../../services/customerPatientMapService');
jest.mock('../../../utils/productUtils');
jest.mock('../../../utils/stateUtils');
jest.mock('../../../db/pg');

const tebraService = require('../../../services/tebraService');
const tebraBillingService = require('../../../services/tebraBillingService');
const shopifyUserService = require('../../../services/shopifyUserService');
const customerPatientMapService = require('../../../services/customerPatientMapService');
const { determineState } = require('../../../utils/stateUtils');

describe('billingController', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    
    req = {
      body: {},
      headers: {},
      clientLocation: 'US'
    };
    
    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
  });

  describe('handleShopifyOrderPaid', () => {
    it('should process paid order and create billing records', async () => {
      const orderData = {
        id: 'order-123',
        email: 'customer@example.com',
        customer: {
          id: 'customer-123',
          email: 'customer@example.com'
        },
        line_items: [
          {
            id: 'line-item-1',
            product_id: 'product-123',
            quantity: 1,
            price: '50.00',
            properties: []
          }
        ],
        total_price: '50.00',
        financial_status: 'paid',
        shipping_address: {
          province_code: 'CA',
          country_code: 'US'
        }
      };

      req.body = orderData;

      determineState.mockReturnValue('CA');
      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-123');
      tebraBillingService.createCharge = jest.fn().mockResolvedValue({ id: 'charge-123' });
      tebraBillingService.createPayment = jest.fn().mockResolvedValue({ id: 'payment-123' });

      await handleShopifyOrderPaid(req, res);

      expect(determineState).toHaveBeenCalled();
      expect(customerPatientMapService.getPatientId).toHaveBeenCalled();
      expect(tebraBillingService.createCharge).toHaveBeenCalled();
      expect(tebraBillingService.createPayment).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true
        })
      );
    });

    it('should handle subscription orders', async () => {
      const orderData = {
        id: 'order-123',
        email: 'customer@example.com',
        customer: {
          id: 'customer-123'
        },
        line_items: [
          {
            id: 'line-item-1',
            product_id: 'product-123',
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
          province_code: 'TX',
          country_code: 'US'
        }
      };

      req.body = orderData;

      determineState.mockReturnValue('TX');
      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-123');
      tebraBillingService.createCharge = jest.fn().mockResolvedValue({ id: 'charge-123' });
      tebraBillingService.createPayment = jest.fn().mockResolvedValue({ id: 'payment-123' });
      tebraBillingService.createSubscription = jest.fn().mockResolvedValue({ id: 'subscription-123' });

      await handleShopifyOrderPaid(req, res);

      expect(tebraBillingService.createSubscription).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true
        })
      );
    });

    it('should create patient if not found', async () => {
      const orderData = {
        id: 'order-123',
        email: 'newcustomer@example.com',
        customer: {
          id: 'customer-123',
          first_name: 'John',
          last_name: 'Doe',
          email: 'newcustomer@example.com'
        },
        line_items: [],
        financial_status: 'paid',
        shipping_address: {
          province_code: 'WA',
          country_code: 'US'
        }
      };

      req.body = orderData;

      determineState.mockReturnValue('WA');
      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue(null);
      tebraService.searchPatients = jest.fn().mockResolvedValue({ patients: [] });
      tebraService.createPatient = jest.fn().mockResolvedValue({ 
        id: 'new-patient-123',
        patientId: 'new-patient-123'
      });
      customerPatientMapService.upsert = jest.fn().mockResolvedValue(true);
      tebraBillingService.createCharge = jest.fn().mockResolvedValue({ id: 'charge-123' });
      tebraBillingService.createPayment = jest.fn().mockResolvedValue({ id: 'payment-123' });

      await handleShopifyOrderPaid(req, res);

      expect(tebraService.createPatient).toHaveBeenCalled();
      expect(customerPatientMapService.upsert).toHaveBeenCalled();
      expect(tebraBillingService.createCharge).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const orderData = {
        id: 'order-123',
        email: 'customer@example.com',
        financial_status: 'paid'
      };

      req.body = orderData;

      determineState.mockReturnValue('CA');
      const error = new Error('Billing service error');
      customerPatientMapService.getPatientId = jest.fn().mockRejectedValue(error);

      await handleShopifyOrderPaid(req, res);

      // Should still return 200 to prevent webhook retries
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false
        })
      );
    });

    it('should extract contact information from line item properties', async () => {
      const orderData = {
        id: 'order-123',
        email: 'customer@example.com',
        customer: {
          id: 'customer-123'
        },
        line_items: [
          {
            id: 'line-item-1',
            product_id: 'product-123',
            properties: [
              { name: 'first_name', value: 'Jane' },
              { name: 'last_name', value: 'Smith' },
              { name: 'email', value: 'jane.smith@example.com' }
            ]
          }
        ],
        financial_status: 'paid',
        shipping_address: {
          province_code: 'CA',
          country_code: 'US'
        }
      };

      req.body = orderData;

      determineState.mockReturnValue('CA');
      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-123');
      tebraBillingService.createCharge = jest.fn().mockResolvedValue({ id: 'charge-123' });
      tebraBillingService.createPayment = jest.fn().mockResolvedValue({ id: 'payment-123' });

      await handleShopifyOrderPaid(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true
        })
      );
    });
  });

  describe('handleShopifyOrderCreated', () => {
    it('should process order creation and book appointment', async () => {
      const orderData = {
        id: 'order-123',
        email: 'customer@example.com',
        customer: {
          id: 'customer-123',
          email: 'customer@example.com'
        },
        line_items: [
          {
            id: 'line-item-1',
            product_id: 'product-123',
            title: 'Consultation Appointment',
            properties: [
              { name: 'appointment_date', value: '2024-02-15' },
              { name: 'start_time', value: '10:00' },
              { name: 'timezone', value: 'America/Los_Angeles' }
            ]
          }
        ],
        shipping_address: {
          province_code: 'CA',
          country_code: 'US'
        }
      };

      req.body = orderData;

      determineState.mockReturnValue('CA');
      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-123');
      tebraService.createAppointment = jest.fn().mockResolvedValue({
        id: 'appointment-123',
        appointmentId: 'appointment-123'
      });
      tebraService.getAppointment = jest.fn().mockResolvedValue({
        id: 'appointment-123',
        meetingLink: null
      });

      await handleShopifyOrderCreated(req, res);

      expect(customerPatientMapService.getPatientId).toHaveBeenCalled();
      expect(tebraService.createAppointment).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        tebraAppointmentId: 'appointment-123',
        meetingLink: null,
        patientId: 'patient-123',
        message: expect.stringContaining('successfully')
      });
    });

    it('should create patient if not found during order creation', async () => {
      const orderData = {
        id: 'order-123',
        email: 'newcustomer@example.com',
        customer: {
          id: 'customer-123',
          first_name: 'John',
          last_name: 'Doe',
          email: 'newcustomer@example.com'
        },
        line_items: [
          {
            id: 'line-item-1',
            product_id: 'product-123',
            properties: [
              { name: 'appointment_date', value: '2024-02-15' },
              { name: 'start_time', value: '10:00' }
            ]
          }
        ],
        shipping_address: {
          province_code: 'TX',
          country_code: 'US'
        }
      };

      req.body = orderData;

      determineState.mockReturnValue('TX');
      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue(null);
      tebraService.searchPatients = jest.fn().mockResolvedValue({ patients: [] });
      tebraService.createPatient = jest.fn().mockResolvedValue({ 
        id: 'new-patient-123',
        patientId: 'new-patient-123'
      });
      customerPatientMapService.upsert = jest.fn().mockResolvedValue(true);
      tebraService.createAppointment = jest.fn().mockResolvedValue({
        id: 'appointment-123'
      });
      tebraService.getAppointment = jest.fn().mockResolvedValue({
        id: 'appointment-123'
      });

      await handleShopifyOrderCreated(req, res);

      expect(tebraService.createPatient).toHaveBeenCalled();
      expect(tebraService.createAppointment).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          patientId: 'new-patient-123'
        })
      );
    });

    it('should handle orders without appointment data', async () => {
      const orderData = {
        id: 'order-123',
        email: 'customer@example.com',
        line_items: [
          {
            id: 'line-item-1',
            product_id: 'product-123',
            properties: []
          }
        ],
        shipping_address: {
          province_code: 'CA',
          country_code: 'US'
        }
      };

      req.body = orderData;

      determineState.mockReturnValue('CA');
      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-123');

      await handleShopifyOrderCreated(req, res);

      // Should still succeed but not create appointment
      expect(tebraService.createAppointment).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          tebraAppointmentId: null
        })
      );
    });

    it('should parse appointment datetime from various formats', async () => {
      const orderData = {
        id: 'order-123',
        email: 'customer@example.com',
        customer: {
          id: 'customer-123'
        },
        line_items: [
          {
            id: 'line-item-1',
            product_id: 'product-123',
            properties: [
              { name: 'appointment_start', value: '2024-02-15T10:00:00-08:00' },
              { name: 'timezone', value: 'America/Los_Angeles' }
            ]
          }
        ],
        shipping_address: {
          province_code: 'CA',
          country_code: 'US'
        }
      };

      req.body = orderData;

      determineState.mockReturnValue('CA');
      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-123');
      tebraService.createAppointment = jest.fn().mockResolvedValue({
        id: 'appointment-123'
      });
      tebraService.getAppointment = jest.fn().mockResolvedValue({
        id: 'appointment-123'
      });

      await handleShopifyOrderCreated(req, res);

      expect(tebraService.createAppointment).toHaveBeenCalled();
      const appointmentCall = tebraService.createAppointment.mock.calls[0][0];
      expect(appointmentCall).toHaveProperty('startTime');
    });

    it('should handle appointment creation errors gracefully', async () => {
      const orderData = {
        id: 'order-123',
        email: 'customer@example.com',
        customer: {
          id: 'customer-123'
        },
        line_items: [
          {
            id: 'line-item-1',
            product_id: 'product-123',
            properties: [
              { name: 'appointment_date', value: '2024-02-15' },
              { name: 'start_time', value: '10:00' }
            ]
          }
        ],
        shipping_address: {
          province_code: 'CA',
          country_code: 'US'
        }
      };

      req.body = orderData;

      determineState.mockReturnValue('CA');
      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-123');
      const error = new Error('Appointment creation failed');
      tebraService.createAppointment = jest.fn().mockRejectedValue(error);

      await handleShopifyOrderCreated(req, res);

      // Should still return 200 to prevent webhook retries
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          tebraAppointmentId: null
        })
      );
    });

    it('should handle multiple line items and find best appointment candidate', async () => {
      const orderData = {
        id: 'order-123',
        email: 'customer@example.com',
        customer: {
          id: 'customer-123'
        },
        line_items: [
          {
            id: 'line-item-1',
            product_id: 'product-123',
            title: 'Regular Product',
            properties: []
          },
          {
            id: 'line-item-2',
            product_id: 'product-456',
            title: 'Consultation Appointment',
            properties: [
              { name: 'appointment_date', value: '2024-02-15' },
              { name: 'start_time', value: '10:00' },
              { name: 'duration', value: '30 minutes' }
            ]
          }
        ],
        shipping_address: {
          province_code: 'CA',
          country_code: 'US'
        }
      };

      req.body = orderData;

      determineState.mockReturnValue('CA');
      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-123');
      tebraService.createAppointment = jest.fn().mockResolvedValue({
        id: 'appointment-123'
      });
      tebraService.getAppointment = jest.fn().mockResolvedValue({
        id: 'appointment-123'
      });

      await handleShopifyOrderCreated(req, res);

      // Should use the line item with appointment data (line-item-2)
      expect(tebraService.createAppointment).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          tebraAppointmentId: 'appointment-123'
        })
      );
    });
  });
});
