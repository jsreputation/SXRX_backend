const express = require('express');
const router = express.Router();
const tebraService = require('../services/tebraService');
const providerMapping = require('../config/providerMapping');
const { validateAppointmentBooking, sanitizeRequestBody } = require('../middleware/validation');
const appointmentEmailService = require('../services/appointmentEmailService');
const customerPatientMapService = require('../services/customerPatientMapService');
const logger = require('../utils/logger');
const { auth } = require('../middleware/shopifyTokenAuth');

/**
 * @swagger
 * /api/appointments/book:
 *   post:
 *     summary: Patient (Shopify customer) sends a booking request to the provider in Tebra
 *     description: |
 *       Patient (Shopify) → Backend → Tebra. The backend creates the appointment in Tebra
 *       as **Tentative** (booking request). The provider receives it in Tebra (Tentative
 *       Appointments / Action Required), reviews and confirms. Patient gets a "request received"
 *       email now and a confirmation once the provider approves. Set
 *       APPOINTMENT_REQUEST_AS_TENTATIVE=false to create as Scheduled (immediate, no review).
 *       Only logged-in Shopify customers can book, and bookings are tied to the authenticated customer.
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
 *               - state
 *               - startTime
 *             properties:
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
// Patient (Shopify customer) sends booking request → backend creates appointment in Tebra for the provider
router.post('/book', auth, express.json({ limit: '50kb' }), sanitizeRequestBody, validateAppointmentBooking, async (req, res) => {
  try {
    const { patientId, patientEmail, email, firstName, lastName, phone, state, startTime, endTime, appointmentName, productId, purchaseType } = req.body;
    const authEmail = (req.user?.email || '').toLowerCase().trim();
    const authCustomerId = req.user?.shopifyCustomerId || req.user?.id || req.user?.customerId || null;
    if (!authEmail) {
      return res.status(401).json({ success: false, message: 'Unauthorized: customer email required' });
    }
    const providedEmail = (patientEmail || email || '').toLowerCase().trim();
    if (providedEmail && providedEmail !== authEmail) {
      return res.status(403).json({ success: false, message: 'Booking must match the logged-in customer email' });
    }
    
    // Log: patient (Shopify customer) is sending a booking request to the provider in Tebra
    logger.info('[APPOINTMENT BOOKING] Received booking request from patient (Shopify customer)', {
      patientEmail: authEmail,
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

    // Resolve patientId (lookup/create by authenticated email)
    let resolvedPatientId = null;
    {
      const effectiveEmail = authEmail;
      logger.info('[APPOINTMENT BOOKING] Resolving patient ID', { email: effectiveEmail, firstName, lastName, phone: phone || 'not provided' });
      
      // 1) Try DB mapping first
      const existingMap = await customerPatientMapService.getByShopifyIdOrEmail(authCustomerId, effectiveEmail);
      if (existingMap?.tebra_patient_id) {
        resolvedPatientId = existingMap.tebra_patient_id;
        logger.info('[APPOINTMENT BOOKING] Found existing patient in DB mapping', { patientId: resolvedPatientId, email: effectiveEmail });
        
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
        const search = await tebraService.searchPatients({ email: effectiveEmail });
        const firstMatch = (search.patients || [])[0];
        if (firstMatch?.ID || firstMatch?.id) {
          resolvedPatientId = String(firstMatch.ID || firstMatch.id);
          logger.info('[APPOINTMENT BOOKING] Found existing patient in Tebra', { patientId: resolvedPatientId, email: effectiveEmail });
          
          // Save mapping to DB for future lookups
          await customerPatientMapService.upsert(authCustomerId, effectiveEmail, resolvedPatientId);
          
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
            email: effectiveEmail,
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
            email: effectiveEmail,
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
            email: effectiveEmail,
            firstName,
            lastName,
            phone: phone || 'not provided'
          });
        }
        if (resolvedPatientId) {
          await customerPatientMapService.upsert(authCustomerId, effectiveEmail, resolvedPatientId);
        }
      }
    }

    if (patientId && resolvedPatientId && String(patientId) !== String(resolvedPatientId)) {
      return res.status(403).json({ success: false, message: 'Booking must use the logged-in patient record' });
    }

    // Parse start time (validation already ensures it's valid and in future)
    const startDate = new Date(startTime);

    // Always enforce 30-minute appointment duration
    const endDate = new Date(startDate.getTime() + 30 * 60000); // Always 30 minutes

    // Create appointment in Tebra as Tentative = booking REQUEST. Provider receives it in Tebra (Tentative Appointments / Action Required), reviews and confirms.
    // Set APPOINTMENT_REQUEST_AS_TENTATIVE=false to create as Scheduled (immediate, no provider review). Default: true.
    const useTentative = process.env.APPOINTMENT_REQUEST_AS_TENTATIVE !== 'false';
    const appointmentData = {
      appointmentName: appointmentName || 'Telemedicine Consultation',
      appointmentStatus: useTentative ? 'Tentative' : 'Scheduled',
      appointmentType: 'P', // Patient
      appointmentMode: 'Telehealth', // Telemedicine
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      patientId: resolvedPatientId,
      patientFirstName: firstName || 'Guest',
      patientLastName: lastName || 'Customer',
      patientEmail: authEmail,
      practiceId: mapping.practiceId,
      providerId: mapping.defaultProviderId,
      serviceLocationId: mapping.serviceLocationId,
      appointmentReasonId: mapping.appointmentReasonId,
      notes: `Consultation scheduled from questionnaire. Product: ${productId || 'N/A'}, Type: ${purchaseType || 'N/A'}`,
      isRecurring: false,
      state,
      practiceGuid: mapping.practiceGuid,
      providerGuid: mapping.providerGuid,
      resourceGuid: mapping.resourceGuid,
      resourceId: mapping.resourceId
    };

    console.log(`📅 [APPOINTMENT BOOKING] Sending patient's booking request to provider in Tebra:`, {
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

    console.log(`✅ [APPOINTMENT BOOKING] Patient's booking request created in Tebra (appointment ${appointmentId} with provider for patient ${resolvedPatientId})`);

    const cacheService = require('../services/cacheService');
    // Record just-booked slot so availability excludes it immediately (covers Tebra eventual consistency)
    await cacheService.addBookedSlot(state.toUpperCase(), mapping.defaultProviderId, appointmentData.startTime, appointmentData.endTime);
    // Invalidate availability cache for this state/provider
    await cacheService.invalidateAvailability(state.toUpperCase(), mapping.defaultProviderId);
    logger.info('[APPOINTMENT BOOKING] Invalidated availability cache', { state, providerId: mapping.defaultProviderId });

    // Send email (async, don't wait): request-received when Tentative, confirmation when Scheduled
    (async () => {
      try {
        const patientInfo = await tebraService.getPatient(resolvedPatientId);
        const patientName = patientInfo?.FirstName && patientInfo?.LastName 
          ? `${patientInfo.FirstName} ${patientInfo.LastName}`
          : (firstName && lastName ? `${firstName} ${lastName}`.trim() : authEmail || 'Patient');
        const email = patientInfo?.Email || authEmail;
        
        if (email) {
          const apt = {
            id: appointmentId,
            startTime: appointmentData.startTime,
            endTime: appointmentData.endTime,
            providerName: mapping.providerName || 'Provider',
            appointmentType: appointmentData.appointmentName,
            notes: appointmentData.notes
          };
          if (useTentative) {
            await appointmentEmailService.sendBookingRequestReceived({ to: email, patientName: patientName || `${firstName || ''} ${lastName || ''}`.trim() || 'Patient', appointment: apt });
            logger.info('[APPOINTMENT BOOKING] Booking-request-received email sent', { appointmentId, email });
          } else {
            await appointmentEmailService.sendAppointmentConfirmation({ to: email, patientName: patientName || `${firstName || ''} ${lastName || ''}`.trim() || 'Patient', appointment: apt });
            logger.info('[APPOINTMENT BOOKING] Confirmation email sent', { appointmentId, email });
          }
        } else {
          logger.warn('[APPOINTMENT BOOKING] No email available', { appointmentId, resolvedPatientId });
        }
      } catch (emailError) {
        logger.warn('[APPOINTMENT BOOKING] Failed to send email', { appointmentId, error: emailError.message });
      }
    })();

    res.json({
      success: true,
      appointmentId: appointmentId,
      appointment: appointment,
      startTime: appointmentData.startTime,
      endTime: appointmentData.endTime,
      message: useTentative
        ? 'Booking request submitted. The provider will review it and you will receive a confirmation once it is approved.'
        : 'Appointment booked successfully'
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
