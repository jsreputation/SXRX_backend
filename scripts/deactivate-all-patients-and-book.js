#!/usr/bin/env node
/**
 * 1) Deactivate all patients in Tebra (practice 1).
 *    Note: Tebra SOAP does not support DeactivatePatient (ActionNotSupported); step 1 will skip.
 * 2) Book an appointment with:
 *    email: stepanyan.arman981@gmail.com, firstName: Arman, lastName: Ar,
 *    startTime: 2026-01-27T09:00:00.000Z, state: CA
 *
 * Booking requires TEBRA_PROVIDER_GUID_CA or TEBRA_PROVIDER_GUID in .env (valid UUID from Tebra).
 *
 * Run from backend/: node scripts/deactivate-all-patients-and-book.js
 */

require('dotenv').config();

const practiceId = '1';
let startTime = '2026-01-27T09:00:00.000Z';
let endTime = '2026-01-27T09:30:00.000Z';
const email = 'stepanyan.arman981@gmail.com';
const firstName = 'Arman';
const lastName = 'Ar';

function ensureFutureSlot() {
  const start = new Date(startTime);
  if (start.getTime() < Date.now()) {
    const s = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const e = new Date(s.getTime() + 30 * 60 * 1000);
    startTime = s.toISOString().replace(/\.\d{3}Z$/, 'Z');
    endTime = e.toISOString().replace(/\.\d{3}Z$/, 'Z');
    console.warn('startTime was in the past; using 2 days from now:', startTime);
  }
}

async function main() {
  if (!process.env.TEBRA_CUSTOMER_KEY || !process.env.TEBRA_USER || !process.env.TEBRA_PASSWORD) {
    console.error('Missing Tebra credentials. Set TEBRA_CUSTOMER_KEY, TEBRA_USER, TEBRA_PASSWORD in .env');
    process.exit(1);
  }

  ensureFutureSlot();

  const getTebra = require('../src/services/tebraServiceSingleton');
  const tebra = getTebra();

  console.log('\n=== 1) Deactivate all patients (practice', practiceId + ') ===');

  let res;
  try {
    res = await tebra.getPatients({ practiceId });
  } catch (e) {
    console.error('GetPatients failed:', e.message);
    throw e;
  }

  const rawList = res?.GetPatientsResult?.Patients || res?.patients || [];
  const ids = rawList
    .map((p) => String(p?.ID ?? p?.PatientID ?? p?.id ?? ''))
    .filter(Boolean);

  console.log('Found', ids.length, 'patient(s):', ids.length ? ids.slice(0, 10).join(', ') + (ids.length > 10 ? '...' : '') : '(none)');

  let deactivateNotSupported = false;
  for (const id of ids) {
    try {
      await tebra.deactivatePatient(id);
      console.log('  Deactivated:', id);
    } catch (e) {
      if (e?.code === 'TEBRA_DEACTIVATE_NOT_SUPPORTED' || /does not support DeactivatePatient/.test(String(e?.message))) {
        deactivateNotSupported = true;
        console.warn('  Tebra does not support DeactivatePatient (ActionNotSupported). Skipping remaining.');
        break;
      }
      console.warn('  DeactivatePatient', id, 'failed:', e.message);
    }
  }
  if (deactivateNotSupported) {
    console.log('  → Deactivation is not available in this Tebra SOAP API; patients were not changed.\n');
  }

  console.log('\n=== 2) Book appointment ===');
  console.log('email:', email, 'firstName:', firstName, 'lastName:', lastName);
  console.log('startTime:', startTime, 'endTime:', endTime, 'state: CA\n');

  // Resolve patientId by email (search or create)
  console.log('--- Resolve patient by email ---');
  let patientId;
  try {
    const search = await tebra.searchPatients({ email });
    const first = (search.patients || [])[0];
    if (first && (first.ID || first.id)) {
      patientId = String(first.ID || first.id);
      console.log('Found existing patient:', patientId);
    } else {
      const created = await tebra.createPatient({
        email,
        firstName,
        lastName,
        state: 'CA',
        practiceId,
      });
      patientId = String(created?.id || created?.patientId || created?.PatientID || '');
      if (!patientId) throw new Error('CreatePatient returned no id');
      console.log('Created new patient:', patientId);
    }
  } catch (e) {
    console.error('Resolve patient error:', e.message);
    throw e;
  }

  // GetAppointmentReasons (informational)
  try {
    const reasons = await tebra.getAppointmentReasons(practiceId);
    const r = (reasons?.appointmentReasons || [])[0];
    console.log('First reason: id=', r?.id ?? r?.appointmentReasonId, 'name=', r?.name);
  } catch (e) {
    console.warn('GetAppointmentReasons:', e.message);
  }

  // buildAppointmentData + CreateAppointment
  console.log('\n--- buildAppointmentData + CreateAppointment ---');
  const base = {
    patientId,
    practiceId,
    providerId: '1',
    serviceLocationId: '1',
    appointmentReasonId: '80',
    startTime,
    endTime,
    patientFirstName: firstName,
    patientLastName: lastName,
    patientEmail: email,
    state: 'CA',
  };

  try {
    const built = await tebra.buildAppointmentData(base);
    console.log('Built AppointmentReasonID:', built.AppointmentReasonID, 'ProviderGuids:', built.ProviderGuids ?? '(none)');
    const result = await tebra.createAppointment(base);
    const id = result?.CreateAppointmentResult?.Appointment?.AppointmentID
      || result?.CreateAppointmentResult?.Appointment?.AppointmentId
      || result?.CreateAppointmentResult?.Appointment?.id;
    console.log('CreateAppointment OK, id:', id);
  } catch (e) {
    console.log('CreateAppointment FAILED:', (e.message || e).slice(0, 400));
    if (/ProviderGuids or ResourceGuids/i.test(String(e.message || e))) {
      console.log('\n→ Set TEBRA_PROVIDER_GUID_CA or TEBRA_PROVIDER_GUID in .env with a valid UUID from Tebra.');
    } else {
      throw e;
    }
  }

  console.log('\n--- done ---\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
