#!/usr/bin/env node
/**
 * Test the /book flow pieces: GetProviders (for Guid), UpdatePatient, buildAppointmentData, CreateAppointment.
 * Reproduces: UpdatePatient InternalServiceFault, CreateAppointment "ProviderGuids or ResourceGuids".
 *
 * Run from backend/: node scripts/test-booking-flow-tebra.js [practiceId] [patientId]
 * Example: node scripts/test-booking-flow-tebra.js 1 2
 *
 * Uses .env for Tebra creds. Optional: TEBRA_PROVIDER_GUID or TEBRA_PROVIDER_GUID_CA to test ProviderGuids.
 */

require('dotenv').config();

const practiceId = process.argv[2] || process.env.TEBRA_PRACTICE_ID || process.env.TEBRA_PRACTICE_ID_CA || '1';
const patientId = process.argv[3] || process.env.TEST_PATIENT_ID || '2';

async function main() {
  const getTebra = require('../src/services/tebraServiceSingleton');
  const tebra = getTebra();

  console.log('\n=== Tebra booking-flow diagnostic ===');
  console.log('practiceId:', practiceId, 'patientId:', patientId);
  console.log('');

  // 1) GetProviders – check if any provider has Guid (for ProviderGuids in CreateAppointment)
  console.log('--- 1) GetProviders ---');
  try {
    const prov = await tebra.getProviders({ practiceName: process.env.TEBRA_PRACTICE_NAME || process.env.TEBRA_PRACTICE_NAME_CA || 'SXRX, LLC' });
    const list = prov?.providers || prov?.Providers || [];
    const first = list[0];
    if (first) {
      console.log('First provider keys:', Object.keys(first));
      console.log('  id:', first.id ?? first.providerId ?? first.ID);
      console.log('  fullName:', first.fullName ?? first.FullName);
      console.log('  guid:', first.guid ?? first.Guid ?? first.ProviderGuid ?? '(none)');
      if (!(first.guid || first.Guid || first.ProviderGuid)) {
        console.log('  → No provider Guid. CreateAppointmentV3 needs ProviderGuids; set TEBRA_PROVIDER_GUID if Tebra gives you one.');
      }
    } else {
      console.log('No providers returned.');
    }
  } catch (e) {
    console.error('GetProviders error:', e.message);
  }

  // 2) GetAppointmentReasons – sanity
  console.log('\n--- 2) GetAppointmentReasons ---');
  try {
    const reasons = await tebra.getAppointmentReasons(practiceId);
    const r = (reasons?.appointmentReasons || [])[0];
    if (r) {
      console.log('First reason: id=', r.id ?? r.appointmentReasonId, 'name=', r.name, 'guid=', r.appointmentReasonGuid ?? '(none)');
    } else {
      console.log('No reasons.');
    }
  } catch (e) {
    console.error('GetAppointmentReasons error:', e.message);
  }

  // 3) UpdatePatient – minimal then with "not provided" to find root cause of InternalServiceFault
  console.log('\n--- 3) UpdatePatient ---');
  for (const label of ['minimal { firstName, lastName }', '{ firstName, lastName, phone: "not provided", mobilePhone: "not provided" }']) {
    const isMinimal = label.startsWith('minimal');
    const up = isMinimal
      ? { firstName: 'Arman', lastName: 'Ar' }
      : { firstName: 'Arman', lastName: 'Ar', phone: 'not provided', mobilePhone: 'not provided' };
    try {
      await tebra.updatePatient(patientId, up);
      console.log('  OK:', label);
    } catch (e) {
      console.log('  FAIL:', label);
      console.log('    ', (e.message || e).slice(0, 200));
      if (/InternalServiceFault|internal error/i.test(String(e.message || e))) {
        console.log('    → InternalServiceFault: Tebra server error. Set TEBRA_SKIP_UPDATE_PATIENT_ON_BOOK=true to skip UpdatePatient during /book.');
      }
    }
  }

  // 4) buildAppointmentData + CreateAppointment – reproduces ProviderGuids error
  console.log('\n--- 4) buildAppointmentData + CreateAppointment ---');
  const base = {
    patientId,
    practiceId,
    providerId: process.env.TEBRA_PROVIDER_ID_CA || process.env.TEBRA_PROVIDER_ID || '1',
    serviceLocationId: process.env.TEBRA_SERVICE_LOCATION_ID_CA || process.env.TEBRA_SERVICE_LOCATION_ID || '1',
    appointmentReasonId: process.env.TEBRA_APPT_REASON_ID_CA || process.env.TEBRA_DEFAULT_APPT_REASON_ID || '80',
    startTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    endTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    patientFirstName: 'Arman',
    patientLastName: 'Ar',
    patientEmail: 'test@example.com',
    state: 'CA',
  };
  // If env has Provider GUID, pass it
  const guid = process.env.TEBRA_PROVIDER_GUID || process.env.TEBRA_PROVIDER_GUID_CA;
  if (guid && /^[0-9a-fA-F-]{36}$/.test(guid)) {
    base.providerGuid = guid;
    console.log('Using TEBRA_PROVIDER_GUID / TEBRA_PROVIDER_GUID_CA in request.');
  }

  try {
    const built = await tebra.buildAppointmentData(base);
    console.log('Built AppointmentReasonID:', built.AppointmentReasonID, 'ProviderGuids:', built.ProviderGuids ?? '(none)');
    const result = await tebra.createAppointment(base);
    const id = result?.CreateAppointmentResult?.Appointment?.AppointmentID
      || result?.CreateAppointmentResult?.Appointment?.AppointmentId
      || result?.CreateAppointmentResult?.Appointment?.id;
    console.log('CreateAppointment OK, id:', id);
  } catch (e) {
    console.log('CreateAppointment FAILED:', (e.message || e).slice(0, 300));
    if (/ProviderGuids or ResourceGuids/i.test(String(e.message || e))) {
      console.log('\n→ CreateAppointmentV3 requires ProviderGuids or ResourceGuids (UUIDs).');
      console.log('  - Get Provider/Resource GUIDs from Tebra (Support or another API) and set TEBRA_PROVIDER_GUID or TEBRA_PROVIDER_GUID_CA.');
      console.log('  - Or ask Tebra to map ProviderID/ResourceID to GUIDs in their CreateAppointment→V3 layer.');
    }
  }

  console.log('\n--- done ---\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
