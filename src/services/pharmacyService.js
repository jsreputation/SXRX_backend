// backend/src/services/pharmacyService.js
// Pharmacy/eRx submission adapter.
// Supports multiple eRx providers: Tebra native eRx, Surescripts, DrFirst, etc.
// Configure via ERX_PROVIDER environment variable.

const { randomUUID } = require('crypto');
const axios = require('axios');

const ERX_PROVIDER = (process.env.ERX_PROVIDER || 'stub').toLowerCase();
const ERX_API_KEY = process.env.ERX_API_KEY;
const ERX_API_SECRET = process.env.ERX_API_SECRET;
const ERX_BASE_URL = process.env.ERX_BASE_URL;

/**
 * Submit a prescription to the pharmacy/eRx system.
 * @param {Object} params
 * @param {string} params.patientId - Tebra patient ID
 * @param {string} [params.practiceId] - Tebra practice ID
 * @param {Object} params.treatment - normalized prescription payload
 * @param {Object} [params.pharmacy] - Pharmacy information (name, NPI, address)
 * @param {string} [params.providerId] - Prescribing provider ID
 * @returns {Promise<{ success: boolean, rxId?: string, confirmationNumber?: string, pharmacy?: Object, message?: string, error?: string }>} 
 */
async function submitPrescription({ patientId, practiceId, treatment, pharmacy, providerId }) {
  if (!patientId || !treatment) {
    return { success: false, message: 'Missing patient or treatment for eRx' };
  }

  // Route to appropriate eRx provider based on configuration
  switch (ERX_PROVIDER) {
    case 'tebra':
      return await submitViaTebra({ patientId, practiceId, treatment, pharmacy, providerId });
    
    case 'surescripts':
      return await submitViaSurescripts({ patientId, practiceId, treatment, pharmacy, providerId });
    
    case 'drfirst':
      return await submitViaDrFirst({ patientId, practiceId, treatment, pharmacy, providerId });
    
    case 'stub':
    default:
      return await submitViaStub({ patientId, treatment });
  }
}

/**
 * Submit prescription via Tebra native eRx (if available)
 */
async function submitViaTebra({ patientId, practiceId, treatment, pharmacy, providerId }) {
  try {
    const tebraService = require('./tebraService');
    
    // If Tebra has eRx API, call it here
    // Example structure (adjust based on actual Tebra eRx API):
    const response = await tebraService.createPrescription({
      patientId,
      practiceId,
      providerId,
      medication: treatment.medication || treatment.name,
      dosage: treatment.dosage,
      instructions: treatment.instructions,
      quantity: treatment.quantity,
      refills: treatment.refills || 0,
      pharmacy: pharmacy ? {
        name: pharmacy.name,
        npi: pharmacy.npi,
        address: pharmacy.address
      } : undefined
    });

    return {
      success: true,
      rxId: response.prescriptionId || response.id,
      confirmationNumber: response.confirmationNumber,
      pharmacy: pharmacy
    };
  } catch (error) {
    console.error('[Pharmacy] Tebra eRx submission failed:', error?.message || error);
    return {
      success: false,
      error: error?.message || 'Tebra eRx submission failed',
      // Fallback to stub if Tebra eRx fails
      fallback: await submitViaStub({ patientId, treatment })
    };
  }
}

/**
 * Submit prescription via Surescripts
 */
async function submitViaSurescripts({ patientId, practiceId, treatment, pharmacy, providerId }) {
  if (!ERX_API_KEY || !ERX_BASE_URL) {
    console.warn('[Pharmacy] Surescripts credentials not configured, falling back to stub');
    return await submitViaStub({ patientId, treatment });
  }

  try {
    const response = await axios.post(
      `${ERX_BASE_URL}/v1/prescriptions/submit`,
      {
        patient_id: patientId,
        practice_id: practiceId,
        provider_id: providerId,
        medication: {
          name: treatment.medication || treatment.name,
          dosage: treatment.dosage,
          form: treatment.form,
          quantity: treatment.quantity,
          refills: treatment.refills || 0
        },
        instructions: treatment.instructions,
        pharmacy: {
          npi: pharmacy?.npi,
          name: pharmacy?.name,
          address: pharmacy?.address
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${ERX_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    return {
      success: true,
      rxId: response.data.prescription_id || response.data.id,
      confirmationNumber: response.data.confirmation_number,
      pharmacy: pharmacy
    };
  } catch (error) {
    console.error('[Pharmacy] Surescripts eRx submission failed:', error?.message || error);
    return {
      success: false,
      error: error?.message || 'Surescripts eRx submission failed'
    };
  }
}

/**
 * Submit prescription via DrFirst
 */
async function submitViaDrFirst({ patientId, practiceId, treatment, pharmacy, providerId }) {
  if (!ERX_API_KEY || !ERX_BASE_URL) {
    console.warn('[Pharmacy] DrFirst credentials not configured, falling back to stub');
    return await submitViaStub({ patientId, treatment });
  }

  try {
    const response = await axios.post(
      `${ERX_BASE_URL}/api/v1/prescriptions`,
      {
        patientId,
        practiceId,
        providerId,
        medication: treatment.medication || treatment.name,
        dosage: treatment.dosage,
        instructions: treatment.instructions,
        pharmacyNpi: pharmacy?.npi
      },
      {
        headers: {
          'Authorization': `Bearer ${ERX_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    return {
      success: true,
      rxId: response.data.rxId || response.data.id,
      confirmationNumber: response.data.confirmationNumber,
      pharmacy: pharmacy
    };
  } catch (error) {
    console.error('[Pharmacy] DrFirst eRx submission failed:', error?.message || error);
    return {
      success: false,
      error: error?.message || 'DrFirst eRx submission failed'
    };
  }
}

/**
 * Stub implementation (for development/testing)
 * Generates a mock rxId without actually submitting to pharmacy
 */
async function submitViaStub({ patientId, treatment }) {
  console.warn('[Pharmacy] Using stub eRx implementation - prescription not actually sent to pharmacy');
  
  // Generate a deterministic-ish rxId for tracking
  const rxId = `rx_${Date.now()}_${randomUUID().slice(0, 8)}`;
  
  return {
    success: true,
    rxId,
    message: 'Prescription submitted (stub mode - not sent to pharmacy)',
    stub: true
  };
}

/**
 * Get prescription status
 * @param {string} rxId - Prescription ID
 * @returns {Promise<{success: boolean, status?: string, details?: Object}>}
 */
async function getPrescriptionStatus(rxId) {
  // Implementation depends on eRx provider
  // This is a placeholder
  return {
    success: false,
    message: 'Prescription status lookup not implemented'
  };
}

module.exports = { 
  submitPrescription,
  getPrescriptionStatus
};
