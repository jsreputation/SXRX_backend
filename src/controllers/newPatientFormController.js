// backend/src/controllers/newPatientFormController.js
// Creates/ensures a Tebra patient and uploads a New Patient Intake form as a document to the chart.

const getTebraService = require('../services/tebraServiceSingleton');
const tebraService = getTebraService();
const { auth } = require('../middleware/shopifyTokenAuth');

const { ensureTebraPatient, base64Encode } = require('../utils/tebraPatientUtils');

// Re-export for backward compatibility
function b64(input) {
  return base64Encode(input);
}

exports.submit = async (req, res) => {
  try {
    const useMock = String(process.env.USE_TEBRA_MOCK || '').toLowerCase() === 'true';
    const { patient = {}, form = {}, practiceId } = req.body || {};

    const effectivePracticeId = practiceId || process.env.TEBRA_PRACTICE_ID || undefined;
    // practiceId is optional - will be handled gracefully by Tebra service if not provided

    // Ensure patient exists
    let patientId = null;
    try {
      const ensured = await ensureTebraPatient({
        email: patient.email,
        firstName: patient.firstName,
        lastName: patient.lastName,
        phone: patient.phone,
        dateOfBirth: patient.dateOfBirth,
        gender: patient.gender,
        address: patient.address || {},
        practiceId: effectivePracticeId,
      });
      patientId = ensured.id;
      
      // Store customer-patient mapping (like questionnaire does)
      try {
        const mapService = require('../services/customerPatientMapService');
        const shopifyCustomerId = req.user?.customerId || req.user?.id || req.user?.sub || 
                                  (req.user?.payload?.customerId) || (req.user?.payload?.sub) || null;
        if (shopifyCustomerId || patient.email) {
          await mapService.upsert(shopifyCustomerId, patient.email, patientId);
          console.log(`✅ [NEW PATIENT FORM] Mapped patient ${patientId} to customer ${shopifyCustomerId || patient.email}`);
        }
      } catch (mapError) {
        console.warn('⚠️ [NEW PATIENT FORM] Failed to store customer-patient mapping:', mapError?.message || mapError);
        // Non-critical, continue
      }
    } catch (e) {
      if (useMock) {
        patientId = `MOCK-PAT-${Date.now()}`;
      } else {
        const err = new Error('Unable to open patient chart in Tebra');
        err.status = 502;
        throw err;
      }
    }

    // Build a readable JSON structure
    const jsonDoc = {
      type: 'New Patient Form',
      submittedAt: new Date().toISOString(),
      patientDemographics: patient,
      form,
    };

    // Upload as document
    let docRes = null;
    try {
      docRes = await tebraService.createDocument({
        name: 'New Patient Form',
        label: 'Intake',
        status: 'Completed',
        fileName: `new-patient-form-${Date.now()}.json`,
        patientId,
        practiceId: effectivePracticeId,
        fileContent: b64(jsonDoc),
      });
    } catch (e) {
      if (useMock) {
        docRes = { id: `MOCK-DOC-NPF-${Date.now()}`, status: 'Completed', mock: true };
      } else {
        const err = new Error('Failed to store New Patient Form in Tebra');
        err.status = 502;
        throw err;
      }
    }

    return res.json({ success: true, message: useMock ? 'Stored (mock)' : 'Form stored in Tebra chart', tebra_patient_id: patientId, tebra_document_id: docRes?.id || docRes?.DocumentId || null });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ success: false, message: error?.message || 'Failed to submit new patient form' });
  }
};
