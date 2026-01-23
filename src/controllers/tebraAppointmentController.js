// backend/src/controllers/tebraAppointmentController.js
const tebraService = require('../services/tebraService');
const moment = require('moment-timezone');

// Configurable shift parameters (env vars):
const SHIFT_INCREMENT_MINUTES = parseInt(process.env.APPOINTMENT_SHIFT_MINUTES, 10) || 15;
const SHIFT_MAX_ATTEMPTS = parseInt(process.env.APPOINTMENT_SHIFT_MAX_ATTEMPTS, 10) || 24;

// Get availability slots
exports.getAvailability = async (req, res) => {
  try {
    const { availabilityOptions } = req.body;
    const { clientLocation } = req;

    console.log(`📅 [TEBRA AVAILABILITY] Getting availability slots`, availabilityOptions);

    const result = await tebraService.getAvailability(availabilityOptions);

    res.json({
      success: true,
      message: 'Availability retrieved successfully',
      availability: result.availability || [],
      totalCount: result.totalCount || 0,
      location: clientLocation
    });

  } catch (error) {
    console.error('Tebra availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get availability',
      error: error.message,
      location: req.clientLocation
    });
  }
};

// Create appointment
exports.createAppointment = async (req, res) => {
  try {
    const { appointmentData } = req.body;
    const { clientLocation } = req;
    let generatedMeetingLink = null;

    // Ensure patient exists in Tebra if patientId is missing
    try {
      if (!appointmentData.patientId && (appointmentData.patientEmail || appointmentData.patientSummary?.Email)) {
        const email = appointmentData.patientEmail || appointmentData.patientSummary?.Email;
        let patientIdFromLookup = null;
        try {
          if (email && tebraService.searchPatients) {
            const found = await tebraService.searchPatients({ email });
            const candidates = found?.patients || found?.Patients || [];
            const match = candidates.find(p => (p.Email || p.email || '').toLowerCase() === String(email).toLowerCase());
            if (match) patientIdFromLookup = match.ID || match.Id || match.id;
          }
        } catch (e) {
          console.warn('Patient lookup failed, will attempt creation:', e?.message || e);
        }
        if (!patientIdFromLookup) {
          // Enhanced patient creation with full demographic data
          const created = await tebraService.createPatient({
            email,
            firstName: appointmentData.patientSummary?.FirstName || appointmentData.patientSummary?.firstName || 'Unknown',
            lastName: appointmentData.patientSummary?.LastName || appointmentData.patientSummary?.lastName || 'Unknown',
            mobilePhone: appointmentData.patientSummary?.MobilePhone || appointmentData.patientSummary?.Phone || appointmentData.patientSummary?.phone || undefined,
            dateOfBirth: appointmentData.patientSummary?.DateOfBirth || appointmentData.patientSummary?.dateOfBirth || appointmentData.patientSummary?.dateOfBirth || undefined,
            gender: appointmentData.patientSummary?.Gender || appointmentData.patientSummary?.gender || undefined,
            addressLine1: appointmentData.patientSummary?.address?.street || appointmentData.patientSummary?.address?.addressLine1 || appointmentData.patientSummary?.Address?.street || undefined,
            city: appointmentData.patientSummary?.address?.city || appointmentData.patientSummary?.Address?.city || undefined,
            state: appointmentData.patientSummary?.address?.state || appointmentData.patientSummary?.Address?.state || undefined,
            zipCode: appointmentData.patientSummary?.address?.zip || appointmentData.patientSummary?.address?.zipCode || appointmentData.patientSummary?.Address?.zip || appointmentData.patientSummary?.Address?.zipCode || undefined,
            country: appointmentData.patientSummary?.address?.country || appointmentData.patientSummary?.Address?.country || 'US',
            practice: appointmentData.practiceId ? { PracticeID: appointmentData.practiceId } : undefined,
          });
          patientIdFromLookup = created?.id || created?.patientId || created?.PatientID;
          console.log(`✅ [APPOINTMENT] Created new patient chart in Tebra: ${patientIdFromLookup}`);
        }
        if (patientIdFromLookup) {
          appointmentData.patientId = patientIdFromLookup;
          
          // Store customer-patient mapping (like questionnaire does)
          try {
            const mapService = require('../services/customerPatientMapService');
            const shopifyCustomerId = req.user?.customerId || req.user?.id || req.user?.sub || 
                                      (req.user?.payload?.customerId) || (req.user?.payload?.sub) || null;
            if (shopifyCustomerId || email) {
              await mapService.upsert(shopifyCustomerId, email, patientIdFromLookup);
              console.log(`✅ [APPOINTMENT] Mapped patient ${patientIdFromLookup} to customer ${shopifyCustomerId || email}`);
            }
          } catch (mapError) {
            console.warn('⚠️ [APPOINTMENT] Failed to store customer-patient mapping:', mapError?.message || mapError);
            // Non-critical, continue
          }
        }
      }
    } catch (ensureErr) {
      console.warn('Failed to ensure patient prior to appointment creation:', ensureErr?.message || ensureErr);
    }

    console.log(`📅 [TEBRA APPOINTMENT] Creating appointment with patientId:`, appointmentData.patientId, `(type: ${typeof appointmentData.patientId})`);
    console.log(`📅 [TEBRA APPOINTMENT] Full appointment data:`, JSON.stringify({
      patientId: appointmentData.patientId,
      startTime: appointmentData.startTime,
      endTime: appointmentData.endTime,
      appointmentType: appointmentData.appointmentType,
      patientEmail: appointmentData.patientEmail,
    }, null, 2));
    /**
     * Overlap Prevention Algorithm:
     * Prevents creating overlapping appointments by checking existing appointments for the same
     * provider/resource and automatically shifting the requested slot forward in configurable increments
     * until a free slot is found (with maxAttempts fallback to prevent infinite loops).
     * 
     * Algorithm Steps:
     * 1. Calculate appointment duration from start/end times
     * 2. Query existing appointments for the same day, provider, and practice
     * 3. For each candidate time slot:
     *    a. Check if it overlaps with any existing appointment (same provider/resource/patient)
     *    b. If overlap found, shift forward by incrementMinutes
     *    c. Repeat until free slot found or maxAttempts reached
     * 4. Update appointmentData with shifted times if adjustment was made
     * 
     * Overlap Detection Logic:
     * - Two time ranges overlap if: start1 < end2 AND start2 < end1
     * - Checks are scoped to same provider/resource to avoid false positives
     * - Falls back to patient-based checking if provider/resource not specified
     */
    try {
      const start = moment(appointmentData.startTime);
      const end = moment(appointmentData.endTime);
      const durationMs = end.diff(start); // Calculate duration to preserve when shifting
      const incrementMinutes = SHIFT_INCREMENT_MINUTES; // Default: 15 minutes
      const maxAttempts = SHIFT_MAX_ATTEMPTS; // Default: 24 attempts (6 hours max shift)

      let attempts = 0;
      let candidateStart = start.clone(); // Start with original requested time
      let candidateEnd = candidateStart.clone().add(durationMs, 'ms'); // Preserve duration
      let foundFree = false;

      // Remember original times so we can inform the frontend if adjustment was made
      const originalStartISO = start.toISOString();
      const originalEndISO = end.toISOString();

      // Prepare search window for the day of the appointment
      // Only check appointments on the same day to optimize query performance
      const dayStart = start.clone().startOf('day').toISOString();
      const dayEnd = start.clone().endOf('day').toISOString();

      const searchOptions = { startDate: dayStart, endDate: dayEnd };
      // Include provider/practice filters when available to avoid false overlap checks
      // This ensures we only check conflicts with appointments for the same provider/practice
      if (appointmentData.providerId) searchOptions.providerId = appointmentData.providerId;
      if (appointmentData.practiceId) searchOptions.practiceId = appointmentData.practiceId;

      const rawResult = await tebraService.getAppointments(searchOptions);

      // Normalize returned appointments list - handle different response structures from Tebra API
      let existingAppointments = [];
      if (rawResult && rawResult.GetAppointmentsResult && rawResult.GetAppointmentsResult.Appointments) {
        existingAppointments = rawResult.GetAppointmentsResult.Appointments.map(a => tebraService.normalizeAppointmentData(a));
      } else if (rawResult && rawResult.appointments) {
        existingAppointments = rawResult.appointments;
      }

      /**
       * Overlap detection function: Two time ranges overlap if they intersect
       * @param {string} s1 - Start time of range 1 (ISO string)
       * @param {string} e1 - End time of range 1 (ISO string)
       * @param {string} s2 - Start time of range 2 (ISO string)
       * @param {string} e2 - End time of range 2 (ISO string)
       * @returns {boolean} True if ranges overlap
       */
      const overlaps = (s1, e1, s2, e2) => {
        return (s1 < e2) && (s2 < e1);
      };

      // Iterate through candidate time slots until we find a free one
      while (attempts < maxAttempts) {
        const candidateStartISO = candidateStart.toISOString();
        const candidateEndISO = candidateEnd.toISOString();

        // Check if candidate slot overlaps any existing appointment
        const conflict = existingAppointments.find(existing => {
          // Match by provider/resource when available for accurate conflict detection
          // Provider-based: Same provider cannot have overlapping appointments
          const sameProvider = appointmentData.providerId && existing.providerId && String(appointmentData.providerId) === String(existing.providerId);
          // Resource-based: Same resource (room/equipment) cannot be double-booked
          const sameResource = appointmentData.resourceId && existing.resourceId && String(appointmentData.resourceId) === String(existing.resourceId);
          // Patient-based: Same patient shouldn't have overlapping appointments (fallback if no provider/resource)
          const samePatient = (appointmentData.patientId || appointmentData.PatientID) && (existing.patient?.id || existing.patientId) && String(appointmentData.patientId || appointmentData.PatientID) === String(existing.patient?.id || existing.patientId);
          
          // Determine if we should check for overlap with this existing appointment
          // Priority: provider > resource > patient (if no provider/resource specified)
          const shouldCheck = sameProvider || sameResource || (!appointmentData.providerId && !appointmentData.resourceId && samePatient);
          if (!shouldCheck) return false; // Skip appointments for different providers/resources

          // Parse existing appointment times (handle multiple possible field names)
          const exStart = moment(existing.startTime || existing.StartTime || existing.Start);
          const exEnd = moment(existing.endTime || existing.EndTime || existing.End);
          
          // Check if candidate time range overlaps with existing appointment time range
          return overlaps(candidateStartISO, candidateEndISO, exStart.toISOString(), exEnd.toISOString());
        });

        // If no conflict found, we have a free slot
        if (!conflict) {
          foundFree = true;
          break;
        }

        // Conflict found - shift forward by increment and try again
        candidateStart.add(incrementMinutes, 'minutes');
        candidateEnd = candidateStart.clone().add(durationMs, 'ms'); // Maintain original duration
        attempts += 1;
      }

      if (!foundFree) {
        console.warn('Could not find non-overlapping slot for appointment after', maxAttempts, 'attempts');
        return res.status(409).json({ success: false, message: 'No available non-overlapping timeslot found for the requested appointment' });
      }

      // If we shifted the appointment, update appointmentData before creating
      if (!candidateStart.isSame(start)) {
        appointmentData.startTime = candidateStart.toISOString();
        appointmentData.endTime = candidateEnd.toISOString();
        appointmentData._autoAdjusted = true;
        appointmentData._originalStartTime = originalStartISO;
        appointmentData._originalEndTime = originalEndISO;
        console.log('Adjusted appointment time to avoid overlap:', appointmentData.startTime, appointmentData.endTime);
      }
    } catch (checkErr) {
      console.error('Failed to check/adjust appointment times for overlap:', checkErr);
      // proceed with original appointment if overlap check fails unexpectedly
    }

      // Always generate a meeting link and append to notes (no longer depends on a request flag)
      try {
        // Force Google Meet for meeting link generation; Zoom option removed
        const rnd = Math.random().toString(36).slice(2, 10);
        const meetingLink = `https://meet.google.com/${rnd.slice(0,3)}-${rnd.slice(3,6)}-${rnd.slice(6,8)}`;
        generatedMeetingLink = meetingLink;

        // Append to notes (preserve existing notes)
        appointmentData.notes = appointmentData.notes ? `${appointmentData.notes}\nMeeting Link: ${meetingLink}` : `Meeting Link: ${meetingLink}`;

        // Queue email sending as background job
        const patientEmail = (appointmentData.patientEmail || appointmentData.patientSummary?.Email || appointmentData.PatientEmail);
        if (patientEmail) {
          try {
            const jobQueueService = require('../services/jobQueue');
            if (jobQueueService.enabled) {
              await jobQueueService.addJob('emails', 'sendEmail', {
                to: patientEmail,
                from: process.env.SENDGRID_FROM || 'no-reply@example.com',
                subject: 'Your Appointment Meeting Link',
                text: `Your appointment meeting link: ${meetingLink}`,
                html: `<p>Your appointment meeting link: <a href="${meetingLink}">${meetingLink}</a></p>`
              });
              console.log('✅ Meeting link email queued for sending to:', patientEmail);
            } else {
              // Fallback: send immediately if job queue is disabled
              const sgKey = process.env.SENDGRID_API_KEY;
              if (sgKey) {
                const sgMail = require('@sendgrid/mail');
                sgMail.setApiKey(sgKey);
                const msg = {
                  to: patientEmail,
                  from: process.env.SENDGRID_FROM || 'no-reply@example.com',
                  subject: 'Your Appointment Meeting Link',
                  text: `Your appointment meeting link: ${meetingLink}`,
                  html: `<p>Your appointment meeting link: <a href="${meetingLink}">${meetingLink}</a></p>`
                };
                const sgResult = await sgMail.send(msg);
                console.log('✅ Meeting link emailed via SendGrid to:', patientEmail, sgResult && sgResult[0] && sgResult[0].statusCode);
              } else {
                console.log('ℹ️ SENDGRID_API_KEY not configured. Skipping email send. Would have sent to:', patientEmail, 'link:', meetingLink);
              }
            }
          } catch (mailErr) {
            console.warn('Failed to queue/send meeting link email (continuing):', mailErr && mailErr.message ? mailErr.message : mailErr);
          }
        } else {
          console.log('ℹ️ No patient email available to send meeting link to. Generated link:', meetingLink);
        }
      } catch (genErr) {
        console.warn('Failed to generate or email meeting link, continuing without it:', genErr);
      }

      const result = await tebraService.createAppointment(appointmentData);
    
    // Record business metric
    const metricsService = require('../services/metricsService');
    metricsService.recordBusinessMetric('appointment_created', 1);
    
    // Invalidate appointment cache when new appointment is created
    try {
      const cacheService = require('../services/cacheService');
      await cacheService.deletePattern('sxrx:appointments:*');
      console.log('✅ [APPOINTMENTS] Invalidated appointment cache after creation');
    } catch (cacheErr) {
      console.warn('⚠️ [APPOINTMENTS] Failed to invalidate cache:', cacheErr?.message || cacheErr);
    }
    
    console.log('🔍 Raw result from tebraService.createAppointment:', JSON.stringify(result, null, 2));

    // Log patient ID information for debugging
    console.log('📋 Created appointment patient info:', {
      requestedPatientId: appointmentData.patientId,
      requestedPatientIdType: typeof appointmentData.patientId,
      returnedPatientID: result?.CreateAppointmentResult?.Appointment?.PatientID,
      returnedPatientId: result?.CreateAppointmentResult?.Appointment?.PatientId,
      returnedPatientIdType: typeof result?.CreateAppointmentResult?.Appointment?.PatientId,
      patientSummary: result?.CreateAppointmentResult?.Appointment?.PatientSummary ? {
        PatientID: result.CreateAppointmentResult.Appointment.PatientSummary.PatientID,
        Id: result.CreateAppointmentResult.Appointment.PatientSummary.Id,
        ID: result.CreateAppointmentResult.Appointment.PatientSummary.ID,
        id: result.CreateAppointmentResult.Appointment.PatientSummary.id,
      } : null
    });

    // Extract appointment ID from the response structure
    let appointmentId = null;
    if (result && result.CreateAppointmentResult && result.CreateAppointmentResult.Appointment) {
      appointmentId = result.CreateAppointmentResult.Appointment.AppointmentId 
        || result.CreateAppointmentResult.Appointment.AppointmentID 
        || result.CreateAppointmentResult.Appointment.ID
        || result.CreateAppointmentResult.Appointment.Id;
      console.log('✅ Extracted appointment ID from CreateAppointmentResult:', appointmentId);
    } else if (result && result.id) {
      // Fallback for other response formats
      appointmentId = result.id;
      console.log('✅ Extracted appointment ID from result.id:', appointmentId);
    } else if (result && result.appointmentId) {
      appointmentId = result.appointmentId;
      console.log('✅ Extracted appointment ID from result.appointmentId:', appointmentId);
    } else {
      console.log('⚠️ Could not extract appointment ID from result structure');
      console.log('⚠️ Available result keys:', result ? Object.keys(result) : 'null');
    }

    // Attempt to fetch canonical appointment details to ensure consistent ID and fields
    let canonicalAppointment = null;
    try {
      if (appointmentId) {
        const fetched = await tebraService.getAppointment(appointmentId);
        if (fetched) {
          canonicalAppointment = fetched;
        }
      }
    } catch (e) {
      console.warn('⚠️ Failed to fetch canonical appointment after create:', e?.message || e);
    }

    // If appointmentId is still null, try to extract from appointment object
    if (!appointmentId && canonicalAppointment) {
      appointmentId = canonicalAppointment.id || canonicalAppointment.appointmentId || canonicalAppointment.AppointmentID || canonicalAppointment.AppointmentId;
      console.log('✅ Extracted appointment ID from canonical appointment:', appointmentId);
    }
    
    // Last resort: try to extract from raw result
    if (!appointmentId) {
      const rawAppointment = result?.CreateAppointmentResult?.Appointment || result?.Appointment || result;
      if (rawAppointment) {
        appointmentId = rawAppointment.ID || rawAppointment.AppointmentID || rawAppointment.AppointmentId || rawAppointment.id || rawAppointment.appointmentId;
        console.log('✅ Extracted appointment ID from raw result:', appointmentId);
      }
    }

    // Derive meeting link from generated value or notes
    const notesFromResult = result?.CreateAppointmentResult?.Appointment?.Notes;
    const meetingFromNotes = (() => {
      try {
        if (!notesFromResult) return undefined;
        const m = String(notesFromResult).match(/https?:\/\/[^\s)]+/);
        return m && m[0] ? m[0].replace(/[).,;]*$/, '') : undefined;
      } catch { return undefined; }
    })();

    // Build the appointment object for response
    const responseAppointment = canonicalAppointment || (result?.CreateAppointmentResult?.Appointment ? tebraService.normalizeAppointmentData(result.CreateAppointmentResult.Appointment) : null) || result?.CreateAppointmentResult?.Appointment || result;

    res.json({
      success: true,
      message: 'Appointment created successfully',
      appointmentId: appointmentId,
      patientId: appointmentData.patientId || null,
      // Prefer the canonical normalized object; fall back to raw structure
      appointment: responseAppointment,
      meetingLink: generatedMeetingLink || meetingFromNotes || (canonicalAppointment ? canonicalAppointment.meetingLink : undefined),
      autoAdjusted: !!appointmentData._autoAdjusted,
      originalStartTime: appointmentData._originalStartTime || null,
      originalEndTime: appointmentData._originalEndTime || null,
      adjustedStartTime: appointmentData.startTime || null,
      adjustedEndTime: appointmentData.endTime || null,
      location: clientLocation
    });

  } catch (error) {
    console.error('Tebra create appointment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create appointment',
      error: error.message,
      location: req.clientLocation
    });
  }
};

