// Integration tests for appointment endpoints

const request = require('supertest');
const app = require('../helpers/testApp');

// Mock external services
jest.mock('../../services/tebraService');
jest.mock('../../services/appointmentEmailService');
jest.mock('../../services/customerPatientMapService');

const tebraService = require('../../services/tebraService');
const appointmentEmailService = require('../../services/appointmentEmailService');
const customerPatientMapService = require('../../services/customerPatientMapService');

describe('POST /api/appointments/book', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should book an appointment successfully', async () => {
    const mockAppointment = {
      AppointmentId: '12345',
      StartTime: '2024-02-15T10:00:00Z',
      EndTime: '2024-02-15T10:30:00Z',
      ProviderId: 'provider-123',
      PracticeId: 'practice-123'
    };

    tebraService.createAppointment = jest.fn().mockResolvedValue(mockAppointment);
    appointmentEmailService.sendConfirmation = jest.fn().mockResolvedValue(true);
    customerPatientMapService.getPatientId = jest.fn().mockResolvedValue('patient-123');

    const appointmentData = {
      patientId: 'patient-123',
      state: 'CA',
      startTime: '2024-02-15T10:00:00Z',
      appointmentName: 'Telemedicine Consultation',
      productId: 'product-123',
      purchaseType: 'subscription'
    };

    const res = await request(app)
      .post('/api/appointments/book')
      .send(appointmentData)
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('appointmentId');
    expect(tebraService.createAppointment).toHaveBeenCalled();
    expect(appointmentEmailService.sendConfirmation).toHaveBeenCalled();
  });

  it('should return 400 for missing required fields', async () => {
    const res = await request(app)
      .post('/api/appointments/book')
      .send({
        state: 'CA'
        // Missing patientId and startTime
      })
      .expect(400);

    expect(res.body).toHaveProperty('success', false);
  });

  it('should return 400 for invalid state', async () => {
    const res = await request(app)
      .post('/api/appointments/book')
      .send({
        patientId: 'patient-123',
        state: 'INVALID',
        startTime: '2024-02-15T10:00:00Z'
      })
      .expect(400);

    expect(res.body).toHaveProperty('success', false);
  });

  it('should return 400 for past appointment time', async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday

    const res = await request(app)
      .post('/api/appointments/book')
      .send({
        patientId: 'patient-123',
        state: 'CA',
        startTime: pastDate.toISOString()
      })
      .expect(400);

    expect(res.body).toHaveProperty('success', false);
  });

  it('should handle Tebra service errors', async () => {
    tebraService.createAppointment = jest.fn().mockRejectedValue(new Error('Tebra service unavailable'));

    const appointmentData = {
      patientId: 'patient-123',
      state: 'CA',
      startTime: '2024-02-15T10:00:00Z'
    };

    const res = await request(app)
      .post('/api/appointments/book')
      .send(appointmentData)
      .expect(500);

    expect(res.body).toHaveProperty('success', false);
  });

  it('should enforce 30-minute duration', async () => {
    const mockAppointment = {
      AppointmentId: '12345',
      StartTime: '2024-02-15T10:00:00Z',
      EndTime: '2024-02-15T10:30:00Z' // 30 minutes
    };

    tebraService.createAppointment = jest.fn().mockResolvedValue(mockAppointment);
    appointmentEmailService.sendConfirmation = jest.fn().mockResolvedValue(true);

    const appointmentData = {
      patientId: 'patient-123',
      state: 'CA',
      startTime: '2024-02-15T10:00:00Z',
      endTime: '2024-02-15T11:00:00Z' // User tries to set 1 hour
    };

    const res = await request(app)
      .post('/api/appointments/book')
      .send(appointmentData)
      .expect(200);

    // Verify that 30-minute duration was enforced
    const callArgs = tebraService.createAppointment.mock.calls[0][0];
    const startTime = new Date(callArgs.startTime);
    const endTime = new Date(callArgs.endTime);
    const durationMinutes = (endTime - startTime) / (1000 * 60);
    expect(durationMinutes).toBe(30);
  });
});

describe('DELETE /api/appointments/:appointmentId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should cancel an appointment successfully', async () => {
    tebraService.deleteAppointment = jest.fn().mockResolvedValue(true);

    const res = await request(app)
      .delete('/api/appointments/12345')
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(tebraService.deleteAppointment).toHaveBeenCalledWith('12345');
  });

  it('should return 404 for non-existent appointment', async () => {
    tebraService.deleteAppointment = jest.fn().mockRejectedValue(new Error('Appointment not found'));

    const res = await request(app)
      .delete('/api/appointments/99999')
      .expect(404);

    expect(res.body).toHaveProperty('success', false);
  });
});

describe('PUT /api/appointments/:appointmentId/reschedule', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should reschedule an appointment successfully', async () => {
    const mockAppointment = {
      AppointmentId: '12345',
      StartTime: '2024-02-16T14:00:00Z',
      EndTime: '2024-02-16T14:30:00Z'
    };

    tebraService.getAppointment = jest.fn().mockResolvedValue(mockAppointment);
    tebraService.updateAppointment = jest.fn().mockResolvedValue(mockAppointment);
    appointmentEmailService.sendConfirmation = jest.fn().mockResolvedValue(true);

    const res = await request(app)
      .put('/api/appointments/12345/reschedule')
      .send({
        startTime: '2024-02-16T14:00:00Z',
        state: 'CA'
      })
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(tebraService.updateAppointment).toHaveBeenCalled();
  });

  it('should return 400 for invalid reschedule data', async () => {
    const res = await request(app)
      .put('/api/appointments/12345/reschedule')
      .send({
        // Missing startTime
        state: 'CA'
      })
      .expect(400);

    expect(res.body).toHaveProperty('success', false);
  });
});
