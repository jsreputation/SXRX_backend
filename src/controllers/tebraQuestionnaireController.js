// backend/src/controllers/tebraQuestionnaireController.js
const getTebraService = require('../services/tebraServiceSingleton');
const tebraService = getTebraService();
const { ensureTebraPatient, base64Encode } = require('../utils/tebraPatientUtils');

// In-memory idempotency cache for questionnaire submissions (patientId+submissionId)
// Note: replace with persistent store (Redis/DB) in production if needed
const submissionCache = new Map();
const SUBMISSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function makeSubmissionKey(patientId, submissionId) {
  return `${patientId}::${submissionId}`;
}

function rememberSubmission(patientId, submissionId, payload) {
  const key = makeSubmissionKey(patientId, submissionId);
  submissionCache.set(key, { at: Date.now(), payload });
}

function wasRecentlySubmitted(patientId, submissionId) {
  const key = makeSubmissionKey(patientId, submissionId);
  const hit = submissionCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SUBMISSION_TTL_MS) {
    submissionCache.delete(key);
    return null;
  }
  return hit.payload;
}

// ensureTebraPatient is now imported from utils/tebraPatientUtils

// Helper: create a Tebra Document under a patient chart
async function createTebraDocument({ patientId, practiceId, name, label, notes, fileName, json }) {
  const documentData = {
    name: name || 'Document',
    fileName: fileName || `${(name || 'document').toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.json`,
    documentDate: new Date().toISOString(),
    status: 'Completed',
    label: label || 'General',
    notes: notes || '',
    patientId,
    practiceId,
    fileContent: Buffer.from(JSON.stringify(json || { notes })).toString('base64'),
  };
  return await tebraService.createDocument(documentData);
}

