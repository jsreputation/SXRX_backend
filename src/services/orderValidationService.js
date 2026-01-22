// backend/src/services/orderValidationService.js
// Service for validating Shopify orders before processing

const { determineStateSync } = require('../utils/stateUtils');
const questionnaireCompletionService = require('./questionnaireCompletionService');
const logger = require('../utils/logger');

/**
 * Extract email from order
 * @param {Object} order - Shopify order
 * @returns {Promise<string|null>} Email address
 */
async function extractEmailFromOrder(order) {
  if (order.email) return order.email;
  if (order.customer?.email) return order.customer.email;
  if (order.billing_address?.email) return order.billing_address.email;
  if (order.shipping_address?.email) return order.shipping_address.email;
  return null;
}

/**
 * Normalize boolean value
 * @param {*} value - Value to normalize
 * @returns {boolean} Boolean value
 */
function normalizeBool(value) {
  if (value === true) return true;
  if (value === false) return false;
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return false;
  return v === 'true' || v === '1' || v === 'yes' || v === 'y';
}

/**
 * Get property value from line item properties
 * @param {Array|Object} props - Properties array or object
 * @param {string|Array} keyCandidates - Key or array of keys to search for
 * @returns {*} Property value or null
 */
function getPropValue(props, keyCandidates) {
  if (!props) return null;
  const candidates = Array.isArray(keyCandidates) ? keyCandidates : [keyCandidates];

  // Shopify order line item properties are typically: [{ name, value }, ...]
  if (Array.isArray(props)) {
    for (const k of candidates) {
      const match = props.find(p => String(p?.name || '').toLowerCase() === String(k).toLowerCase());
      if (match && match.value !== undefined) return match.value;
    }
    return null;
  }

  // Some callers may provide properties as an object map
  if (typeof props === 'object') {
    for (const k of candidates) {
      if (Object.prototype.hasOwnProperty.call(props, k)) return props[k];
      // Also try case-insensitive lookup
      const foundKey = Object.keys(props).find(pk => pk.toLowerCase() === String(k).toLowerCase());
      if (foundKey) return props[foundKey];
    }
  }
  return null;
}

/**
 * Validate order before processing
 * - Checks if customer has completed questionnaire for products that require it
 * - Checks state restrictions (e.g., Ketamine not available in CA)
 * @param {Object} order - Shopify order
 * @param {Object} req - Express request object (optional)
 * @returns {Promise<Object>} Validation result { valid, errors, warnings }
 */
async function validateOrderBeforeProcessing(order, req = null) {
  const lineItems = order.line_items || [];
  const shippingAddress = order.shipping_address || order.billing_address;
  // Use standardized state determination (sync version for validation - geolocation not needed here)
  const state = determineStateSync({ shipping_address: shippingAddress, billing_address: order.billing_address }, { order });
  const customerId = order.customer?.id;
  const email = await extractEmailFromOrder(order);

  const errors = [];
  const warnings = [];

  // Fetch customer metafields for questionnaire status
  let customerMetafields = {};
  if (customerId) {
    try {
      // This would need to be implemented if using Shopify Admin API
      // For now, we'll check questionnaire completions via database
    } catch (error) {
      logger.warn('Failed to fetch customer metafields', { customerId, error: error.message });
    }
  }

  // Validate each line item
  for (const item of lineItems) {
    const productId = item.product_id?.toString();
    const requiresQuestionnaire = normalizeBool(
      getPropValue(item.properties, ['requires_questionnaire', 'Requires Questionnaire', 'questionnaire_required'])
    );

    // Check questionnaire completion if required
    if (requiresQuestionnaire && productId) {
      if (!email) {
        errors.push({
          type: 'missing_email',
          message: 'Email is required for products that require questionnaire completion',
          productId,
          lineItemId: item.id
        });
        continue;
      }

      try {
        const completion = await questionnaireCompletionService.getLatestCompletion({
          email,
          productId: parseInt(productId)
        });

        if (!completion) {
          errors.push({
            type: 'questionnaire_not_completed',
            message: `Questionnaire not completed for product ${productId}`,
            productId,
            lineItemId: item.id,
            email
          });
        } else {
          // Check for red flags
          if (completion.red_flags_detected) {
            warnings.push({
              type: 'red_flags_detected',
              message: `Red flags detected in questionnaire for product ${productId}`,
              productId,
              completionId: completion.id
            });
          }
        }
      } catch (error) {
        logger.error('Error checking questionnaire completion', {
          email,
          productId,
          error: error.message
        });
        errors.push({
          type: 'questionnaire_check_failed',
          message: 'Failed to verify questionnaire completion',
          productId,
          error: error.message
        });
      }
    }

    // Check state restrictions
    const restrictedStates = getPropValue(item.properties, ['restricted_states', 'Restricted States']);
    if (restrictedStates && state) {
      const restrictedList = String(restrictedStates).split(',').map(s => s.trim().toUpperCase());
      if (restrictedList.includes(state.toUpperCase())) {
        errors.push({
          type: 'state_restriction',
          message: `Product ${productId} is not available in state ${state}`,
          productId,
          state,
          restrictedStates: restrictedList
        });
      }
    }
  }

  // Validate state
  if (!state) {
    warnings.push({
      type: 'state_not_detected',
      message: 'State could not be determined from order. Using default.',
      shippingAddress: shippingAddress ? {
        province: shippingAddress.province,
        province_code: shippingAddress.province_code
      } : null
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    state: state || 'CA', // Default to CA
    email
  };
}

module.exports = {
  validateOrderBeforeProcessing,
  extractEmailFromOrder,
  getPropValue,
  normalizeBool
};
