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
    const { patientId, patientEmail, firstName, lastName, phone, state, startTime, endTime, appointmentName, productId, purchaseType } = req.body;
    
    // Log received data for debugging
    logger.info('[APPOINTMENT BOOKING] Received booking request', {
      patientEmail,
      firstName,
      lastName,
      phone: phone || 'not provided',
      state,
      startTime,
      appointmentName,
      hasPatientId: !!patientId
    });

    // Get provider mapping for state (validation already ensures state is valid)
    const mapping = providerMapping[state.toUpperCase()];
    if (!mapping || !mapping.practiceId) {
      return res.status(400).json({
        success: false,
        message: `Unsupported state: ${state}. Available states: ${Object.keys(providerMapping).join(', ')}`
      });
    }

    // Resolve patientId if not provided (lookup/create by email)
    let resolvedPatientId = patientId;
    if (!resolvedPatientId) {
      const email = (patientEmail || '').toLowerCase().trim();
      logger.info('[APPOINTMENT BOOKING] Resolving patient ID', { email, firstName, lastName, phone: phone || 'not provided' });
      
      // 1) Try DB mapping first
      const existingMap = await customerPatientMapService.getByShopifyIdOrEmail(null, email);
      if (existingMap?.tebra_patient_id) {
        resolvedPatientId = existingMap.tebra_patient_id;
        logger.info('[APPOINTMENT BOOKING] Found existing patient in DB mapping', { patientId: resolvedPatientId, email });
        
        // Update existing patient with latest data from Shopify if provided (skip when TEBRA_SKIP_UPDATE_PATIENT_ON_BOOK=true to avoid InternalServiceFault noise)
        if (firstName || lastName || phone) {
          if (process.env.TEBRA_SKIP_UPDATE_PATIENT_ON_BOOK === 'true') {
            logger.debug('[APPOINTMENT BOOKING] Skipping UpdatePatient (TEBRA_SKIP_UPDATE_PATIENT_ON_BOOK)');
          } else {
            try {
              const updateData = {};
              if (firstName) updateData.firstName = firstName;
              if (lastName) updateData.lastName = lastName;
              if (phone) {
                updateData.phone = phone;
                updateData.mobilePhone = phone;
              }
              if (Object.keys(updateData).length > 0) {
                await tebraService.updatePatient(resolvedPatientId, updateData);
                logger.info('[APPOINTMENT BOOKING] Updated existing patient with latest Shopify data', {
                  patientId: resolvedPatientId,
                  updates: updateData
                });
              }
            } catch (updateError) {
              logger.warn('[APPOINTMENT BOOKING] Failed to update existing patient', {
                patientId: resolvedPatientId,
                error: updateError.message
              });
            }
          }
        }
      } else {
        // 2) Try searching in Tebra
        const search = await tebraService.searchPatients({ email });
        const firstMatch = (search.patients || [])[0];
        if (firstMatch?.ID || firstMatch?.id) {
          resolvedPatientId = String(firstMatch.ID || firstMatch.id);
          logger.info('[APPOINTMENT BOOKING] Found existing patient in Tebra', { patientId: resolvedPatientId, email });
          
          // Save mapping to DB for future lookups
          await customerPatientMapService.upsert(null, email, resolvedPatientId);
          
          // Update existing patient with latest data from Shopify if provided (skip when TEBRA_SKIP_UPDATE_PATIENT_ON_BOOK=true)
          if (firstName || lastName || phone) {
            if (process.env.TEBRA_SKIP_UPDATE_PATIENT_ON_BOOK === 'true') {
              logger.debug('[APPOINTMENT BOOKING] Skipping UpdatePatient (TEBRA_SKIP_UPDATE_PATIENT_ON_BOOK)');
            } else {
              try {
                const updateData = {};
                if (firstName) updateData.firstName = firstName;
                if (lastName) updateData.lastName = lastName;
                if (phone) {
                  updateData.phone = phone;
                  updateData.mobilePhone = phone; // Use same phone for mobile
                }
                if (Object.keys(updateData).length > 0) {
                  await tebraService.updatePatient(resolvedPatientId, updateData);
                  logger.info('[APPOINTMENT BOOKING] Updated existing patient with latest Shopify data', {
                    patientId: resolvedPatientId,
                    updates: updateData
                  });
                }
              } catch (updateError) {
                logger.warn('[APPOINTMENT BOOKING] Failed to update existing patient', {
                  patientId: resolvedPatientId,
                  error: updateError.message
                });
              }
            }
          }
        } else {
          // 3) Create patient in Tebra with all available info from Shopify
          const patientCreateData = {
            email: email,
            firstName: firstName || 'Guest',
            lastName: lastName || 'Customer',
            state: state || null,
            practiceId: mapping.practiceId // Include practice ID for proper assignment
          };
          
          // Add phone if provided (use for both HomePhone and MobilePhone)
          if (phone) {
            patientCreateData.phone = phone;
            patientCreateData.mobilePhone = phone; // Use same phone for mobile
          }
          
          logger.info('[APPOINTMENT BOOKING] Creating patient in Tebra with data', {
            email,
            firstName,
            lastName,
            phone: phone || 'not provided',
            state,
            practiceId: mapping.practiceId
          });
          
          const created = await tebraService.createPatient(patientCreateData);
          resolvedPatientId = String(created?.id || created?.PatientID || created?.patientId);
          
          logger.info('[APPOINTMENT BOOKING] Created new patient in Tebra', {
            patientId: resolvedPatientId,
            email,
            firstName,
            lastName,
            phone: phone || 'not provided'
          });
        }
        if (resolvedPatientId) {
          await customerPatientMapService.upsert(null, email, resolvedPatientId);
        }
      }
    }

    // Parse start time (validation already ensures it's valid and in future)
    const startDate = new Date(startTime);

    // Always enforce 30-minute appointment duration
    const endDate = new Date(startDate.getTime() + 30 * 60000); // Always 30 minutes

    // Create appointment in Tebra (pass Tebra-required: serviceLocationId, appointmentReasonId; tebraService sets ResourceId/ResourceIds when absent)
    // Pass logged-in user's firstname, lastname, email for PatientSummary (createPatient/updatePatient already use these for the patient record)
    const appointmentData = {
      appointmentName: appointmentName || 'Telemedicine Consultation',
      appointmentStatus: 'Scheduled',
      appointmentType: 'P', // Patient
      appointmentMode: 'Telehealth', // Telemedicine
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      patientId: resolvedPatientId,
      patientFirstName: firstName || 'Guest',
      patientLastName: lastName || 'Customer',
      patientEmail: patientEmail || undefined,
      practiceId: mapping.practiceId,
      providerId: mapping.defaultProviderId,
      serviceLocationId: mapping.serviceLocationId,
      appointmentReasonId: mapping.appointmentReasonId,
      notes: `Consultation scheduled from questionnaire. Product: ${productId || 'N/A'}, Type: ${purchaseType || 'N/A'}`,
      isRecurring: false,
      state,
      providerGuid: mapping.providerGuid
    };

    console.log(`📅 [APPOINTMENT BOOKING] Creating appointment in Tebra:`, {
      patientId: resolvedPatientId,
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

    console.log(`✅ [APPOINTMENT BOOKING] Created appointment ${appointmentId} in Tebra for patient ${resolvedPatientId}`);

    const cacheService = require('../services/cacheService');
    // Record just-booked slot so availability excludes it immediately (covers Tebra eventual consistency)
    await cacheService.addBookedSlot(state.toUpperCase(), mapping.defaultProviderId, appointmentData.startTime, appointmentData.endTime);
    // Invalidate availability cache for this state/provider
    await cacheService.invalidateAvailability(state.toUpperCase(), mapping.defaultProviderId);
    logger.info('[APPOINTMENT BOOKING] Invalidated availability cache', { state, providerId: mapping.defaultProviderId });

    // Send confirmation email (async, don't wait)
    (async () => {
      try {
        // Get patient info for email
        // Use resolvedPatientId (the actual Tebra patient ID we used to create the appointment)
        const patientInfo = await tebraService.getPatient(resolvedPatientId);
        const patientName = patientInfo?.FirstName && patientInfo?.LastName 
          ? `${patientInfo.FirstName} ${patientInfo.LastName}`
          : (firstName && lastName ? `${firstName} ${lastName}`.trim() : patientEmail || 'Patient');
        const email = patientInfo?.Email || patientEmail;
        
        if (email) {
          await appointmentEmailService.sendAppointmentConfirmation({
            to: email,
            patientName: patientName || `${firstName || ''} ${lastName || ''}`.trim() || 'Patient',
            appointment: {
              id: appointmentId,
              startTime: appointmentData.startTime,
              endTime: appointmentData.endTime,
              providerName: mapping.providerName || 'Provider',
              appointmentType: appointmentData.appointmentName,
              notes: appointmentData.notes
            }
          });
          logger.info('[APPOINTMENT BOOKING] Confirmation email sent', { appointmentId, email });
        } else {
          logger.warn('[APPOINTMENT BOOKING] No email available for confirmation', { appointmentId, resolvedPatientId });
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
    console.error('❌ [APPOINTMENT BOOKING] Error booking appointment:', error?.message || error);
    if (error?.stack) console.error(error.stack);
    const msg = error?.message || 'Failed to book appointment';
    res.status(500).json({
      success: false,
      message: msg.includes('AppointmentReasonID') ? msg : 'Failed to book appointment',
      error: msg
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

    // Update appointment status to Cancelled in Tebra (include required fields per Tebra guide)
    const updateData = {
      appointmentStatus: 'Cancelled',
      notes: (appointment.notes || '') + `\nCancelled: ${reason || 'Cancelled by patient'}`,
      appointmentName: appointment.appointmentName || 'Appointment',
      startTime: appointment.startDateTime || appointment.startTime,
      endTime: appointment.endDateTime || appointment.endTime,
      patientId: appointment.patientId,
      serviceLocationId: appointment.serviceLocation?.id || appointment.serviceLocationId,
      appointmentReasonId: appointment.appointmentReasonId,
      resourceId: appointment.resourceId || appointment.providerId,
      maxAttendees: appointment.maxAttendees || 1
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
    const originalAppointment = await tebraService.getAppointment(appointmentId);
    
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
      appointmentStatus: 'Cancelled',
      notes: (originalAppointment.notes || '') + `\nCancelled: Rescheduled to ${newStartTime}. ${reason || ''}`,
      appointmentName: originalAppointment.appointmentName || 'Appointment',
      startTime: originalAppointment.startDateTime || originalAppointment.startTime,
      endTime: originalAppointment.endDateTime || originalAppointment.endTime,
      patientId: originalAppointment.patientId,
      serviceLocationId: originalAppointment.serviceLocation?.id || originalAppointment.serviceLocationId,
      appointmentReasonId: originalAppointment.appointmentReasonId,
      resourceId: originalAppointment.resourceId || originalAppointment.providerId,
      maxAttendees: originalAppointment.maxAttendees || 1
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
    const originalPracticeId = originalAppointment.practice?.id || originalAppointment.practiceId;
    const originalProviderId = originalAppointment.providerId;
    const originalServiceLocationId = originalAppointment.serviceLocation?.id || originalAppointment.serviceLocationId;
    const originalState = originalAppointment.state || 
                          originalAppointment.State || 
                          Object.keys(providerMapping).find(state => 
                            String(providerMapping[state].practiceId) === String(originalPracticeId)
                          ) || 'CA';
    
    const mapping = providerMapping[originalState.toUpperCase()] || providerMapping['CA'];
    const newAppointment = await tebraService.createAppointment({
      appointmentName: originalAppointment.appointmentName || 'Telemedicine Consultation',
      appointmentStatus: 'Scheduled',
      appointmentType: originalAppointment.appointmentType || 'P',
      appointmentMode: originalAppointment.appointmentMode || 'Telehealth',
      startTime: newStart.toISOString(),
      endTime: newEnd.toISOString(),
      patientId: originalAppointment.patientId || originalAppointment.patient?.id,
      patientFirstName: originalAppointment.patient?.firstName,
      patientLastName: originalAppointment.patient?.lastName,
      patientEmail: originalAppointment.patient?.email,
      practiceId: mapping?.practiceId || originalPracticeId,
      providerId: mapping?.defaultProviderId || originalProviderId,
      serviceLocationId: mapping?.serviceLocationId || originalServiceLocationId,
      appointmentReasonId: mapping?.appointmentReasonId || originalAppointment.appointmentReasonId,
      notes: `Rescheduled from ${originalAppointment.startDateTime || originalAppointment.startTime || originalAppointment.start_date}. ${reason || ''}`,
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
    const state = req.body?.state || originalState || 'CA';
    const providerId = originalProviderId || mapping?.defaultProviderId;
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
