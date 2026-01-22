// backend/src/routes/shopify.js
// Shopify integration routes for checkout validation and product filtering

const express = require('express');
const router = express.Router();
const { auth, optionalAuth } = require('../middleware/shopifyTokenAuth');
const productUtils = require('../utils/productUtils');
const shopifyUserService = require('../services/shopifyUserService');
const tebraService = require('../services/tebraService');
const questionnaireCompletionService = require('../services/questionnaireCompletionService');
const axios = require('axios');

// Shopify Admin API configuration
const SHOPIFY_CONFIG = {
  shopDomain: process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN,
  accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
  apiVersion: process.env.SHOPIFY_API_VERSION || '2024-01'
};

// Helper to make Shopify Admin API requests
async function makeShopifyAdminRequest(endpoint, method = 'GET', data = null) {
  try {
    const url = `https://${SHOPIFY_CONFIG.shopDomain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/${endpoint}`;
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
    console.error('Shopify Admin API error:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * POST /api/shopify/checkout/validate
 * Validates checkout before allowing purchase
 * - Checks if customer has completed questionnaire for products that require it
 * - Checks state restrictions (e.g., Ketamine not available in CA)
 */
router.post('/checkout/validate', auth, async (req, res) => {
  try {
    const { lineItems, shippingAddress } = req.body;
    const customerId = req.user?.shopifyCustomerId || req.user?.id || req.user?.customerId;
    const state = shippingAddress?.province_code || shippingAddress?.province || shippingAddress?.state;
    
    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'lineItems array is required'
      });
    }
    
    // Fetch customer metafields once
    let customerMetafields = {};
    if (customerId) {
      try {
        customerMetafields = await shopifyUserService.getCustomerMetafields(customerId);
      } catch (e) {
        console.warn('[CHECKOUT VALIDATION] Failed to fetch customer metafields:', e?.message || e);
      }
    }
    
    const questionnaireStatus = customerMetafields?.questionnaire_status?.value || 
                                customerMetafields?.questionnaire_status ||
                                customerMetafields?.questionnaireStatus;

    const normalizeBool = (value) => {
      if (value === true) return true;
      if (value === false) return false;
      const v = String(value ?? '').trim().toLowerCase();
      if (!v) return false;
      return v === 'true' || v === '1' || v === 'yes' || v === 'y';
    };

    const getPropValue = (props, keyCandidates) => {
      if (!props) return null;
      const candidates = Array.isArray(keyCandidates) ? keyCandidates : [keyCandidates];

      // Common shapes:
      // - Shopify order webhooks: [{ name, value }, ...]
      // - Cart/ajax contexts: { key: value, ... }
      if (Array.isArray(props)) {
        for (const k of candidates) {
          const match = props.find(p => String(p?.name || '').toLowerCase() === String(k).toLowerCase());
          if (match && match.value !== undefined) return match.value;
        }
        return null;
      }

      if (typeof props === 'object') {
        for (const k of candidates) {
          if (Object.prototype.hasOwnProperty.call(props, k)) return props[k];
          const foundKey = Object.keys(props).find(pk => pk.toLowerCase() === String(k).toLowerCase());
          if (foundKey) return props[foundKey];
        }
      }
      return null;
    };

    const requestHasQuestionnaireProof = (lineItems || []).some((item) => {
      const props = item?.properties || item?.line_item_properties || null;
      const v = getPropValue(props, ['_questionnaire_completed', 'questionnaire_completed', 'questionnaireCompleted']);
      return normalizeBool(v);
    });
    
    // Validate each line item
    for (const item of lineItems) {
      const productId = item.product_id || item.productId;
      const variantId = item.variant_id || item.variantId;
      
      if (!productId) {
        console.warn('[CHECKOUT VALIDATION] Line item missing product_id:', item);
        continue;
      }
      
      // Fetch product details from Shopify (with tags and metafields)
      let product = null;
      try {
        const productData = await makeShopifyAdminRequest(`products/${productId}.json`);
        product = productData.product;
        
        // Fetch product metafields
        try {
          const metafieldsData = await makeShopifyAdminRequest(`products/${productId}/metafields.json`);
          if (metafieldsData.metafields) {
            product.metafields = metafieldsData.metafields;
          }
        } catch (e) {
          console.warn(`[CHECKOUT VALIDATION] Failed to fetch metafields for product ${productId}:`, e?.message || e);
        }
      } catch (e) {
        console.error(`[CHECKOUT VALIDATION] Failed to fetch product ${productId}:`, e?.message || e);
        // Continue validation with available data
        product = {
          id: productId,
          title: item.title || item.name || 'Unknown Product',
          tags: item.tags || ''
        };
      }
      
      // Check state restrictions
      if (state && productUtils.isRestrictedInState(product, state)) {
        return res.status(400).json({
          error: 'PRODUCT_RESTRICTED',
          message: `${product.title || 'This product'} is not available in ${state}`,
          productId: product.id,
          productTitle: product.title,
          restrictedState: state
        });
      }
      
      // Check if questionnaire required
      if (productUtils.requiresQuestionnaire(product)) {
        // Get email from shipping address or customer
        const email = shippingAddress?.email || 
                      req.body.email || 
                      (customerId ? (await shopifyUserService.getCustomer(customerId).catch(() => null))?.email : null) ||
                      getPropValue(item?.properties || item?.line_item_properties, ['Email', 'email']);
        
        // Server-side validation using questionnaire completion registry
        let isValidCompletion = false;
        if (email) {
          try {
            isValidCompletion = await questionnaireCompletionService.validateForCheckout({
              email: email,
              customerId: customerId || null,
              productId: productId
            });
          } catch (validationErr) {
            console.warn(`[CHECKOUT VALIDATION] Questionnaire validation error for product ${productId}:`, validationErr?.message || validationErr);
            // Fall back to legacy validation if registry check fails
          }
        }
        
        // Legacy validation (for backward compatibility)
        const props = item?.properties || item?.line_item_properties || null;
        const itemHasProof = normalizeBool(getPropValue(props, ['_questionnaire_completed', 'questionnaire_completed', 'questionnaireCompleted']));
        const legacyValid = questionnaireStatus === 'completed' || requestHasQuestionnaireProof || itemHasProof;
        
        // Require either server-side validation OR legacy proof
        if (!isValidCompletion && !legacyValid) {
          return res.status(400).json({
            error: 'QUESTIONNAIRE_REQUIRED',
            message: 'Please complete the medical questionnaire before purchasing this product',
            productId: product.id,
            productTitle: product.title || item.title
          });
        }
      }
    }
    
    res.json({ 
      valid: true,
      message: 'Checkout validation passed'
    });
  } catch (error) {
    console.error('[CHECKOUT VALIDATION] Error:', error);
    res.status(500).json({ 
      error: 'VALIDATION_FAILED', 
      message: error.message || 'Checkout validation failed'
    });
  }
});

