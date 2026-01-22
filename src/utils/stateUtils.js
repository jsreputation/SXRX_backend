// backend/src/utils/stateUtils.js
// Standardized state determination utility
// Used across all controllers for consistent state handling

/**
 * Normalize state code (e.g., "California" -> "CA", "ca" -> "CA")
 * @param {string} state - State name or code
 * @returns {string|null} Normalized state code or null
 */
function normalizeStateCode(state) {
  if (!state || typeof state !== 'string') {
    return null;
  }

  const stateMap = {
    'california': 'CA',
    'texas': 'TX',
    'washington': 'WA',
    'kuala lumpur': 'KL',
    'kl': 'KL',
    'new york': 'NY',
    'florida': 'FL',
    'arizona': 'AZ',
    'colorado': 'CO',
    'illinois': 'IL',
    'massachusetts': 'MA',
    'new jersey': 'NJ',
    'pennsylvania': 'PA',
    'virginia': 'VA',
    'north carolina': 'NC',
    'georgia': 'GA',
    'michigan': 'MI',
    'ohio': 'OH',
    'tennessee': 'TN',
    'indiana': 'IN',
    'maryland': 'MD',
    'wisconsin': 'WI',
    'minnesota': 'MN',
    'missouri': 'MO',
    'louisiana': 'LA',
    'alabama': 'AL',
    'kentucky': 'KY',
    'oregon': 'OR',
    'oklahoma': 'OK',
    'connecticut': 'CT',
    'utah': 'UT',
    'iowa': 'IA',
    'nevada': 'NV',
    'arkansas': 'AR',
    'mississippi': 'MS',
    'kansas': 'KS',
    'new mexico': 'NM',
    'nebraska': 'NE',
    'west virginia': 'WV',
    'idaho': 'ID',
    'hawaii': 'HI',
    'new hampshire': 'NH',
    'maine': 'ME',
    'montana': 'MT',
    'rhode island': 'RI',
    'delaware': 'DE',
    'south dakota': 'SD',
    'north dakota': 'ND',
    'alaska': 'AK',
    'vermont': 'VT',
    'wyoming': 'WY',
    'south carolina': 'SC',
  };

  const normalized = state.trim().toLowerCase();
  
  // Check if it's already a valid 2-letter code
  if (normalized.length === 2 && /^[a-z]{2}$/.test(normalized)) {
    return normalized.toUpperCase();
  }
  
  // Check state map
  if (stateMap[normalized]) {
    return stateMap[normalized];
  }
  
  // If it's a long string, try to find a match
  for (const [key, value] of Object.entries(stateMap)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value;
    }
  }
  
  // If all else fails, return uppercase if it looks like a state code
  if (normalized.length <= 3) {
    return normalized.toUpperCase();
  }
  
  return null;
}

/**
 * Map US state names/codes to normalized codes
 */
const US_STATE_MAP = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC', 'dc': 'DC'
};

/**
 * Map region codes to state codes (for IP geolocation)
 * @param {string} regionCode - Region code from geolocation
 * @returns {string|null} State code or null
 */
function regionCodeToState(regionCode) {
  if (!regionCode) return null;
  
  // Common region code mappings (IP-API returns region codes like "CA", "TX", etc.)
  const normalized = String(regionCode).toUpperCase().trim();
  
  // If it's already a 2-letter code, validate it
  if (normalized.length === 2 && /^[A-Z]{2}$/.test(normalized)) {
    // Check if it's a valid US state
    if (Object.values(US_STATE_MAP).includes(normalized)) {
      return normalized;
    }
  }
  
  return null;
}

/**
 * Determine state from various payload sources with geolocation fallback
 * @param {Object} payload - Payload object
 * @param {Object} options - Options
 * @param {Object} options.order - Shopify order object (for fallback)
 * @param {Object} options.clientLocation - Client location from geolocation middleware
 * @param {Object} options.req - Express request object (for geolocation)
 * @returns {Promise<string|null>} State code or null
 */
async function determineState(payload, options = {}) {
  // Try explicit fields first
  const candidates = [
    payload.state,
    payload.shippingState,
    payload.billingState,
    payload.patientInfo?.state,
    payload.address?.state,
    payload.shipping_address?.provinceCode,
    payload.shipping_address?.province,
    payload.billing_address?.provinceCode,
    payload.billing_address?.province,
  ];

  // Try order shipping address as fallback
  if (options.order) {
    candidates.push(
      options.order.shipping_address?.province_code,
      options.order.shipping_address?.province,
      options.order.billing_address?.province_code,
      options.order.billing_address?.province
    );
  }

  // Find first valid state from explicit sources
  for (const candidate of candidates) {
    if (candidate) {
      const normalized = normalizeStateCode(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }

  // If no state found in payload, try geolocation fallback
  const clientLocation = options.clientLocation || options.req?.clientLocation;
  if (clientLocation && !clientLocation.isLocal) {
    // Try region code first (most reliable)
    if (clientLocation.regionCode) {
      const stateFromRegion = regionCodeToState(clientLocation.regionCode);
      if (stateFromRegion) {
        console.log(`🌍 [STATE DETECTION] Using geolocation region code: ${stateFromRegion} (from ${clientLocation.region}, ${clientLocation.country})`);
        return stateFromRegion;
      }
    }
    
    // Try region name as fallback
    if (clientLocation.region) {
      const normalized = normalizeStateCode(clientLocation.region);
      if (normalized) {
        console.log(`🌍 [STATE DETECTION] Using geolocation region name: ${normalized} (from ${clientLocation.region}, ${clientLocation.country})`);
        return normalized;
      }
    }
  }

  return null;
}

/**
 * Synchronous version (for backward compatibility)
 * Does not use geolocation fallback
 */
function determineStateSync(payload, options = {}) {
  const candidates = [
    payload.state,
    payload.shippingState,
    payload.billingState,
    payload.patientInfo?.state,
    payload.address?.state,
    payload.shipping_address?.provinceCode,
    payload.shipping_address?.province,
    payload.billing_address?.provinceCode,
    payload.billing_address?.province,
  ];

  if (options.order) {
    candidates.push(
      options.order.shipping_address?.province_code,
      options.order.shipping_address?.province,
      options.order.billing_address?.province_code,
      options.order.billing_address?.province
    );
  }

  for (const candidate of candidates) {
    if (candidate) {
      const normalized = normalizeStateCode(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

/**
 * Validate state code
 * @param {string} state - State code to validate
 * @param {Array<string>} allowedStates - Array of allowed state codes (optional)
 * @returns {boolean} True if valid
 */
function isValidState(state, allowedStates = null) {
  if (!state) {
    return false;
  }

  const normalized = normalizeStateCode(state);
  if (!normalized) {
    return false;
  }

  // If allowed states provided, check against them
  if (allowedStates && Array.isArray(allowedStates)) {
    return allowedStates.map(s => normalizeStateCode(s)).includes(normalized);
  }

  // Otherwise, just check if it's a valid 2-letter code
  return /^[A-Z]{2}$/.test(normalized);
}

module.exports = {
  normalizeStateCode,
  determineState,
  determineStateSync,
  isValidState,
  regionCodeToState
};
