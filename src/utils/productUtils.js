// backend/src/utils/productUtils.js
// Product utility functions for Shopify integration

/**
 * Check if product requires questionnaire
 * @param {Object} product - Product object with tags or metafields
 * @returns {boolean}
 */
function requiresQuestionnaire(product) {
  // Check tags first (from CSV import)
  const tags = (product.tags || '').toLowerCase();
  if (tags.includes('requires-questionnaire')) {
    return true;
  }
  
  // Check metafield as fallback
  const metafield = product.metafields?.find(m => 
    m.namespace === 'sxrx' && m.key === 'requires_questionnaire'
  );
  if (metafield && metafield.value === 'true') {
    return true;
  }
  
  return false;
}

/**
 * Check if product is subscription
 * @param {Object} product - Product object with tags or metafields
 * @returns {boolean}
 */
function isSubscriptionProduct(product) {
  // Check tags first
  const tags = (product.tags || '').toLowerCase();
  if (tags.includes('subscription-monthly') || tags.includes('subscription')) {
    return true;
  }
  
  // Check metafield as fallback
  const metafield = product.metafields?.find(m => 
    m.namespace === 'sxrx' && m.key === 'subscription_type'
  );
  if (metafield && (metafield.value === 'monthly' || metafield.value === 'quarterly')) {
    return true;
  }
  
  return false;
}

/**
 * Parse state restrictions from metafield
 * Handles both JSON format and comma-separated text format
 * @param {string|Object} metafieldValue - Metafield value (can be JSON string or text)
 * @returns {string[]} Array of state codes
 */
function parseStateRestrictions(metafieldValue) {
  if (!metafieldValue) {
    return [];
  }
  
  // If it's already an array, return it
  if (Array.isArray(metafieldValue)) {
    return metafieldValue.map(s => s.toUpperCase());
  }
  
  // Try to parse as JSON first
  if (typeof metafieldValue === 'string') {
    // Check if it looks like JSON
    if (metafieldValue.trim().startsWith('[') || metafieldValue.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(metafieldValue);
        if (Array.isArray(parsed)) {
          return parsed.map(s => String(s).toUpperCase());
        }
      } catch (e) {
        // Not valid JSON, continue to text parsing
      }
    }
    
    // Parse as comma-separated text
    if (metafieldValue.includes(',')) {
      return metafieldValue.split(',').map(s => s.trim().toUpperCase()).filter(s => s);
    }
    
    // Single value
    const trimmed = metafieldValue.trim().toUpperCase();
    return trimmed ? [trimmed] : [];
  }
  
  return [];
}

/**
 * Check if product is restricted in state
 * @param {Object} product - Product object with tags or metafields
 * @param {string} state - State code (e.g., "CA", "TX")
 * @returns {boolean}
 */
function isRestrictedInState(product, state) {
  if (!state) {
    return false;
  }
  
  const stateCode = String(state).toUpperCase();
  
  // Check tags first (for backward compatibility)
  const tags = (product.tags || '').toLowerCase();
  if (tags.includes('ketamine-therapy') && tags.includes('ca-restricted')) {
    return stateCode === 'CA';
  }
  
  // Check metafield (preferred method)
  const metafield = product.metafields?.find(m => 
    m.namespace === 'sxrx' && m.key === 'state_restrictions'
  );
  
  if (metafield) {
    const restrictions = parseStateRestrictions(metafield.value);
    return restrictions.includes(stateCode);
  }
  
  return false;
}

/**
 * Get subscription type from product
 * @param {Object} product - Product object with tags or metafields
 * @returns {string|null} 'monthly', 'quarterly', or null
 */
function getSubscriptionType(product) {
  // Check metafield first (more reliable)
  const metafield = product.metafields?.find(m => 
    m.namespace === 'sxrx' && m.key === 'subscription_type'
  );
  if (metafield && metafield.value) {
    return metafield.value.toLowerCase();
  }
  
  // Check tags as fallback
  const tags = (product.tags || '').toLowerCase();
  if (tags.includes('subscription-monthly')) {
    return 'monthly';
  }
  if (tags.includes('subscription-quarterly')) {
    return 'quarterly';
  }
  
  return null;
}

module.exports = {
  requiresQuestionnaire,
  isSubscriptionProduct,
  isRestrictedInState,
  getSubscriptionType,
  parseStateRestrictions
};

