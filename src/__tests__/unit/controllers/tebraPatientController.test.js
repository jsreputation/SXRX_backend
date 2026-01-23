// Unit tests for tebraPatientController

const {
  createTebraPatient,
  createTebraPatientFromCustomer,
  getTebraPatient,
  updateTebraPatient,
  getTebraPatients,
  searchTebraPatients
} = require('../../../controllers/tebraPatientController');

// Mock dependencies
jest.mock('../../../services/tebraService');
jest.mock('../../../services/shopifyUserService');
jest.mock('../../../services/cacheService');
jest.mock('../../../db/pg');

const tebraService = require('../../../services/tebraService');
const shopifyUserService = require('../../../services/shopifyUserService');
const cacheService = require('../../../services/cacheService');

describe('tebraPatientController', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    
    req = {
      body: {},
      params: {},
      query: {},
      clientLocation: 'US'
    };
    
    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
  });

  describe('createTebraPatient', () => {
    it('should create patient successfully with all required fields', async () => {
      req.body = {
        patientData: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          phone: '555-1234',
          mobilePhone: '555-5678',
          dateOfBirth: '1990-01-01',
          gender: 'Male',
          state: 'CA',
          address: {
            street: '123 Main St',
            city: 'Los Angeles',
            zipCode: '90001',
            country: 'US'
          }
        }
      };

      const mockTebraData = {
        id: 'patient-123',
        patientId: 'patient-123'
      };

      tebraService.createPatient = jest.fn().mockResolvedValue(mockTebraData);

      await createTebraPatient(req, res);

      expect(tebraService.createPatient).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Patient created successfully in Tebra',
        patient: expect.objectContaining({
          id: 'patient-123',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com'
        }),
        location: 'US'
      });
    });

    it('should return 400 when required fields are missing', async () => {
      req.body = {
        patientData: {
          firstName: 'John'
          // Missing lastName and email
        }
      };

      await createTebraPatient(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Missing required fields: firstName, lastName, email',
        location: 'US',
        received: {
          firstName: true,
          lastName: false,
          email: false
        }
      });
      expect(tebraService.createPatient).not.toHaveBeenCalled();
    });

    it('should handle errors during patient creation', async () => {
      req.body = {
        patientData: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com'
        }
      };

      const error = new Error('Tebra API error');
      tebraService.createPatient = jest.fn().mockRejectedValue(error);

      await createTebraPatient(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to create patient in Tebra',
        error: error.message,
        location: 'US'
      });
    });

    it('should extract state from address object if not provided directly', async () => {
      req.body = {
        patientData: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          address: {
            state: 'TX',
            street: '123 Main St',
            city: 'Houston',
            zipCode: '77001'
          }
        }
      };

      tebraService.createPatient = jest.fn().mockResolvedValue({ id: 'patient-123' });

      await createTebraPatient(req, res);

      const createCall = tebraService.createPatient.mock.calls[0][0];
      expect(createCall.state).toBe('TX');
    });
  });

  describe('createTebraPatientFromCustomer', () => {
    it('should create patient from Shopify customer successfully', async () => {
      req.params.customerId = 'customer-123';
      const mockCustomer = {
        id: 'customer-123',
        first_name: 'Jane',
        last_name: 'Smith',
        email: 'jane.smith@example.com',
        phone: '555-9999',
        metafields: {
          state: 'WA',
          role: 'patient'
        }
      };

      const mockTebraData = {
        id: 'patient-456',
        patientId: 'patient-456'
      };

      shopifyUserService.getCustomerWithMetafields = jest.fn().mockResolvedValue(mockCustomer);
      tebraService.createPatient = jest.fn().mockResolvedValue(mockTebraData);
      shopifyUserService.updateCustomerMetafields = jest.fn().mockResolvedValue(true);

      await createTebraPatientFromCustomer(req, res);

      expect(shopifyUserService.getCustomerWithMetafields).toHaveBeenCalledWith('customer-123');
      expect(tebraService.createPatient).toHaveBeenCalled();
      expect(shopifyUserService.updateCustomerMetafields).toHaveBeenCalledWith('customer-123', {
        tebra_patient_id: 'patient-456',
        tebra_sync_status: 'synced'
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Tebra patient created successfully from customer',
        customer: expect.objectContaining({
          id: 'customer-123',
          email: 'jane.smith@example.com'
        }),
        tebraPatient: expect.objectContaining({
          id: 'patient-456',
          syncStatus: 'synced'
        }),
        location: 'US'
      });
    });

    it('should return 404 when customer not found', async () => {
      req.params.customerId = 'nonexistent-123';
      shopifyUserService.getCustomerWithMetafields = jest.fn().mockResolvedValue(null);

      await createTebraPatientFromCustomer(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Customer not found',
        location: 'US'
      });
      expect(tebraService.createPatient).not.toHaveBeenCalled();
    });

    it('should return 400 when customer already has Tebra patient ID', async () => {
      req.params.customerId = 'customer-123';
      const mockCustomer = {
        id: 'customer-123',
        email: 'existing@example.com',
        metafields: {
          tebra_patient_id: 'patient-existing-123'
        }
      };

      shopifyUserService.getCustomerWithMetafields = jest.fn().mockResolvedValue(mockCustomer);

      await createTebraPatientFromCustomer(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Customer already has Tebra patient ID',
        tebraPatientId: 'patient-existing-123',
        location: 'US'
      });
      expect(tebraService.createPatient).not.toHaveBeenCalled();
    });

    it('should update sync status to failed on error', async () => {
      req.params.customerId = 'customer-123';
      const mockCustomer = {
        id: 'customer-123',
        email: 'test@example.com',
        metafields: {}
      };

      shopifyUserService.getCustomerWithMetafields = jest.fn().mockResolvedValue(mockCustomer);
      const error = new Error('Tebra API error');
      tebraService.createPatient = jest.fn().mockRejectedValue(error);
      shopifyUserService.updateCustomerMetafields = jest.fn().mockResolvedValue(true);

      await createTebraPatientFromCustomer(req, res);

      expect(shopifyUserService.updateCustomerMetafields).toHaveBeenCalledWith('customer-123', {
        tebra_sync_status: 'failed'
      });
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getTebraPatient', () => {
    it('should retrieve patient successfully', async () => {
      req.params.patientId = 'patient-123';
      const mockPatient = {
        id: 'patient-123',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com'
      };

      tebraService.getPatient = jest.fn().mockResolvedValue(mockPatient);

      await getTebraPatient(req, res);

      expect(tebraService.getPatient).toHaveBeenCalledWith('patient-123');
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        patient: mockPatient,
        location: 'US'
      });
    });

    it('should handle errors when getting patient', async () => {
      req.params.patientId = 'patient-123';
      const error = new Error('Patient not found');
      tebraService.getPatient = jest.fn().mockRejectedValue(error);

      await getTebraPatient(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to get patient data from Tebra',
        error: error.message,
        location: 'US'
      });
    });
  });

  describe('updateTebraPatient', () => {
    it('should update patient successfully and invalidate cache', async () => {
      req.params.patientId = 'patient-123';
      req.body = {
        email: 'newemail@example.com',
        phone: '555-9999'
      };

      const mockUpdatedPatient = {
        id: 'patient-123',
        email: 'newemail@example.com',
        phone: '555-9999'
      };

      tebraService.updatePatient = jest.fn().mockResolvedValue(mockUpdatedPatient);
      cacheService.deletePattern = jest.fn().mockResolvedValue(true);

      await updateTebraPatient(req, res);

      expect(tebraService.updatePatient).toHaveBeenCalledWith('patient-123', req.body);
      expect(cacheService.deletePattern).toHaveBeenCalledWith('sxrx:chart:*');
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Patient updated successfully in Tebra',
        patient: mockUpdatedPatient,
        location: 'US'
      });
    });

    it('should handle cache invalidation errors gracefully', async () => {
      req.params.patientId = 'patient-123';
      req.body = { email: 'newemail@example.com' };

      const mockUpdatedPatient = { id: 'patient-123', email: 'newemail@example.com' };
      tebraService.updatePatient = jest.fn().mockResolvedValue(mockUpdatedPatient);
      cacheService.deletePattern = jest.fn().mockRejectedValue(new Error('Cache error'));

      await updateTebraPatient(req, res);

      // Should still succeed even if cache invalidation fails
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Patient updated successfully in Tebra',
        patient: mockUpdatedPatient,
        location: 'US'
      });
    });

    it('should handle update errors', async () => {
      req.params.patientId = 'patient-123';
      req.body = { email: 'newemail@example.com' };
      const error = new Error('Update failed');
      tebraService.updatePatient = jest.fn().mockRejectedValue(error);

      await updateTebraPatient(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to update patient in Tebra',
        error: error.message,
        location: 'US'
      });
    });
  });

  describe('getTebraPatients', () => {
    it('should retrieve patients list with pagination', async () => {
      req.query = {
        practiceId: 'practice-123',
        page: '1',
        limit: '20'
      };

      const mockPatients = {
        patients: [
          { id: 'patient-1', firstName: 'John', lastName: 'Doe' },
          { id: 'patient-2', firstName: 'Jane', lastName: 'Smith' }
        ],
        totalCount: 2,
        hasMore: false
      };

      tebraService.getPatients = jest.fn().mockResolvedValue(mockPatients);

      await getTebraPatients(req, res);

      expect(tebraService.getPatients).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Patients retrieved successfully',
        patients: mockPatients.patients,
        totalCount: mockPatients.totalCount,
        location: 'US'
      });
    });

    it('should handle errors when getting patients', async () => {
      req.query = {};
      const error = new Error('Tebra API error');
      tebraService.getPatients = jest.fn().mockRejectedValue(error);

      await getTebraPatients(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to get patients from Tebra',
        error: error.message,
        location: 'US'
      });
    });
  });

  describe('searchTebraPatients', () => {
    it('should search patients successfully', async () => {
      req.query = {
        email: 'john.doe@example.com',
        firstName: 'John',
        lastName: 'Doe'
      };

      const mockSearchResults = {
        patients: [
          { id: 'patient-123', firstName: 'John', lastName: 'Doe', email: 'john.doe@example.com' }
        ],
        totalCount: 1
      };

      tebraService.searchPatients = jest.fn().mockResolvedValue(mockSearchResults);

      await searchTebraPatients(req, res);

      expect(tebraService.searchPatients).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Patients found',
        patients: mockSearchResults.patients,
        totalCount: mockSearchResults.totalCount,
        location: 'US'
      });
    });

    it('should handle search errors', async () => {
      req.query = { email: 'test@example.com' };
      const error = new Error('Search failed');
      tebraService.searchPatients = jest.fn().mockRejectedValue(error);

      await searchTebraPatients(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to search patients',
        error: error.message,
        location: 'US'
      });
    });
  });
});
