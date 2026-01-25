#!/usr/bin/env node
/**
 * Validate whether the UUIDs from app.kareo.com appear in Tebra BILLING-related
 * API responses (GetCharges, GetTransactions, GetEncounterDetails).
 *
 * UUIDs checked:
 *   - 02957c9e-577c-476d-849e-cf17942ef276 (User GUID, from .../users/...)
 *   - 74d1d497-535e-4aa0-9e4e-2bbf67a53a7d (Provider Profile GUID, from .../provider-profiles/...)
 *
 * Note: Billing APIs (GetCharges, GetTransactions, CreateDocument, CreateEncounter) do NOT
 * accept ProviderGuid/User GUID as input. This script only checks if these IDs APPEAR IN
 * billing responses (e.g. as rendering provider on charges/encounters).
 *
 * Run from backend/: node scripts/validate-uuids-for-billing.js
 */

require('dotenv').config();

const practiceId = process.env.TEBRA_PRACTICE_ID_CA || process.env.TEBRA_PRACTICE_ID || '1';
const practiceName = process.env.TEBRA_PRACTICE_NAME || process.env.TEBRA_PRACTICE_NAME_CA || 'SXRX, LLC';

const CANDIDATES = [
  { uuid: '02957c9e-577c-476d-849e-cf17942ef276', label: 'User GUID (users/...)', source: 'app.kareo.com/.../users/...' },
  { uuid: '74d1d497-535e-4aa0-9e4e-2bbf67a53a7d', label: 'Provider Profile GUID', source: 'app.kareo.com/.../provider-profiles/...' }
];

function toStr(v) {
  if (typeof v === 'string') return v;
  if (v?.data != null) return String(v.data);
  return String(v ?? '');
}

function appearsIn(str, uuid) {
  return str && typeof str === 'string' && str.includes(uuid);
}

async function main() {
  const getTebra = require('../src/services/tebraServiceSingleton');
  const tebra = getTebra();

  const from = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);

  const inGetCharges = new Set();
  const inGetTransactions = new Set();
  const inGetEncounterDetails = new Set();
  let encounterIdsFromCharges = [];
  let getChargesErr = null;
  let getTransactionsErr = null;

  console.log('\n=== Validate UUIDs in Billing API Responses ===\n');
  console.log('UUIDs to check:');
  CANDIDATES.forEach(({ uuid, label }) => console.log(`  - ${uuid}  [${label}]`));
  console.log('\nBilling APIs do NOT accept these as input. We only check if they appear IN the responses.\n');
  console.log('Date range:', from, '→', to);
  console.log('practiceName:', practiceName, '  practiceId:', practiceId);
  console.log('');

  // ----- 1) GetCharges -----
  try {
    const raw = await tebra.getCharges({
      practiceName,
      fromCreatedDate: from,
      toCreatedDate: to
    });
    const str = toStr(raw);
    CANDIDATES.forEach(c => { if (appearsIn(str, c.uuid)) inGetCharges.add(c.uuid); });
    const encMatches = str.match(/<EncounterI[Dd][^>]*>([^<]+)<\/EncounterI[Dd]>/gi);
    if (encMatches) {
      encounterIdsFromCharges = encMatches.map(m => {
        const v = m.replace(/<\/?[^>]+>/g, '').trim();
        return v || null;
      }).filter(Boolean);
      encounterIdsFromCharges = [...new Set(encounterIdsFromCharges)].slice(0, 5);
    }
    console.log('--- 1) GetCharges ---');
    console.log('  EncounterIDs in response:', encounterIdsFromCharges.length ? encounterIdsFromCharges.slice(0, 5).join(', ') : '(none)');
    CANDIDATES.forEach(c => console.log(`  ${c.uuid.slice(0, 8)}... in response: ${inGetCharges.has(c.uuid) ? 'YES' : 'no'}`));
  } catch (e) {
    getChargesErr = e;
    console.log('--- 1) GetCharges --- Error:', e.message);
  }
  console.log('');

  // ----- 2) GetTransactions -----
  try {
    const raw = await tebra.getTransactions({
      practiceName,
      fromTransactionDate: from,
      toTransactionDate: to
    });
    const str = toStr(raw);
    CANDIDATES.forEach(c => { if (appearsIn(str, c.uuid)) inGetTransactions.add(c.uuid); });
    console.log('--- 2) GetTransactions ---');
    CANDIDATES.forEach(c => console.log(`  ${c.uuid.slice(0, 8)}... in response: ${inGetTransactions.has(c.uuid) ? 'YES' : 'no'}`));
  } catch (e) {
    getTransactionsErr = e;
    console.log('--- 2) GetTransactions --- Error:', e.message);
  }
  console.log('');

  // ----- 3) GetEncounterDetails (for encounters from GetCharges) -----
  if (encounterIdsFromCharges.length > 0) {
    console.log('--- 3) GetEncounterDetails (from GetCharges EncounterIDs) ---');
    for (const encId of encounterIdsFromCharges.slice(0, 3)) {
      try {
        const enc = await tebra.getEncounterDetails(encId, practiceId);
        const str = typeof enc === 'object' ? JSON.stringify(enc) : toStr(enc);
        CANDIDATES.forEach(c => { if (appearsIn(str, c.uuid)) inGetEncounterDetails.add(c.uuid); });
        console.log(`  EncounterID ${encId}: checked for UUIDs`);
      } catch (e) {
        console.log(`  EncounterID ${encId}: Error ${e.message}`);
      }
    }
    CANDIDATES.forEach(c => console.log(`  ${c.uuid.slice(0, 8)}... in any GetEncounterDetails: ${inGetEncounterDetails.has(c.uuid) ? 'YES' : 'no'}`));
  } else {
    console.log('--- 3) GetEncounterDetails ---');
    console.log('  No EncounterIDs in GetCharges; skipped.');
  }
  console.log('');

  // ----- Report -----
  console.log('=== Billing availability report ===\n');
  console.log('| UUID (short)     | Label                | In GetCharges? | In GetTransactions? | In GetEncounterDetails? |');
  console.log('|------------------|----------------------|----------------|---------------------|--------------------------|');
  for (const c of CANDIDATES) {
    const a = inGetCharges.has(c.uuid) ? 'YES' : 'no';
    const b = inGetTransactions.has(c.uuid) ? 'YES' : 'no';
    const d = inGetEncounterDetails.has(c.uuid) ? 'YES' : 'no';
    console.log(`| ${c.uuid.slice(0, 8)}...       | ${c.label.padEnd(20)} | ${a.padEnd(14)} | ${b.padEnd(19)} | ${d.padEnd(24)} |`);
  }
  console.log('');
  console.log('Interpretation:');
  console.log('  - "YES" = this UUID appears in the billing/encounter response (e.g. as ProviderGuid, ResourceGuid, or in raw XML).');
  console.log('  - "no"  = not found in that response (may be no data in range, or this ID is not used in billing).');
  console.log('');
  console.log('Important:');
  console.log('  - GetCharges, GetTransactions, CreateDocument, CreateEncounter do NOT accept ProviderGuid or User GUID as input.');
  console.log('  - These IDs cannot be passed INTO billing APIs; we only checked if they appear in GET responses.');
  console.log('  - If both show "no" everywhere, either there is no billing/transaction data in the date range, or');
  console.log('    these UUIDs are not used by Tebra in charge/transaction/encounter records.');
  if (getChargesErr || getTransactionsErr) {
    console.log('  - One or more billing calls failed; "no" may be due to API errors.');
  }
  console.log('');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
