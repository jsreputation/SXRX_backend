// backend/src/controllers/billingController.js
// Enhanced Shopify -> Tebra billing integration handler.
// Listens for Shopify order paid webhooks and creates actual charges and payments in Tebra,
// handles subscriptions, and links orders to patient charts.

const tebraService = require('../services/tebraService');
const tebraBillingService = require('../services/tebraBillingService');
const productUtils = require('../utils/productUtils');
const shopifyUserService = require('../services/shopifyUserService');
const questionnaireCompletionService = require('../services/questionnaireCompletionService');
const customerPatientMapService = require('../services/customerPatientMapService');
const { determineState } = require('../utils/stateUtils');
const {
  extractCustomerIdFromOrder,
  safeTrim,
  parseFullName,
  extractContactFromLineItemProperties,
  extractAppointmentBookingMeta,
  isSubscriptionProduct,
  SHOPIFY_CONFIG,
  makeShopifyAdminRequest,
  getNextBillingDate
} = require('./billingControllerHelpers');

// Import order validation service
const orderValidationService = require('../services/orderValidationService');

/**
 * Validate order before processing
 * - Checks if customer has completed questionnaire for products that require it
 * - Checks state restrictions (e.g., Ketamine not available in CA)
 */
async function validateOrderBeforeProcessing(order, req = null) {
  return await orderValidationService.validateOrderBeforeProcessing(order, req);
}

/**
 * Extract email from order (delegated to service)
 */
async function extractEmailFromOrder(order) {
  return await orderValidationService.extractEmailFromOrder(order);
}

/**
 * Get property value from line item properties (delegated to service)
 */
function getPropValue(props, keyCandidates) {
  return orderValidationService.getPropValue(props, keyCandidates);
}

/**
 * Normalize boolean value (delegated to service)
 */
function normalizeBool(value) {
  return orderValidationService.normalizeBool(value);
}

