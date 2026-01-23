// Unit tests for tebraAppointmentController

const {
  getAvailability,
  createAppointment,
  getAppointment,
  updateAppointment,
  deleteAppointment,
  getAppointments
} = require('../../../controllers/tebraAppointmentController');

// Mock dependencies
jest.mock('../../../services/tebraService');
jest.mock('../../../services/customerPatientMapService');
jest.mock('../../../services/googleMeetService');
jest.mock('../../../db/pg');

const tebraService = require('../../../services/tebraService');
const customerPatientMapService = require('../../../services/customerPatientMapService');
const googleMeetService = require('../../../services/googleMeetService');

describe('tebraAppointmentController', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    
    req = {
      body: {},
      user: {},
      clientLocation: 'US'
    };
    
    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
  });

  describe('getAvailability', () => {
    it('should return availability slots successfully', async () => {
      const mockAvailability = {
        availability: [
          {
            startTime: '2024-02-15T10:00:00Z',
            endTime: '2024-02-15T10:30:00Z',
            providerId: 'provider-123'
          }
        ],
        totalCount: 1
      };

      req.body.availabilityOptions = {
        startDate: '2024-02-15',
        endDate: '2024-02-20',
        providerId: 'provider-123'
      };

      tebraService.getAvailability = jest.fn().mockResolvedValue(mockAvailability);

      await getAvailability(req, res);

      expect(tebraService.getAvailability).toHaveBeenCalledWith(req.body.availabilityOptions);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Availability retrieved successfully',
        availability: mockAvailability.availability,
        totalCount: mockAvailability.totalCount,
        location: 'US'
      });
    });

    it('should handle errors when getting availability', async () => {
      req.body.availabilityOptions = {};
      const error = new Error('Tebra API error');
      tebraService.getAvailability = jest.fn().mockRejectedValue(error);

      await getAvailability(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to get availability',
        error: error.message,
        location: 'US'
      });
    });
  });

  describe('createAppointment', () => {
    it('should create appointment successfully with existing patient', async () => {
      req.body.appointmentData = {
        patientId: 'patient-123',
        startTime: '2024-02-15T10:00:00Z',
        endTime: '2024-02-15T10:30:00Z',
        appointmentType: 'P',
        practiceId: 'practice-123',
        providerId: 'provider-123'
      };

      tebraService.getAppointments = jest.fn().mockResolvedValue({ appointments: [] });
      tebraService.createAppointment = jest.fn().mockResolvedValue({
        id: 'appointment-123',
        appointmentId: 'appointment-123'
      });
      googleMeetService.createMeeting = jest.fn().mockResolvedValue({
        meetingLink: 'https://meet.google.com/abc-def-ghi'
      });

      await createAppointment(req, res);

      expect(tebraService.createAppointment).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          appointmentId: 'appointment-123'
        })
      );
    });

    it('should create patient if patientId is missing but email is provided', async () => {
      req.body.appointmentData = {
        patientEmail: 'newpatient@example.com',
        startTime: '2024-02-15T10:00:00Z',
        endTime: '2024-02-15T10:30:00Z',
        appointmentType: 'P',
        patientSummary: {
          FirstName: 'John',
          LastName: 'Doe',
          Email: 'newpatient@example.com'
        }
      };

      tebraService.searchPatients = jest.fn().mockResolvedValue({ patients: [] });
      tebraService.createPatient = jest.fn().mockResolvedValue({
        id: 'new-patient-123',
        patientId: 'new-patient-123'
      });
      customerPatientMapService.upsert = jest.fn().mockResolvedValue(true);
      tebraService.getAppointments = jest.fn().mockResolvedValue({ appointments: [] });
      tebraService.createAppointment = jest.fn().mockResolvedValue({
        id: 'appointment-123'
      });
      googleMeetService.createMeeting = jest.fn().mockResolvedValue({
        meetingLink: 'https://meet.google.com/abc-def-ghi'
      });

      await createAppointment(req, res);

      expect(tebraService.createPatient).toHaveBeenCalled();
      expect(customerPatientMapService.upsert).toHaveBeenCalled();
      expect(tebraService.createAppointment).toHaveBeenCalled();
    });

    it('should shift appointment time if slot is occupied', async () => {
      req.body.appointmentData = {
        patientId: 'patient-123',
        startTime: '2024-02-15T10:00:00Z',
        endTime: '2024-02-15T10:30:00Z',
        appointmentType: 'P',
        practiceId: 'practice-123',
        providerId: 'provider-123'
      };

      // Mock existing appointment that overlaps
      const existingAppointment = {
        id: 'existing-123',
        startDateTime: '2024-02-15T10:00:00Z',
        endDateTime: '2024-02-15T10:30:00Z',
        providerId: 'provider-123'
      };

      tebraService.getAppointments = jest.fn().mockResolvedValue({
        appointments: [existingAppointment]
      });
      tebraService.createAppointment = jest.fn().mockResolvedValue({
        id: 'appointment-123'
      });
      googleMeetService.createMeeting = jest.fn().mockResolvedValue({
        meetingLink: 'https://meet.google.com/abc-def-ghi'
      });

      await createAppointment(req, res);

      // Should shift the appointment time
      const createCall = tebraService.createAppointment.mock.calls[0][0];
      expect(createCall.startTime).not.toBe('2024-02-15T10:00:00Z');
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          shifted: true
        })
      );
    });

    it('should handle errors during appointment creation', async () => {
      req.body.appointmentData = {
        patientId: 'patient-123',
        startTime: '2024-02-15T10:00:00Z',
        endTime: '2024-02-15T10:30:00Z'
      };

      tebraService.getAppointments = jest.fn().mockResolvedValue({ appointments: [] });
      const error = new Error('Tebra API error');
      tebraService.createAppointment = jest.fn().mockRejectedValue(error);

      await createAppointment(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: expect.stringContaining('Failed to create appointment')
        })
      );
    });
  });

  describe('getAppointment', () => {
    it('should retrieve appointment successfully', async () => {
      req.params = { appointmentId: 'appointment-123' };
      const mockAppointment = {
        id: 'appointment-123',
        startTime: '2024-02-15T10:00:00Z',
        endTime: '2024-02-15T10:30:00Z',
        patientId: 'patient-123'
      };

      tebraService.getAppointment = jest.fn().mockResolvedValue(mockAppointment);

      await getAppointment(req, res);

      expect(tebraService.getAppointment).toHaveBeenCalledWith('appointment-123');
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Appointment retrieved successfully',
        appointment: mockAppointment,
        location: 'US'
      });
    });

    it('should handle appointment not found', async () => {
      req.params = { appointmentId: 'nonexistent-123' };
      tebraService.getAppointment = jest.fn().mockResolvedValue(null);

      await getAppointment(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Appointment not found',
        location: 'US'
      });
    });
  });

  describe('updateAppointment', () => {
    it('should update appointment successfully', async () => {
      req.params = { appointmentId: 'appointment-123' };
      req.body.updates = {
        startTime: '2024-02-15T11:00:00Z',
        endTime: '2024-02-15T11:30:00Z'
      };

      const updatedAppointment = {
        id: 'appointment-123',
        startTime: '2024-02-15T11:00:00Z',
        endTime: '2024-02-15T11:30:00Z'
      };

      tebraService.updateAppointment = jest.fn().mockResolvedValue(updatedAppointment);

      await updateAppointment(req, res);

      expect(tebraService.updateAppointment).toHaveBeenCalledWith('appointment-123', req.body.updates);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Appointment updated successfully',
        appointment: updatedAppointment,
        location: 'US'
      });
    });

    it('should handle update errors', async () => {
      req.params = { appointmentId: 'appointment-123' };
      req.body.updates = {};
      const error = new Error('Update failed');
      tebraService.updateAppointment = jest.fn().mockRejectedValue(error);

      await updateAppointment(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to update appointment',
        error: error.message,
        location: 'US'
      });
    });
  });

  describe('deleteAppointment', () => {
    it('should delete appointment successfully', async () => {
      req.params = { appointmentId: 'appointment-123' };
      tebraService.deleteAppointment = jest.fn().mockResolvedValue({ success: true });

      await deleteAppointment(req, res);

      expect(tebraService.deleteAppointment).toHaveBeenCalledWith('appointment-123');
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Appointment deleted successfully',
        location: 'US'
      });
    });

    it('should handle delete errors', async () => {
      req.params = { appointmentId: 'appointment-123' };
      const error = new Error('Delete failed');
      tebraService.deleteAppointment = jest.fn().mockRejectedValue(error);

      await deleteAppointment(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to delete appointment',
        error: error.message,
        location: 'US'
      });
    });
  });

  describe('getAppointments', () => {
    it('should retrieve appointments list successfully', async () => {
      req.query = {
        startDate: '2024-02-15',
        endDate: '2024-02-20',
        patientId: 'patient-123'
      };

      const mockAppointments = {
        appointments: [
          { id: 'appointment-123', patientId: 'patient-123' },
          { id: 'appointment-456', patientId: 'patient-123' }
        ],
        totalCount: 2
      };

      tebraService.getAppointments = jest.fn().mockResolvedValue(mockAppointments);

      await getAppointments(req, res);

      expect(tebraService.getAppointments).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Appointments retrieved successfully',
        appointments: mockAppointments.appointments,
        totalCount: mockAppointments.totalCount,
        location: 'US'
      });
    });

    it('should handle errors when getting appointments', async () => {
      req.query = {};
      const error = new Error('Tebra API error');
      tebraService.getAppointments = jest.fn().mockRejectedValue(error);

      await getAppointments(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to get appointments',
        error: error.message,
        location: 'US'
      });
    });
  });
});
