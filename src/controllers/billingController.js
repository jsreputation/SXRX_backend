// backend/src/controllers/billingController.js
// Enhanced Shopify -> Tebra billing integration handler.
// Listens for Shopify order paid webhooks and creates actual charges and payments in Tebra,
// handles subscriptions, and links orders to patient charts.

const tebraService = require('../services/tebraService');
const tebraBillingService = require('../services/tebraBillingService');
const productUtils = require('../utils/productUtils');
const shopifyUserService = require('../services/shopifyUserService');
const axios = require('axios');

async function extractEmailFromOrder(body) {
  // Try common locations for customer email
  return (
    body?.email ||
    body?.customer?.email ||
    body?.contact_email ||
    body?.billing_address?.email ||
    null
  );
}

async function extractCustomerIdFromOrder(body) {
  // Try to extract Shopify customer ID
  return (
    body?.customer?.id ||
    body?.customer_id ||
    null
  );
}

// Check if product requires subscription (via tags or metafields)
function isSubscriptionProduct(product) {
  const tags = (product.tags || '').toLowerCase();
  return tags.includes('subscription-monthly') || tags.includes('subscription');
}

// Shopify Admin API configuration
const SHOPIFY_CONFIG = {
  shopDomain: process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN,
  accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
  apiVersion: process.env.SHOPIFY_API_VERSION || '2024-01'
};

// Validate Shopify config on startup
if (!SHOPIFY_CONFIG.shopDomain) {
  console.warn('⚠️ [SHOPIFY CONFIG] SHOPIFY_STORE or SHOPIFY_STORE_DOMAIN is not set');
}
if (!SHOPIFY_CONFIG.accessToken) {
  console.warn('⚠️ [SHOPIFY CONFIG] SHOPIFY_ACCESS_TOKEN is not set - product tag detection will fail');
} else {
  // Log first few and last few chars for verification (don't log full token for security)
  const tokenPreview = SHOPIFY_CONFIG.accessToken.length > 10 
    ? `${SHOPIFY_CONFIG.accessToken.substring(0, 8)}...${SHOPIFY_CONFIG.accessToken.substring(SHOPIFY_CONFIG.accessToken.length - 4)}`
    : 'INVALID';
  console.log(`✅ [SHOPIFY CONFIG] Access token configured: ${tokenPreview} (length: ${SHOPIFY_CONFIG.accessToken.length})`);
  console.log(`✅ [SHOPIFY CONFIG] Shop domain: ${SHOPIFY_CONFIG.shopDomain || 'NOT SET'}`);
}

// Helper to make Shopify Admin API requests
async function makeShopifyAdminRequest(endpoint, method = 'GET', data = null) {
  try {
    // Validate config before making request
    if (!SHOPIFY_CONFIG.shopDomain) {
      throw new Error('SHOPIFY_STORE or SHOPIFY_STORE_DOMAIN is not configured');
    }
    if (!SHOPIFY_CONFIG.accessToken) {
      throw new Error('SHOPIFY_ACCESS_TOKEN is not configured');
    }
    
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
    const errorDetails = {
      status: error.response?.status,
      statusText: error.response?.statusText,
      message: error.response?.data?.errors || error.message,
      url: error.config?.url
    };
    
    if (error.response?.status === 401) {
      console.error('❌ [SHOPIFY API] Authentication failed (401) - Check SHOPIFY_ACCESS_TOKEN in .env file');
      console.error('   Token preview:', SHOPIFY_CONFIG.accessToken ? `${SHOPIFY_CONFIG.accessToken.substring(0, 8)}...${SHOPIFY_CONFIG.accessToken.substring(SHOPIFY_CONFIG.accessToken.length - 4)}` : 'NOT SET');
      console.error('   Shop domain:', SHOPIFY_CONFIG.shopDomain || 'NOT SET');
    } else {
      console.error('❌ [SHOPIFY API] Request failed:', errorDetails);
    }
    throw error;
  }
}

/**
 * Validate order before processing
 * - Checks if customer has completed questionnaire for products that require it
 * - Checks state restrictions (e.g., Ketamine not available in CA)
 */