/**
 * GET /api/shopify/products
 * Returns products filtered by state restrictions
 * Optional query params: state (customer's state code)
 */
router.get('/products', auth, async (req, res) => {
  try {
    const state = req.query.state || req.user?.state;
    
    // Fetch all products from Shopify
    let products = [];
    try {
      const response = await makeShopifyAdminRequest('products.json?limit=250');
      products = response.products || [];
      
      // Fetch metafields for all products (in batches if needed)
      for (const product of products) {
        try {
          const metafieldsData = await makeShopifyAdminRequest(`products/${product.id}/metafields.json`);
          if (metafieldsData.metafields) {
            product.metafields = metafieldsData.metafields;
          }
        } catch (e) {
          // Non-critical, continue without metafields
          console.warn(`[PRODUCT FILTER] Failed to fetch metafields for product ${product.id}:`, e?.message || e);
        }
      }
    } catch (e) {
      console.error('[PRODUCT FILTER] Failed to fetch products:', e?.message || e);
      return res.status(500).json({
        error: 'FETCH_FAILED',
        message: 'Failed to fetch products from Shopify'
      });
    }
    
    // Filter products by state restrictions if state is provided
    if (state) {
      products = products.filter(product => {
        return !productUtils.isRestrictedInState(product, state);
      });
    }
    
    res.json({
      products,
      count: products.length,
      filtered: !!state,
      state: state || null
    });
  } catch (error) {
    console.error('[PRODUCT FILTER] Error:', error);
    res.status(500).json({ 
      error: 'FETCH_FAILED', 
      message: error.message || 'Failed to fetch products'
    });
  }
});

