// E2E tests for appointment booking flow

const request = require('supertest');
const app = require('../helpers/testApp');

// Mock external services
jest.mock('../../services/tebraService');
jest.mock('../../services/appointmentEmailService');
jest.mock('../../services/customerPatientMapService');
jest.mock('../../services/availabilityService');
jest.mock('../../db/pg');

const tebraService = require('../../services/tebraService');
const appointmentEmailService = require('../../services/appointmentEmailService');
const customerPatientMapService = require('../../services/customerPatientMapService');
const availabilityService = require('../../services/availabilityService');

describe('E2E: Appointment Booking Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should complete full appointment booking flow: availability → select → book → confirm', async () => {
    const state = 'CA';
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
    const startTime = new Date(futureDate.setHours(10, 0, 0, 0)).toISOString();

    // Step 1: Get available slots
    const mockSlots = [
      {
        startTime: startTime,
        endTime: new Date(new Date(startTime).getTime() + 30 * 60000).toISOString(),
        providerId: 'provider-123'
      },
      {
        startTime: new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString(),
        endTime: new Date(new Date(startTime).getTime() + 60 * 60 * 1000 + 30 * 60000).toISOString(),
        providerId: 'provider-123'
      }
    ];

    tebraService.getAvailability = jest.fn().mockResolvedValue({
      availability: mockSlots,
      totalCount: 2
    });

    availabilityService.filterAvailability = jest.fn().mockResolvedValue(mockSlots);

    const availabilityRes = await request(app)
      .get(`/webhooks/availability/${state}`)
      .expect(200);

    expect(availabilityRes.body).toHaveProperty('success', true);
    expect(availabilityRes.body).toHaveProperty('data');
    expect(availabilityRes.body.data.length).toBeGreaterThan(0);

    // Step 2: Book appointment
    const appointmentData = {
      patientId: 'patient-123',
      state: state,
      startTime: startTime,
      appointmentName: 'Telemedicine Consultation',
      productId: 'product-123',
      purchaseType: 'subscription'
    };

    const mockAppointment = {
      AppointmentId: 'appointment-123',
      StartTime: startTime,
      EndTime: new Date(new Date(startTime).getTime() + 30 * 60000).toISOString(),
      ProviderId: 'provider-123',
      PracticeId: 'practice-123'
    };

    tebraService.createAppointment = jest.fn().mockResolvedValue(mockAppointment);
    appointmentEmailService.sendConfirmation = jest.fn().mockResolvedValue(true);
    customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-123');

    const bookingRes = await request(app)
      .post('/api/appointments/book')
      .send(appointmentData)
      .expect(200);

    expect(bookingRes.body).toHaveProperty('success', true);
    expect(bookingRes.body).toHaveProperty('appointmentId', 'appointment-123');
    expect(tebraService.createAppointment).toHaveBeenCalled();
    expect(appointmentEmailService.sendConfirmation).toHaveBeenCalled();

    // Verify 30-minute duration was enforced
    const createCall = tebraService.createAppointment.mock.calls[0][0];
    const bookedStart = new Date(createCall.startTime);
    const bookedEnd = new Date(createCall.endTime);
    const durationMinutes = (bookedEnd - bookedStart) / (1000 * 60);
    expect(durationMinutes).toBe(30);
  });

  it('should handle appointment cancellation flow', async () => {
    const appointmentId = 'appointment-123';

    // Step 1: Get appointment details
    const mockAppointment = {
      AppointmentId: appointmentId,
      StartTime: '2024-02-15T10:00:00Z',
      EndTime: '2024-02-15T10:30:00Z',
      Status: 'Scheduled'
    };

    tebraService.getAppointment = jest.fn().mockResolvedValue(mockAppointment);

    // Step 2: Cancel appointment
    tebraService.deleteAppointment = jest.fn().mockResolvedValue(true);

    const cancelRes = await request(app)
      .delete(`/api/appointments/${appointmentId}`)
      .expect(200);

    expect(cancelRes.body).toHaveProperty('success', true);
    expect(tebraService.deleteAppointment).toHaveBeenCalledWith(appointmentId);
  });

  it('should handle appointment rescheduling flow', async () => {
    const appointmentId = 'appointment-123';
    const newStartTime = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    // Step 1: Get existing appointment
    const existingAppointment = {
      AppointmentId: appointmentId,
      StartTime: '2024-02-15T10:00:00Z',
      EndTime: '2024-02-15T10:30:00Z',
      Status: 'Scheduled'
    };

    tebraService.getAppointment = jest.fn().mockResolvedValue(existingAppointment);

    // Step 2: Reschedule appointment
    const updatedAppointment = {
      AppointmentId: appointmentId,
      StartTime: newStartTime,
      EndTime: new Date(new Date(newStartTime).getTime() + 30 * 60000).toISOString(),
      Status: 'Scheduled'
    };

    tebraService.updateAppointment = jest.fn().mockResolvedValue(updatedAppointment);
    appointmentEmailService.sendConfirmation = jest.fn().mockResolvedValue(true);

    const rescheduleRes = await request(app)
      .put(`/api/appointments/${appointmentId}/reschedule`)
      .send({
        startTime: newStartTime,
        state: 'CA'
      })
      .expect(200);

    expect(rescheduleRes.body).toHaveProperty('success', true);
    expect(rescheduleRes.body).toHaveProperty('appointment');
    expect(tebraService.updateAppointment).toHaveBeenCalled();
    expect(appointmentEmailService.sendConfirmation).toHaveBeenCalled();
  });

  it('should prevent booking past appointments', async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday

    const appointmentData = {
      patientId: 'patient-123',
      state: 'CA',
      startTime: pastDate.toISOString()
    };

    const res = await request(app)
      .post('/api/appointments/book')
      .send(appointmentData)
      .expect(400);

    expect(res.body).toHaveProperty('success', false);
    expect(tebraService.createAppointment).not.toHaveBeenCalled();
  });

  it('should prevent booking beyond advance booking window', async () => {
    const farFutureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

    const appointmentData = {
      patientId: 'patient-123',
      state: 'CA',
      startTime: farFutureDate.toISOString()
    };

    // Mock availability service to return empty (beyond window)
    availabilityService.filterAvailability = jest.fn().mockResolvedValue([]);

    const res = await request(app)
      .post('/api/appointments/book')
      .send(appointmentData)
      .expect(400);

    expect(res.body).toHaveProperty('success', false);
  });
});
