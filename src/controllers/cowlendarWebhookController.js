// backend/src/controllers/cowlendarWebhookController.js
// Handles Cowlendar webhook events for appointment creation/updates
//
// IMPORTANT: Cowlendar does NOT have direct webhook configuration in their app settings.
// This endpoint is for potential future direct webhook support or manual API integration.
// 
// PRIMARY INTEGRATION: Cowlendar bookings are handled through Shopify Order Created webhook
// (see billingController.handleShopifyOrderCreated)
//
// Meeting links:
// - Do NOT forward meeting links from Cowlendar to backend/Tebra.
// - Only surface a "Join" link if Tebra explicitly returns a MeetingLink on the appointment.

const tebraService = require('../services/tebraService');
const customerPatientMapService = require('../services/customerPatientMapService');
const providerMapping = require('../config/providerMapping');

/**
 * Handle Cowlendar appointment created webhook
 * 
 * Note: This endpoint may not be used if Cowlendar doesn't support direct webhooks.
 * Primary integration is through Shopify Order Created webhook.
 * 
 * Expected payload:
 * {
 *   appointment: { id, start_time, duration, service_name, meeting_link?, ... },
 *   customer: { id, email, firstName, lastName, state, ... },
 *   patient: { tebraPatientId? }
 * }
 */
exports.handleAppointmentCreated = async (req, res) => {
  try {
    const { appointment, customer, patient } = req.body;
    
    if (!appointment || !customer) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: appointment, customer'
      });
    }

    // Determine state and provider mapping
    const state = (customer.state || customer.address?.state || 'CA').toUpperCase();
    const mapping = providerMapping[state] || providerMapping['CA'] || {};
    
    if (!mapping.practiceId) {
      return res.status(400).json({
        success: false,
        message: `Unsupported or unmapped state: ${state}`
      });
    }

    // Get or create patient in Tebra
    let patientId = patient?.tebraPatientId || null;
    
    if (!patientId && customer.email) {
      try {
        const customerMapping = await customerPatientMapService.getByShopifyIdOrEmail(
          customer.shopifyCustomerId || customer.id,
          customer.email
        );
        if (customerMapping && customerMapping.tebra_patient_id) {
          patientId = customerMapping.tebra_patient_id;
        }
      } catch (e) {
        console.warn('[COWLENDAR] Customer-patient mapping lookup failed:', e?.message);
      }
    }

    // If patient not found, try to create
    if (!patientId && customer.email) {
      try {
        const patientPayload = {
          firstName: customer.firstName || customer.first_name || 'Unknown',
          lastName: customer.lastName || customer.last_name || 'Unknown',
          email: customer.email,
          mobilePhone: customer.phone || customer.mobilePhone,
          state: state,
          practice: {
            PracticeID: mapping.practiceId,
            PracticeName: mapping.practiceName,
          }
        };
        
        const created = await tebraService.createPatient(patientPayload);
        patientId = created.id || created.PatientID || created.patientId;
        
        // Store mapping
        if (customer.shopifyCustomerId || customer.id) {
          await customerPatientMapService.upsert(
            customer.shopifyCustomerId || customer.id,
            customer.email,
            patientId
          );
        }
        
        console.log(`✅ [COWLENDAR] Created new patient in Tebra: ${patientId}`);
      } catch (e) {
        console.error('[COWLENDAR] Failed to create patient:', e?.message || e);
        return res.status(500).json({
          success: false,
          message: 'Failed to create patient in Tebra'
        });
      }
    }

    if (!patientId) {
      return res.status(400).json({
        success: false,
        message: 'Unable to determine or create patient in Tebra'
      });
    }

    // Create appointment in Tebra
    const startTime = new Date(appointment.start_time || appointment.startTime);
    const duration = appointment.duration || 30; // minutes
    const endTime = new Date(startTime.getTime() + duration * 60000);

    // Meeting link policy: do NOT forward Cowlendar links.
    const meetingLink = null;

    const appointmentData = {
      appointmentName: appointment.service_name || appointment.serviceName || 'Telemedicine Consultation',
      appointmentStatus: 'Scheduled',
      appointmentType: 'P', // 'P' = Patient (valid Tebra enum value; AppointmentMode='Telehealth' handles telemedicine)
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      patientId,
      practiceId: mapping.practiceId,
      providerId: mapping.defaultProviderId || appointment.providerId,
      // Keep notes link-free. This is an audit trail only.
      notes: 'Cowlendar appointment.',
      isRecurring: false
    };

    const tebraAppointment = await tebraService.createAppointment(appointmentData);
    const createdId = tebraAppointment?.id || tebraAppointment?.ID || tebraAppointment?.appointmentId || tebraAppointment?.AppointmentID || null;
    console.log(`✅ [COWLENDAR] Created appointment in Tebra: ${createdId || '(unknown id)'}`);

    // Verify whether Tebra provides an explicit meeting link on the created appointment.
    if (createdId) {
      try {
        const fetched = await tebraService.getAppointment(createdId);
        const tebraMeetingLink = fetched?.meetingLink || fetched?.MeetingLink || null;
        console.log(`🔍 [COWLENDAR] Tebra appointment meeting link ${tebraMeetingLink ? 'present' : 'not present'}`);
      } catch (e) {
        console.warn('[COWLENDAR] Failed to fetch appointment after create for meeting link verification:', e?.message || e);
      }
    }

    res.json({
      success: true,
      tebraAppointmentId: createdId,
      meetingLink: null,
      patientId,
      message: 'Appointment synced to Tebra successfully'
    });
  } catch (error) {
    console.error('[COWLENDAR] Appointment creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal error',
      error: error.message
    });
  }
};

/**
 * Handle Cowlendar appointment updated webhook
 */
exports.handleAppointmentUpdated = async (req, res) => {
  try {
    const { appointment, changes } = req.body;
    
    if (!appointment || !appointment.tebraAppointmentId) {
      return res.status(400).json({
        success: false,
        message: 'Missing appointment or tebraAppointmentId'
      });
    }

    // Update appointment in Tebra
    const updateData = {};
    
    if (changes?.start_time || changes?.startTime) {
      const startTime = new Date(changes.start_time || changes.startTime);
      updateData.startTime = startTime.toISOString();
      
      if (appointment.duration) {
        const endTime = new Date(startTime.getTime() + appointment.duration * 60000);
        updateData.endTime = endTime.toISOString();
      }
    }
    
    if (changes?.status) {
      updateData.appointmentStatus = changes.status;
    }

    if (Object.keys(updateData).length > 0) {
      await tebraService.updateAppointment(appointment.tebraAppointmentId, updateData);
      console.log(`✅ [COWLENDAR] Updated appointment in Tebra: ${appointment.tebraAppointmentId}`);
    }

    res.json({
      success: true,
      message: 'Appointment updated in Tebra successfully'
    });
  } catch (error) {
    console.error('[COWLENDAR] Appointment update error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal error',
      error: error.message
    });
  }
};

