const tebraService = require('../services/tebraService');
const providerMapping = require('../config/providerMapping');
const googleMeetService = require('../services/googleMeetService');
const notificationService = require('../services/notificationService');
const pharmacyService = require('../services/pharmacyService');
const qualiphyService = require('../services/qualiphyService');
const customerPatientMapService = require('../services/customerPatientMapService');
const shopifyUserService = require('../services/shopifyUserService');

// Helpers
function determineState(payload) {
  // Try explicit field, else derive from shipping/billing address
  // Also check patientInfo object if present
  const state = (
    payload.state ||
    payload.shippingState ||
    payload.billingState ||
    payload.patientInfo?.state ||
    (payload.address && payload.address.state) ||
    (payload.shipping_address && payload.shipping_address.provinceCode) ||
    (payload.shipping_address && payload.shipping_address.province) ||
    (payload.billing_address && payload.billing_address.provinceCode) ||
    (payload.billing_address && payload.billing_address.province) ||
    undefined
  );
  
  // Normalize state code (e.g., "California" -> "CA", "ca" -> "CA")
  if (state) {
    const stateMap = {
      'california': 'CA',
      'texas': 'TX',
      'washington': 'WA',
      'kuala lumpur': 'KL',
      'kl': 'KL',
      'new york': 'NY',
      'florida': 'FL',
      // Add more as needed
    };
    const normalized = stateMap[state.toLowerCase()] || state.toUpperCase();
    return normalized;
  }
  
  return undefined;
}

function hasRedFlags(payload) {
  // RevenueHunt can send computed flags; fallback to simple checks
  if (payload.flags && typeof payload.flags.redFlags === 'boolean') return payload.flags.redFlags;
  if (Array.isArray(payload.redFlags)) return payload.redFlags.length > 0;
  if (typeof payload.hasRedFlags === 'boolean') return payload.hasRedFlags;
  return false;
}

function buildPatientPayload(payload, mapping) {
  const name = (payload.fullName || '').trim();
  const [firstName, ...rest] = name.split(' ');
  const lastName = rest.join(' ').trim() || payload.lastName;
  return {
    firstName: payload.firstName || firstName || 'Unknown',
    lastName: lastName || 'Unknown',
    email: payload.email,
    gender: payload.gender,
    dateOfBirth: payload.dateOfBirth || payload.dob,
    mobilePhone: payload.phone || payload.mobilePhone,
    addressLine1: payload.addressLine1 || payload.address1,
    addressLine2: payload.addressLine2 || payload.address2,
    city: payload.city,
    state: payload.state || mapping.state,
    zipCode: payload.zip || payload.zipCode,
    country: payload.country || 'USA',
    practice: {
      PracticeID: mapping.practiceId,
      PracticeName: mapping.practiceName,
    },
  };
}

async function createQuestionnaireDocument(patientId, mapping, payload) {
  const fileName = `questionnaire-${patientId}-${Date.now()}.json`;
  const documentData = {
    name: 'Online Questionnaire',
    fileName,
    documentDate: new Date().toISOString(),
    status: 'Completed',
    label: 'Consultation',
    notes: payload.summary || 'Submitted via RevenueHunt',
    patientId,
    practiceId: mapping.practiceId,
    // For now, attach JSON string as file content (base64)
    fileContent: Buffer.from(JSON.stringify(payload)).toString('base64'),
  };
  return await tebraService.createDocument(documentData);
}

async function notifyDoctor(mapping, payload, patientId) {
  try {
    const email = process.env.MEDICAL_DIRECTOR_EMAIL || process.env.PROVIDER_ALERT_EMAIL;
    const phone = process.env.MEDICAL_DIRECTOR_PHONE || process.env.ALERT_PHONE;
    
    if (!email && !phone) {
      console.warn('No doctor notification email or phone configured');
      return;
    }

    const patientName = payload.fullName || `${payload.firstName || ''} ${payload.lastName || ''}`.trim() || payload.email;
    const redFlags = payload.redFlags || payload.flags?.redFlags || [];
    const redFlagDetails = Array.isArray(redFlags) ? redFlags.join(', ') : String(redFlags);
    
    const subject = `Consultation Required - Red Flags Detected (${mapping.state})`;
    const text = `
New consultation needed for patient: ${patientName}
Email: ${payload.email || 'N/A'}
State: ${mapping.state}
Patient ID: ${patientId}
Practice: ${mapping.practiceName}

Red Flags: ${redFlagDetails || 'General red flags detected'}

Please review the patient chart in Tebra and schedule a consultation.
    `.trim();
    
    const html = `
      <h2>Consultation Required</h2>
      <p><strong>Patient:</strong> ${patientName}</p>
      <p><strong>Email:</strong> ${payload.email || 'N/A'}</p>
      <p><strong>State:</strong> ${mapping.state}</p>
      <p><strong>Patient ID:</strong> ${patientId}</p>
      <p><strong>Practice:</strong> ${mapping.practiceName}</p>
      <p><strong>Red Flags:</strong> ${redFlagDetails || 'General red flags detected'}</p>
      <p>Please review the patient chart in Tebra and schedule a consultation.</p>
    `;

    if (email) {
      await notificationService.sendProviderAlert({
        to: email,
        subject,
        text,
        html
      });
    }

  } catch (error) {
    console.error('Error notifying doctor:', error);
    // Don't fail the webhook if notification fails
  }
}

