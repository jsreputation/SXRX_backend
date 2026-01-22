// backend/src/services/tebraBillingService.js
// Billing service using OFFICIAL Tebra SOAP API methods
// FIXED: Now uses CreateEncounter (for charges) and CreatePayments (for payments) as per official API
// Reference: Official Tebra Web Services API 2.1 Technical Guide

const tebraService = require('./tebraService');

/**
 * Create Encounter (Official method for creating charges)
 * Charges in Tebra are created via encounters with service lines
 * Reference: Official API Guide Section 4.16
 */
async function createCharge({ practiceId, patientId, dateOfService, placeOfService = '10', items = [], caseId, caseName, payerScenario }) {
  try {
    // Get patient case ID if not provided (required for encounter)
    let finalCaseId = caseId;
    let finalCaseName = caseName || 'Default Case';
    let finalPayerScenario = payerScenario || 'Self Pay';
    
    if (!finalCaseId) {
      try {
        // Try to get patient with cases
        const patient = await tebraService.getPatient(patientId);
        finalCaseId = patient?.Cases?.[0]?.PatientCaseID || 
                     patient?.DefaultCaseID ||
                     patient?.DefaultCase?.PatientCaseID;
        finalCaseName = patient?.Cases?.[0]?.Name || 
                       patient?.DefaultCase?.Name || 
                       finalCaseName;
        finalPayerScenario = patient?.Cases?.[0]?.PayerScenario || 
                            patient?.DefaultCase?.PayerScenario || 
                            finalPayerScenario;
      } catch (patientError) {
        console.warn('⚠️ [BILLING] Could not fetch patient for case ID, will try to create encounter without case');
      }
    }

    // If still no case ID, we'll need to create a default case or use a workaround
    // For now, we'll throw an error to ensure data integrity
    if (!finalCaseId) {
      throw new Error('Patient case ID is required for creating encounters. Please ensure patient has a case or provide caseId parameter.');
    }

    // Convert items to service lines format
    const serviceLines = items.map(item => ({
      procedureCode: item.cpt || '99000', // Default CPT code if not provided
      diagnosisCode1: item.diagnosisCode1 || 'Z00.00', // Default diagnosis if not provided
      units: item.units || 1,
      unitCharge: (item.amountCents || 0) / 100, // Convert cents to dollars
      serviceStartDate: dateOfService,
      serviceEndDate: dateOfService
    }));

    // Create encounter with service lines (this creates the charges)
    const encounterData = {
      practiceId,
      patientId,
      caseId: finalCaseId,
      caseName: finalCaseName,
      payerScenario: finalPayerScenario,
      serviceStartDate: dateOfService,
      serviceEndDate: dateOfService,
      postDate: dateOfService,
      serviceLines
    };

    const result = await tebraService.createEncounter(encounterData);
    
    return {
      chargeId: result.encounterId, // Encounter ID serves as charge identifier
      encounterId: result.encounterId,
      success: result.success,
      raw: result.raw
    };
  } catch (error) {
    console.error('❌ [BILLING] Error creating charge via CreateEncounter:', error.message);
    throw error;
  }
}

/**
 * Create Payment (Official method - uses CreatePayments)
 * Reference: Official API Guide Section 4.18
 */
async function postPayment({ practiceId, patientId, amountCents, referenceNumber, date }) {
  try {
    const paymentData = {
      practiceId,
      patientId,
      amountPaid: (amountCents || 0) / 100, // Convert cents to dollars
      paymentMethod: 'CreditCard',
      referenceNumber: referenceNumber || `PAY-${Date.now()}`,
      postDate: date || new Date().toISOString().slice(0, 10),
      payerType: 'Patient'
    };

    const result = await tebraService.createPayments(paymentData);
    
    return {
      paymentId: result.paymentId,
      success: result.success,
      raw: result.raw
    };
  } catch (error) {
    console.error('❌ [BILLING] Error creating payment via CreatePayments:', error.message);
    throw error;
  }
}

/**
 * Get Charges (Official method)
 * Reference: Official API Guide Section 4.4
 */
async function getCharges(options = {}) {
  try {
    return await tebraService.getCharges(options);
  } catch (error) {
    console.error('❌ [BILLING] Error getting charges:', error.message);
    throw error;
  }
}

/**
 * Get Payments (Official method)
 * Reference: Official API Guide Section 4.8
 */
async function getPayments(options = {}) {
  try {
    return await tebraService.getPayments(options);
  } catch (error) {
    console.error('❌ [BILLING] Error getting payments:', error.message);
    throw error;
  }
}

module.exports = { 
  createCharge,  // Now uses CreateEncounter internally
  postPayment,   // Now uses CreatePayments internally
  getCharges,    // New: Official GetCharges method
  getPayments    // New: Official GetPayments method
};
