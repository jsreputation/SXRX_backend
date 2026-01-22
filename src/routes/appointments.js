const express = require('express');
const router = express.Router();
const tebraService = require('../services/tebraService');
const providerMapping = require('../config/providerMapping');
const { validateAppointmentBooking, sanitizeRequestBody } = require('../middleware/validation');
const appointmentEmailService = require('../services/appointmentEmailService');
const customerPatientMapService = require('../services/customerPatientMapService');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/appointments/book:
 *   post:
 *     summary: Book an appointment
 *     tags: [Appointments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - patientId
 *               - state
 *               - startTime
 *             properties:
 *               patientId:
 *                 type: string
 *                 description: Tebra patient ID
 *               state:
 *                 type: string
 *                 description: State code (e.g., CA, TX)
 *                 example: CA
 *               startTime:
 *                 type: string
 *                 format: date-time
 *                 description: Appointment start time (ISO 8601)
 *               appointmentName:
 *                 type: string
 *                 description: Appointment name/type
 *               productId:
 *                 type: string
 *                 description: Shopify product ID
 *               purchaseType:
 *                 type: string
 *                 enum: [subscription, one-time]
 *     responses:
 *       200:
 *         description: Appointment booked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 appointmentId:
 *                   type: string
 *                 startTime:
 *                   type: string
 *                 endTime:
 *                   type: string
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// Book appointment directly via Tebra
router.post('/book', express.json({ limit: '50kb' }), sanitizeRequestBody, validateAppointmentBooking, async (req, res) => {
  try {
    const { patientId, state, startTime, endTime, appointmentName, productId, purchaseType } = req.body;

    // Get provider mapping for state (validation already ensures state is valid)
    const mapping = providerMapping[state.toUpperCase()];
    if (!mapping || !mapping.practiceId) {
      return res.status(400).json({
        success: false,
        message: `Unsupported state: ${state}. Available states: ${Object.keys(providerMapping).join(', ')}`
      });
    }

    // Parse start time (validation already ensures it's valid and in future)
    const startDate = new Date(startTime);

    // Always enforce 30-minute appointment duration
    const endDate = new Date(startDate.getTime() + 30 * 60000); // Always 30 minutes

    // Create appointment in Tebra
    const appointmentData = {
      appointmentName: appointmentName || 'Telemedicine Consultation',
      appointmentStatus: 'Scheduled',
      appointmentType: 'P', // Patient
      appointmentMode: 'Telehealth', // Telemedicine
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      patientId: patientId,
      practiceId: mapping.practiceId,
      providerId: mapping.defaultProviderId,
      notes: `Consultation scheduled from questionnaire. Product: ${productId || 'N/A'}, Type: ${purchaseType || 'N/A'}`,
      isRecurring: false
    };

    console.log(`📅 [APPOINTMENT BOOKING] Creating appointment in Tebra:`, {
      patientId,
      practiceId: mapping.practiceId,
      providerId: mapping.defaultProviderId,
      startTime: appointmentData.startTime,
      endTime: appointmentData.endTime
    });

    const appointment = await tebraService.createAppointment(appointmentData);
    const appointmentId = appointment?.CreateAppointmentResult?.Appointment?.AppointmentID || 
                         appointment?.id || 
                         appointment?.AppointmentID ||
                         appointment?.CreateAppointmentResult?.Appointment?.id;

    if (!appointmentId) {
      console.error('❌ [APPOINTMENT BOOKING] Failed to get appointment ID from Tebra response:', appointment);
      throw new Error('Failed to get appointment ID from Tebra');
    }

    console.log(`✅ [APPOINTMENT BOOKING] Created appointment ${appointmentId} in Tebra for patient ${patientId}`);

    // Invalidate availability cache for this state/provider
    const cacheService = require('../services/cacheService');
    await cacheService.invalidateAvailability(state.toUpperCase(), mapping.defaultProviderId);
    logger.info('[APPOINTMENT BOOKING] Invalidated availability cache', { state, providerId: mapping.defaultProviderId });

    // Send confirmation email (async, don't wait)
    (async () => {
      try {
        // Get patient info for email
        const patientInfo = await tebraService.getPatient({ patientId });
        const patientName = patientInfo?.FirstName && patientInfo?.LastName 
          ? `${patientInfo.FirstName} ${patientInfo.LastName}`
          : patientInfo?.Email || 'Patient';
        const email = patientInfo?.Email;
        
        if (email) {
          await appointmentEmailService.sendAppointmentConfirmation({
            to: email,
            patientName,
            appointment: {
              id: appointmentId,
              startTime: appointmentData.startTime,
              endTime: appointmentData.endTime,
              providerName: mapping.providerName || 'Provider',
              appointmentType: appointmentData.appointmentName,
              notes: appointmentData.notes
            }
          });
        }
      } catch (emailError) {
        logger.warn('[APPOINTMENT BOOKING] Failed to send confirmation email', {
          appointmentId,
          error: emailError.message
        });
        // Don't fail the booking if email fails
      }
    })();

    res.json({
      success: true,
      appointmentId: appointmentId,
      appointment: appointment,
      startTime: appointmentData.startTime,
      endTime: appointmentData.endTime,
      message: 'Appointment booked successfully'
    });

  } catch (error) {
    console.error('❌ [APPOINTMENT BOOKING] Error booking appointment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to book appointment',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/appointments/{appointmentId}:
 *   delete:
 *     summary: Cancel an appointment
 *     tags: [Appointments]
 *     parameters:
 *       - in: path
 *         name: appointmentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Appointment ID to cancel
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Cancellation reason
 *     responses:
 *       200:
 *         description: Appointment cancelled successfully
 *       404:
 *         description: Appointment not found
 *       500:
 *         description: Internal server error
 */
// Cancel appointment
router.delete('/:appointmentId', async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { reason } = req.body;

    if (!appointmentId) {
      return res.status(400).json({
        success: false,
        message: 'Appointment ID is required'
      });
    }

    // Get appointment first to get details
    const appointment = await tebraService.getAppointment(appointmentId);
    
    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Update appointment status to Cancelled in Tebra
    const updateData = {
      AppointmentId: appointmentId,
      AppointmentStatus: 'Cancelled',
      Notes: (appointment.Notes || appointment.notes || '') + `\nCancelled: ${reason || 'Cancelled by patient'}`
    };

    // Try to update appointment status
    try {
      await tebraService.updateAppointment(appointmentId, updateData);
    } catch (updateError) {
      // If update fails, try delete (some Tebra setups use delete for cancellation)
      logger.warn('[APPOINTMENT] Update failed, trying delete', { error: updateError.message });
      try {
        await tebraService.deleteAppointment(appointmentId);
      } catch (deleteError) {
        throw new Error(`Failed to cancel appointment: ${updateError.message}`);
      }
    }

    logger.info('[APPOINTMENT] Appointment cancelled', {
      appointmentId,
      reason
    });

    // Invalidate availability cache (appointment was cancelled, slot is now available)
    const cacheService = require('../services/cacheService');
    // Try to get state from appointment or request
    const state = req.body?.state || appointment?.State || 'CA';
    const providerId = appointment?.ProviderID || appointment?.ProviderId;
    if (state && providerId) {
      await cacheService.invalidateAvailability(state.toUpperCase(), providerId);
      logger.info('[APPOINTMENT] Invalidated availability cache after cancellation', { state, providerId });
    } else {
      // Invalidate all availability if we can't determine state/provider
      await cacheService.invalidateAvailability();
    }

    res.json({
      success: true,
      appointmentId,
      message: 'Appointment cancelled successfully'
    });
  } catch (error) {
    logger.error('[APPOINTMENT] Error cancelling appointment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel appointment',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/appointments/{appointmentId}/reschedule:
 *   put:
 *     summary: Reschedule an appointment
 *     tags: [Appointments]
 *     parameters:
 *       - in: path
 *         name: appointmentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Appointment ID to reschedule
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newStartTime
 *             properties:
 *               newStartTime:
 *                 type: string
 *                 format: date-time
 *                 description: New appointment start time
 *               newEndTime:
 *                 type: string
 *                 format: date-time
 *                 description: New appointment end time (optional, defaults to 30 min after start)
 *               reason:
 *                 type: string
 *                 description: Rescheduling reason
 *     responses:
 *       200:
 *         description: Appointment rescheduled successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Appointment not found
 *       500:
 *         description: Internal server error
 */
// Reschedule appointment
router.put('/:appointmentId/reschedule', async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { newStartTime, newEndTime, reason } = req.body;

    if (!appointmentId || !newStartTime) {
      return res.status(400).json({
        success: false,
        message: 'Appointment ID and new start time are required'
      });
    }

    // Validate new start time is in the future
    const newStart = new Date(newStartTime);
    if (isNaN(newStart.getTime()) || newStart.getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'New start time must be a valid future date'
      });
    }

    // Get original appointment to preserve details
    const originalAppointment = await tebraService.getAppointment({ appointmentId });
    
    if (!originalAppointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Calculate new end time (30 minutes after start, or use provided)
    const newEnd = newEndTime ? new Date(newEndTime) : new Date(newStart.getTime() + 30 * 60000);

    // Cancel original appointment
    const cancelUpdateData = {
      AppointmentId: appointmentId,
      AppointmentStatus: 'Cancelled',
      Notes: (originalAppointment.Notes || originalAppointment.notes || '') + `\nCancelled: Rescheduled to ${newStartTime}. ${reason || ''}`
    };
    
    try {
      await tebraService.updateAppointment(appointmentId, cancelUpdateData);
    } catch (updateError) {
      logger.warn('[APPOINTMENT] Update failed during reschedule, trying delete', { error: updateError.message });
      try {
        await tebraService.deleteAppointment(appointmentId);
      } catch (deleteError) {
        // Log but continue - we'll create the new appointment anyway
        logger.warn('[APPOINTMENT] Failed to cancel original appointment during reschedule', { error: deleteError.message });
      }
    }

    // Create new appointment with same details
    // Determine state from original appointment or use default
    const originalState = originalAppointment.State || 
                          originalAppointment.state || 
                          Object.keys(providerMapping).find(state => 
                            providerMapping[state].practiceId === (originalAppointment.PracticeID || originalAppointment.practiceId)
                          ) || 'CA';
    
    const mapping = providerMapping[originalState.toUpperCase()] || providerMapping['CA'];
    const newAppointment = await tebraService.createAppointment({
      appointmentName: originalAppointment.AppointmentName || originalAppointment.appointmentName || 'Telemedicine Consultation',
      appointmentStatus: 'Scheduled',
      appointmentType: 'P',
      appointmentMode: 'Telehealth',
      startTime: newStart.toISOString(),
      endTime: newEnd.toISOString(),
      patientId: originalAppointment.PatientID || originalAppointment.patientId || originalAppointment.Patient?.ID,
      practiceId: mapping?.practiceId || originalAppointment.PracticeID || originalAppointment.practiceId,
      providerId: mapping?.defaultProviderId || originalAppointment.ProviderID || originalAppointment.providerId,
      notes: `Rescheduled from ${originalAppointment.StartTime || originalAppointment.startTime || originalAppointment.start_date}. ${reason || ''}`,
      isRecurring: false
    });

    const newAppointmentId = newAppointment?.CreateAppointmentResult?.Appointment?.AppointmentID || 
                            newAppointment?.id || 
                            newAppointment?.AppointmentID;

    logger.info('[APPOINTMENT] Appointment rescheduled', {
      originalAppointmentId: appointmentId,
      newAppointmentId,
      newStartTime
    });

    // Invalidate availability cache (both old and new slots affected)
    const cacheService = require('../services/cacheService');
    const state = req.body?.state || originalAppointment?.State || 'CA';
    const providerId = originalAppointment?.ProviderID || originalAppointment?.ProviderId || mapping?.defaultProviderId;
    if (state && providerId) {
      await cacheService.invalidateAvailability(state.toUpperCase(), providerId);
      logger.info('[APPOINTMENT] Invalidated availability cache after reschedule', { state, providerId });
    } else {
      await cacheService.invalidateAvailability();
    }

    res.json({
      success: true,
      originalAppointmentId: appointmentId,
      newAppointmentId,
      newStartTime: newStart.toISOString(),
      newEndTime: newEnd.toISOString(),
      message: 'Appointment rescheduled successfully'
    });
  } catch (error) {
    logger.error('[APPOINTMENT] Error rescheduling appointment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reschedule appointment',
      error: error.message
    });
  }
});

module.exports = router;