async function getAvailableSlots(mapping, options = {}) {
  try {
    const availability = await tebraService.getAvailability({
      practiceId: mapping.practiceId,
      providerId: mapping.defaultProviderId,
      isAvailable: true,
      fromDate: options.fromDate || new Date().toISOString().split('T')[0],
      toDate: options.toDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    });
    return availability.availability || [];
  } catch (error) {
    console.error('Error fetching availability:', error);
    return [];
  }
}

async function createTelemedicineAppointment(patientId, mapping, scheduledTime) {
  try {
    // Generate Google Meet link (disabled)
    const meetingDetails = googleMeetService.generateMeetLink({
      patientName: 'Patient', // You might want to get this from patient data
      doctorName: 'Medical Director',
      appointmentId: `APT-${Date.now()}`,
      scheduledTime
    });

    // Create appointment in Tebra
    const appointmentData = {
      appointmentName: 'Telemedicine Consultation',
      appointmentStatus: 'Scheduled',
      appointmentType: 'P', // 'P' = Patient (valid Tebra enum value; AppointmentMode='Telehealth' handles telemedicine)
      startTime: scheduledTime,
      endTime: new Date(new Date(scheduledTime).getTime() + 30 * 60000), // 30 minutes later
      patientId,
      practiceId: mapping.practiceId,
      providerId: mapping.defaultProviderId,
      notes: meetingDetails ? `Telemedicine consultation. Google Meet: ${meetingDetails.meetLink}` : 'Telemedicine consultation.',
      isRecurring: false
    };

    const appointment = await tebraService.createAppointment(appointmentData);
    
    return {
      appointment,
      meetingDetails
    };
  } catch (error) {
    console.error('Error creating telemedicine appointment:', error);
    throw error;
  }
}