// Search appointments
exports.searchAppointments = async (req, res) => {
  try {
    const { searchOptions = {}, patientId } = req.body;
    const { clientLocation } = req;
    
    // Parse pagination parameters
    const { parsePaginationParams, createPaginationMeta, createPaginatedResponse } = require('../utils/pagination');
    const pagination = parsePaginationParams(req, { defaultPage: 1, defaultLimit: 20, maxLimit: 100 });
    
    // Check cache for appointment list (include pagination in cache key)
    const cacheService = require('../services/cacheService');
    const cacheKey = cacheService.generateKey('appointments', { 
      patientId: patientId || 'all',
      startDate: searchOptions.startDate,
      endDate: searchOptions.endDate,
      providerId: searchOptions.providerId,
      practiceId: searchOptions.practiceId,
      page: pagination.page,
      limit: pagination.limit
    });
    const cachedAppointments = await cacheService.get(cacheKey);
    if (cachedAppointments) {
      console.log(`✅ [APPOINTMENTS] Returning cached appointment list`);
      return res.json(cachedAppointments);
    }

    // Apply robust default date window if missing (past 180 days to next 365 days)
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0,10);
    const defaultEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0,10);

    const normalizedSearch = { ...searchOptions };
    // Normalize date formats to YYYY-MM-DD
    const norm = (d) => {
      if (!d) return undefined;
      try {
        if (typeof d === 'string') return d.length > 10 ? d.slice(0,10) : d;
        if (d instanceof Date) return d.toISOString().slice(0,10);
      } catch {}
      return d;
    };
    normalizedSearch.startDate = norm(searchOptions.startDate) || defaultStart;
    normalizedSearch.endDate = norm(searchOptions.endDate) || defaultEnd;

    console.log(`📋 [TEBRA APPOINTMENTS] Searching appointments`, normalizedSearch);
    console.log(`👤 [TEBRA APPOINTMENTS] Requesting patient ID:`, patientId, `(type: ${typeof patientId})`);
    console.log(`📅 [TEBRA APPOINTMENTS] Date filters - StartDate:`, normalizedSearch.startDate, 'EndDate:', normalizedSearch.endDate);

    // Add requestingPatientId to searchOptions for the mine field logic
    // Also try passing patientId directly to Tebra if it supports it
    const optionsWithPatientId = {
      ...normalizedSearch,
      requestingPatientId: patientId,
      // Try passing patientId directly to Tebra search
      patientId: patientId || undefined,
    };

    console.log(`📋 [TEBRA APPOINTMENTS] Calling tebraService.getAppointments with options:`, JSON.stringify(optionsWithPatientId, null, 2));
    const result = await tebraService.getAppointments(optionsWithPatientId);
    
    console.log('🔍 Raw result from tebraService.getAppointments:', JSON.stringify(result, null, 2));

    // Extract appointments from the response structure
    let appointments = [];
    let totalCount = 0;
    
    if (result && result.GetAppointmentsResult && result.GetAppointmentsResult.Appointments) {
      // Raw SOAP response - normalize the appointments
      const rawAppointments = result.GetAppointmentsResult.Appointments;
      appointments = rawAppointments.map(appointment => tebraService.normalizeAppointmentData(appointment));
      totalCount = result.GetAppointmentsResult.TotalCount || appointments.length;
      console.log('✅ Extracted and normalized appointments from GetAppointmentsResult:', appointments.length);
    } else if (result && result.appointments) {
      // Already normalized response
      appointments = result.appointments;
      totalCount = result.totalCount || appointments.length;
      console.log('✅ Extracted appointments from result.appointments:', appointments.length);
    } else {
      console.log('⚠️ Could not extract appointments from result structure');
    }

    // Log all appointments before filtering to see what patient IDs they have
    if (appointments.length > 0) {
      console.log(`📋 Before filtering - found ${appointments.length} appointments from Tebra`);
      appointments.slice(0, 5).forEach((apt, idx) => {
        const patientIds = [
          apt.patientId,
          apt.patient?.id,
          apt.patient?.ID,
          apt.patient?.Id,
          apt.patientSummary?.Id,
          apt.patientSummary?.ID,
          apt.patientSummary?.id,
        ].filter(Boolean);
        console.log(`  Appointment ${idx + 1} (${apt.id}): patient IDs found:`, patientIds);
      });
    } else {
      console.warn(`⚠️ Tebra returned ZERO appointments for date range ${normalizedSearch.startDate} to ${normalizedSearch.endDate}`);
      console.warn(`   Patient ID filter: ${patientId || 'none'}`);
      console.warn(`   This could mean:`);
      console.warn(`   1. No appointments exist in Tebra for this patient/date range`);
      console.warn(`   2. Tebra search failed or returned empty`);
      console.warn(`   3. Patient ID mismatch - appointments exist but for different patient`);
    }

    // If a requesting patient ID is supplied, filter to that patient's appointments only
    // DEBUG: Allow bypassing filter with query parameter ?debug=true
    const debugMode = req.query.debug === 'true' || process.env.DEBUG_APPOINTMENT_FILTER === 'true';
    
    if (patientId && !debugMode) {
      const pidStr = String(patientId).toLowerCase().trim();
      console.log(`🔍 Filtering appointments by patientId: "${pidStr}" (type: ${typeof patientId})`);
      
      const matchPid = (apt) => {
        try {
          // Collect all possible patient ID fields
          const candidates = [
            apt.patientId,  // Now populated by normalizeAppointmentData
            apt.patient?.id,
            apt.patient?.ID,
            apt.patient?.Id,
            apt.patientSummary?.Id,
            apt.patientSummary?.ID,
            apt.patientSummary?.id,
            apt.patientSummary?.Guid,
            apt.patientSummary?.GUID,
            apt.patientSummary?.guid,
            apt.PatientID,  // Direct field
            apt.PatientId,  // Direct field
          ].filter(Boolean).map(v => String(v).toLowerCase().trim());
          
          const matches = candidates.includes(pidStr);
          
          // DEBUG: Log ALL appointments (matching and non-matching) to diagnose ID mismatches
          if (candidates.length > 0) {
            if (matches) {
              console.log(`✅ Appointment ${apt.id} MATCHED: patientId "${pidStr}" found in [${candidates.join(', ')}]`);
            } else {
              console.log(`⚠️ Appointment ${apt.id} excluded: looking for patientId "${pidStr}", found [${candidates.join(', ')}]`);
            }
          } else {
            console.log(`⚠️ Appointment ${apt.id} has NO patient ID fields!`);
          }
          
          return matches;
        } catch (e) {
          console.error(`Error matching patient ID for appointment ${apt.id}:`, e);
          return false;
        }
      };
      
      const before = appointments.length;
      appointments = appointments.filter(matchPid);
      totalCount = appointments.length;
      console.log(`🎯 Filtered appointments by patientId ${patientId}: ${before} → ${appointments.length}`);
      
      // If all appointments were filtered out, log for debugging
      if (before > 0 && appointments.length === 0) {
        console.warn(`⚠️ ALL ${before} appointments filtered out for patientId ${patientId} - possible ID mismatch!`);
        console.warn(`   Searching for: "${pidStr}"`);
        console.warn(`   Check backend logs above to see what patient IDs are actually in the appointments`);
        console.warn(`   To see all appointments without filtering, set DEBUG_APPOINTMENT_FILTER=true in backend .env`);
      }
    } else if (debugMode) {
      console.log(`🔍 DEBUG MODE: Returning ALL appointments without patient ID filter`);
    } else if (!patientId) {
      console.log(`ℹ️ No patient ID provided - returning all appointments in date range`);
    }

    // Apply pagination
    const total = appointments.length;
    const startIndex = pagination.offset;
    const endIndex = startIndex + pagination.limit;
    const paginatedAppointments = appointments.slice(startIndex, endIndex);
    
    const paginationMeta = createPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total
    });

    const response = createPaginatedResponse(
      paginatedAppointments,
      paginationMeta,
      {
        message: 'Appointments retrieved successfully',
        location: clientLocation
      }
    );
    
    // Cache appointment list for 2 minutes (120 seconds) - appointments change frequently
    await cacheService.set(cacheKey, response, 120);
    
    res.json(response);

  } catch (error) {
    console.error('Tebra search appointments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search appointments',
      error: error.message,
      location: req.clientLocation
    });
  }
};