async function validateOrderBeforeProcessing(order) {
  const lineItems = order.line_items || [];
  const shippingAddress = order.shipping_address || order.billing_address;
  const state = shippingAddress?.province_code || shippingAddress?.province || shippingAddress?.state;
  const customerId = order.customer?.id;
  
  // Fetch customer metafields for questionnaire status
  let customerMetafields = {};
  if (customerId) {
    try {
      customerMetafields = await shopifyUserService.getCustomerMetafields(customerId);
    } catch (e) {
      console.warn('[ORDER VALIDATION] Failed to fetch customer metafields:', e?.message || e);
    }
  }
  
  const questionnaireStatus = customerMetafields?.questionnaire_status?.value || 
                              customerMetafields?.questionnaire_status ||
                              customerMetafields?.questionnaireStatus;
  
  // Validate each line item
  for (const item of lineItems) {
    const productId = item.product_id;
    
    if (!productId) {
      console.warn('[ORDER VALIDATION] Line item missing product_id:', item);
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
        console.warn(`[ORDER VALIDATION] Failed to fetch metafields for product ${productId}:`, e?.message || e);
      }
    } catch (e) {
      console.error(`[ORDER VALIDATION] Failed to fetch product ${productId}:`, e?.message || e);
      // Continue validation with available data from line item
      product = {
        id: productId,
        title: item.title || item.name || 'Unknown Product',
        tags: item.properties?.find(p => p.name === 'tags')?.value || ''
      };
    }
    
    // Check state restrictions
    if (state && productUtils.isRestrictedInState(product, state)) {
      throw new Error(`Product ${product.title || item.title} is not available in ${state}`);
    }
    
    // Check questionnaire requirement
    if (productUtils.requiresQuestionnaire(product)) {
      if (questionnaireStatus !== 'completed') {
        throw new Error(`Questionnaire required for ${product.title || item.title}`);
      }
    }
  }
}

exports.handleShopifyOrderPaid = async (req, res) => {
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

    // Create billing document in Tebra for reconciliation (always create as backup)
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
        fileContent: Buffer.from(JSON.stringify(payload)).toString('base64'),
        status: 'Completed',
      });
      console.log(`✅ [BILLING] Created billing document for order ${shopifyOrderId}`);
    } catch (e) {
      console.warn('⚠️ [BILLING] Failed to create billing document in Tebra:', e?.message || e);
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

    res.json({
      success: true,
      tebraChargeId,
      tebraPaymentId,
      shopifyOrderId,
    });
  } catch (error) {
    console.error('❌ [BILLING] handleShopifyOrderPaid error:', error);
    res.status(500).json({ success: false, message: 'Failed to process order webhook', error: error.message });
  }
};

/**
 * Handle Shopify Order Created webhook
 * 
 * PRIMARY INTEGRATION METHOD for Cowlendar bookings.
 * 
 * IMPORTANT: Cowlendar does NOT have direct webhook configuration in their app settings.
 * Integration works through Shopify Order Created webhook when Cowlendar creates orders.
 * 
 * When Cowlendar creates a booking:
 * 1. Cowlendar may create a Shopify order (if configured to do so)
 * 2. Shopify sends Order Created webhook to this endpoint
 * 3. Backend detects if it's a Cowlendar booking (by product tags or order notes)
 * 4. Backend extracts booking information from order properties/notes
 * 5. Backend creates/updates patient in Tebra
 * 6. Backend creates appointment in Tebra
 * 7. Backend uses Cowlendar-provided meeting link if available (Elite plan)
 *    Otherwise falls back to backend generation (currently disabled)
 * 
 * Cowlendar can generate Google Meet/Zoom links automatically (Elite plan and above).
 * Meeting links may be included in:
 * - Order line item properties (meeting_link, video_url, etc.)
 * - Order notes (as URLs)
 * - Direct webhook payload (if using direct webhook endpoint)
 */