/**
 * GET /api/shopify/products/:productId
 * Get single product with validation info
 */
router.get('/products/:productId', auth, async (req, res) => {
  try {
    const { productId } = req.params;
    const state = req.query.state || req.user?.state;
    
    // Fetch product from Shopify
    let product = null;
    try {
      const productData = await makeShopifyAdminRequest(`products/${productId}.json`);
      product = productData.product;
      
      // Fetch product metafields
      try {
        const metafieldsData = await makeShopifyAdminRequest(`products/${productId}/metafields.json`);
        if (metafieldsData.metafields) {
          product.metafields = metafieldsData.metafields;
        }
      } catch (e) {
        console.warn(`[PRODUCT GET] Failed to fetch metafields:`, e?.message || e);
      }
    } catch (e) {
      if (e.response?.status === 404) {
        return res.status(404).json({
          error: 'PRODUCT_NOT_FOUND',
          message: 'Product not found'
        });
      }
      throw e;
    }
    
    // Add validation info
    const validationInfo = {
      requiresQuestionnaire: productUtils.requiresQuestionnaire(product),
      isSubscription: productUtils.isSubscriptionProduct(product),
      isRestrictedInState: state ? productUtils.isRestrictedInState(product, state) : false,
      restrictedStates: productUtils.parseStateRestrictions(
        product.metafields?.find(m => m.namespace === 'sxrx' && m.key === 'state_restrictions')?.value
      ),
      subscriptionType: productUtils.getSubscriptionType(product)
    };
    
    res.json({
      product,
      validation: validationInfo
    });
  } catch (error) {
    console.error('[PRODUCT GET] Error:', error);
    res.status(500).json({ 
      error: 'FETCH_FAILED', 
      message: error.message || 'Failed to fetch product'
    });
  }
});

/**
 * GET /api/shopify/customers/:customerId/chart
 * Get patient medical chart (patient info, questionnaire, documents, prescriptions, appointments) from Tebra
 * Note: Auth is optional - if no token provided, we'll still try to fetch data (for customer account pages)
 */
const { cacheStrategies } = require('../middleware/cacheHeaders');

