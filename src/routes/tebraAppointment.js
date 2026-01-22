// backend/src/routes/tebraAppointment.js
const express = require('express');
const router = express.Router();
const tebraAppointmentController = require('../controllers/tebraAppointmentController');
const { auth } = require('../middleware/shopifyTokenAuth');
const { cacheStrategies } = require('../middleware/cacheHeaders');

// Get availability slots
router.post('/get-availability', auth, tebraAppointmentController.getAvailability);

// Friendly alias: GET availability via query params
router.get('/availability', auth, async (req, res, next) => {
  try {
    const { practiceId, providerId, from, to, isAvailable } = req.query;
    req.body = {
      availabilityOptions: {
        practiceId: practiceId || process.env.TEBRA_PRACTICE_ID || undefined,
        providerId: providerId,
        fromDate: from || new Date().toISOString().slice(0,10),
        toDate: to || new Date(Date.now() + 14*24*60*60*1000).toISOString().slice(0,10),
        isAvailable: String(isAvailable ?? 'true') !== 'false'
      }
    };
    return tebraAppointmentController.getAvailability(req, res);
  } catch (e) {
    next(e);
  }
});

// Create appointment
router.post('/create', auth, tebraAppointmentController.createAppointment);

// Friendly alias: POST /book (wraps to create)
router.post('/book', auth, express.json({ limit: '1mb' }), async (req, res, next) => {
  try {
    const body = req.body || {};
    const appointmentData = body.appointmentData || {
      practiceId: body.practiceId,
      providerId: body.providerId,
      serviceLocationId: body.locationId,
      patientId: body.patientId,
      patientEmail: body.patient?.email || body.patientEmail,
      patientSummary: body.patient || undefined,
      startTime: body.slot?.start || body.start || body.startTime,
      endTime: body.slot?.end || body.end || body.endTime,
      reason: body.reason || 'Telemedicine consult',
      appointmentName: body.title || 'Appointment',
      appointmentType: body.appointmentType || 'P',
      notes: body.notes || undefined,
      appointmentMode: body.appointmentMode || 'Telehealth',
    };
    req.body = { appointmentData };
    return tebraAppointmentController.createAppointment(req, res);
  } catch (e) {
    next(e);
  }
});

// Search appointments
router.post('/search', auth, cacheStrategies.short(), tebraAppointmentController.searchAppointments);

// Get appointment by ID
router.get('/:appointmentId', auth, tebraAppointmentController.getAppointment);

// Update appointment
router.put('/update/:appointmentId', auth, tebraAppointmentController.updateAppointment);

// Delete appointment
router.delete('/delete/:appointmentId', auth, tebraAppointmentController.deleteAppointment);

module.exports = router;