exports.handleShopifyOrderPaid = async (req, res) => {
  const webhookRetryService = require('../services/webhookRetryService');
  const metricsService = require('../services/metricsService');
  
  try {
    const order = req.body || {};
    const shopifyOrderId = String(order.id || order.order_id || order.name || 'unknown');
    const email = await extractEmailFromOrder(order);
    const shopifyCustomerId = await extractCustomerIdFromOrder(order);
    const practiceId = process.env.TEBRA_PRACTICE_ID || undefined;

    // Validate order before processing (questionnaire and state restrictions)
    try {
      await validateOrderBeforeProcessing(order);
      console.log(`✅ [BILLING] Order ${shopifyOrderId} passed validation`);
    } catch (validationError) {
      console.error(`❌ [BILLING] Order ${shopifyOrderId} validation failed:`, validationError.message);
      // Return success to Shopify (to acknowledge webhook) but log the error
      // The order should have been blocked at checkout, but if it got through, we log it
      return res.json({ 
        success: true, 
        skipped: true, 
        reason: 'validation_failed',
        validationError: validationError.message 
      });
    }

    // Find Tebra patient id via mapping; fallback: try to create if missing
    let tebraPatientId = null;
    try {
      const mapService = require('../services/customerPatientMapService');
      const existing = await mapService.getByShopifyIdOrEmail(shopifyCustomerId, email);
      tebraPatientId = existing?.tebra_patient_id || existing?.tebraPatientId || null;

      if (!tebraPatientId && email) {
        // Best-effort search/create
        try {
          const found = await tebraService.searchPatients({ email });
          const candidates = found?.patients || found?.Patients || [];
          const match = candidates.find(p => (p.Email || p.email || '').toLowerCase() === email.toLowerCase());
          const id = match?.ID || match?.Id || match?.id;
          if (id) tebraPatientId = id;
        } catch {}
      }
    } catch (e) {
      console.warn('Billing webhook: mapping lookup failed:', e?.message || e);
    }

    if (!tebraPatientId) {
      console.warn(`⚠️ [BILLING] No Tebra patient ID found for order ${shopifyOrderId}, email: ${email}`);
      return res.json({ success: true, skipped: true, reason: 'no_patient_id' });
    }

    const lineItems = order.line_items || [];
    const totalAmountCents = Math.round((parseFloat(order.total_price || order.current_total_price || order.total_price_set?.shop_money?.amount || 0)) * 100);
    const dateOfService = order.created_at ? new Date(order.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

    // Create actual charge in Tebra accounting
    let tebraChargeId = null;
    let tebraPaymentId = null;
    if (practiceId && tebraPatientId) {
      try {
        // Map line items to charge items (using generic CPT code 99000 for non-medical items)
        // You may want to customize CPT codes based on product type
        const chargeItems = lineItems.map(li => ({
          cpt: '99000', // Generic CPT code - adjust based on your product mapping
          units: parseInt(li.quantity || 1),
          amountCents: Math.round(parseFloat(li.price || 0) * 100),
        }));

        // Create charge in Tebra
        const chargeResult = await tebraBillingService.createCharge({
          practiceId,
          patientId: tebraPatientId,
          dateOfService,
          placeOfService: '10', // Telehealth
          items: chargeItems,
        });
        tebraChargeId = chargeResult.chargeId;
        console.log(`✅ [BILLING] Created Tebra charge ${tebraChargeId} for order ${shopifyOrderId}`);

        // Post payment to Tebra
        const paymentResult = await tebraBillingService.postPayment({
          practiceId,
          patientId: tebraPatientId,
          amountCents: totalAmountCents,
          referenceNumber: shopifyOrderId,
          date: dateOfService,
        });
        tebraPaymentId = paymentResult.paymentId;
        console.log(`✅ [BILLING] Posted Tebra payment ${tebraPaymentId} for order ${shopifyOrderId}`);
      } catch (e) {
        console.error('❌ [BILLING] Failed to create charge/payment in Tebra:', e?.message || e);
        // Continue to create document as fallback
      }
    }

    // Create billing document in Tebra for reconciliation.
    // If charge+payment were successfully created, this is optional and can be skipped to avoid
    // repeated SOAP CreateDocument faults in some Kareo accounts.
    const alwaysCreateBillingDoc = String(process.env.TEBRA_ALWAYS_CREATE_BILLING_DOCUMENTS || 'false').toLowerCase() === 'true';
    const shouldCreateBillingDoc = alwaysCreateBillingDoc || !tebraChargeId || !tebraPaymentId;
    if (shouldCreateBillingDoc) {
      try {
        const payload = {
          shopifyOrderId,
          shopifyCustomerId,
          total: order.total_price || order.current_total_price || order.total_price_set?.shop_money?.amount,
          currency: order.currency || 'USD',
          lineItems: lineItems.map(li => ({
            title: li.title,
            sku: li.sku,
            productId: li.product_id,
            variantId: li.variant_id,
            price: li.price,
            quantity: li.quantity,
          })),
          tebraChargeId,
          tebraPaymentId,
          dateOfService,
        };
        await tebraService.createDocument({
          name: 'Billing - Shopify Order',
          fileName: `billing-${shopifyOrderId}.json`,
          label: 'Billing',
          patientId: tebraPatientId,
          practiceId,
          documentDate: dateOfService,
          fileContent: Buffer.from(JSON.stringify(payload)).toString('base64'),
          status: 'Completed',
        });
        console.log(`✅ [BILLING] Created billing document for order ${shopifyOrderId}`);
      } catch (e) {
        console.warn('⚠️ [BILLING] Failed to create billing document in Tebra:', e?.message || e);
      }
    } else {
      console.log(`ℹ️ [BILLING] Skipping billing document (charge+payment created) for order ${shopifyOrderId}`);
    }

    // Handle subscriptions - create subscription records for monthly products
    try {
      const subscriptionService = require('../services/subscriptionService');
      
      // Check order metadata/note for purchase type (from questionnaire flow)
      const orderNote = order.note || order.note_attributes?.find(attr => attr.name === 'purchaseType')?.value || '';
      const purchaseType = orderNote.toLowerCase().includes('subscription') ? 'subscription' : 
                          orderNote.toLowerCase().includes('one-time') ? 'one-time' : null;
      
      for (const lineItem of lineItems) {
        // Check if product is subscription via:
        // 1. Order metadata/note (purchaseType from questionnaire)
        // 2. Line item properties (from frontend: "Purchase Type" or "_purchaseType")
        // 3. Product tags
        const productTags = lineItem.properties?.find(p => p.name === 'tags')?.value || 
                           (lineItem.product?.tags || '');
        // Check line item properties for purchase type (frontend uses "Purchase Type" and "_purchaseType")
        const lineItemPurchaseType = lineItem.properties?.find(p => 
          p.name === 'Purchase Type' || 
          p.name === 'purchaseType' || 
          p.name === '_purchaseType'
        )?.value;
        
        // Also check order-level attributes (if purchase type is stored at order level)
        const orderPurchaseType = order.attributes?.find(attr => 
          attr.key === 'Purchase Type' || 
          attr.key === 'purchaseType' || 
          attr.key === '_purchaseType'
        )?.value;
        
        // Normalize purchase type value (check line item, order, or fallback)
        const purchaseTypeValue = lineItemPurchaseType || orderPurchaseType || purchaseType || '';
        const normalizedPurchaseType = purchaseTypeValue.toLowerCase();
        const isSubscriptionValue = normalizedPurchaseType.includes('subscription') || 
                                   normalizedPurchaseType === 'subscription' ||
                                   normalizedPurchaseType === 'monthly' ||
                                   normalizedPurchaseType.includes('monthly');
        
        const isSubscription = isSubscriptionValue || 
                               isSubscriptionProduct({ tags: productTags });
        
        if (isSubscription) {
          await subscriptionService.createSubscription({
            shopifyCustomerId: shopifyCustomerId ? String(shopifyCustomerId) : null,
            shopifyOrderId,
            shopifyProductId: lineItem.product_id ? String(lineItem.product_id) : null,
            shopifyVariantId: lineItem.variant_id ? String(lineItem.variant_id) : null,
            tebraPatientId,
            amountCents: Math.round(parseFloat(lineItem.price || 0) * 100),
            currency: order.currency || 'USD',
            frequency: 'monthly', // Default to monthly
            status: 'active',
            nextBillingDate: getNextBillingDate('monthly'),
          });
          console.log(`✅ [BILLING] Created subscription for product ${lineItem.product_id} (purchase type: ${purchaseType || lineItemPurchaseType || 'from tags'})`);
        } else {
          console.log(`ℹ️ [BILLING] One-time purchase for product ${lineItem.product_id} - no subscription created`);
        }
      }
    } catch (e) {
      console.warn('⚠️ [BILLING] Failed to create subscription records:', e?.message || e);
    }

    // Update Shopify customer metafield for subscription type if applicable
    if (shopifyCustomerId) {
      try {
        const hasSubscription = lineItems.some(li => {
          const productTags = li.properties?.find(p => p.name === 'tags')?.value || '';
          return isSubscriptionProduct({ tags: productTags });
        });
        if (hasSubscription) {
          const shopifyUserService = require('../services/shopifyUserService');
          await shopifyUserService.updateCustomerMetafields(shopifyCustomerId, {
            subscription_type: 'monthly',
          });
        }
      } catch (e) {
        console.warn('⚠️ [BILLING] Failed to update customer subscription metafield:', e?.message || e);
      }
    }

    // Persist encounter linkage
    try {
      const { createOrUpdate } = require('../services/encounterService');
      await createOrUpdate({
        shopifyOrderId,
        tebraPatientId: tebraPatientId || null,
        status: 'order_paid',
        tebraChargeId,
        tebraPaymentId,
      });
    } catch (e) {
      console.warn('⚠️ [BILLING] Encounter persistence (order) failed:', e?.message || e);
    }

    metricsService.recordBusinessMetric('webhook_processed', { type: 'shopify_order_paid', status: 'success' });
    res.json({
      success: true,
      tebraChargeId,
      tebraPaymentId,
      shopifyOrderId,
    });
  } catch (error) {
    console.error('❌ [BILLING] handleShopifyOrderPaid error:', error);
    metricsService.recordBusinessMetric('webhook_processed', { type: 'shopify_order_paid', status: 'error' });
    metricsService.recordError('webhook', 'shopify_order_paid_error');
    
    // Store failed webhook for retry
    try {
      await webhookRetryService.storeFailedWebhook({
        webhookType: 'shopify_order_paid',
        webhookUrl: '/webhooks/shopify/orders/paid',
        payload: req.body,
        headers: req.headers,
        error: error
      });
    } catch (retryError) {
      console.error('[BILLING] Failed to store webhook for retry:', retryError);
    }
    
    // Return 200 to prevent Shopify from retrying immediately
    res.status(200).json({ 
      success: false, 
      message: 'Order processing failed, will retry',
      error: error.message 
    });
  }
};

/**
 * Handle Shopify Order Created webhook
 * 
 * Processes orders that contain appointment booking information.
 * 
 * When an order contains appointment data:
 * 1. Shopify sends Order Created webhook to this endpoint
 * 2. Backend detects if order has appointment properties (appointment_date, start_time, etc.)
 * 3. Backend extracts booking information from order properties/notes
 * 4. Backend creates/updates patient in Tebra
 * 5. Backend creates appointment in Tebra (30 minutes duration)
 * 
 * Appointment data may be included in:
 * - Order line item properties (appointment_date, start_time, etc.)
 * - Order notes (as ISO datetime strings)
 */
exports.handleShopifyOrderCreated = async (req, res) => {
  const webhookRetryService = require('../services/webhookRetryService');
  const metricsService = require('../services/metricsService');
  
  try {
    // Log at the VERY start to catch ALL webhook requests
    console.log(`🔔 [WEBHOOK RECEIVED] Order Created webhook hit - Timestamp: ${new Date().toISOString()}`);
    console.log(`📥 [WEBHOOK RAW] Request body keys: ${Object.keys(req.body || {}).join(', ')}`);
    console.log(`🔧 [CONFIG CHECK] Shopify API configured: ${SHOPIFY_CONFIG.shopDomain ? '✅' : '❌'} Domain, ${SHOPIFY_CONFIG.accessToken ? '✅' : '❌'} Token`);
    
    const order = req.body || {};
    const shopifyOrderId = String(order.id || order.order_id || order.name || 'unknown');
    const email = await extractEmailFromOrder(order);
    const shopifyCustomerId = await extractCustomerIdFromOrder(order);
    
    // Log full order details for debugging
    console.log(`📦 [STEP 3] [ORDER CREATED] Backend received webhook - Processing order ${shopifyOrderId} for customer ${shopifyCustomerId || email || 'unknown'}`);
    console.log(`📋 [ORDER DETAILS] Order Name: ${order.name || 'N/A'}, Note: "${order.note || '(empty)'}", Source: ${order.source_name || 'N/A'}`);
    console.log(`📦 [ORDER DETAILS] Line items: ${(order.line_items || []).length} items`);
    if (order.line_items && order.line_items.length > 0) {
      order.line_items.forEach((item, idx) => {
        console.log(`   Item ${idx + 1}: Product ID: ${item.product_id}, Title: "${item.title || 'N/A'}", SKU: ${item.sku || 'N/A'}`);
        if (item.properties && item.properties.length > 0) {
          console.log(`      Properties: ${item.properties.map(p => `${p.name}=${p.value}`).join(', ')}`);
        }
      });
    }

    // Check if this order contains appointment booking data
    // Appointment orders typically have:
    // 1. Line item properties with appointment data (appointment_date, start_time, etc.)
    // 2. Order notes mentioning "booking" or "appointment"
    // 3. Line item titles/SKUs with appointment-related keywords
    
    const lineItems = order.line_items || [];
    let hasAppointmentProperties = false;
    let appointmentPropertiesFound = [];
    
    // Check line item properties for appointment data
    for (const item of lineItems) {
      const properties = item.properties || [];
      for (const prop of properties) {
        const propName = (prop.name || '').toLowerCase();
        
        // Check for appointment-related properties
        if (propName.includes('appointment') || 
            propName.includes('booking') || 
            propName.includes('start_time') ||
            propName.includes('end_time') ||
            propName.includes('appointment_date') ||
            propName.includes('appointment_time') ||
            propName.includes('scheduled_time') ||
            propName.includes('scheduled_date')) {
          hasAppointmentProperties = true;
          appointmentPropertiesFound.push(`${prop.name}: ${prop.value}`);
        }
      }
    }
    
    // Also check order note for appointment keywords
    const orderNote = (order.note || '').toLowerCase();
    const hasAppointmentInNote = orderNote.includes('appointment') || 
                                 orderNote.includes('booking') ||
                                 orderNote.includes('consultation');
    
    // Determine if this order contains appointment data
    const isAppointmentOrder = hasAppointmentProperties || hasAppointmentInNote;
    
    // If not an appointment order, skip processing (let order paid webhook handle it)
    if (!isAppointmentOrder) {
      console.log(`⚠️ [ORDER CREATED] Order ${shopifyOrderId} does not contain appointment data - skipping`);
      return res.json({ 
        success: true, 
        skipped: true, 
        reason: 'not_appointment_order',
        orderNote: order.note || '',
        lineItemCount: lineItems.length
      });
    }
    
    console.log(`✅ [STEP 3] [ORDER CREATED] Appointment order detected for order ${shopifyOrderId}`);
    if (hasAppointmentProperties) {
      console.log(`   📋 Appointment properties found: ${appointmentPropertiesFound.join(', ')}`);
    }
    if (hasAppointmentInNote) {
      console.log(`   📝 Appointment keywords found in order note`);
    }

    // Determine state from shipping/billing address (using standardized utility with geolocation fallback)
    const shippingAddress = order.shipping_address || null;
    const billingAddress = order.billing_address || null;
    const detectedState = await determineState({ shipping_address: shippingAddress, billing_address: billingAddress }, { order, req });
    const state = detectedState || 'CA'; // Default to CA if not found
    
    console.log(`🌍 [STEP 4] [ORDER CREATED] State detection - Detected: "${detectedState || 'none'}" (normalized: ${state}), Available states: ${Object.keys(require('../config/providerMapping')).join(', ')}`);
    
    const providerMapping = require('../config/providerMapping');
    const mapping = providerMapping[state] || providerMapping['CA'] || {};
    
    if (!mapping.practiceId) {
      console.warn(`⚠️ [ORDER CREATED] Unsupported state: ${state} for order ${shopifyOrderId}`);
      console.warn(`   Available states: ${Object.keys(providerMapping).join(', ')}`);
      console.warn(`   Shipping address: ${JSON.stringify(shippingAddress ? { province_code: shippingAddress.province_code, province: shippingAddress.province, state: shippingAddress.state } : 'N/A')}`);
      console.warn(`   Billing address: ${JSON.stringify(billingAddress ? { province_code: billingAddress.province_code, province: billingAddress.province, state: billingAddress.state } : 'N/A')}`);
      return res.json({ 
        success: true, 
        skipped: true, 
        reason: 'unsupported_state',
        state,
        availableStates: Object.keys(providerMapping)
      });
    }
    
    console.log(`✅ [STEP 4] [ORDER CREATED] State mapping found - State: ${state}, Practice ID: ${mapping.practiceId}, Provider ID: ${mapping.defaultProviderId}`);

    // Get or create patient in Tebra
    const customerPatientMapService = require('../services/customerPatientMapService');
    let tebraPatientId = null;
    
    try {
      if (shopifyCustomerId || email) {
        const existing = await customerPatientMapService.getByShopifyIdOrEmail(shopifyCustomerId, email);
        if (existing && existing.tebra_patient_id) {
          tebraPatientId = existing.tebra_patient_id;
          console.log(`✅ [STEP 4] [ORDER CREATED] Found existing patient in Tebra: Patient ID ${tebraPatientId} for customer ${shopifyCustomerId || email}`);
        }
      }
    } catch (e) {
      console.warn('[ORDER CREATED] Customer-patient mapping lookup failed:', e?.message);
    }

    // Create patient if not found
    // Resolve best-available contact fields for guest + customer orders
    const contactFromProps = extractContactFromLineItemProperties(lineItems);
    const resolvedEmail = email || contactFromProps.email || null;
    const resolvedFirstName =
      safeTrim(shippingAddress?.first_name) ||
      safeTrim(billingAddress?.first_name) ||
      safeTrim(order.customer?.first_name) ||
      safeTrim(contactFromProps.firstName) ||
      parseFullName(order.customer?.name).firstName ||
      'Unknown';
    const resolvedLastName =
      safeTrim(shippingAddress?.last_name) ||
      safeTrim(billingAddress?.last_name) ||
      safeTrim(order.customer?.last_name) ||
      safeTrim(contactFromProps.lastName) ||
      parseFullName(order.customer?.name).lastName ||
      'Unknown';
    const resolvedPhone =
      safeTrim(shippingAddress?.phone) ||
      safeTrim(billingAddress?.phone) ||
      safeTrim(order.customer?.phone) ||
      null;

    console.log('👤 [ORDER CREATED] Resolved contact', {
      email: resolvedEmail,
      firstName: resolvedFirstName,
      lastName: resolvedLastName,
      hasShipping: !!shippingAddress,
      hasBilling: !!billingAddress,
      hasCustomerObj: !!order.customer,
      lineItemPropertyMatches: contactFromProps.matchedKeys
    });

    if (!tebraPatientId && resolvedEmail) {
      try {
        const addressForPatient = shippingAddress || billingAddress || null;
        const patientPayload = {
          firstName: resolvedFirstName,
          lastName: resolvedLastName,
          email: resolvedEmail,
          mobilePhone: resolvedPhone,
          addressLine1: addressForPatient?.address1 || null,
          addressLine2: addressForPatient?.address2 || null,
          city: addressForPatient?.city || null,
          state: state,
          zipCode: addressForPatient?.zip || null,
          country: addressForPatient?.country || 'USA',
          practice: {
            PracticeID: mapping.practiceId,
            PracticeName: mapping.practiceName,
          }
        };
        
        const created = await tebraService.createPatient(patientPayload);
        tebraPatientId = created.id || created.PatientID || created.patientId;
        
        // Store mapping
        if (shopifyCustomerId || resolvedEmail) {
          await customerPatientMapService.upsert(shopifyCustomerId, resolvedEmail, tebraPatientId);
        }
        
        console.log(`✅ [STEP 4] [ORDER CREATED] Created new patient in Tebra: Patient ID ${tebraPatientId}, Email: ${resolvedEmail}, Practice ID: ${mapping.practiceId}`);
      } catch (e) {
        console.error('[ORDER CREATED] Failed to create patient:', e?.message || e);
        // Continue - we'll try to create appointment anyway
      }
    }

    if (!tebraPatientId) {
      console.warn(`⚠️ [ORDER CREATED] No Tebra patient ID for order ${shopifyOrderId}`);
      return res.json({ 
        success: true, 
        skipped: true, 
        reason: 'no_patient_id' 
      });
    }

    // Always upsert mapping when we have a patient id (keeps email/customerId linkage fresh)
    try {
      if (shopifyCustomerId || resolvedEmail) {
        await customerPatientMapService.upsert(shopifyCustomerId, resolvedEmail, tebraPatientId);
        
        // If this is a guest order that now has a customerId (guest created account), link questionnaire completions
        if (shopifyCustomerId && resolvedEmail) {
          try {
            const linkedCount = await questionnaireCompletionService.linkToCustomer(resolvedEmail, shopifyCustomerId);
            if (linkedCount > 0) {
              console.log(`✅ [ORDER CREATED] Linked ${linkedCount} guest questionnaire completion(s) to customer ${shopifyCustomerId}`);
            }
          } catch (linkErr) {
            console.warn('[ORDER CREATED] Failed to link guest questionnaire completions (non-critical):', linkErr?.message || linkErr);
          }
        }
      }
    } catch (e) {
      console.warn('[ORDER CREATED] Failed to upsert customer-patient mapping:', e?.message || e);
    }

    console.log(`📋 [STEP 5] [ORDER CREATED] Starting appointment extraction for order ${shopifyOrderId}, Patient ID: ${tebraPatientId}`);

    // Extract appointment details from order
    // Appointment booking info is stored in:
    // 1. Order line item properties (appointment_date, start_time, booking_time, etc.)
    // 2. Order notes (may contain appointment details as ISO datetime strings)
    let appointmentStartTime = order.created_at ? new Date(order.created_at) : new Date();
    // Always enforce 30-minute appointment duration
    const appointmentDuration = 30; // Always exactly 30 minutes

    const bookingMeta = extractAppointmentBookingMeta(order, lineItems);
    if (bookingMeta.best) {
      const b = bookingMeta.best;
      if (b.startDate && !isNaN(b.startDate.getTime())) {
        appointmentStartTime = b.startDate;
      }
      // appointmentDuration always 30 minutes (enforced above)
      console.log('🕒 [ORDER CREATED] Booking time extraction (best match)', {
        orderId: shopifyOrderId,
        itemTitle: b.itemTitle,
        startISO: appointmentStartTime.toISOString(),
        durationMin: 30, // Always 30 minutes
        source: b.startSource,
        tz: b.tz,
        usedParts: b.usedParts,
        durationRaw: b.durationRaw,
        keysPreview: b.keysPreview,
      });
    } else {
      console.warn('🕒 [ORDER CREATED] Booking time extraction found no candidates; using order.created_at fallback.', {
        orderId: shopifyOrderId,
        createdAt: order.created_at || null,
      });
    }

    // As a final fallback, check order note for an ISO-like datetime
    if (!appointmentStartTime || isNaN(appointmentStartTime.getTime())) {
      appointmentStartTime = order.created_at ? new Date(order.created_at) : new Date();
    }
    if (appointmentStartTime.getTime() === (order.created_at ? new Date(order.created_at).getTime() : appointmentStartTime.getTime())) {
      const noteMatch = order.note?.match(/(?:appointment|booking|scheduled).*?(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?(?:Z|[+\-]\d{2}:?\d{2})?)/i);
      if (noteMatch) {
        const parsed = parseAppointmentDateTime(noteMatch[1], null);
        if (parsed && !isNaN(parsed.getTime())) {
          appointmentStartTime = parsed;
          console.log(`📅 [ORDER CREATED] Extracted appointment time from order note: ${appointmentStartTime.toISOString()}`);
        }
      }
    }

    // Meeting link policy: We only surface a "Join" link if Tebra explicitly returns one on the appointment.
    const meetingLink = null;

    // Create appointment in Tebra
    const appointmentEndTime = new Date(appointmentStartTime.getTime() + appointmentDuration * 60000);
    const appointmentData = {
      appointmentName: lineItems[0]?.title || 'Telemedicine Consultation',
      appointmentStatus: 'Scheduled',
      appointmentType: 'P', // 'P' = Patient (valid Tebra enum value; AppointmentMode='Telehealth' handles telemedicine)
      startTime: appointmentStartTime.toISOString(),
      endTime: appointmentEndTime.toISOString(),
      patientId: tebraPatientId,
      practiceId: mapping.practiceId,
      // Only include providerId if explicitly set - Tebra will use practice default if omitted
      ...(mapping.defaultProviderId && { providerId: mapping.defaultProviderId }),
      // Keep notes link-free. This is an audit trail only.
      notes: `Appointment booking from order ${shopifyOrderId}.`,
      isRecurring: false
    };

    console.log(`📅 [STEP 5] [ORDER CREATED] Creating appointment in Tebra - Start: ${appointmentStartTime.toISOString()}, End: ${appointmentEndTime.toISOString()}, Patient ID: ${tebraPatientId}, Practice ID: ${mapping.practiceId}, Provider ID: ${mapping.defaultProviderId || '(omitted - using practice default)'}`);
    
    let tebraAppointment = null;
    let tebraAppointmentId = null;
    
    try {
      tebraAppointment = await tebraService.createAppointment(appointmentData);
      
      // Log the full response structure for debugging
      console.log(`🔍 [STEP 5] [DEBUG] Full createAppointment response:`, JSON.stringify(tebraAppointment, null, 2));
      
      // Extract appointment ID from various possible response structures
      // Raw SOAP returns: { CreateAppointmentResult: { Appointment: { AppointmentID: ... } } }
      // Normalized returns: { id: ..., appointmentId: ... }
      if (tebraAppointment?.CreateAppointmentResult?.Appointment) {
        const appointment = tebraAppointment.CreateAppointmentResult.Appointment;
        tebraAppointmentId = appointment.AppointmentID || appointment.AppointmentId || appointment.id;
        console.log(`🔍 [STEP 5] Extracted appointment ID from CreateAppointmentResult.Appointment: ${tebraAppointmentId}`);
      } else if (tebraAppointment?.Appointment) {
        const appointment = tebraAppointment.Appointment;
        tebraAppointmentId = appointment.AppointmentID || appointment.AppointmentId || appointment.id;
        console.log(`🔍 [STEP 5] Extracted appointment ID from Appointment: ${tebraAppointmentId}`);
      } else if (tebraAppointment?.CreateAppointmentResult) {
        // Sometimes the appointment is directly in CreateAppointmentResult
        const result = tebraAppointment.CreateAppointmentResult;
        tebraAppointmentId = result.AppointmentID || result.AppointmentId || result.id;
        console.log(`🔍 [STEP 5] Extracted appointment ID from CreateAppointmentResult: ${tebraAppointmentId}`);
      } else {
        tebraAppointmentId = tebraAppointment?.id || tebraAppointment?.ID || tebraAppointment?.appointmentId || tebraAppointment?.AppointmentID;
        console.log(`🔍 [STEP 5] Extracted appointment ID from root: ${tebraAppointmentId}`);
      }
      
      // Log full response for debugging if ID is still missing
      if (!tebraAppointmentId) {
        console.warn(`⚠️ [STEP 5] Could not extract appointment ID from response. Full response keys:`, Object.keys(tebraAppointment || {}));
        console.warn(`⚠️ [STEP 5] Full response structure:`, JSON.stringify(tebraAppointment, null, 2));
      }
      
    } catch (appointmentError) {
      console.error(`❌ [STEP 5] [ORDER CREATED] Failed to create appointment in Tebra:`, appointmentError?.message || appointmentError);
      console.error(`   Error details:`, appointmentError?.response?.data || appointmentError?.stack);
      // Continue - we'll still return success to Shopify to avoid webhook retries
      // The appointment creation can be retried manually if needed
    }
    
    if (tebraAppointmentId) {
      console.log(`✅ [STEP 5] [ORDER CREATED] Created appointment in Tebra: Appointment ID ${tebraAppointmentId}`);
    } else {
      console.warn(`⚠️ [STEP 5] [ORDER CREATED] Appointment creation completed but no Appointment ID returned`);
    }

    // Verify whether Tebra provides an explicit meeting link on the created appointment.
    let tebraMeetingLink = null;
    if (tebraAppointmentId) {
      try {
        const fetched = await tebraService.getAppointment(tebraAppointmentId);
        tebraMeetingLink = fetched?.meetingLink || fetched?.MeetingLink || null;
        console.log(`🔍 [ORDER CREATED] Tebra appointment meeting link ${tebraMeetingLink ? 'present' : 'not present'}`);
      } catch (e) {
        console.warn('[ORDER CREATED] Failed to fetch appointment after create for meeting link verification:', e?.message || e);
      }
    }
    
    console.log(`✅ [STEP 8] [ORDER CREATED] Appointment verification - Order: ${shopifyOrderId}, Tebra Appointment ID: ${tebraAppointmentId || 'N/A'}, Patient ID: ${tebraPatientId}, Tebra Meeting Link: ${tebraMeetingLink || 'None'}`);
    console.log(`📧 [STEP 7] [ORDER CREATED] Sending success response to Shopify webhook`);

    res.json({
      success: true,
      tebraAppointmentId: tebraAppointmentId || null,
      meetingLink: null,
      patientId: tebraPatientId,
      message: tebraAppointmentId ? 'Appointment booking synced to Tebra successfully' : 'Appointment booking processed but appointment ID not available'
    });
  } catch (error) {
    console.error('[ORDER CREATED] Error:', error);
    
    // Store failed webhook for retry
    try {
      await webhookRetryService.storeFailedWebhook({
        webhookType: 'shopify_order_created',
        webhookUrl: '/webhooks/shopify/orders/created',
        payload: req.body,
        headers: req.headers,
        error: error
      });
    } catch (retryError) {
      console.error('[ORDER CREATED] Failed to store webhook for retry:', retryError);
    }
    
    // Return 200 to prevent Shopify from retrying immediately
    // Our retry service will handle retries
    metricsService.recordBusinessMetric('webhook_processed', { type: 'shopify_order_created', status: 'error' });
    metricsService.recordError('webhook', 'shopify_order_created_error');
    res.status(200).json({ 
      success: false, 
      message: 'Order processing failed, will retry',
      error: error.message 
    });
  }
};
