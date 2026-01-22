// backend/src/services/guestAccountLinkingService.js
// Service to link guest orders/questionnaires to customer accounts when they register

const questionnaireCompletionService = require('./questionnaireCompletionService');
const customerPatientMapService = require('./customerPatientMapService');

/**
 * Link guest data to customer account when guest creates account
 * @param {string} email - User email
 * @param {number} customerId - Shopify customer ID
 * @returns {Promise<Object>} Linking results
 */
async function linkGuestToCustomer(email, customerId) {
  if (!email || !customerId) {
    throw new Error('Email and customerId are required');
  }

  const results = {
    questionnaireCompletionsLinked: 0,
    patientMappingsUpdated: 0,
    errors: []
  };

  try {
    // 1. Link questionnaire completions
    try {
      const linkedCount = await questionnaireCompletionService.linkToCustomer(email, customerId);
      results.questionnaireCompletionsLinked = linkedCount;
      console.log(`✅ [GUEST LINKING] Linked ${linkedCount} questionnaire completion(s) for customer ${customerId}`);
    } catch (err) {
      results.errors.push(`Questionnaire linking failed: ${err.message}`);
      console.warn('[GUEST LINKING] Failed to link questionnaire completions:', err?.message || err);
    }

    // 2. Update customer-patient mappings (link existing patient records)
    try {
      // Find existing mappings by email (guest orders)
      const existingMapping = await customerPatientMapService.getByShopifyIdOrEmail(null, email);
      if (existingMapping && existingMapping.tebra_patient_id) {
        // Update mapping to include customerId
        await customerPatientMapService.upsert(customerId, email, existingMapping.tebra_patient_id);
        results.patientMappingsUpdated = 1;
        console.log(`✅ [GUEST LINKING] Updated patient mapping for customer ${customerId} -> patient ${existingMapping.tebra_patient_id}`);
      }
    } catch (err) {
      results.errors.push(`Patient mapping update failed: ${err.message}`);
      console.warn('[GUEST LINKING] Failed to update patient mapping:', err?.message || err);
    }

    return results;
  } catch (error) {
    console.error('[GUEST LINKING] Error linking guest to customer:', error);
    throw error;
  }
}

module.exports = {
  linkGuestToCustomer
};