// GET /api/tebra-questionnaire/list?patientId=xxx
// Returns list of questionnaire submissions for a patient
exports.list = async (req, res) => {
  try {
    const { patientId } = req.query;
    if (!patientId) {
      return res.status(400).json({ success: false, message: 'patientId is required' });
    }

    // Get documents from Tebra for this patient
    let documents = [];
    
    try {
      const result = await tebraService.getDocuments({ patientId });
      documents = result?.documents || [];
      console.log(`✅ [QUESTIONNAIRE LIST] Retrieved ${documents.length} documents for patient ${patientId}`);
    } catch (docError) {
      console.error(`⚠️ [QUESTIONNAIRE LIST] Failed to get documents from Tebra for patient ${patientId}:`, docError?.message || docError);
      // If Tebra is unavailable, return empty list but indicate the issue
      // This allows the frontend to still render (just with no submissions)
      return res.json({
        success: true,
        submissions: [],
        count: 0,
        warning: 'Unable to retrieve documents from Tebra. Please try again later.',
        error: process.env.NODE_ENV === 'development' ? docError?.message : undefined,
      });
    }

    // Filter for questionnaire and prescription documents
    const questionnaireDocs = documents.filter((d) => 
      d.name === 'Online Questionnaire' || d.label === 'Consultation'
    );
    const prescriptionDocs = documents.filter((d) => 
      d.name === 'Prescription' || d.label === 'Prescription'
    );
    
    console.log(`📋 [QUESTIONNAIRE LIST] Found ${questionnaireDocs.length} questionnaire docs and ${prescriptionDocs.length} prescription docs`);

    // Group by submission (match by timestamp or other metadata)
    const submissions = questionnaireDocs.map((qDoc) => {
      // Find matching prescription document (if exists) by looking for similar timestamps
      const rxDoc = prescriptionDocs.find((rx) => {
        const qTime = new Date(qDoc.documentDate || qDoc.createdAt).getTime();
        const rxTime = new Date(rx.documentDate || rx.createdAt).getTime();
        // Match if within 5 minutes
        return Math.abs(qTime - rxTime) < 5 * 60 * 1000;
      });

      return {
        patientId,
        patientName: qDoc.patientName || null,
        questionnaireDocument: {
          id: qDoc.id,
          name: qDoc.name,
          status: qDoc.status,
          label: qDoc.label,
          documentDate: qDoc.documentDate || qDoc.createdAt,
        },
        prescriptionDocument: rxDoc ? {
          id: rxDoc.id,
          name: rxDoc.name,
          status: rxDoc.status,
          label: rxDoc.label,
          documentDate: rxDoc.documentDate || rxDoc.createdAt,
        } : null,
        submittedAt: qDoc.documentDate || qDoc.createdAt,
      };
    });

    // Sort by submission date (newest first)
    submissions.sort((a, b) => {
      const dateA = new Date(a.submittedAt).getTime();
      const dateB = new Date(b.submittedAt).getTime();
      return dateB - dateA;
    });

    console.log(`✅ [QUESTIONNAIRE LIST] Returning ${submissions.length} submissions for patient ${patientId}`);
    
    res.json({
      success: true,
      submissions,
      count: submissions.length,
    });
  } catch (error) {
    console.error('❌ [QUESTIONNAIRE LIST] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to list questionnaire submissions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// POST /api/tebra-questionnaire/submit
// Body example: { questionnaire: {...}, patient: { email, firstName, lastName, phone, dateOfBirth, gender, address }, practiceId, treatment: {...} }
exports.submit = async (req, res) => {
  try {
    const { questionnaire = {}, patient = {}, practiceId, treatment, submissionId } = req.body || {};

    // Determine state for routing (prefer explicit patient.address.state, then defaultAddress province if provided via auth later)
    const stateInput = patient?.address?.state || patient?.state || null;
    const { evaluate, selectProvider } = require('../services/providerRoutingService');
    const evalResult = evaluate(questionnaire, treatment, stateInput);

    // Enforce restriction: if restricted treatment for the state, do not proceed with Rx doc creation
    const routing = selectProvider({ stateInput, preferredPracticeId: practiceId });
    const effectivePracticeId = routing.practiceId || practiceId || process.env.TEBRA_PRACTICE_ID || undefined;

    const useMock = String(process.env.USE_TEBRA_MOCK || '').toLowerCase() === 'true';

    // practiceId is optional - will be handled gracefully by Tebra service if not provided

    // Ensure/find patient in Tebra - create patient chart if it doesn't exist
    let patientId = null;
    let patientCreated = false;
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
      
      // Store the mapping between Shopify customer (if authenticated) and Tebra patient
      try {
        const mapService = require('../services/customerPatientMapService');
        // Try multiple possible fields for customer ID from different auth middlewares
        const shopifyCustomerId = req.user?.customerId || req.user?.id || req.user?.sub || 
                                  (req.user?.payload?.customerId) || (req.user?.payload?.sub) || null;
        if (shopifyCustomerId || patient.email) {
          await mapService.upsert(shopifyCustomerId, patient.email, patientId);
          console.log(`✅ [QUESTIONNAIRE] Mapped patient ${patientId} to customer ${shopifyCustomerId || patient.email}`);
        }
      } catch (mapError) {
        console.warn('[Questionnaire] Failed to store customer-patient mapping:', mapError?.message || mapError);
        // Non-critical, continue
      }
      
      patientCreated = true;
      console.log(`✅ [QUESTIONNAIRE] Patient chart ${patientId} ready for ${patient.firstName} ${patient.lastName} (${patient.email})`);
    } catch (e) {
      // Only use mock fallback if explicitly enabled
      if (useMock) {
        console.warn('[Questionnaire] Tebra ensure patient failed; using mock patient id due to USE_TEBRA_MOCK=true:', e?.message || e);
        patientId = `MOCK-PAT-${Date.now()}`;
        patientCreated = true; // Mark as created even in mock mode
      } else {
        // In production or when mock is disabled, return error - Tebra integration is required
        console.error('[Questionnaire] Tebra ensure patient failed:', e?.message || e);
        return res.status(502).json({
          success: false,
          code: 'E_TEBRA_PATIENT_CREATE',
          message: 'Unable to create patient chart in Tebra. Please verify Tebra credentials and configuration.',
          details: process.env.NODE_ENV === 'development' ? e?.message : undefined
        });
      }
    }

    // Idempotency: short-circuit if recently submitted with same submissionId
    const dedupeKey = submissionId || questionnaire.submissionId;
    if (dedupeKey) {
      const prior = wasRecentlySubmitted(patientId, dedupeKey);
      if (prior) {
        return res.json({ success: true, duplicate: true, patientId, requiresConsult: evalResult.requiresConsult, restrictions: evalResult.restrictions, ...prior });
      }
    }

    // Create questionnaire document in Tebra patient chart
    let qDoc = null;
    try {
      qDoc = await createTebraDocument({
        patientId,
        practiceId: effectivePracticeId,
        name: 'Online Questionnaire',
        label: 'Consultation',
        notes: questionnaire.summary || 'Submitted via Website Questionnaire',
        json: { 
          ...questionnaire, 
          evaluation: evalResult,
          submittedAt: new Date().toISOString(),
          patient: {
            email: patient.email,
            firstName: patient.firstName,
            lastName: patient.lastName,
          }
        },
      });
      console.log(`✅ [QUESTIONNAIRE] Questionnaire document created in patient chart ${patientId}:`, qDoc?.id || 'Created');
    } catch (e) {
      // Only use mock fallback if explicitly enabled
      if (useMock) {
        console.warn('[Questionnaire] Failed to store questionnaire in Tebra; using mock doc due to USE_TEBRA_MOCK=true:', e?.message || e);
        qDoc = { id: `MOCK-DOC-Q-${Date.now()}`, name: 'Online Questionnaire', status: 'Completed', mock: true };
      } else {
        // In production without mock, return error - document storage is required
        console.error('[Questionnaire] Failed to store questionnaire in Tebra:', e?.message || e);
        return res.status(502).json({
          success: false,
          code: 'E_TEBRA_DOCUMENT_CREATE',
          message: 'Unable to store questionnaire in patient chart. Please verify Tebra credentials and configuration.',
          details: process.env.NODE_ENV === 'development' ? e?.message : undefined
        });
      }
    }

    // Optionally create prescription document/eRx if treatment info provided and not restricted
    let rxDoc = null;
    let rxId = null;
    if (!evalResult.requiresConsult && !evalResult.restricted && treatment && Object.keys(treatment).length) {
      try {
        rxDoc = await createTebraDocument({
          patientId,
          practiceId: effectivePracticeId,
          name: 'Prescription',
          label: 'Prescription',
          notes: treatment.summary || 'Proposed Treatment/Prescription',
          json: treatment,
        });
      } catch (e) {
        // Only use mock fallback if explicitly enabled, otherwise log warning but continue
        if (useMock) {
          console.warn('[Questionnaire] Failed to store prescription in Tebra; using mock doc due to USE_TEBRA_MOCK=true:', e?.message || e);
          rxDoc = { id: `MOCK-DOC-RX-${Date.now()}`, name: 'Prescription', status: 'Completed', mock: true };
        } else {
          // Log warning but continue - prescription document is optional
          console.warn('[Questionnaire] Prescription document creation failed (non-critical):', e?.message || e);
        }
      }
      
      // Log success if prescription was created
      if (rxDoc && !rxDoc.mock) {
        console.log(`✅ [QUESTIONNAIRE] Prescription document created in patient chart ${patientId}:`, rxDoc?.id || 'Created');
      }
      // Submit eRx to pharmacy connector (stubbed service)
      try {
        const { submitPrescription } = require('../services/pharmacyService');
        const rxRes = await submitPrescription({ patientId, practiceId: effectivePracticeId, treatment });
        if (rxRes && rxRes.success && rxRes.rxId) {
          rxId = rxRes.rxId;
        }
      } catch (e) {
        console.warn('eRx submission failed:', e?.message || e);
      }
    }

    // Create a provider-review document to ensure provider workflow when direct eRx is not available
    try {
      const needsProviderReview = evalResult.requiresConsult || !rxId;
      if (needsProviderReview) {
        await createTebraDocument({
          patientId,
          practiceId: effectivePracticeId,
          name: 'Provider Review Request',
          label: 'Task',
          notes: 'Please review intake and prescribe if appropriate',
          json: { questionnaire, treatment, evaluation: evalResult, pharmacy: req.body?.pharmacy || null }
        });
      }
    } catch (e) {
      if (!useMock) console.warn('Failed to create provider-review document:', e?.message || e);
    }

    // Persist encounter linkage (questionnaire → rx)
    try {
      const { createOrUpdate } = require('../services/encounterService');
      await createOrUpdate({ submissionId: dedupeKey || null, tebraPatientId: patientId, rxId: rxId || null, status: evalResult.requiresConsult ? 'needs_consult' : 'intake_completed' });
    } catch (e) {
      console.warn('Encounter persistence failed:', e?.message || e);
    }

    // If requires consult, notify provider and optionally route to Qualiphy
    if (evalResult.requiresConsult) {
      try {
        const { sendProviderAlert } = require('../services/notificationService');
        const subject = `Consultation Required - ${patient?.firstName || ''} ${patient?.lastName || ''}`.trim();
        const html = `<p>A questionnaire submission requires a consult.</p>
          <p>Patient: ${patient?.firstName || ''} ${patient?.lastName || ''} (${patient?.email || 'n/a'})</p>
          <p>State: ${evalResult.state || 'n/a'}</p>
          <p>Red Flags: ${evalResult.redFlags.join(', ') || 'n/a'}</p>`;
        await sendProviderAlert({ to: routing.providerContact, subject, html });
      } catch (e) {
        console.warn('Provider alert failed:', e?.message || e);
      }

      // Route to Qualiphy if enabled (preferred for most consultations)
      try {
        const qualiphyService = require('../services/qualiphyService');
        if (qualiphyService.isEnabled()) {
          console.log('[QUESTIONNAIRE] Routing consultation to Qualiphy');
          const consultation = await qualiphyService.createConsultationRequest({
            patientId,
            patientInfo: {
              firstName: patient?.firstName || '',
              lastName: patient?.lastName || '',
              email: patient?.email || '',
              phone: patient?.phone || ''
            },
            reason: `Red flags detected: ${evalResult.redFlags.join(', ')}`,
            preferredTime: req.body?.preferredTime || null,
            urgency: evalResult.redFlags.some(f => /suicid|homicid|emergency/i.test(f)) ? 'urgent' : 'normal'
          });

          if (consultation.success && consultation.consultationId) {
            // Store Qualiphy consultation details in Tebra
            try {
              await createTebraDocument({
                patientId,
                practiceId: effectivePracticeId,
                name: 'Qualiphy Consultation',
                label: 'Consultation',
                notes: `Qualiphy consultation scheduled: ${consultation.consultationId}`,
                json: {
                  qualiphyConsultationId: consultation.consultationId,
                  scheduledTime: consultation.scheduledTime,
                  provider: consultation.provider,
                  meetingLink: consultation.meetingLink,
                  confirmationNumber: consultation.confirmationNumber
                }
              });
              console.log(`✅ [QUESTIONNAIRE] Qualiphy consultation created: ${consultation.consultationId}`);
            } catch (docError) {
              console.warn('[QUESTIONNAIRE] Failed to store Qualiphy consultation document:', docError?.message || docError);
            }
          } else {
            console.warn('[QUESTIONNAIRE] Qualiphy consultation creation failed, falling back to internal scheduling');
          }
        }
      } catch (e) {
        console.warn('[QUESTIONNAIRE] Qualiphy integration error (non-critical):', e?.message || e);
        // Continue with internal scheduling if Qualiphy fails
      }
    }

    // Update Shopify customer metafields if customer is authenticated
    try {
      const shopifyCustomerId = req.user?.customerId || req.user?.id || req.user?.sub || 
                                (req.user?.payload?.customerId) || (req.user?.payload?.sub) || null;
      if (shopifyCustomerId) {
        const shopifyUserService = require('../services/shopifyUserService');
        const metafields = {
          questionnaire_status: evalResult.requiresConsult ? 'requires_consultation' : 'completed',
          tebra_patient_id: String(patientId),
          last_questionnaire_date: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
        };
        if (evalResult.state) {
          metafields.state = evalResult.state;
        }
        await shopifyUserService.updateCustomerMetafields(shopifyCustomerId, metafields);
        console.log(`✅ [QUESTIONNAIRE] Updated Shopify customer metafields for customer ${shopifyCustomerId}`);
      }
    } catch (e) {
      console.warn('[Questionnaire] Failed to update Shopify customer metafields (non-critical):', e?.message || e);
      // Non-critical, continue
    }

    // Remember this submission to avoid duplicates
    if (dedupeKey) {
      rememberSubmission(patientId, dedupeKey, { questionnaireDocument: qDoc, prescriptionDocument: rxDoc });
    }

    const isMocked = useMock;
    
    // Build comprehensive response with chart and document information
    const response = {
      success: true,
      message: isMocked 
        ? 'Questionnaire accepted (stored locally for development)' 
        : 'Questionnaire and prescription stored in your Tebra patient chart successfully',
      patientId,
      patientName: `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || patient.email,
      patientCreated,
      questionnaireDocument: qDoc ? {
        id: qDoc.id || qDoc.ID || 'Created',
        name: qDoc.name || 'Online Questionnaire',
        status: qDoc.status || 'Completed',
        label: qDoc.label || 'Consultation',
      } : null,
      prescriptionDocument: rxDoc ? {
        id: rxDoc.id || rxDoc.ID || 'Created',
        name: rxDoc.name || 'Prescription',
        status: rxDoc.status || 'Completed',
        label: rxDoc.label || 'Prescription',
      } : null,
      rxId: rxId || null,
      requiresConsult: evalResult.requiresConsult,
      restrictions: evalResult.restrictions || [],
      mock: isMocked,
      chartCreated: patientCreated && !isMocked, // Indicate if a real chart was created
    };
    
    console.log(`✅ [QUESTIONNAIRE] Submission complete for patient ${patientId}:`, {
      patientCreated,
      questionnaireDoc: response.questionnaireDocument?.id,
      prescriptionDoc: response.prescriptionDocument?.id,
      requiresConsult: response.requiresConsult,
    });
    
    res.json(response);
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const code = status === 502 ? 'E_TEBRA_UPSTREAM' : 'E_UNKNOWN';
    const message = error?.message || (status === 502 ? 'Upstream EHR (Tebra) error' : 'Failed to submit questionnaire');
    console.error('Questionnaire submit error:', message, error?.details || error);
    res.status(status).json({ success: false, message, code });
  }
};