router.get('/customers/:customerId/chart', optionalAuth, cacheStrategies.private(300), async (req, res) => {
  try {
    const { customerId } = req.params;
    console.log(`📋 [CHART] Request for customer ${customerId}`, {
      hasAuth: !!req.user,
      authType: req.user?.authType || 'none',
      customerIdFromAuth: req.user?.shopifyCustomerId || req.user?.id || null
    });
    
    // Check cache for chart data
    const cacheService = require('../services/cacheService');
    const cacheKey = cacheService.generateKey('chart', { customerId });
    const cachedChart = await cacheService.get(cacheKey);
    if (cachedChart) {
      console.log(`✅ [CHART] Returning cached chart data for customer ${customerId}`);
      return res.json(cachedChart);
    }
    
    const customerPatientMapService = require('../services/customerPatientMapService');
    
    // Get customer email for lookup
    let customerEmail = null;
    try {
      const customer = await shopifyUserService.getCustomer(customerId);
      customerEmail = customer?.email;
    } catch (e) {
      console.warn('[CHART] Failed to fetch customer:', e?.message || e);
    }
    
    // Get Tebra patient ID from customer-patient mapping
    let tebraPatientId = null;
    try {
      const mapping = await customerPatientMapService.getByShopifyIdOrEmail(customerId, customerEmail);
      if (mapping && mapping.tebra_patient_id) {
        tebraPatientId = mapping.tebra_patient_id;
      }
    } catch (e) {
      console.warn('[CHART] Failed to fetch customer-patient mapping:', e?.message || e);
    }
    
    // Fallback: try customer metafields
    if (!tebraPatientId) {
      try {
        const metafields = await shopifyUserService.getCustomerMetafields(customerId);
        tebraPatientId = metafields?.tebra_patient_id?.value || 
                        metafields?.tebra_patient_id ||
                        metafields?.tebraPatientId;
      } catch (e) {
        console.warn('[CHART] Failed to fetch customer metafields:', e?.message || e);
      }
    }
    
    if (!tebraPatientId) {
      return res.status(404).json({
        error: 'PATIENT_NOT_FOUND',
        message: 'Patient record not found. Please complete a questionnaire first.'
      });
    }
    
    // Fetch patient information from Tebra
    let patient = null;
    try {
      const patientResponse = await tebraService.getPatient(tebraPatientId);
      patient = patientResponse.patient || patientResponse.Patient || patientResponse;
    } catch (e) {
      console.warn('[CHART] Failed to fetch patient info:', e?.message || e);
    }
    
    // Fetch documents from Tebra
    let documents = [];
    try {
      const docsResponse = await tebraService.getDocuments({ patientId: tebraPatientId });
      documents = docsResponse.documents || docsResponse.Documents || [];
    } catch (e) {
      console.warn('[CHART] Failed to fetch documents:', e?.message || e);
    }
    
    // Find questionnaire document
    const questionnaireDoc = documents.find(doc => 
      doc.label === 'Consultation' || 
      doc.name?.toLowerCase().includes('questionnaire') ||
      doc.name === 'Online Questionnaire'
    );
    
    // Parse questionnaire data if available
    let questionnaire = null;
    if (questionnaireDoc && questionnaireDoc.fileContent) {
      try {
        const questionnaireData = JSON.parse(Buffer.from(questionnaireDoc.fileContent, 'base64').toString());
        questionnaire = {
          submittedAt: questionnaireDoc.documentDate || questionnaireDoc.createdAt,
          summary: questionnaireData.summary || questionnaireDoc.notes,
          evaluation: questionnaireData.evaluation || null,
          ...questionnaireData
        };
      } catch (e) {
        console.warn('[CHART] Failed to parse questionnaire data:', e?.message || e);
      }
    }
    
    // Fetch prescriptions (filter documents by label/type)
    const prescriptions = documents.filter(doc => 
      doc.label === 'Prescription' || 
      doc.name?.toLowerCase().includes('prescription') ||
      doc.type === 'Prescription'
    ).map(rx => ({
      name: rx.name,
      date: rx.documentDate || rx.createdAt,
      status: rx.status || 'Active',
      notes: rx.notes,
      pharmacy: rx.pharmacy || null
    }));
    
    // Filter out prescriptions and questionnaire from documents list
    const otherDocuments = documents.filter(doc => 
      doc.label !== 'Prescription' && 
      doc.label !== 'Consultation' &&
      !doc.name?.toLowerCase().includes('prescription') &&
      !doc.name?.toLowerCase().includes('questionnaire') &&
      doc.type !== 'Prescription'
    );
    
    // Fetch appointments
    let appointments = [];
    try {
      const appointmentsResponse = await tebraService.getAppointments({ patientId: tebraPatientId });
      appointments = (appointmentsResponse.appointments || appointmentsResponse.Appointments || []).map(apt => ({
        id: apt.id || apt.ID,
        appointmentName: apt.appointmentName || apt.AppointmentName,
        // Prefer full datetime when available (Tebra GetAppointment returns UTC datetime)
        startTime: apt.startDateTime || apt.StartTime || apt.startTime,
        endTime: apt.endDateTime || apt.EndTime || apt.endTime,
        // Also provide date parts if caller wants them
        startDate: apt.startDate || null,
        endDate: apt.endDate || null,
        status: apt.appointmentStatus || apt.AppointmentStatus || apt.status,
        appointmentType: apt.appointmentType || apt.AppointmentType,
        // Meeting link is returned only when Tebra provides an explicit meeting link field
        meetingLink: apt.meetingLink || apt.MeetingLink || null
      }));
    } catch (e) {
      console.warn('[CHART] Failed to fetch appointments:', e?.message || e);
    }
    
    const chartData = {
      patientId: tebraPatientId,
      patient: patient ? {
        firstName: patient.firstName || patient.FirstName,
        lastName: patient.lastName || patient.LastName,
        email: patient.email || patient.Email || patient.EmailAddress,
        dateOfBirth: patient.dateOfBirth || patient.DateOfBirth,
        mobilePhone: patient.mobilePhone || patient.MobilePhone,
        gender: patient.gender || patient.Gender
      } : null,
      questionnaire: questionnaire,
      documents: otherDocuments,
      prescriptions: prescriptions,
      appointments: appointments,
      totalDocuments: documents.length,
      totalPrescriptions: prescriptions.length,
      totalAppointments: appointments.length
    };
    
    // Cache chart data for 5 minutes (300 seconds)
    await cacheService.set(cacheKey, chartData, 300);
    
    res.json(chartData);
  } catch (error) {
    console.error('[CHART] Error:', error);
    res.status(500).json({ 
      error: 'FETCH_FAILED', 
      message: error.message || 'Failed to fetch patient chart'
    });
  }
});