// Get single appointment by ID
exports.getAppointment = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { clientLocation } = req;

    console.log(`📋 [TEBRA APPOINTMENT] Get appointment ${appointmentId}`);
    const result = await tebraService.getAppointment(appointmentId);

    // Normalize structure
    let appointment = null;
    if (result && result.Appointment) {
      appointment = tebraService.normalizeGetAppointmentResponse(result);
    } else if (result && result.appointment) {
      appointment = result.appointment;
    } else {
      appointment = result;
    }

    return res.json({
      success: true,
      appointment,
      location: clientLocation
    });
  } catch (error) {
    console.error('Tebra get appointment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get appointment',
      error: error.message,
      location: req.clientLocation
    });
  }
};

// Update appointment
exports.updateAppointment = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { updates } = req.body;
    const { clientLocation } = req;

  console.log(`✏️ [TEBRA APPOINTMENT] Updating appointment ${appointmentId}`, updates);

  // Coerce numeric string IDs to integers to match SOAP type expectations
  const appointmentIdToUse = (typeof appointmentId === 'string' && /^\d+$/.test(appointmentId)) ? parseInt(appointmentId, 10) : appointmentId;
  // If frontend requested meeting generation on update, generate placeholder link and append to notes
  try {
    if (updates && updates.requestMeeting) {
      // Force Google Meet for meeting link generation on update as well
      const rnd = Math.random().toString(36).slice(2, 10);
      const meetingLink = `https://meet.google.com/${rnd.slice(0,3)}-${rnd.slice(3,6)}-${rnd.slice(6,8)}`;

      updates.notes = updates.notes ? `${updates.notes}\nMeeting Link: ${meetingLink}` : `Meeting Link: ${meetingLink}`;

      // Queue email sending as background job
      const patientEmail = updates.patientEmail || updates.PatientEmail || updates.patientSummary?.Email;
      if (patientEmail) {
        try {
          const jobQueueService = require('../services/jobQueue');
          if (jobQueueService.enabled) {
            await jobQueueService.addJob('emails', 'sendEmail', {
              to: patientEmail,
              from: process.env.SENDGRID_FROM || 'no-reply@example.com',
              subject: 'Your Appointment Meeting Link',
              text: `Your appointment meeting link: ${meetingLink}`,
              html: `<p>Your appointment meeting link: <a href="${meetingLink}">${meetingLink}</a></p>`
            });
            console.log('✅ Meeting link email queued for sending to:', patientEmail);
          } else {
            // Fallback: send immediately if job queue is disabled
            const sgKey = process.env.SENDGRID_API_KEY;
            if (sgKey) {
              const sgMail = require('@sendgrid/mail');
              sgMail.setApiKey(sgKey);
              const msg = {
                to: patientEmail,
                from: process.env.SENDGRID_FROM || 'no-reply@example.com',
                subject: 'Your Appointment Meeting Link',
                text: `Your appointment meeting link: ${meetingLink}`,
                html: `<p>Your appointment meeting link: <a href="${meetingLink}">${meetingLink}</a></p>`
              };
              await sgMail.send(msg);
              console.log('✅ Meeting link emailed via SendGrid to:', patientEmail);
            } else {
              console.log('ℹ️ SENDGRID_API_KEY not configured. Skipping email send. Would have sent to:', patientEmail, 'link:', meetingLink);
            }
          }
        } catch (mailErr) {
          console.warn('Failed to queue/send meeting link email on update (continuing):', mailErr && mailErr.message ? mailErr.message : mailErr);
        }
      } else {
        console.log('ℹ️ No patient email available to send updated meeting link to. Generated link:', meetingLink);
      }
    }
  } catch (genErr) {
    console.warn('Failed to generate or email meeting link for update, continuing:', genErr);
  }

  const result = await tebraService.updateAppointment(appointmentIdToUse, updates);
    
    // Invalidate appointment cache when appointment is updated
    try {
      const cacheService = require('../services/cacheService');
      await cacheService.deletePattern('sxrx:appointments:*');
      await cacheService.deletePattern('sxrx:chart:*'); // Also invalidate chart cache
      console.log('✅ [APPOINTMENTS] Invalidated appointment and chart cache after update');
    } catch (cacheErr) {
      console.warn('⚠️ [APPOINTMENTS] Failed to invalidate cache:', cacheErr?.message || cacheErr);
    }
    
    console.log('🔍 Raw result from tebraService.updateAppointment:', JSON.stringify(result, null, 2));

    // Extract appointment ID from the response structure
    let updatedAppointmentId = appointmentId; // Use the input ID as fallback
    if (result && result.UpdateAppointmentResult && result.UpdateAppointmentResult.Appointment) {
      updatedAppointmentId = result.UpdateAppointmentResult.Appointment.AppointmentId;
      console.log('✅ Extracted updated appointment ID from UpdateAppointmentResult:', updatedAppointmentId);
    } else if (result && result.id) {
      updatedAppointmentId = result.id;
      console.log('✅ Extracted updated appointment ID from result.id:', updatedAppointmentId);
    }

    // Fetch canonical appointment details after update for consistency
    let canonicalAppointment = null;
    try {
      if (updatedAppointmentId) {
        canonicalAppointment = await tebraService.getAppointment(updatedAppointmentId);
      }
    } catch (fetchErr) {
      console.warn('⚠️ Failed to fetch canonical appointment after update:', fetchErr?.message || fetchErr);
    }

    res.json({
      success: true,
      message: 'Appointment updated successfully',
      appointmentId: updatedAppointmentId,
      appointment: canonicalAppointment || result.UpdateAppointmentResult?.Appointment || result,
      location: clientLocation
    });

  } catch (error) {
    // Log richer error information to help debug SOAP/backend failures
    console.error('Tebra update appointment error:', error && error.message ? error.message : error);
    if (error && error.stack) console.error('Stack:', error.stack);
    if (error && error.response && error.response.data) console.error('Upstream response data:', error.response.data);

    res.status(500).json({
      success: false,
      message: 'Failed to update appointment',
      error: error && error.message ? error.message : String(error),
      rawError: error && error.response && error.response.data ? error.response.data : (error && error.stack ? error.stack : null),
      location: req.clientLocation
    });
  }
};

