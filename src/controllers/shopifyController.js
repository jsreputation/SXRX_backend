const crypto = require('crypto');
const axios = require('axios');
const tebraService = require('../services/tebraService');
const providerMapping = require('../config/providerMapping');

// Shopify API configuration
const SHOPIFY_CONFIG = {
  apiVersion: '2023-10',
  shopDomain: process.env.SHOPIFY_SHOP_DOMAIN,
  accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
  apiSecretKey: process.env.SHOPIFY_API_SECRET_KEY
};

// Helper function to verify Shopify App Proxy signature
async function verifyProxySignature(req) {
  try {
    const query = new URLSearchParams(req.query);
    const signature = query.get('signature');
    query.delete('signature');
    
    const calculated = crypto
      .createHmac('sha256', SHOPIFY_CONFIG.apiSecretKey)
      .update(query.toString())
      .digest('hex');
    
    return signature === calculated;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

// Helper function to make authenticated Shopify API calls
async function makeShopifyRequest(endpoint, method = 'GET', data = null) {
  try {
    const url = `https://${SHOPIFY_CONFIG.shopDomain}/api/${SHOPIFY_CONFIG.apiVersion}/${endpoint}`;
    const config = {
      method,
      url,
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_CONFIG.accessToken,
        'Content-Type': 'application/json'
      }
    };
    
    if (data) {
      config.data = data;
    }
    
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error('Shopify API error:', error.response?.data || error.message);
    throw error;
  }
}

// Helper function to find customer by email
async function findCustomerByEmail(email) {
  try {
    const response = await makeShopifyRequest(`customers/search.json?query=${encodeURIComponent(email)}`);
    return response.customers && response.customers.length > 0 ? response.customers[0] : null;
  } catch (error) {
    console.error('Error finding customer:', error);
    return null;
  }
}

// Helper function to create or update customer
async function createOrUpdateCustomer(customerData) {
  try {
    // Try to find existing customer
    const existingCustomer = await findCustomerByEmail(customerData.email);
    
    if (existingCustomer) {
      // Update existing customer
      const updatedCustomer = await makeShopifyRequest(
        `customers/${existingCustomer.id}.json`,
        'PUT',
        {
          customer: {
            id: existingCustomer.id,
            first_name: customerData.first_name,
            last_name: customerData.last_name,
            email: customerData.email,
            phone: customerData.phone,
            tags: existingCustomer.tags ? `${existingCustomer.tags}, quiz-consultancy` : 'quiz-consultancy'
          }
        }
      );
      return updatedCustomer.customer;
    } else {
      // Create new customer
      const newCustomer = await makeShopifyRequest(
        'customers.json',
        'POST',
        {
          customer: {
            first_name: customerData.first_name,
            last_name: customerData.last_name,
            email: customerData.email,
            phone: customerData.phone,
            tags: 'quiz-consultancy'
          }
        }
      );
      return newCustomer.customer;
    }
  } catch (error) {
    console.error('Error creating/updating customer:', error);
    throw error;
  }
}

// Helper function to add metafields to customer
async function addCustomerMetafields(customerId, quizResult) {
  try {
    await makeShopifyRequest(
      `customers/${customerId}/metafields.json`,
      'POST',
      {
        metafield: {
          namespace: 'rh',
          key: 'quiz_result',
          value: JSON.stringify(quizResult),
          type: 'json_string'
        }
      }
    );
  } catch (error) {
    console.error('Error adding metafields:', error);
    // Don't throw - this is not critical
  }
}

// Helper function to create draft order
async function createDraftOrder(customerId, appointmentData, quizResult) {
  try {
    const draftOrder = await makeShopifyRequest(
      'draft_orders.json',
      'POST',
      {
        draft_order: {
          line_items: [{
            variant_id: appointmentData.service_variant_id,
            quantity: 1,
            properties: [
              { name: '_quiz_id', value: quizResult.quiz_id.toString() },
              { name: '_email', value: appointmentData.customer.email },
              { name: '_notes', value: appointmentData.notes || 'Consultation booking' }
            ]
          }],
          customer: { id: customerId },
          use_customer_default_address: true,
          note: `Quiz consultancy requested on ${appointmentData.preferred_date || new Date().toISOString().split('T')[0]}`
        }
      }
    );
    return draftOrder.draft_order;
  } catch (error) {
    console.error('Error creating draft order:', error);
    throw error;
  }
}

// Helper function to determine state from customer data
function determineState(customerData) {
  return (
    customerData.state ||
    customerData.shippingState ||
    customerData.billingState ||
    (customerData.address && customerData.address.state) ||
    (customerData.shipping_address && customerData.shipping_address.provinceCode) ||
    (customerData.billing_address && customerData.billing_address.provinceCode) ||
    'CA' // Default to California if no state found
  );
}

// Helper function to build patient payload for Tebra
function buildPatientPayload(customerData, mapping) {
  const name = (customerData.fullName || `${customerData.first_name} ${customerData.last_name}`).trim();
  const [firstName, ...rest] = name.split(' ');
  const lastName = rest.join(' ').trim() || customerData.last_name;
  
  return {
    firstName: customerData.first_name || firstName || 'Unknown',
    lastName: lastName || 'Unknown',
    email: customerData.email,
    mobilePhone: customerData.phone,
    addressLine1: customerData.addressLine1 || customerData.address1,
    addressLine2: customerData.addressLine2 || customerData.address2,
    city: customerData.city,
    state: customerData.state || mapping.state,
    zipCode: customerData.zip || customerData.zipCode,
    country: customerData.country || 'USA',
    practice: {
      PracticeID: mapping.practiceId,
      PracticeName: mapping.practiceName,
    },
  };
}

/**
 * Main controller function for Shopify appointment booking
 * 
 * This endpoint handles appointment booking requests that may come from:
 * - Shopify App Proxy (if configured)
 * - Direct API calls from frontend
 * - Custom integration flows
 * 
 * NOTE: The PRIMARY Cowlendar integration method is through Shopify Order Created webhook
 * (see billingController.handleShopifyOrderCreated). This endpoint is for alternative
 * integration methods or direct booking requests.
 * 
 * Cowlendar can generate Google Meet/Zoom links automatically (Elite plan and above).
 * The backend will use Cowlendar-provided links if available in the appointment data.
 */
exports.handleShopifyAppointment = async (req, res) => {
  try {
    // Verify the request method
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Verify Shopify App Proxy signature (if using App Proxy)
    if (req.query.signature) {
      const isValidSignature = await verifyProxySignature(req);
      if (!isValidSignature) {
        return res.status(403).json({ error: 'Invalid signature' });
      }
    }

    const { customer, quiz_result, appointment } = req.body;

    // Validate required fields
    if (!customer || !customer.email) {
      return res.status(400).json({ 
        error: 'Missing required customer data' 
      });
    }

    if (!appointment || !appointment.service_variant_id) {
      return res.status(400).json({ 
        error: 'Missing required appointment data' 
      });
    }

    // Determine state and provider mapping
    const state = determineState(customer).toUpperCase();
    const mapping = providerMapping[state] || {};
    
    if (!mapping.practiceId) {
      return res.status(400).json({ 
        error: `Unsupported or unmapped state: ${state}` 
      });
    }

    // Create or update customer in Shopify
    const shopifyCustomer = await createOrUpdateCustomer(customer);
    
    // Add metafields to store quiz results
    if (quiz_result) {
      await addCustomerMetafields(shopifyCustomer.id, quiz_result);
    }

    // Create draft order with the Cowlendar product
    const draftOrder = await createDraftOrder(shopifyCustomer.id, appointment, quiz_result);

    // Create or update patient in Tebra (for medical records)
    let patientId = null;
    try {
      const patientPayload = buildPatientPayload(customer, mapping);
      const customerPatientMapService = require('../services/customerPatientMapService');
      const googleMeetService = require('../services/googleMeetService');
      
      // Try to find existing patient by email or customer mapping
      try {
        const mapping = await customerPatientMapService.getByShopifyIdOrEmail(shopifyCustomer.id, customer.email);
        if (mapping && mapping.tebra_patient_id) {
          patientId = mapping.tebra_patient_id;
        }
      } catch (_) {}

      if (!patientId) {
        try {
          const existing = await tebraService.getPatients({
            PracticeName: mapping.practiceName,
          });
          const match = (existing.patients || []).find(p => 
            p.email && patientPayload.email && 
            p.email.toLowerCase() === patientPayload.email.toLowerCase()
          );
          if (match) patientId = match.id;
        } catch (_) {}
      }

      if (!patientId) {
        const created = await tebraService.createPatient(patientPayload);
        patientId = created.id || created.PatientID || created.patientId;
        console.log(`✅ [COWLENDAR] Created new patient in Tebra: ${patientId}`);
      } else {
        await tebraService.updatePatient(patientId, { 
          EmailAddress: patientPayload.email, 
          MobilePhone: patientPayload.mobilePhone 
        });
        console.log(`✅ [COWLENDAR] Updated existing patient in Tebra: ${patientId}`);
      }

      // Store customer-patient mapping
      if (shopifyCustomer.id && customer.email) {
        try {
          await customerPatientMapService.upsert(shopifyCustomer.id, customer.email, patientId);
        } catch (mapErr) {
          console.warn('Failed to store customer-patient mapping:', mapErr?.message);
        }
      }

      // Store quiz results as a document in Tebra
      if (quiz_result) {
        const fileName = `questionnaire-${patientId}-${Date.now()}.json`;
        const documentData = {
          name: 'Online Questionnaire',
          fileName,
          documentDate: new Date().toISOString(),
          status: 'Completed',
          label: 'Consultation',
          notes: 'Submitted via Cowlendar appointment booking',
          patientId,
          practiceId: mapping.practiceId,
          fileContent: Buffer.from(JSON.stringify(quiz_result)).toString('base64'),
        };
        await tebraService.createDocument(documentData);
        console.log(`✅ [COWLENDAR] Stored questionnaire in patient chart`);
      }

      // Create appointment in Tebra with telemedicine link
      if (appointment && appointment.start_time && patientId) {
        try {
          const startTime = new Date(appointment.start_time);
          const endTime = new Date(startTime.getTime() + (appointment.duration || 30) * 60000); // Default 30 min
          
          // Use meeting link from Cowlendar if available (Cowlendar can generate Google Meet/Zoom links)
          const cowlendarMeetingLink = 
            appointment.meeting_link || 
            appointment.meetingLink || 
            appointment.video_url || 
            appointment.videoUrl || 
            appointment.google_meet_link || 
            appointment.googleMeetLink ||
            appointment.zoom_link ||
            appointment.zoomLink ||
            null;

          // Only generate our own link if Cowlendar didn't provide one (and if generation is enabled)
          let meetingLink = cowlendarMeetingLink;
          if (!meetingLink) {
            const meetingDetails = googleMeetService.generateMeetLink({
              patientName: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.email,
              doctorName: 'Medical Director',
              appointmentId: `COWLENDAR-${Date.now()}`,
              scheduledTime: startTime.toISOString()
            });
            meetingLink = meetingDetails ? meetingDetails.meetLink : null;
          }

          const appointmentData = {
            appointmentName: appointment.service_name || 'Telemedicine Consultation',
            appointmentStatus: 'Scheduled',
            appointmentType: 'Telemedicine',
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            patientId,
            practiceId: mapping.practiceId,
            providerId: mapping.defaultProviderId,
            notes: meetingLink ? `Cowlendar appointment. Meeting link: ${meetingLink}` : 'Cowlendar appointment.',
            isRecurring: false
          };

          const tebraAppointment = await tebraService.createAppointment(appointmentData);
          console.log(`✅ [COWLENDAR] Created appointment in Tebra: ${tebraAppointment.id || tebraAppointment.ID}`);

          // Store meeting link for response (if available)
          appointment.tebraAppointmentId = tebraAppointment.id || tebraAppointment.ID;
          if (meetingLink) {
            appointment.meetingLink = meetingLink;
          }
        } catch (apptError) {
          console.error('Error creating Tebra appointment:', apptError?.message || apptError);
          // Continue with response even if appointment creation fails
        }
      }
    } catch (tebraError) {
      console.error('Tebra integration error (non-critical):', tebraError);
      // Continue with Shopify flow even if Tebra fails
    }

    // Return success response with checkout URL
    const response = {
      ok: true,
      calendar_url: `/checkout?draft_order_id=${draftOrder.id}`,
      customer_id: shopifyCustomer.id,
      draft_order_id: draftOrder.id,
      message: 'Appointment booking processed successfully'
    };

    // Add appointment details if available
    if (appointment && appointment.tebraAppointmentId) {
      response.appointment_id = appointment.tebraAppointmentId;
      response.meeting_link = appointment.meetingLink;
    }

    res.status(200).json(response);

  } catch (error) {
    console.error('Shopify appointment booking error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};

// Health check endpoint for Shopify App Proxy
exports.shopifyHealthCheck = async (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    shop: SHOPIFY_CONFIG.shopDomain
  });
};
