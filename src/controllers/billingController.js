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
const axios = require('axios');
const moment = require('moment-timezone');

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

function safeTrim(value) {
  const s = (value ?? '').toString().trim();
  return s.length ? s : null;
}

function parseFullName(fullName) {
  const s = safeTrim(fullName);
  if (!s) return { firstName: null, lastName: null };
  const parts = s.split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function extractContactFromLineItemProperties(lineItems) {
  const out = { firstName: null, lastName: null, email: null, fullName: null, matchedKeys: [] };
  const items = Array.isArray(lineItems) ? lineItems : [];

  for (const item of items) {
    const props = Array.isArray(item?.properties) ? item.properties : [];
    for (const prop of props) {
      const rawKey = prop?.name ?? '';
      const key = rawKey.toString().toLowerCase().trim();
      const val = safeTrim(prop?.value);
      if (!key || !val) continue;

      const recordMatch = (field) => out.matchedKeys.push(`${field}:${rawKey}`);

      if (!out.email && key.includes('email') && val.includes('@')) {
        out.email = val;
        recordMatch('email');
        continue;
      }

      if (!out.firstName && (key === 'first_name' || key === 'firstname' || key.includes('first name') || key.includes('given name'))) {
        out.firstName = val;
        recordMatch('firstName');
        continue;
      }

      if (!out.lastName && (key === 'last_name' || key === 'lastname' || key.includes('last name') || key.includes('family name') || key.includes('surname'))) {
        out.lastName = val;
        recordMatch('lastName');
        continue;
      }

      if (!out.fullName && (key === 'full_name' || key.includes('full name') || key === 'name' || key.endsWith('_name'))) {
        out.fullName = val;
        recordMatch('fullName');
      }
    }
  }

  // If only full name provided, split it.
  if ((!out.firstName || !out.lastName) && out.fullName) {
    const parsed = parseFullName(out.fullName);
    out.firstName = out.firstName || parsed.firstName;
    out.lastName = out.lastName || parsed.lastName;
  }

  return out;
}

function normalizePropKey(key) {
  return String(key || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildLineItemPropsMap(properties) {
  const props = Array.isArray(properties) ? properties : [];
  const map = {};
  for (const p of props) {
    const rawKey = p?.name ?? p?.key ?? '';
    const rawVal = p?.value ?? p?.val ?? '';
    const k = normalizePropKey(rawKey);
    const v = safeTrim(rawVal);
    if (!k || v === null) continue;
    // Preserve the first value for a key, but also keep all values in case.
    if (!map[k]) map[k] = { value: v, rawKey: String(rawKey), all: [v] };
    else map[k].all.push(v);
  }
  return map;
}

/**
 * Parse duration string into minutes
 * Supports multiple input formats commonly used by booking systems:
 * - ISO 8601 duration: "PT30M" (30 minutes)
 * - Time format: "HH:MM" or "HH:MM:SS" (e.g., "1:30" = 90 minutes)
 * - Natural language: "30 min", "1.5 hours", "30 minutes"
 * - Numeric: "30" (assumed minutes), large numbers assumed seconds/milliseconds
 * 
 * @param {string} raw - Raw duration string from various sources
 * @returns {number|null} Duration in minutes, or null if unparseable
 */
function parseDurationMinutes(raw) {
  const s = safeTrim(raw);
  if (!s) return null;

  // ISO 8601 duration format: "PT30M" (Period Time 30 Minutes)
  const iso = s.match(/^pt(\d+)m$/i);
  if (iso) return parseInt(iso[1], 10);

  // Time format: "HH:MM" or "HH:MM:SS" (e.g., "1:30" = 1 hour 30 minutes = 90 minutes)
  const hhmm = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hhmm) {
    const h = parseInt(hhmm[1], 10); // Hours
    const m = parseInt(hhmm[2], 10); // Minutes
    const sec = hhmm[3] ? parseInt(hhmm[3], 10) : 0; // Optional seconds
    return h * 60 + m + Math.round(sec / 60); // Convert all to minutes
  }

  // Natural language or numeric: "30", "30 min", "30 minutes", "1.5 hours"
  const num = s.match(/(\d+(?:\.\d+)?)/);
  if (num) {
    const n = parseFloat(num[1]);
    if (Number.isFinite(n)) {
      const lower = s.toLowerCase();
      
      // Check for unit keywords to determine conversion factor
      if (lower.includes('hour')) return Math.round(n * 60); // Hours to minutes
      if (lower.includes('sec')) return Math.max(1, Math.round(n / 60)); // Seconds to minutes (min 1 min)

      // Heuristic for numeric-only values: infer unit from magnitude
      // Very large numbers (>100000) are likely milliseconds
      if (n >= 100000) return Math.max(1, Math.round(n / 60000)); // ms -> min
      // Large numbers (>1000) are likely seconds
      if (n >= 1000) return Math.max(1, Math.round(n / 60)); // sec -> min

      // Default: assume minutes for smaller numbers
      return Math.round(n);
    }
  }

  return null; // Unparseable format
}

/**
 * Parse appointment datetime from various formats
 * Handles multiple input formats commonly used by booking systems and Shopify order properties:
 * - Unix timestamps: 10-digit (seconds) or 13-digit (milliseconds)
 * - ISO 8601 with timezone: "2024-02-15T10:00:00Z" or "2024-02-15T10:00:00-08:00"
 * - ISO 8601 without timezone: "2024-02-15T10:00:00" (interpreted in provided timezone)
 * - Date strings: "2024-02-15 10:00" (interpreted in provided timezone)
 * - Generic date strings: Fallback to native Date() parsing
 * 
 * @param {string} value - Raw datetime string from order properties or other sources
 * @param {string} tz - Timezone to use if value doesn't include timezone (e.g., "America/Los_Angeles")
 * @returns {Date|null} Parsed Date object, or null if unparseable
 */
function parseAppointmentDateTime(value, tz) {
  const s = safeTrim(value);
  if (!s) return null;

  // Unix timestamp: 10 digits = seconds, 13 digits = milliseconds
  if (/^\d{10,13}$/.test(s)) {
    const n = parseInt(s, 10);
    if (!Number.isFinite(n)) return null;
    const ms = s.length === 10 ? n * 1000 : n; // Convert seconds to milliseconds if needed
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  // ISO 8601 with timezone indicator (Z or +/-offset): preserve timezone information
  // Use parseZone to maintain the original timezone rather than converting to local
  const zoneParsed = moment.parseZone(s, moment.ISO_8601, true);
  if (zoneParsed.isValid() && /z|[+\-]\d{2}:?\d{2}$/i.test(s)) {
    return zoneParsed.toDate(); // Return Date object preserving timezone
  }

  // ISO 8601 format without timezone: try strict parsing first
  const m1 = moment(s, moment.ISO_8601, true);
  if (m1.isValid()) return m1.toDate();

  // No timezone info in value: interpret in provided timezone (or fallback to UTC/Shopify timezone)
  // This is critical for appointments booked in different timezones
  const zone = tz || process.env.DEFAULT_BOOKING_TIMEZONE || process.env.SHOPIFY_TIMEZONE || 'UTC';
  const mtz = moment.tz(s, zone);
  if (mtz.isValid()) return mtz.toDate();

  // Final fallback: native Date() parsing (may be unreliable for ambiguous formats)
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Extract appointment booking metadata from Shopify order line items
 * 
 * This function analyzes order line items to find appointment booking information embedded
 * in product properties. Different booking apps use different property naming conventions,
 * so this function tries multiple common patterns and scores candidates to find the best match.
 * 
 * Algorithm:
 * 1. For each line item, extract and normalize all properties into a searchable map
 * 2. Try multiple datetime extraction strategies:
 *    a. Single combined datetime field (e.g., "appointment_start")
 *    b. Separate date + time fields (e.g., "appointment_date" + "start_time")
 *    c. Fallback to individual date or time fields
 * 3. Score each candidate based on:
 *    - Presence of valid start date (5 points)
 *    - Both date and time fields present (3 points)
 *    - Duration information available (1 point)
 *    - Number of properties (1 point)
 *    - Title keywords like "appointment", "booking", "consultation" (1 point)
 * 4. Return highest-scoring candidate as the best match
 * 
 * @param {Object} order - Shopify order object
 * @param {Array} lineItems - Array of order line items to analyze
 * @returns {Object} Object with 'best' candidate and 'candidates' array (sorted by score)
 */
function extractAppointmentBookingMeta(order, lineItems) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const candidates = [];

  for (const item of items) {
    const properties = item?.properties || [];
    const map = buildLineItemPropsMap(properties); // Normalize property keys for searching
    const keys = Object.keys(map);

    /**
     * Helper to get property value by trying multiple possible key names
     * Handles variations like "appointment_start", "appointmentStart", "appointment_start_time", etc.
     */
    const get = (...names) => {
      for (const n of names) {
        const k = normalizePropKey(n); // Normalize to lowercase with underscores
        if (map[k]?.value) return map[k].value;
      }
      return null;
    };

    // Extract timezone from properties or order metadata
    // Critical for parsing datetime strings without timezone info
    const tz =
      get('timezone', 'time_zone', 'tz') ||
      (order && (order.timezone || order.time_zone)) ||
      null;

    // Strategy 1: Try single combined datetime field (most common in modern booking apps)
    // Check multiple common field names used by different booking systems
    const startRaw =
      get('appointment_start', 'booking_start', 'start_datetime', 'start_date_time', 'appointment_datetime', 'scheduled_datetime') ||
      get('appointment_time', 'booking_time', 'scheduled_time') ||
      null;

    // Strategy 2: Try separate date and time fields (common in older/custom booking systems)
    const dateRaw =
      get('appointment_date', 'booking_date', 'date', 'start_date', 'scheduled_date') ||
      null;
    const timeRaw =
      get('start_time', 'time', 'scheduled_time', 'appointment_time', 'booking_time') ||
      null;

    // Extract duration for appointment length calculation
    const durationRaw =
      get('duration', 'appointment_duration', 'booking_duration', 'service_duration') ||
      null;

    const durationMin = parseDurationMinutes(durationRaw);

    // Determine start date using multiple parsing strategies
    let startDate = null;
    let startSource = null; // Track which strategy succeeded for debugging
    let usedParts = null; // Store which fields were used for logging

    // Strategy 1: Single combined datetime field (highest priority - most reliable)
    if (startRaw) {
      const parsed = parseAppointmentDateTime(startRaw, tz);
      if (parsed) {
        startDate = parsed;
        startSource = 'single_field';
        usedParts = { startKey: map[normalizePropKey('appointment_start')]?.rawKey || 'unknown', startRaw, tz: tz || null };
      }
    }

    // Strategy 2: Combine separate date and time fields
    if (!startDate && dateRaw && timeRaw) {
      // Combine into ISO-like string: "YYYY-MM-DD HH:mm"
      const combined = `${dateRaw} ${timeRaw}`;
      const parsed = parseAppointmentDateTime(combined, tz);
      if (parsed) {
        startDate = parsed;
        startSource = 'date_time_fields';
        usedParts = { dateRaw, timeRaw, tz: tz || null };
      }
    }

    // Strategy 3: Fallback - try individual date or time field alone
    // Some apps store date in "appointment_date" (YYYY-MM-DD) and time in "start_time" (HH:mm)
    if (!startDate && (dateRaw || timeRaw)) {
      const parsed = parseAppointmentDateTime(startRaw || dateRaw || timeRaw, tz);
      if (parsed) {
        startDate = parsed;
        startSource = 'fallback_single';
        usedParts = { raw: startRaw || dateRaw || timeRaw, tz: tz || null };
      }
    }

    /**
     * Scoring Algorithm:
     * Higher score = more likely this line item contains appointment booking data
     * Scores are additive - items with more booking indicators rank higher
     */
    const title = String(item?.title || '').toLowerCase();
    const score =
      (startDate ? 5 : 0) + // Valid datetime is strongest indicator
      (dateRaw && timeRaw ? 3 : 0) + // Both date and time fields present
      (durationMin ? 1 : 0) + // Duration information available
      (keys.length ? 1 : 0) + // More properties = more likely to be booking item
      (title.includes('appointment') || title.includes('booking') || title.includes('consultation') ? 1 : 0); // Title keywords

    candidates.push({
      score,
      itemTitle: item?.title || null,
      startDate,
      startSource, // Which parsing strategy succeeded
      usedParts, // Which fields were used (for debugging)
      durationMin,
      durationRaw,
      tz: tz || null,
      keysPreview: keys.slice(0, 20), // First 20 property keys for debugging
    });
  }

  // Sort by score descending - highest scoring candidate is most likely the booking item
  candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
  return { best: candidates[0] || null, candidates };
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

/**
 * Legacy function - now uses service
 */
async function validateOrderBeforeProcessing_legacy(order, req = null) {
  // Fetch customer metafields for questionnaire status
  let customerMetafields = {};
  const customerId = order.customer?.id;
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

  // Guests don't have customer metafields; accept proof written by the storefront flow
  // (`questionnaire-integration.js` sets `_questionnaire_completed: 'true'` on line-item properties).
  const orderHasQuestionnaireProof = lineItems.some((item) => {
    const v = getPropValue(item?.properties, ['_questionnaire_completed', 'questionnaire_completed', 'questionnaireCompleted']);
    return normalizeBool(v);
  });
  
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
          console.warn(`[ORDER VALIDATION] Questionnaire validation error for product ${productId}:`, validationErr?.message || validationErr);
          // Fall back to legacy validation if registry check fails
        }
      }
      
      // Legacy validation (for backward compatibility)
      const itemHasProof = normalizeBool(getPropValue(item?.properties, ['_questionnaire_completed', 'questionnaire_completed', 'questionnaireCompleted']));
      
      // Require either server-side validation OR legacy proof
      if (!isValidCompletion && questionnaireStatus !== 'completed' && !orderHasQuestionnaireProof && !itemHasProof) {
        throw new Error(`Questionnaire required for ${product.title || item.title}`);
      }
    }
  }
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
