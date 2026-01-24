#!/usr/bin/env node

/**
 * Test CreateAppointment against live Tebra SOAP API.
 *
 * Runs: GetAppointmentReasons, (optional) GetPatient, buildAppointmentData, CreateAppointment
 * with sample data to reproduce and diagnose "Error translating AppointmentCreate to CreateAppointmentV3Request".
 *
 * Usage (from backend/):
 *   node scripts/test-create-appointment-tebra.js [practiceId] [patientId]
 *
 * Defaults: practiceId=1, patientId=2 (or from TEBRA_PRACTICE_ID_CA, TEST_PATIENT_ID).
 * Requires: .env with TEBRA_CUSTOMER_KEY, TEBRA_USER, TEBRA_PASSWORD, TEBRA_SOAP_WSDL, TEBRA_SOAP_ENDPOINT.
 */

require('dotenv').config();

const practiceId = String(process.argv[2] || process.env.TEBRA_PRACTICE_ID_CA || process.env.TEBRA_PRACTICE_ID || '1');
const patientId = String(process.argv[3] || process.env.TEST_PATIENT_ID || '2');

// Start ~7 days from now, 9:00 UTC
const start = new Date();
start.setDate(start.getDate() + 7);
start.setUTCHours(9, 0, 0, 0);
const end = new Date(start.getTime() + 30 * 60 * 1000);

const sampleAppointmentData = {
  appointmentName: 'Direct Consultation',
  appointmentStatus: 'Scheduled',
  appointmentType: 'P',
  appointmentMode: 'Telehealth',
  startTime: start.toISOString(),
  endTime: end.toISOString(),
  patientId,
  patientFirstName: 'Test',
  patientLastName: 'Script',
  patientEmail: 'test-script@example.com',
  practiceId: String(practiceId),
  providerId: process.env.TEBRA_PROVIDER_ID_CA || process.env.TEBRA_DEFAULT_PROVIDER_ID || '1',
  serviceLocationId: process.env.TEBRA_SERVICE_LOCATION_ID_CA || process.env.TEBRA_SERVICE_LOCATION_ID || '1',
  appointmentReasonId: process.env.TEBRA_APPT_REASON_NAME_CA || process.env.TEBRA_DEFAULT_APPT_REASON_NAME || 'Counseling',
  notes: 'Test from scripts/test-create-appointment-tebra.js',
  isRecurring: false,
};

async function main() {
  const tebra = require('../src/services/tebraService');

  console.log('\n=== Tebra CreateAppointment diagnostic ===\n');
  console.log('PracticeId:', practiceId, '| PatientId:', patientId);
  console.log('Start:', sampleAppointmentData.startTime, '| End:', sampleAppointmentData.endTime);
  console.log('AppointmentReasonId (input):', sampleAppointmentData.appointmentReasonId);

  // 1) GetProviders – fetch to find Provider Guid (CreateAppointmentV3 requires ProviderGuids or ResourceGuids)
  try {
    const prov = await tebra.getProviders({ practiceId });
    const providers = prov?.providers || [];
    console.log('\n--- GetProviders (for ProviderGuid) ---');
    if (providers.length === 0) {
      console.log('(none)');
    } else {
      for (const p of providers.slice(0, 3)) {
        console.log('  provider:', JSON.stringify({ id: p.id, providerId: p.providerId, guid: p.guid, fullName: p.fullName }));
      }
      if (providers[0] && !providers[0].guid) {
        console.log('  → No .guid on normalized provider. Raw GetProviders may include Guid – check Tebra API docs.');
      }
    }
  } catch (e) {
    console.warn('GetProviders error:', e.message);
  }

  // 2) GetAppointmentReasons – see which IDs Tebra returns
  try {
    const reasons = await tebra.getAppointmentReasons(practiceId);
    const list = reasons?.appointmentReasons || [];
    console.log('\n--- GetAppointmentReasons ---');
    if (list.length === 0) {
      console.log('(none)');
    } else {
      for (const r of list) {
        console.log('  id:', r.id ?? r.appointmentReasonId, '| name:', r.name || '-');
      }
      const first = list[0];
      const firstId = first?.id ?? first?.appointmentReasonId;
      console.log('\n→ Suggestion: TEBRA_DEFAULT_APPT_REASON_ID=' + firstId);
    }
  } catch (e) {
    console.error('GetAppointmentReasons error:', e.message);
  }

  // 3) Optional: verify patient exists
  try {
    const p = await tebra.getPatient(patientId);
    console.log('\n--- GetPatient(' + patientId + ') ---');
    console.log('  FirstName:', p?.FirstName, '| LastName:', p?.LastName, '| Email:', p?.Email);
  } catch (e) {
    console.warn('GetPatient(' + patientId + ') error:', e.message, '| continuing with CreateAppointment');
  }

  // 4) Build payload (same as createAppointment does) and log it
  try {
    const built = await tebra.buildAppointmentData(sampleAppointmentData);
    console.log('\n--- buildAppointmentData (payload to SOAP) ---');
    console.log(JSON.stringify(built, null, 2));
    console.log('\n  AppointmentReasonID:', built.AppointmentReasonID);
    console.log('  ResourceID:', built.ResourceID, '| ResourceIds:', built.ResourceIds);
  } catch (e) {
    console.error('buildAppointmentData error:', e.message);
    process.exit(1);
  }

  // 5) CreateAppointment – full request/response will be in service logs
  console.log('\n--- CreateAppointment (see TEBRA logs above for XML and response) ---');
  try {
    const result = await tebra.createAppointment(sampleAppointmentData);
    const id = result?.CreateAppointmentResult?.Appointment?.AppointmentID
      || result?.CreateAppointmentResult?.Appointment?.AppointmentId
      || result?.CreateAppointmentResult?.Appointment?.id
      || result?.id;
    console.log('SUCCESS – AppointmentID:', id);
    console.log('Result (keys):', Object.keys(result || {}));
  } catch (e) {
    console.error('CreateAppointment FAILED:', e.message);
    // Try to extract ErrorMessage from common patterns
    const m = String(e.message || '').match(/CreateAppointmentV3Request|ProviderGuids or ResourceGuids/);
    if (m) {
      console.error('\n→ CreateAppointmentV3 / ProviderGuids or ResourceGuids:');
      console.error('  1) CreateAppointmentV3 requires ProviderGuids or ResourceGuids (UUIDs), not ProviderID/ResourceID.');
      console.error('     SOAP 2.1 only sends ProviderID/ResourceID; Tebra’s translator does not map them to GUIDs.');
      console.error('  2) Contact Tebra to: (a) enable ID→GUID mapping for your customer, or (b) get the Provider/Resource');
      console.error('     GUIDs for your practice and we can add ProviderGuids/ResourceGuids to the SOAP payload.');
      console.error('  3) AppointmentReasonID: set TEBRA_DEFAULT_APPT_REASON_ID from: node scripts/list-tebra-appointment-reasons.js ' + practiceId);
    }
    process.exit(1);
  }

  console.log('\n=== done ===\n');
}

main();
