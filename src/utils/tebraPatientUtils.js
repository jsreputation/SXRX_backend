// backend/src/utils/tebraPatientUtils.js
// Shared utilities for Tebra patient operations

const tebraService = require('../services/tebraService');
const logger = require('./logger');

/**
 * Ensure a Tebra patient exists, creating one if necessary
 * @param {Object} params - Patient parameters
 * @param {string} [params.email] - Patient email
 * @param {string} [params.firstName] - Patient first name
 * @param {string} [params.lastName] - Patient last name
 * @param {string} [params.phone] - Patient phone number
 * @param {string} [params.dateOfBirth] - Patient date of birth
 * @param {string} [params.gender] - Patient gender
 * @param {Object} [params.address={}] - Patient address
 * @param {string} [params.practiceId] - Tebra practice ID
 * @returns {Promise<{id: string}>} Patient ID
 */
async function ensureTebraPatient({ 
  email, 
  firstName, 
  lastName, 
  phone, 
  dateOfBirth, 
  gender, 
  address = {}, 
  practiceId 
}) {
  // Validate required fields
  if (!email && !(firstName && lastName)) {
    const error = new Error('Missing patient identity (email or name)');
    error.status = 400;
    throw error;
  }

  // Try to find existing patient by email
  if (email && tebraService.searchPatients) {
    try {
      const found = await tebraService.searchPatients({ email });
      const candidates = found?.patients || found?.Patients || [];
      const match = candidates.find(p => 
        (p.Email || p.email || '').toLowerCase() === String(email).toLowerCase()
      );
      
      if (match) {
        const id = match.ID || match.Id || match.id;
        if (id) {
          logger.debug('Found existing Tebra patient', { id, email });
          return { id };
        }
      }
    } catch (error) {
      logger.warn('Patient search failed, will create new patient', { 
        error: error.message,
        email 
      });
      // Continue to create new patient
    }
  }

  // Create new patient in Tebra
  const payload = {
    email,
    firstName: firstName || 'Unknown',
    lastName: lastName || 'Unknown',
    mobilePhone: phone,
    dateOfBirth,
    gender,
    addressLine1: address.street || address.addressLine1,
    city: address.city,
    state: address.state,
    zipCode: address.zip || address.zipCode,
    country: address.country || 'US',
    practice: practiceId ? { PracticeID: practiceId } : undefined,
  };

  try {
    const created = await tebraService.createPatient(payload);
    const id = created?.id || created?.patientId || created?.PatientID;
    
    if (!id) {
      const error = new Error('Failed to create Tebra patient: No ID returned');
      error.status = 502;
      throw error;
    }
    
    logger.info('Created new Tebra patient', { id, email });
    return { id };
  } catch (error) {
    logger.errorWithContext(error, { 
      operation: 'ensureTebraPatient',
      email,
      firstName,
      lastName 
    });
    throw error;
  }
}

/**
 * Base64 encode utility
 * @param {string|Buffer|Object} input - Input to encode
 * @returns {string} Base64 encoded string
 */
function base64Encode(input) {
  try {
    const buf = Buffer.isBuffer(input) 
      ? input 
      : Buffer.from(typeof input === 'string' ? input : JSON.stringify(input), 'utf8');
    return buf.toString('base64');
  } catch (error) {
    logger.error('Base64 encoding failed', { error: error.message });
    throw new Error('Failed to encode data');
  }
}

module.exports = {
  ensureTebraPatient,
  base64Encode
};