/**
 * GET /api/shopify/customers/:customerId/appointments
 * Get patient appointments from Tebra
 * This is a convenience endpoint that returns just appointments (also available via /chart endpoint)
 * Note: Auth is optional - if no token provided, we'll still try to fetch data (for customer account pages)
 */
router.get('/customers/:customerId/appointments', optionalAuth, async (req, res) => {
  try {
    const { customerId } = req.params;
    console.log(`📅 [APPOINTMENTS] Request for customer ${customerId}`, {
      hasAuth: !!req.user,
      authType: req.user?.authType || 'none',
      customerIdFromAuth: req.user?.shopifyCustomerId || req.user?.id || null
    });
    const customerPatientMapService = require('../services/customerPatientMapService');
    
    // Get customer email for lookup
    let customerEmail = null;
    try {
      const customer = await shopifyUserService.getCustomer(customerId);
      customerEmail = customer?.email;
    } catch (e) {
      console.warn('[APPOINTMENTS] Failed to fetch customer:', e?.message || e);
    }
    
    // Get Tebra patient ID from customer-patient mapping
    let tebraPatientId = null;
    try {
      const mapping = await customerPatientMapService.getByShopifyIdOrEmail(customerId, customerEmail);
      if (mapping && mapping.tebra_patient_id) {
        tebraPatientId = mapping.tebra_patient_id;
      }
    } catch (e) {
      console.warn('[APPOINTMENTS] Failed to fetch customer-patient mapping:', e?.message || e);
    }
    
    // Fallback: try customer metafields
    if (!tebraPatientId) {
      try {
        const metafields = await shopifyUserService.getCustomerMetafields(customerId);
        tebraPatientId = metafields?.tebra_patient_id?.value || 
                        metafields?.tebra_patient_id ||
                        metafields?.tebraPatientId;
      } catch (e) {
        console.warn('[APPOINTMENTS] Failed to fetch customer metafields:', e?.message || e);
      }
    }
    
    if (!tebraPatientId) {
      return res.status(404).json({
        error: 'PATIENT_NOT_FOUND',
        message: 'Patient record not found. Please complete a questionnaire or book an appointment first.'
      });
    }
    
    // Fetch appointments from Tebra
    let appointments = [];
    try {
      const appointmentsResponse = await tebraService.getAppointments({ patientId: tebraPatientId });
      appointments = (appointmentsResponse.appointments || appointmentsResponse.Appointments || []).map(apt => ({
        id: apt.id || apt.ID || apt.AppointmentID || apt.AppointmentId,
        appointmentName: apt.appointmentName || apt.AppointmentName || 'Appointment',
        // Prefer full datetime when available (Tebra GetAppointment returns UTC datetime)
        startTime: apt.startDateTime || apt.StartTime || apt.startTime || apt.StartDate,
        endTime: apt.endDateTime || apt.EndTime || apt.endTime || apt.EndDate,
        startDate: apt.startDate || null,
        endDate: apt.endDate || null,
        status: apt.appointmentStatus || apt.AppointmentStatus || apt.status || 'Scheduled',
        appointmentType: apt.appointmentType || apt.AppointmentType || 'Consultation',
        notes: apt.notes || apt.Notes || null,
        // Meeting link is returned only when Tebra provides an explicit meeting link field
        meetingLink: apt.meetingLink || apt.MeetingLink || null
      }));
    } catch (e) {
      console.warn('[APPOINTMENTS] Failed to fetch appointments:', e?.message || e);
    }
    
    res.json({
      patientId: tebraPatientId,
      appointments: appointments,
      totalCount: appointments.length
    });
  } catch (error) {
    console.error('[APPOINTMENTS] Error:', error);
    res.status(500).json({ 
      error: 'FETCH_FAILED', 
      message: error.message || 'Failed to fetch appointments'
    });
  }
});