exports.handleShopifyOrderCreated = async (req, res) => {
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

    // Check if this is a Cowlendar booking order
    // Cowlendar orders typically have:
    // 1. Order notes mentioning "Cowlendar" or "booking" or "appointment"
    // 2. Order source name containing "cowlendar"
    // 3. Line item properties with appointment data (appointment_date, start_time, meeting_link, etc.)
    // 4. Product tags containing "cowlendar" or "booking" or "appointment" (requires API call)
    
    const orderNote = (order.note || '').toLowerCase();
    const orderSourceName = (order.source_name || '').toLowerCase();
    
    // Method 1: Check order note
    const isCowlendarOrder = orderNote.includes('cowlendar') || 
                            orderNote.includes('booking') ||
                            orderNote.includes('appointment');
    
    // Method 2: Check order source name
    const hasCowlendarSource = orderSourceName.includes('cowlendar');
    
    // Method 3: Check line item properties for appointment data (NO API CALL NEEDED)
    const lineItems = order.line_items || [];
    let hasAppointmentProperties = false;
    let appointmentPropertiesFound = [];
    
    // Also check line item titles and SKUs for appointment-related keywords
    let hasAppointmentInTitle = false;
    
    for (const item of lineItems) {
      const itemTitle = (item.title || '').toLowerCase();
      const itemSku = (item.sku || '').toLowerCase();
      const itemVendor = (item.vendor || '').toLowerCase();
      
      // Check title, SKU, vendor for appointment keywords
      if (itemTitle.includes('appointment') || 
          itemTitle.includes('booking') || 
          itemTitle.includes('consultation') ||
          itemTitle.includes('cowlendar') ||
          itemSku.includes('appointment') ||
          itemSku.includes('booking') ||
          itemVendor.includes('cowlendar')) {
        hasAppointmentInTitle = true;
        console.log(`   📌 Found appointment keyword in line item: "${item.title}" (SKU: ${item.sku || 'N/A'})`);
      }
      
      const properties = item.properties || [];
      for (const prop of properties) {
        const propName = (prop.name || '').toLowerCase();
        const propValue = (prop.value || '').toLowerCase();
        
        // Check for appointment-related properties
        if (propName.includes('appointment') || 
            propName.includes('booking') || 
            propName.includes('meeting') ||
            propName.includes('start_time') ||
            propName.includes('end_time') ||
            propName.includes('date') ||
            propName.includes('time') ||
            propValue.includes('meet.google.com') ||
            propValue.includes('zoom.us') ||
            propValue.includes('cowlendar') ||
            propValue.includes('appointment') ||
            propValue.includes('booking')) {
          hasAppointmentProperties = true;
          appointmentPropertiesFound.push(`${prop.name}: ${prop.value}`);
        }
      }
    }
    
    // Method 4: Check product tags via API (fallback, may fail due to auth issues)
    let hasCowlendarProduct = false;
    let productTagCheckError = null;
    
    for (const item of lineItems) {
      const productId = item.product_id;
      if (productId) {
        try {
          const productData = await makeShopifyAdminRequest(`products/${productId}.json`);
          const product = productData.product;
          const tags = (product.tags || '').toLowerCase();
          
          if (tags.includes('cowlendar') || tags.includes('booking') || tags.includes('appointment')) {
            hasCowlendarProduct = true;
            break;
          }
        } catch (e) {
          productTagCheckError = e?.message || 'Unknown error';
          console.warn(`[ORDER CREATED] Failed to fetch product ${productId} (API auth may be invalid):`, e?.message);
          // Don't break - continue checking other items
        }
      }
    }
    
    // Log detection results
    console.log(`🔍 [COWLENDAR DETECTION] Order ${shopifyOrderId}:`);
    console.log(`   📝 Order note match: ${isCowlendarOrder} (note: "${order.note || '(empty)'}")`);
    console.log(`   🏪 Source name match: ${hasCowlendarSource} (source: "${order.source_name || '(empty)'}")`);
    console.log(`   📋 Appointment properties: ${hasAppointmentProperties} (found: ${appointmentPropertiesFound.length > 0 ? appointmentPropertiesFound.join(', ') : 'none'})`);
    console.log(`   📌 Appointment in title/SKU: ${hasAppointmentInTitle}`);
    console.log(`   🏷️  Product tag match: ${hasCowlendarProduct}${productTagCheckError ? ` (API error: ${productTagCheckError})` : ''}`);

    // Determine if this is a Cowlendar order using ANY of the detection methods
    const isCowlendarBooking = isCowlendarOrder || hasCowlendarSource || hasAppointmentProperties || hasAppointmentInTitle || hasCowlendarProduct;
    
    // If not a Cowlendar order, skip processing (let order paid webhook handle it)
    if (!isCowlendarBooking) {
      console.log(`⚠️ [ORDER CREATED] Order ${shopifyOrderId} is not a Cowlendar booking - skipping`);
      console.log(`   💡 Tip: If this IS a Cowlendar booking, ensure:`);
      console.log(`      - Order note contains "cowlendar", "booking", or "appointment"`);
      console.log(`      - Order source name contains "cowlendar"`);
      console.log(`      - Line items have properties with appointment data`);
      console.log(`      - Product has "cowlendar", "booking", or "appointment" tag (requires valid Shopify API credentials)`);
      return res.json({ 
        success: true, 
        skipped: true, 
        reason: 'not_cowlendar_order',
        orderNote: order.note || '',
        lineItemCount: lineItems.length,
        productIds: lineItems.map(item => item.product_id).filter(Boolean)
      });
    }

    // Determine which detection method(s) matched
    const detectionMethods = [];
    if (isCowlendarOrder) detectionMethods.push('order_note');
    if (hasCowlendarSource) detectionMethods.push('source_name');
    if (hasAppointmentProperties) detectionMethods.push('appointment_properties');
    if (hasAppointmentInTitle) detectionMethods.push('line_item_title_sku');
    if (hasCowlendarProduct) detectionMethods.push('product_tags');
    
    console.log(`✅ [STEP 3] [ORDER CREATED] Cowlendar booking order detected for order ${shopifyOrderId}`);
    console.log(`   🎯 Detection method(s): ${detectionMethods.join(', ') || 'unknown'}`);

    // Determine state from shipping/billing address
    const shippingAddress = order.shipping_address || order.billing_address;
    const state = (shippingAddress?.province_code || shippingAddress?.province || shippingAddress?.state || 'CA').toUpperCase();
    const providerMapping = require('../config/providerMapping');
    const mapping = providerMapping[state] || providerMapping['CA'] || {};
    
    if (!mapping.practiceId) {
      console.warn(`⚠️ [ORDER CREATED] Unsupported state: ${state} for order ${shopifyOrderId}`);
      return res.json({ 
        success: true, 
        skipped: true, 
        reason: 'unsupported_state',
        state 
      });
    }

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
    if (!tebraPatientId && email) {
      try {
        const patientPayload = {
          firstName: shippingAddress?.first_name || order.customer?.first_name || 'Unknown',
          lastName: shippingAddress?.last_name || order.customer?.last_name || 'Unknown',
          email: email,
          mobilePhone: shippingAddress?.phone || order.customer?.phone || null,
          addressLine1: shippingAddress?.address1 || null,
          addressLine2: shippingAddress?.address2 || null,
          city: shippingAddress?.city || null,
          state: state,
          zipCode: shippingAddress?.zip || null,
          country: shippingAddress?.country || 'USA',
          practice: {
            PracticeID: mapping.practiceId,
            PracticeName: mapping.practiceName,
          }
        };
        
        const created = await tebraService.createPatient(patientPayload);
        tebraPatientId = created.id || created.PatientID || created.patientId;
        
        // Store mapping
        if (shopifyCustomerId || email) {
          await customerPatientMapService.upsert(shopifyCustomerId, email, tebraPatientId);
        }
        
        console.log(`✅ [STEP 4] [ORDER CREATED] Created new patient in Tebra: Patient ID ${tebraPatientId}, Email: ${email}, Practice ID: ${mapping.practiceId}`);
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

    console.log(`📋 [STEP 5] [ORDER CREATED] Starting appointment extraction for order ${shopifyOrderId}, Patient ID: ${tebraPatientId}`);

    // Extract appointment details from order
    // Cowlendar stores booking info in:
    // 1. Order line item properties (appointment_date, start_time, booking_time, duration, etc.)
    // 2. Order notes (may contain appointment details or meeting links)
    // 3. Order metafields (if configured)
    let appointmentStartTime = order.created_at ? new Date(order.created_at) : new Date();
    let appointmentDuration = 30; // Default 30 minutes
    
    // Try to extract appointment time and duration from line item properties
    for (const item of lineItems) {
      const properties = item.properties || [];
      
      // Look for appointment start time in various property names
      const startTimeProp = properties.find(p => {
        const name = (p.name || '').toLowerCase();
        return name === 'appointment_start' || 
               name === 'appointment_date' ||
               name === 'start_time' || 
               name === 'booking_time' ||
               name === 'appointment_time' ||
               name === 'scheduled_time';
      });
      
      if (startTimeProp && startTimeProp.value) {
        try {
          const parsedTime = new Date(startTimeProp.value);
          if (!isNaN(parsedTime.getTime())) {
            appointmentStartTime = parsedTime;
            console.log(`📅 [ORDER CREATED] Extracted appointment time from property: ${appointmentStartTime.toISOString()}`);
          }
        } catch (e) {
          console.warn('[ORDER CREATED] Failed to parse appointment time:', e?.message);
        }
      }
      
      // Look for appointment duration
      const durationProp = properties.find(p => {
        const name = (p.name || '').toLowerCase();
        return name === 'duration' || 
               name === 'appointment_duration' ||
               name === 'booking_duration';
      });
      
      if (durationProp && durationProp.value) {
        const parsedDuration = parseInt(durationProp.value, 10);
        if (!isNaN(parsedDuration) && parsedDuration > 0) {
          appointmentDuration = parsedDuration;
          console.log(`⏱️ [ORDER CREATED] Extracted appointment duration: ${appointmentDuration} minutes`);
        }
      }
    }
    
    // Also check order note for appointment time (if not found in properties)
    if (appointmentStartTime.getTime() === (order.created_at ? new Date(order.created_at).getTime() : new Date().getTime())) {
      const noteMatch = order.note?.match(/(?:appointment|booking|scheduled).*?(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2})/i);
      if (noteMatch) {
        try {
          const parsedTime = new Date(noteMatch[1]);
          if (!isNaN(parsedTime.getTime())) {
            appointmentStartTime = parsedTime;
            console.log(`📅 [ORDER CREATED] Extracted appointment time from order note: ${appointmentStartTime.toISOString()}`);
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
    }

    // Check for meeting link from Cowlendar in order properties or notes
    // Cowlendar may include meeting links in order line item properties or order notes
    let cowlendarMeetingLink = null;
    
    // Check line item properties for meeting link
    if (lineItems && lineItems.length > 0) {
      for (const item of lineItems) {
        if (item.properties) {
          for (const prop of item.properties) {
            const propName = (prop.name || '').toLowerCase();
            const propValue = prop.value || '';
            if ((propName.includes('meeting') || propName.includes('video') || propName.includes('link') || propName.includes('meet') || propName.includes('zoom')) && 
                (propValue.includes('http') || propValue.includes('meet.google.com') || propValue.includes('zoom.us'))) {
              cowlendarMeetingLink = propValue;
              console.log(`🔗 [STEP 6] [ORDER CREATED] Found Cowlendar meeting link in order properties: ${cowlendarMeetingLink}`);
              break;
            }
          }
        }
        if (cowlendarMeetingLink) break;
      }
    }
    
    // Check order note for meeting link
    if (!cowlendarMeetingLink && order.note) {
      const noteMatch = order.note.match(/(https?:\/\/[^\s]+(?:meet\.google\.com|zoom\.us)[^\s]*)/i);
      if (noteMatch) {
        cowlendarMeetingLink = noteMatch[1];
        console.log(`🔗 [STEP 6] [ORDER CREATED] Found Cowlendar meeting link in order note: ${cowlendarMeetingLink}`);
      }
    }

    // Only generate our own link if Cowlendar didn't provide one (and if generation is enabled)
    let meetingLink = cowlendarMeetingLink;
    if (!meetingLink) {
      const googleMeetService = require('../services/googleMeetService');
      const meetingDetails = googleMeetService.generateMeetLink({
        patientName: `${shippingAddress?.first_name || order.customer?.first_name || ''} ${shippingAddress?.last_name || order.customer?.last_name || ''}`.trim() || email,
        doctorName: 'Medical Director',
        appointmentId: `COWLENDAR-ORDER-${shopifyOrderId}`,
        scheduledTime: appointmentStartTime.toISOString()
      });
      meetingLink = meetingDetails ? meetingDetails.meetLink : null;
      if (meetingLink) {
        console.log(`🔗 [STEP 6] [ORDER CREATED] Generated backend meeting link: ${meetingLink}`);
      } else {
        console.log(`⚠️ [STEP 6] [ORDER CREATED] No meeting link available (Cowlendar didn't provide one and backend generation returned null)`);
      }
    } else if (cowlendarMeetingLink) {
      console.log(`🔗 [STEP 6] [ORDER CREATED] Using Cowlendar-provided meeting link: ${cowlendarMeetingLink}`);
    }

    // Create appointment in Tebra
    const appointmentEndTime = new Date(appointmentStartTime.getTime() + appointmentDuration * 60000);
    const appointmentData = {
      appointmentName: lineItems[0]?.title || 'Telemedicine Consultation',
      appointmentStatus: 'Scheduled',
      appointmentType: 'Telemedicine',
      startTime: appointmentStartTime.toISOString(),
      endTime: appointmentEndTime.toISOString(),
      patientId: tebraPatientId,
      practiceId: mapping.practiceId,
      providerId: mapping.defaultProviderId,
      notes: meetingLink ? `Cowlendar booking from order ${shopifyOrderId}. Meeting link: ${meetingLink}` : `Cowlendar booking from order ${shopifyOrderId}.`,
      isRecurring: false
    };

    console.log(`📅 [STEP 5] [ORDER CREATED] Creating appointment in Tebra - Start: ${appointmentStartTime.toISOString()}, End: ${appointmentEndTime.toISOString()}, Patient ID: ${tebraPatientId}, Practice ID: ${mapping.practiceId}, Provider ID: ${mapping.defaultProviderId}`);
    
    let tebraAppointment = null;
    let tebraAppointmentId = null;
    
    try {
      tebraAppointment = await tebraService.createAppointment(appointmentData);
      
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
      } else {
        tebraAppointmentId = tebraAppointment?.id || tebraAppointment?.ID || tebraAppointment?.appointmentId || tebraAppointment?.AppointmentID;
        console.log(`🔍 [STEP 5] Extracted appointment ID from root: ${tebraAppointmentId}`);
      }
      
      // Log full response for debugging if ID is still missing
      if (!tebraAppointmentId) {
        console.warn(`⚠️ [STEP 5] Could not extract appointment ID from response. Full response:`, JSON.stringify(tebraAppointment, null, 2));
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
    
    console.log(`✅ [STEP 8] [ORDER CREATED] Appointment verification - Order: ${shopifyOrderId}, Tebra Appointment ID: ${tebraAppointmentId || 'N/A'}, Patient ID: ${tebraPatientId}, Meeting Link: ${meetingLink || 'None'}`);
    console.log(`📧 [STEP 7] [ORDER CREATED] Sending success response to Shopify webhook - Customer will receive confirmation from Cowlendar`);

    res.json({
      success: true,
      tebraAppointmentId: tebraAppointmentId || null,
      meetingLink: meetingLink,
      patientId: tebraPatientId,
      message: tebraAppointmentId ? 'Cowlendar booking synced to Tebra successfully' : 'Cowlendar booking processed but appointment ID not available'
    });
  } catch (error) {
    console.error('[ORDER CREATED] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal error', 
      error: error.message 
    });
  }
};

// Helper to calculate next billing date
function getNextBillingDate(frequency) {
  const date = new Date();
  if (frequency === 'monthly') {
    date.setMonth(date.getMonth() + 1);
  } else if (frequency === 'quarterly') {
    date.setMonth(date.getMonth() + 3);
  }
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}