// Controller
exports.handleRevenueHunt = async (req, res) => {
  try {
    const payload = req.body || {};

    // Validate that this is actually a RevenueHunt questionnaire request
    // RevenueHunt requests should have questionnaire data (answers, quizId, etc.)
    // Appointment bookings should NOT trigger this webhook
    const hasQuestionnaireData = !!(payload.answers || payload.quizId || payload.quiz_id || payload.questionnaire || payload.questions);
    const hasOrderData = !!(payload.order || payload.orderId || payload.order_id || payload.line_items || payload.lineItems);
    
    // Log the request for debugging
    console.log(`🔔 [REVENUEHUNT] Webhook received - Has questionnaire data: ${hasQuestionnaireData}, Has order data: ${hasOrderData}`);
    console.log(`📥 [REVENUEHUNT] Request body keys: ${Object.keys(payload).join(', ')}`);
    
    // If this looks like an order/appointment booking, reject it
    if (hasOrderData && !hasQuestionnaireData) {
      console.warn(`⚠️ [REVENUEHUNT] Rejecting request - appears to be an order/appointment booking, not a questionnaire`);
      console.warn(`⚠️ [REVENUEHUNT] This webhook is for RevenueHunt questionnaires only. Appointment bookings should use /webhooks/shopify/orders/created`);
      return res.status(400).json({
        success: false,
        message: 'This webhook is for RevenueHunt questionnaire submissions only. Appointment bookings should be handled via Shopify Order Created webhook.',
        receivedData: {
          hasOrderData,
          hasQuestionnaireData,
          payloadKeys: Object.keys(payload)
        }
      });
    }
    
    // If no questionnaire data, also reject (might be a misconfigured webhook)
    if (!hasQuestionnaireData) {
      console.warn(`⚠️ [REVENUEHUNT] Rejecting request - no questionnaire data found`);
      return res.status(400).json({
        success: false,
        message: 'Invalid RevenueHunt webhook request. Missing questionnaire data (answers, quizId, etc.).',
        receivedData: {
          hasOrderData,
          hasQuestionnaireData,
          payloadKeys: Object.keys(payload)
        }
      });
    }

    // 1) Determine state and provider mapping
    const state = (determineState(payload) || '').toUpperCase();
    
    // Log state determination for debugging
    if (!state) {
      console.warn('⚠️ [REVENUEHUNT] State not found in payload:', {
        hasState: !!payload.state,
        hasShippingState: !!payload.shippingState,
        hasBillingState: !!payload.billingState,
        hasAddress: !!payload.address,
        hasShippingAddress: !!payload.shipping_address,
        hasBillingAddress: !!payload.billing_address,
        payloadKeys: Object.keys(payload)
      });
    }
    
    const mapping = providerMapping[state] || {};
    if (!mapping.practiceId) {
      console.error('❌ [REVENUEHUNT] Unsupported or unmapped state:', state, 'Available states:', Object.keys(providerMapping));
      return res.status(400).json({ 
        success: false, 
        message: `Unsupported or unmapped state: ${state || 'undefined'}. Please provide state in payload (state, shippingState, billingState, or address.state). Available states: ${Object.keys(providerMapping).join(', ')}` 
      });
    }

    // 2) Get customer ID, product ID, and purchase type if available
    const customerId = payload.customerId || payload.shopifyCustomerId || null;
    const productId = payload.productId || payload.product_id || null;
    const purchaseType = payload.purchaseType || payload.purchase_type || 'subscription'; // Default to subscription
    const email = payload.email;

    // 3) Create or update patient in Tebra
    const patientPayload = buildPatientPayload(payload, mapping);

    // Try to find existing patient by email or customer mapping
    let patientId;
    try {
      // First check customer-patient mapping
      if (customerId || email) {
        const mapping = await customerPatientMapService.getByShopifyIdOrEmail(customerId, email);
        if (mapping && mapping.tebra_patient_id) {
          patientId = mapping.tebra_patient_id;
        }
      }

      // If not found in mapping, search Tebra by email
      if (!patientId && email) {
        try {
          const existing = await tebraService.getPatients({
            PracticeName: mapping.practiceName,
          });
          const match = (existing.patients || []).find(p => 
            p.email && patientPayload.email && 
            p.email.toLowerCase() === patientPayload.email.toLowerCase()
          );
          if (match) patientId = match.id;
        } catch (searchErr) {
          console.warn('Patient search error:', searchErr?.message);
        }
      }
    } catch (mappingErr) {
      console.warn('Customer-patient mapping lookup error:', mappingErr?.message);
    }

    // Create new patient if not found
    if (!patientId) {
      const created = await tebraService.createPatient(patientPayload);
      patientId = created.id || created.PatientID || created.patientId;
      console.log(`✅ [REVENUEHUNT] Created new patient in Tebra: ${patientId}`);
    } else {
      await tebraService.updatePatient(patientId, { 
        EmailAddress: patientPayload.email, 
        MobilePhone: patientPayload.mobilePhone 
      });
      console.log(`✅ [REVENUEHUNT] Updated existing patient in Tebra: ${patientId}`);
    }

    // Store customer-patient mapping
    if (customerId || email) {
      try {
        await customerPatientMapService.upsert(customerId, email, patientId);
        console.log(`✅ [REVENUEHUNT] Stored customer-patient mapping: ${customerId || email} -> ${patientId}`);
      } catch (mapErr) {
        console.warn('Failed to store customer-patient mapping:', mapErr?.message);
      }
    }

    // 4) Store questionnaire as a consultation document in Tebra patient chart
    const questionnaireDoc = await createQuestionnaireDocument(patientId, mapping, payload);
    console.log(`✅ [REVENUEHUNT] Stored questionnaire as document in patient chart: ${questionnaireDoc?.id || 'Created'}`);

    // 5) Build patient chart URL (for frontend redirect)
    const patientChartUrl = `/pages/my-chart?customer=${customerId || email}`;

    // 6) Branch by red flags
    const red = hasRedFlags(payload);

    // Keep Shopify customer metafields in sync (signed-in flow).
    // The storefront posts to /webhooks/revenue-hunt (not /api/tebra-questionnaire/submit),
    // so without this, paid-order processing may fail validation because questionnaire_status is missing.
    if (customerId) {
      try {
        const today = new Date().toISOString().split('T')[0];
        const metafields = {
          questionnaire_status: red ? 'requires_consultation' : 'completed',
          tebra_patient_id: String(patientId),
          last_questionnaire_date: today,
        };
        if (state) {
          metafields.state = state;
        }
        await shopifyUserService.updateCustomerMetafields(customerId, metafields);
        console.log(`✅ [REVENUEHUNT] Updated Shopify customer metafields for customer ${customerId}`);
      } catch (e) {
        console.warn('⚠️ [REVENUEHUNT] Failed to update Shopify customer metafields (non-critical):', e?.message || e);
      }
    }
    
    if (!red) {
      // No red flags: create prescription and allow purchase
      let prescriptionResult = null;
      const treatment = payload.treatment || payload.prescription || payload.recommendation || null;
      
      if (treatment) {
        try {
          // Create prescription document in Tebra
          const rxDocData = {
            name: 'Prescription',
            fileName: `prescription-${patientId}-${Date.now()}.json`,
            documentDate: new Date().toISOString(),
            status: 'Completed',
            label: 'Prescription',
            notes: treatment.summary || treatment.title || 'Prescription from questionnaire',
            patientId,
            practiceId: mapping.practiceId,
            fileContent: Buffer.from(JSON.stringify(treatment)).toString('base64'),
          };
          await tebraService.createDocument(rxDocData);
          console.log(`✅ [REVENUEHUNT] Created prescription document in patient chart`);

          // Submit prescription to pharmacy via eRx
          prescriptionResult = await pharmacyService.submitPrescription({
            patientId,
            practiceId: mapping.practiceId,
            treatment,
            providerId: mapping.defaultProviderId,
            pharmacy: payload.pharmacy || null
          });
          
          if (prescriptionResult.success) {
            console.log(`✅ [REVENUEHUNT] Prescription submitted to pharmacy: ${prescriptionResult.rxId}`);
          } else {
            console.warn(`⚠️ [REVENUEHUNT] Prescription submission failed: ${prescriptionResult.error}`);
          }
        } catch (rxErr) {
          console.error('Error creating/submitting prescription:', rxErr?.message || rxErr);
          // Continue even if prescription fails
        }
      }

      // Return success with purchase approval and chart URL
      // According to workflow: proceed_to_checkout (not allow_purchase)
      return res.json({ 
        success: true, 
        action: 'proceed_to_checkout', 
        patientId,
        patientChartUrl,
        prescriptionId: prescriptionResult?.rxId || prescriptionResult?.prescriptionId || null,
        prescription: prescriptionResult,
        purchaseType: purchaseType, // Include purchase type for frontend
        productId: productId, // Include product ID for frontend
        message: 'Questionnaire approved. Prescription created. You can proceed to checkout.'
      });
    }

    // Red flags detected: notify doctor, route to Qualiphy if enabled, and prepare scheduling
    console.log(`⚠️ [REVENUEHUNT] Red flags detected for patient ${patientId}`);
    
    // Notify doctor
    await notifyDoctor(mapping, payload, patientId);

    // Route to Qualiphy if enabled
    let qualiphyResult = null;
    if (qualiphyService.isEnabled()) {
      try {
        qualiphyResult = await qualiphyService.createConsultationRequest({
          patientId,
          patientInfo: {
            firstName: patientPayload.firstName,
            lastName: patientPayload.lastName,
            email: patientPayload.email,
            phone: patientPayload.mobilePhone
          },
          reason: `Red flags detected in questionnaire: ${JSON.stringify(payload.redFlags || payload.flags)}`,
          urgency: 'normal'
        });

        if (qualiphyResult.success) {
          console.log(`✅ [REVENUEHUNT] Routed to Qualiphy: ${qualiphyResult.consultationId}`);
        }
      } catch (qualiphyErr) {
        console.error('Error routing to Qualiphy:', qualiphyErr?.message || qualiphyErr);
      }
    }

    // Get available slots for Cowlendar/Tebra
    const availableSlots = await getAvailableSlots(mapping, {
      fromDate: new Date().toISOString().split('T')[0],
      toDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // Next 2 weeks
    });

    // Return scheduling info
    return res.json({ 
      success: true, 
      action: 'schedule_consultation', 
      patientId,
      patientChartUrl,
      providerId: mapping.defaultProviderId, 
      practiceId: mapping.practiceId,
      purchaseType: purchaseType, // Include purchase type for frontend
      productId: productId, // Include product ID for frontend
      availableSlots: availableSlots.map(slot => ({
        id: slot.id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        date: slot.startDate,
        provider: slot.provider,
        serviceLocation: slot.serviceLocation
      })),
      qualiphy: qualiphyResult,
      message: 'Consultation required. Please schedule an appointment with our medical director.'
    });
  } catch (error) {
    console.error('RevenueHunt webhook error', error);
    return res.status(500).json({ success: false, message: 'Internal error', error: error.message });
  }
};

// New endpoint for creating appointments with Google Meet
exports.createTelemedicineAppointment = async (req, res) => {
  try {
    const { patientId, scheduledTime, state } = req.body;
    
    if (!patientId || !scheduledTime || !state) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: patientId, scheduledTime, state' 
      });
    }

    const mapping = providerMapping[state.toUpperCase()];
    if (!mapping) {
      return res.status(400).json({ 
        success: false, 
        message: `Unsupported state: ${state}` 
      });
    }

    const result = await createTelemedicineAppointment(patientId, mapping, new Date(scheduledTime));
    
    return res.json({
      success: true,
      appointment: result.appointment,
      meetingDetails: result.meetingDetails,
      message: 'Telemedicine appointment created successfully'
    });
  } catch (error) {
    console.error('Create telemedicine appointment error', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal error', 
      error: error.message 
    });
  }
};



