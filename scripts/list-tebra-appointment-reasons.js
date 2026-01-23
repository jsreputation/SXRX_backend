#!/usr/bin/env node

/**
 * List Tebra Appointment Reasons for a practice
 *
 * Use this to find an ID or name to set TEBRA_DEFAULT_APPT_REASON_ID or
 * TEBRA_DEFAULT_APPT_REASON_NAME (or TEBRA_APPT_REASON_ID_<STATE> /
 * TEBRA_APPT_REASON_NAME_<STATE>).
 *
 * Run from backend/:
 *   node scripts/list-tebra-appointment-reasons.js [practiceId]
 *
 * If practiceId is omitted, TEBRA_PRACTICE_ID or TEBRA_PRACTICE_ID_CA is used.
 *
 * Requires: .env with TEBRA_CUSTOMER_KEY, TEBRA_USER, TEBRA_PASSWORD,
 *           TEBRA_SOAP_WSDL, TEBRA_SOAP_ENDPOINT (and PracticeId if not passed).
 */

require('dotenv').config();

const practiceId =
  process.argv[2] ||
  process.env.TEBRA_PRACTICE_ID ||
  process.env.TEBRA_PRACTICE_ID_CA ||
  process.env.TEBRA_PRACTICE_ID_TX ||
  process.env.TEBRA_PRACTICE_ID_WA ||
  process.env.TEBRA_PRACTICE_ID_KL ||
  process.env.TEBRA_PRACTICE_ID_SC;

if (!practiceId) {
  console.error('Usage: node scripts/list-tebra-appointment-reasons.js <practiceId>');
  console.error('   or set TEBRA_PRACTICE_ID or TEBRA_PRACTICE_ID_<STATE> in .env');
  process.exit(1);
}

async function main() {
  const getTebraService = require('../src/services/tebraServiceSingleton');
  const tebra = getTebraService();

  try {
    const result = await tebra.getAppointmentReasons(practiceId);
    const reasons = result?.appointmentReasons || [];

    if (reasons.length === 0) {
      console.log('No appointment reasons returned for practice', practiceId);
      process.exit(0);
      return;
    }

    console.log('\nTebra Appointment Reasons (practiceId=%s)\n', practiceId);
    console.log('  %-6s  %s', 'ID', 'Name');
    console.log('  ' + '-'.repeat(50));

    for (const r of reasons) {
      const id = r.id ?? r.appointmentReasonId ?? '-';
      const name = (r.name || '-').slice(0, 44);
      console.log('  %-6s  %s', String(id), name);
    }

    const first = reasons[0];
    const firstId = first?.id ?? first?.appointmentReasonId;
    const firstName = first?.name;

    console.log('\n--- .env examples ---');
    if (firstId != null) {
      console.log('TEBRA_DEFAULT_APPT_REASON_ID=%s', firstId);
    }
    if (firstName) {
      console.log('TEBRA_DEFAULT_APPT_REASON_NAME=%s', JSON.stringify(firstName));
    }
    console.log('');
  } catch (e) {
    console.error('Error:', e.message || e);
    if (e.response?.data) console.error('Response:', String(e.response.data).slice(0, 500));
    process.exit(1);
  }
}

main();
