// Utility functions for working with location data

/**
 * Get formatted location string from client location
 * @param {Object} clientLocation - Location object from req.clientLocation
 * @returns {string} Formatted location string
 */
const getFormattedLocation = (clientLocation) => {
  if (!clientLocation || clientLocation.error || clientLocation.isLocal) {
    return 'Unknown location';
  }
  
  const parts = [];
  if (clientLocation.city) parts.push(clientLocation.city);
  if (clientLocation.region) parts.push(clientLocation.region);
  if (clientLocation.country) parts.push(clientLocation.country);
  
  return parts.length > 0 ? parts.join(', ') : 'Unknown location';
};

/**
 * Check if client is in the same state/region as a doctor
 * @param {Object} clientLocation - Location object from req.clientLocation
 * @param {string} doctorState - Doctor's state
 * @returns {boolean} True if same state, false otherwise
 */
const isSameState = (clientLocation, doctorState) => {
  if (!clientLocation || clientLocation.error || clientLocation.isLocal) {
    return false;
  }
  
  return clientLocation.region === doctorState;
};

/**
 * Get location-based logging prefix
 * @param {Object} clientLocation - Location object from req.clientLocation
 * @param {string} action - Action being performed
 * @returns {string} Formatted log prefix
 */
const getLocationLogPrefix = (clientLocation, action) => {
  const location = getFormattedLocation(clientLocation);
  return `[${action}] from ${location}`;
};

/**
 * Add location metadata to database objects
 * @param {Object} data - Data object to add location to
 * @param {Object} clientLocation - Location object from req.clientLocation
 * @returns {Object} Data object with location metadata
 */
const addLocationMetadata = (data, clientLocation) => {
  return {
    ...data,
    createdFromLocation: clientLocation?.city || 'Unknown',
    locationData: {
      city: clientLocation?.city,
      region: clientLocation?.region,
      country: clientLocation?.country,
      ip: clientLocation?.ip
    }
  };
};

/**
 * Validate if location is available for location-based features
 * @param {Object} clientLocation - Location object from req.clientLocation
 * @returns {Object} Validation result with success and message
 */
const validateLocation = (clientLocation) => {
  if (!clientLocation) {
    return {
      success: false,
      message: 'Location data not available'
    };
  }
  
  if (clientLocation.error) {
    return {
      success: false,
      message: `Location error: ${clientLocation.error}`
    };
  }
  
  if (clientLocation.isLocal) {
    return {
      success: false,
      message: 'Local/private IP detected'
    };
  }
  
  return {
    success: true,
    message: 'Location validated successfully'
  };
};

/**
 * Get location-based response object
 * @param {any} data - Main response data
 * @param {Object} clientLocation - Location object from req.clientLocation
 * @param {string} message - Response message
 * @returns {Object} Response object with location context
 */
const getLocationResponse = (data, clientLocation, message = '') => {
  return {
    data,
    location: clientLocation,
    locationFormatted: getFormattedLocation(clientLocation),
    message: message || `Operation completed from ${getFormattedLocation(clientLocation)}`
  };
};

module.exports = {
  getFormattedLocation,
  isSameState,
  getLocationLogPrefix,
  addLocationMetadata,
  validateLocation,
  getLocationResponse
}; 