/**
 * PUT /api/shopify/customers/:customerId/appointments/:appointmentId/cancel
 * Cancel an appointment (customer-facing endpoint)
 * Note: Auth is optional - if no token provided, we'll still try to process (for customer account pages)
 */
router.put('/customers/:customerId/appointments/:appointmentId/cancel', optionalAuth, async (req, res) => {
  try {
    const { customerId, appointmentId } = req.params;
    console.log(`❌ [APPOINTMENT CANCEL] Request to cancel appointment ${appointmentId} for customer ${customerId}`);
    
    const customerPatientMapService = require('../services/customerPatientMapService');
    const tebraService = require('../services/tebraService');
    
    // Get customer email for lookup
    let customerEmail = null;
    try {
      const customer = await shopifyUserService.getCustomer(customerId);
      customerEmail = customer?.email;
    } catch (e) {
      console.warn('[APPOINTMENT CANCEL] Failed to fetch customer:', e?.message || e);
    }
    
    // Get Tebra patient ID
    let tebraPatientId = null;
    try {
      const mapping = await customerPatientMapService.getByShopifyIdOrEmail(customerId, customerEmail);
      if (mapping && mapping.tebra_patient_id) {
        tebraPatientId = mapping.tebra_patient_id;
      }
    } catch (e) {
      console.warn('[APPOINTMENT CANCEL] Failed to fetch customer-patient mapping:', e?.message || e);
    }
    
    if (!tebraPatientId) {
      return res.status(404).json({
        error: 'PATIENT_NOT_FOUND',
        message: 'Patient record not found.'
      });
    }
    
    // Verify appointment belongs to patient
    let appointment = null;
    try {
      const appointmentResponse = await tebraService.getAppointment(appointmentId);
      appointment = appointmentResponse.appointment || appointmentResponse.Appointment || appointmentResponse;
      
      const appointmentPatientId = appointment.patientId || appointment.PatientId || appointment.patient_id;
      if (String(appointmentPatientId) !== String(tebraPatientId)) {
        return res.status(403).json({
          error: 'UNAUTHORIZED',
          message: 'This appointment does not belong to you.'
        });
      }
    } catch (e) {
      console.error('[APPOINTMENT CANCEL] Failed to fetch appointment:', e?.message || e);
      return res.status(404).json({
        error: 'APPOINTMENT_NOT_FOUND',
        message: 'Appointment not found.'
      });
    }
    
    // Cancel appointment
    try {
      const updateData = {
        appointmentStatus: 'Cancelled',
        notes: (appointment.notes || appointment.Notes || '') + '\n[Cancelled by patient]'
      };
      
      await tebraService.updateAppointment(appointmentId, updateData);
      console.log(`✅ [APPOINTMENT CANCEL] Cancelled appointment ${appointmentId}`);
      
      res.json({
        success: true,
        message: 'Appointment cancelled successfully',
        appointmentId: appointmentId
      });
    } catch (e) {
      console.error('[APPOINTMENT CANCEL] Failed to cancel appointment:', e?.message || e);
      res.status(500).json({
        error: 'CANCEL_FAILED',
        message: 'Failed to cancel appointment. Please try again or contact support.'
      });
    }
  } catch (error) {
    console.error('[APPOINTMENT CANCEL] Error:', error);
    res.status(500).json({ 
      error: 'CANCEL_FAILED', 
      message: error.message || 'Failed to cancel appointment'
    });
  }
});

