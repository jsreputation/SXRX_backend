// E2E tests for appointment management (create, update, delete)

const request = require('supertest');
const app = require('../helpers/testApp');

// Mock external services
jest.mock('../../services/tebraService');
jest.mock('../../services/customerPatientMapService');
jest.mock('../../services/googleMeetService');
jest.mock('../../services/notificationService');
jest.mock('../../db/pg');

const tebraService = require('../../services/tebraService');
const customerPatientMapService = require('../../services/customerPatientMapService');
const googleMeetService = require('../../services/googleMeetService');
const notificationService = require('../../services/notificationService');

describe('E2E: Appointment Management', () => {
  let accessToken;
  let patientId = 'patient-123';
  let appointmentId;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock authenticated user
    accessToken = 'mock-access-token';
    customerPatientMapService.getPatientId = jest.fn().mockResolvedValue(patientId);
  });

  describe('Create Appointment Flow', () => {
    it('should create appointment successfully with full flow', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const startTime = new Date(futureDate.setHours(10, 0, 0, 0)).toISOString();
      const endTime = new Date(new Date(startTime).getTime() + 30 * 60000).toISOString();

      // Step 1: Get availability
      const mockSlots = [
        {
          startTime,
          endTime,
          providerId: 'provider-123'
        }
      ];

      tebraService.getAvailability = jest.fn().mockResolvedValue({
        availability: mockSlots,
        totalCount: 1
      });

      const availabilityRes = await request(app)
        .post('/api/tebra-appointment/availability')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          availabilityOptions: {
            startDate: startTime.split('T')[0],
            endDate: startTime.split('T')[0],
            providerId: 'provider-123'
          }
        })
        .expect(200);

      expect(availabilityRes.body).toHaveProperty('success', true);
      expect(availabilityRes.body.availability).toHaveLength(1);

      // Step 2: Create appointment
      const appointmentData = {
        appointmentData: {
          patientId,
          startTime,
          endTime,
          appointmentType: 'P',
          practiceId: 'practice-123',
          providerId: 'provider-123'
        }
      };

      tebraService.getAppointments = jest.fn().mockResolvedValue({ appointments: [] });
      tebraService.createAppointment = jest.fn().mockResolvedValue({
        id: 'appointment-123',
        appointmentId: 'appointment-123',
        startTime,
        endTime
      });
      googleMeetService.createMeeting = jest.fn().mockResolvedValue({
        meetingLink: 'https://meet.google.com/abc-def-ghi'
      });
      notificationService.sendEmail = jest.fn().mockResolvedValue({ success: true });

      const createRes = await request(app)
        .post('/api/tebra-appointment/book')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(appointmentData)
        .expect(200);

      expect(createRes.body).toHaveProperty('success', true);
      expect(createRes.body).toHaveProperty('appointmentId', 'appointment-123');
      appointmentId = createRes.body.appointmentId;
    });

    it('should handle appointment creation with patient auto-creation', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const startTime = new Date(futureDate.setHours(10, 0, 0, 0)).toISOString();
      const endTime = new Date(new Date(startTime).getTime() + 30 * 60000).toISOString();

      const appointmentData = {
        appointmentData: {
          patientEmail: 'newpatient@example.com',
          startTime,
          endTime,
          appointmentType: 'P',
          patientSummary: {
            FirstName: 'Jane',
            LastName: 'Smith',
            Email: 'newpatient@example.com'
          }
        }
      };

      customerPatientMapService.getPatientId = jest.fn().mockResolvedValue(null);
      tebraService.searchPatients = jest.fn().mockResolvedValue({ patients: [] });
      tebraService.createPatient = jest.fn().mockResolvedValue({
        id: 'new-patient-456',
        patientId: 'new-patient-456'
      });
      customerPatientMapService.upsert = jest.fn().mockResolvedValue(true);
      tebraService.getAppointments = jest.fn().mockResolvedValue({ appointments: [] });
      tebraService.createAppointment = jest.fn().mockResolvedValue({
        id: 'appointment-456'
      });
      googleMeetService.createMeeting = jest.fn().mockResolvedValue({
        meetingLink: 'https://meet.google.com/xyz-abc-123'
      });

      const createRes = await request(app)
        .post('/api/tebra-appointment/book')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(appointmentData)
        .expect(200);

      expect(tebraService.createPatient).toHaveBeenCalled();
      expect(customerPatientMapService.upsert).toHaveBeenCalled();
      expect(createRes.body).toHaveProperty('success', true);
    });
  });

  describe('Update Appointment Flow', () => {
    it('should update appointment successfully', async () => {
      appointmentId = 'appointment-123';
      const newStartTime = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
      newStartTime.setHours(14, 0, 0, 0);
      const newEndTime = new Date(newStartTime.getTime() + 30 * 60000);

      const updates = {
        updates: {
          startTime: newStartTime.toISOString(),
          endTime: newEndTime.toISOString()
        }
      };

      tebraService.updateAppointment = jest.fn().mockResolvedValue({
        id: appointmentId,
        startTime: newStartTime.toISOString(),
        endTime: newEndTime.toISOString()
      });
      notificationService.sendEmail = jest.fn().mockResolvedValue({ success: true });

      const updateRes = await request(app)
        .put(`/api/tebra-appointment/${appointmentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(updates)
        .expect(200);

      expect(updateRes.body).toHaveProperty('success', true);
      expect(updateRes.body).toHaveProperty('appointment');
      expect(tebraService.updateAppointment).toHaveBeenCalledWith(
        appointmentId,
        updates.updates
      );
    });

    it('should handle update errors gracefully', async () => {
      appointmentId = 'appointment-123';
      const error = new Error('Appointment not found');
      tebraService.updateAppointment = jest.fn().mockRejectedValue(error);

      const updateRes = await request(app)
        .put(`/api/tebra-appointment/${appointmentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ updates: { startTime: new Date().toISOString() } })
        .expect(500);

      expect(updateRes.body).toHaveProperty('success', false);
    });
  });

  describe('Delete Appointment Flow', () => {
    it('should delete appointment successfully', async () => {
      appointmentId = 'appointment-123';

      tebraService.deleteAppointment = jest.fn().mockResolvedValue({ success: true });
      notificationService.sendEmail = jest.fn().mockResolvedValue({ success: true });

      const deleteRes = await request(app)
        .delete(`/api/tebra-appointment/${appointmentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(deleteRes.body).toHaveProperty('success', true);
      expect(tebraService.deleteAppointment).toHaveBeenCalledWith(appointmentId);
    });

    it('should handle delete errors gracefully', async () => {
      appointmentId = 'appointment-nonexistent';
      const error = new Error('Appointment not found');
      tebraService.deleteAppointment = jest.fn().mockRejectedValue(error);

      const deleteRes = await request(app)
        .delete(`/api/tebra-appointment/${appointmentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(500);

      expect(deleteRes.body).toHaveProperty('success', false);
    });
  });

  describe('Get Appointments Flow', () => {
    it('should retrieve user appointments list', async () => {
      const mockAppointments = [
        {
          id: 'appointment-123',
          patientId,
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + 30 * 60000).toISOString()
        },
        {
          id: 'appointment-456',
          patientId,
          startTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          endTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 30 * 60000).toISOString()
        }
      ];

      tebraService.getAppointments = jest.fn().mockResolvedValue({
        appointments: mockAppointments,
        totalCount: 2
      });

      const getRes = await request(app)
        .get('/api/tebra-appointment')
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ patientId })
        .expect(200);

      expect(getRes.body).toHaveProperty('success', true);
      expect(getRes.body.appointments).toHaveLength(2);
      expect(tebraService.getAppointments).toHaveBeenCalled();
    });

    it('should filter appointments by date range', async () => {
      const startDate = new Date().toISOString().split('T')[0];
      const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      tebraService.getAppointments = jest.fn().mockResolvedValue({
        appointments: [],
        totalCount: 0
      });

      const getRes = await request(app)
        .get('/api/tebra-appointment')
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ startDate, endDate, patientId })
        .expect(200);

      expect(getRes.body).toHaveProperty('success', true);
      expect(tebraService.getAppointments).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: expect.any(String),
          endDate: expect.any(String)
        })
      );
    });
  });

  describe('Complete Appointment Lifecycle', () => {
    it('should complete full lifecycle: create → update → delete', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const startTime = new Date(futureDate.setHours(10, 0, 0, 0)).toISOString();
      const endTime = new Date(new Date(startTime).getTime() + 30 * 60000).toISOString();

      // Create
      tebraService.getAppointments = jest.fn().mockResolvedValue({ appointments: [] });
      tebraService.createAppointment = jest.fn().mockResolvedValue({
        id: 'appointment-lifecycle-123',
        appointmentId: 'appointment-lifecycle-123'
      });
      googleMeetService.createMeeting = jest.fn().mockResolvedValue({
        meetingLink: 'https://meet.google.com/test-link'
      });

      const createRes = await request(app)
        .post('/api/tebra-appointment/book')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          appointmentData: {
            patientId,
            startTime,
            endTime,
            appointmentType: 'P'
          }
        })
        .expect(200);

      const createdAppointmentId = createRes.body.appointmentId;

      // Update
      const newStartTime = new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString();
      tebraService.updateAppointment = jest.fn().mockResolvedValue({
        id: createdAppointmentId,
        startTime: newStartTime
      });

      await request(app)
        .put(`/api/tebra-appointment/${createdAppointmentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ updates: { startTime: newStartTime } })
        .expect(200);

      // Delete
      tebraService.deleteAppointment = jest.fn().mockResolvedValue({ success: true });

      await request(app)
        .delete(`/api/tebra-appointment/${createdAppointmentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(tebraService.createAppointment).toHaveBeenCalled();
      expect(tebraService.updateAppointment).toHaveBeenCalled();
      expect(tebraService.deleteAppointment).toHaveBeenCalled();
    });
  });
});