// Delete appointment
exports.deleteAppointment = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { clientLocation } = req;

    console.log(`🗑️ [TEBRA APPOINTMENT] Delete request received for appointment ID: ${appointmentId}`);
    console.log(`🗑️ [TEBRA APPOINTMENT] Appointment ID type: ${typeof appointmentId}, value: ${appointmentId}`);

    if (!appointmentId) {
      console.error('❌ [TEBRA APPOINTMENT] Delete failed: appointment ID is missing');
      return res.status(400).json({
        success: false,
        message: 'Appointment ID is required',
        error: 'Missing appointment ID parameter',
        location: clientLocation
      });
    }

    // Coerce numeric string IDs to integers before sending to SOAP
    const appointmentIdToUse = (typeof appointmentId === 'string' && /^\d+$/.test(appointmentId)) ? parseInt(appointmentId, 10) : appointmentId;
    console.log(`🗑️ [TEBRA APPOINTMENT] Using appointment ID for deletion: ${appointmentIdToUse} (coerced from ${appointmentId})`);
    
    console.log(`🗑️ [TEBRA APPOINTMENT] Calling tebraService.deleteAppointment with ID: ${appointmentIdToUse}`);
    const result = await tebraService.deleteAppointment(appointmentIdToUse);
    
    // Invalidate appointment cache when appointment is deleted
    try {
      const cacheService = require('../services/cacheService');
      await cacheService.deletePattern('sxrx:appointments:*');
      await cacheService.deletePattern('sxrx:chart:*'); // Also invalidate chart cache
      console.log('✅ [APPOINTMENTS] Invalidated appointment and chart cache after deletion');
    } catch (cacheErr) {
      console.warn('⚠️ [APPOINTMENTS] Failed to invalidate cache:', cacheErr?.message || cacheErr);
    }
    
    console.log(`🗑️ [TEBRA APPOINTMENT] Delete result from Tebra service:`, result);

    console.log(`✅ [TEBRA APPOINTMENT] Appointment ${appointmentIdToUse} deleted successfully`);
    res.json({
      success: true,
      message: 'Appointment deleted successfully',
      appointmentId: appointmentIdToUse,
      location: clientLocation
    });

  } catch (error) {
    console.error('❌ [TEBRA APPOINTMENT] Delete appointment error:', error);
    console.error('❌ [TEBRA APPOINTMENT] Error details:', {
      message: error?.message,
      stack: error?.stack,
      name: error?.name
    });
    
    const statusCode = error?.status || error?.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: 'Failed to delete appointment',
      error: error?.message || 'Unknown error occurred',
      location: req.clientLocation
    });
  }
};