/**
 * PUT /api/shopify/customers/:customerId/appointments/:appointmentId/update
 * Update an appointment (customer-facing endpoint for rescheduling)
 * Note: Auth is optional - if no token provided, we'll still try to process (for customer account pages)
 */
router.put('/customers/:customerId/appointments/:appointmentId/update', optionalAuth, async (req, res) => {
  try {
    const { customerId, appointmentId } = req.params;
    const { startTime, endTime, notes } = req.body;
    
    console.log(`✏️ [APPOINTMENT UPDATE] Request to update appointment ${appointmentId} for customer ${customerId}`);
    
    if (!startTime) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'startTime is required'
      });
    }
    
    const customerPatientMapService = require('../services/customerPatientMapService');
    const tebraService = require('../services/tebraService');
    
    // Get customer email for lookup
    let customerEmail = null;
    try {
      const customer = await shopifyUserService.getCustomer(customerId);
      customerEmail = customer?.email;
    } catch (e) {
      console.warn('[APPOINTMENT UPDATE] Failed to fetch customer:', e?.message || e);
    }
    
    // Get Tebra patient ID
    let tebraPatientId = null;
    try {
      const mapping = await customerPatientMapService.getByShopifyIdOrEmail(customerId, customerEmail);
      if (mapping && mapping.tebra_patient_id) {
        tebraPatientId = mapping.tebra_patient_id;
      }
    } catch (e) {
      console.warn('[APPOINTMENT UPDATE] Failed to fetch customer-patient mapping:', e?.message || e);
    }
    
    if (!tebraPatientId) {
      return res.status(404).json({
        error: 'PATIENT_NOT_FOUND',
        message: 'Patient record not found.'
      });
    }
    
    // Verify appointment belongs to patient
    let appointment = null;
    try {
      const appointmentResponse = await tebraService.getAppointment(appointmentId);
      appointment = appointmentResponse.appointment || appointmentResponse.Appointment || appointmentResponse;
      
      const appointmentPatientId = appointment.patientId || appointment.PatientId || appointment.patient_id;
      if (String(appointmentPatientId) !== String(tebraPatientId)) {
        return res.status(403).json({
          error: 'UNAUTHORIZED',
          message: 'This appointment does not belong to you.'
        });
      }
    } catch (e) {
      console.error('[APPOINTMENT UPDATE] Failed to fetch appointment:', e?.message || e);
      return res.status(404).json({
        error: 'APPOINTMENT_NOT_FOUND',
        message: 'Appointment not found.'
      });
    }
    
    // Update appointment
    try {
      const updateData = {
        startTime: new Date(startTime).toISOString(),
        endTime: endTime ? new Date(endTime).toISOString() : new Date(new Date(startTime).getTime() + 30 * 60000).toISOString(),
        notes: notes || appointment.notes || appointment.Notes || ''
      };
      
      await tebraService.updateAppointment(appointmentId, updateData);
      console.log(`✅ [APPOINTMENT UPDATE] Updated appointment ${appointmentId}`);
      
      res.json({
        success: true,
        message: 'Appointment updated successfully',
        appointmentId: appointmentId
      });
    } catch (e) {
      console.error('[APPOINTMENT UPDATE] Failed to update appointment:', e?.message || e);
      res.status(500).json({
        error: 'UPDATE_FAILED',
        message: 'Failed to update appointment. Please try again or contact support.'
      });
    }
  } catch (error) {
    console.error('[APPOINTMENT UPDATE] Error:', error);
    res.status(500).json({ 
      error: 'UPDATE_FAILED', 
      message: error.message || 'Failed to update appointment'
    });
  }
});

module.exports = router;

