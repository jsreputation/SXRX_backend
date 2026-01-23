// backend/src/routes/tebraAppointment.js
const express = require('express');
const router = express.Router();
const tebraAppointmentController = require('../controllers/tebraAppointmentController');
const { auth } = require('../middleware/shopifyTokenAuth');
const { cacheStrategies } = require('../middleware/cacheHeaders');

/**
 * @swagger
 * /api/tebra-appointment/get-availability:
 *   post:
 *     summary: Get available appointment slots
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - availabilityOptions
 *             properties:
 *               availabilityOptions:
 *                 type: object
 *                 properties:
 *                   practiceId:
 *                     type: string
 *                     description: Practice ID
 *                   providerId:
 *                     type: string
 *                     description: Provider ID
 *                   startDate:
 *                     type: string
 *                     format: date
 *                     description: Start date for availability search
 *                   endDate:
 *                     type: string
 *                     format: date
 *                     description: End date for availability search
 *     responses:
 *       200:
 *         description: Availability slots retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 availability:
 *                   type: array
 *                   items:
 *                     type: object
 *                 totalCount:
 *                   type: number
 *       500:
 *         description: Failed to get availability
 */
// Get availability slots
router.post('/get-availability', auth, tebraAppointmentController.getAvailability);

/**
 * @swagger
 * /api/tebra-appointment/availability:
 *   get:
 *     summary: Get available appointment slots (GET alias)
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: practiceId
 *         schema:
 *           type: string
 *         description: Practice ID
 *       - in: query
 *         name: providerId
 *         schema:
 *           type: string
 *         description: Provider ID
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (YYYY-MM-DD)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (YYYY-MM-DD)
 *       - in: query
 *         name: isAvailable
 *         schema:
 *           type: boolean
 *         description: Filter by availability status
 *     responses:
 *       200:
 *         description: Availability slots retrieved successfully
 *       500:
 *         description: Failed to get availability
 */
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

/**
 * @swagger
 * /api/tebra-appointment/create:
 *   post:
 *     summary: Create a new appointment
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - appointmentData
 *             properties:
 *               appointmentData:
 *                 type: object
 *                 required:
 *                   - startTime
 *                   - endTime
 *                 properties:
 *                   patientId:
 *                     type: string
 *                     description: Patient ID (required if patientEmail not provided)
 *                   patientEmail:
 *                     type: string
 *                     format: email
 *                     description: Patient email (will create patient if patientId not provided)
 *                   startTime:
 *                     type: string
 *                     format: date-time
 *                     description: Appointment start time (ISO 8601)
 *                   endTime:
 *                     type: string
 *                     format: date-time
 *                     description: Appointment end time (ISO 8601)
 *                   practiceId:
 *                     type: string
 *                   providerId:
 *                     type: string
 *                   appointmentType:
 *                     type: string
 *                     enum: [P, R]
 *                     description: P = Patient, R = Resource
 *                   appointmentMode:
 *                     type: string
 *                     default: Telehealth
 *     responses:
 *       200:
 *         description: Appointment created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 appointmentId:
 *                   type: string
 *                 meetingLink:
 *                   type: string
 *       500:
 *         description: Failed to create appointment
 */
// Create appointment
router.post('/create', auth, tebraAppointmentController.createAppointment);

/**
 * @swagger
 * /api/tebra-appointment/book:
 *   post:
 *     summary: Book an appointment (alias for create)
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               appointmentData:
 *                 type: object
 *               practiceId:
 *                 type: string
 *               providerId:
 *                 type: string
 *               patientId:
 *                 type: string
 *               startTime:
 *                 type: string
 *                 format: date-time
 *               endTime:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Appointment booked successfully
 *       500:
 *         description: Failed to book appointment
 */
// Friendly alias: POST /book (wraps to create)
router.post('/book', auth, express.json({ limit: '1mb' }), async (req, res, next) => {
  try {
    const body = req.body || {};
    
    // Resolve practiceId and providerId from state if provided (User Case 2: Direct Booking)
    let practiceId = body.practiceId;
    let providerId = body.providerId;
    if (body.state && !practiceId) {
      const providerMapping = require('../config/providerMapping');
      const mapping = providerMapping[body.state.toUpperCase()];
      if (mapping) {
        practiceId = mapping.practiceId;
        providerId = mapping.defaultProviderId;
      }
    }
    
    // Handle patientSummary (from test guide User Case 2 format)
    // Map patientSummary to patient format expected by controller
    const patientData = body.patient || body.patientSummary || undefined;
    
    // Calculate endTime if not provided (30 minutes after startTime, as per test guide)
    const startTime = body.slot?.start || body.start || body.startTime;
    let endTime = body.slot?.end || body.end || body.endTime;
    if (!endTime && startTime) {
      const start = new Date(startTime);
      if (!isNaN(start.getTime())) {
        endTime = new Date(start.getTime() + 30 * 60000).toISOString(); // 30 minutes
      }
    }
    
    const appointmentData = body.appointmentData || {
      practiceId: practiceId,
      providerId: providerId,
      serviceLocationId: body.locationId,
      patientId: body.patientId,
      patientEmail: body.patient?.email || body.patientEmail || body.patientSummary?.Email,
      patientSummary: patientData, // Pass patientSummary to controller for patient creation
      startTime: startTime,
      endTime: endTime,
      reason: body.reason || 'Telemedicine consult',
      appointmentName: body.title || body.appointmentName || 'Appointment',
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

/**
 * @swagger
 * /api/tebra-appointment/search:
 *   post:
 *     summary: Search appointments with filters
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               startDate:
 *                 type: string
 *                 format: date
 *               endDate:
 *                 type: string
 *                 format: date
 *               patientId:
 *                 type: string
 *               providerId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Appointments found
 *       500:
 *         description: Failed to search appointments
 */
// Search appointments
router.post('/search', auth, cacheStrategies.short(), tebraAppointmentController.searchAppointments);

/**
 * @swagger
 * /api/tebra-appointment/{appointmentId}:
 *   get:
 *     summary: Get appointment by ID
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: appointmentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Appointment ID
 *     responses:
 *       200:
 *         description: Appointment retrieved successfully
 *       404:
 *         description: Appointment not found
 *       500:
 *         description: Failed to get appointment
 */
// Get appointment by ID
router.get('/:appointmentId', auth, tebraAppointmentController.getAppointment);

/**
 * @swagger
 * /api/tebra-appointment/update/{appointmentId}:
 *   put:
 *     summary: Update an appointment
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: appointmentId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               updates:
 *                 type: object
 *                 properties:
 *                   startTime:
 *                     type: string
 *                     format: date-time
 *                   endTime:
 *                     type: string
 *                     format: date-time
 *                   notes:
 *                     type: string
 *     responses:
 *       200:
 *         description: Appointment updated successfully
 *       500:
 *         description: Failed to update appointment
 */
// Update appointment
router.put('/update/:appointmentId', auth, tebraAppointmentController.updateAppointment);

/**
 * @swagger
 * /api/tebra-appointment/delete/{appointmentId}:
 *   delete:
 *     summary: Delete an appointment
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: appointmentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Appointment deleted successfully
 *       500:
 *         description: Failed to delete appointment
 */
// Delete appointment
router.delete('/delete/:appointmentId', auth, tebraAppointmentController.deleteAppointment);

module.exports = router;
