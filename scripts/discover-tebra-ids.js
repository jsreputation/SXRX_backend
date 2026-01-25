#!/usr/bin/env node
/**
 * Discover Practice ID, Provider ID, and Provider/Resource GUID from Tebra SOAP API.
 * Updates .env with discovered values. GUID is not exposed by SOAP 2.1; we try all known methods.
 *
 * Run from backend/: node scripts/discover-tebra-ids.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

function findUuids(str) {
  if (!str || typeof str !== 'string') return [];
  const m = str.match(UUID_RE);
  return m ? [...new Set(m)] : [];
}

function toStr(v) {
  if (typeof v === 'string') return v;
  if (v?.data != null) return String(v.data);
  return String(v ?? '');
}

function updateEnv(updates) {
  const envPath = path.join(__dirname, '..', '.env');
  let content = fs.readFileSync(envPath, 'utf8');
  for (const [key, value] of Object.entries(updates)) {
    if (value == null) continue;
    const regex = new RegExp(`^(${key})=.*`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `$1=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  }
  fs.writeFileSync(envPath, content);
}

async function main() {
  const getTebra = require('../src/services/tebraServiceSingleton');
  const tebra = getTebra();

  let practiceId = null;
  let providerId = null;
  let providerGuid = null;

  const practiceName = process.env.TEBRA_PRACTICE_NAME || process.env.TEBRA_PRACTICE_NAME_CA || 'SXRX, LLC';

  console.log('\n=== Discover Practice ID, Provider ID, Provider GUID ===\n');

  // ----- 1) GetPractices → Practice ID -----
  try {
    const result = await tebra.getPractices({ practiceName });
    const list = result?.practices || result?.Practices || [];
    if (list.length > 0) {
      practiceId = String(list[0].id ?? list[0].practiceId ?? list[0].ID ?? '');
      console.log('--- 1) GetPractices ---');
      console.log('  practiceId:', practiceId, '  name:', list[0].name || list[0].PracticeName);
    }
    // Also scan raw for any Guid
    const raw = await tebra.callRawSOAPMethod('GetPractices', { ID: 1, PracticeName: 1, Active: 1 }, { PracticeName: practiceName });
    const uuids = findUuids(toStr(raw));
    if (uuids.length && !providerGuid) providerGuid = uuids[0];
  } catch (e) {
    console.log('  GetPractices error:', e.message);
  }

  const pid = practiceId || process.env.TEBRA_PRACTICE_ID_CA || process.env.TEBRA_PRACTICE_ID || '1';

  // ----- 2) GetProviders → Provider ID (and Guid if present) -----
  try {
    const result = await tebra.getProviders({ practiceId: pid });
    const list = result?.providers || result?.Providers || [];
    console.log('\n--- 2) GetProviders ---');
    if (list.length > 0) {
      providerId = String(list[0].id ?? list[0].providerId ?? list[0].ID ?? '');
      const guid = list[0].guid ?? list[0].Guid ?? list[0].ProviderGuid;
      console.log('  providerId:', providerId, '  fullName:', list[0].fullName || list[0].FullName, '  guid:', guid || '(none)');
      if (guid && /^[0-9a-fA-F-]{36}$/.test(guid)) providerGuid = guid;
    } else {
      console.log('  No providers returned.');
    }
    const raw = await tebra.callRawSOAPMethod('GetProviders', { ID: 1, FirstName: 1, LastName: 1, Active: 1, Guid: 1, ProviderGuid: 1 }, { PracticeId: pid });
    const uuids = findUuids(toStr(raw));
    if (uuids.length && !providerGuid) providerGuid = uuids[0];
  } catch (e) {
    console.log('  GetProviders error:', e.message);
  }

  // ----- 3) GetProvider (singular) – if it exists -----
  try {
    const raw = await tebra.callRawSOAPMethod('GetProvider', { ID: 1 }, { PracticeId: pid });
    const str = toStr(raw);
    const uuids = findUuids(str);
    const tag = str.match(/<(?:ProviderGuid|ResourceGuid)[^>]*>([^<]+)</i);
    console.log('\n--- 3) GetProvider (singular) ---');
    if (tag && /^[0-9a-fA-F-]{36}$/.test(tag[1].trim())) { providerGuid = tag[1].trim(); console.log('  ProviderGuid:', providerGuid); }
    else if (uuids.length && !providerGuid) { providerGuid = uuids[0]; console.log('  UUID:', providerGuid); }
    else console.log('  Not available or no Guid in response.');
  } catch (e) {
    console.log('\n--- 3) GetProvider (singular) ---');
    console.log('  Error (method may not exist):', e.message);
  }

  // ----- 4) GetResources – ResourceGuid -----
  try {
    const raw = await tebra.callRawSOAPMethod('GetResources', {}, { PracticeId: pid });
    const str = toStr(raw);
    const tag = str.match(/<(?:ProviderGuid|ResourceGuid)[^>]*>([^<]+)</i);
    const uuids = findUuids(str);
    console.log('\n--- 4) GetResources ---');
    if (tag && /^[0-9a-fA-F-]{36}$/.test(tag[1].trim())) { providerGuid = providerGuid || tag[1].trim(); console.log('  ResourceGuid/ProviderGuid:', tag[1].trim()); }
    else if (uuids.length && !providerGuid) { providerGuid = uuids[0]; console.log('  UUID:', providerGuid); }
    else console.log('  Not available or no Guid in response.');
  } catch (e) {
    console.log('\n--- 4) GetResources ---');
    console.log('  Error (method may not exist):', e.message);
  }

  // ----- 5) GetServiceLocations – ResourceGuid in raw -----
  try {
    const raw = await tebra.getServiceLocations({ practiceId: pid });
    const str = toStr(raw);
    const tag = str.match(/<(?:ProviderGuid|ResourceGuid|Resource_Guid)[^>]*>([^<]+)</i);
    const uuids = findUuids(str);
    console.log('\n--- 5) GetServiceLocations ---');
    if (tag && /^[0-9a-fA-F-]{36}$/.test(tag[1].trim())) { providerGuid = providerGuid || tag[1].trim(); console.log('  ResourceGuid:', tag[1].trim()); }
    else if (uuids.length && !providerGuid) { providerGuid = uuids[0]; console.log('  UUID:', providerGuid); }
    else console.log('  No Guid in response.');
  } catch (e) {
    console.log('\n--- 5) GetServiceLocations ---');
    console.log('  Error:', e.message);
  }

  // ----- 6) GetAppointmentReasons – only use explicit ProviderGuid/ResourceGuid -----
  try {
    const raw = await tebra.callRawSOAPMethod('GetAppointmentReasons', { PracticeId: pid }, {});
    const tag = toStr(raw).match(/<(?:ProviderGuid|ResourceGuid)[^>]*>([^<]+)</i);
    console.log('\n--- 6) GetAppointmentReasons ---');
    if (tag && /^[0-9a-fA-F-]{36}$/.test(tag[1].trim())) { providerGuid = providerGuid || tag[1].trim(); console.log('  ProviderGuid/ResourceGuid:', tag[1].trim()); }
    else console.log('  Only AppointmentReasonGuid (not for ProviderGuids).');
  } catch (e) {
    console.log('\n--- 6) GetAppointmentReasons ---');
    console.log('  Error:', e.message);
  }

  // ----- 7) GetAppointment (existing) – ProviderGuid/ResourceGuid -----
  try {
    const past = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const next = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ids = await tebra.getAppointmentIds({ practiceId: pid, startDate: past, endDate: next });
    console.log('\n--- 7) GetAppointment (existing) ---');
    if (ids && ids.length > 0) {
      const raw = await tebra.callRawSOAPMethod('GetAppointment', { Appointment: { AppointmentId: String(ids[0]) } }, {});
      const tag = toStr(raw).match(/<(?:ProviderGuid|ResourceGuid)[^>]*>([^<]+)</i);
      if (tag && /^[0-9a-fA-F-]{36}$/.test(tag[1].trim())) { providerGuid = providerGuid || tag[1].trim(); console.log('  ProviderGuid/ResourceGuid in appt:', tag[1].trim()); }
      else console.log('  No <ProviderGuid> or <ResourceGuid> in appointment.');
    } else console.log('  No existing appointments.');
  } catch (e) {
    console.log('\n--- 7) GetAppointment ---');
    console.log('  Error:', e.message);
  }

  // ----- 8) GetCharges – Charge/Encounter may reference ProviderGuid -----
  try {
    const from = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const raw = await tebra.getCharges({ practiceName, fromCreatedDate: from, toCreatedDate: to });
    const str = toStr(raw);
    const tag = str.match(/<(?:ProviderGuid|ResourceGuid)[^>]*>([^<]+)</i);
    const uuids = findUuids(str);
    console.log('\n--- 8) GetCharges ---');
    if (tag && /^[0-9a-fA-F-]{36}$/.test(tag[1].trim())) { providerGuid = providerGuid || tag[1].trim(); console.log('  ProviderGuid/ResourceGuid:', tag[1].trim()); }
    else if (uuids.length && !providerGuid) { providerGuid = uuids[0]; console.log('  UUID:', providerGuid); }
    else {
      const encMatch = str.match(/<EncounterI[Dd][^>]*>([^<]+)<\/EncounterI[Dd]>/i);
      const encounterId = encMatch && encMatch[1] ? encMatch[1].trim() : null;
      if (encounterId && !providerGuid) {
        try {
          const enc = await tebra.getEncounterDetails(encounterId, pid);
          const search = (o) => {
            if (!o || typeof o !== 'object') return;
            for (const [k, v] of Object.entries(o)) {
              if (/ProviderGuid|ResourceGuid/i.test(k) && typeof v === 'string' && /^[0-9a-fA-F-]{36}$/.test(v)) { providerGuid = v; return; }
              search(v);
            }
          };
          search(enc);
          if (providerGuid) console.log('  ProviderGuid/ResourceGuid from GetEncounterDetails:', providerGuid);
        } catch (_) {}
      }
      if (!providerGuid) console.log('  No ProviderGuid/ResourceGuid in GetCharges.');
    }
  } catch (e) {
    console.log('\n--- 8) GetCharges ---');
    console.log('  Error:', e.message);
  }

  // ----- 9) GetTransactions -----
  try {
    const from = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const raw = await tebra.getTransactions({ practiceName, fromTransactionDate: from, toTransactionDate: to });
    const str = toStr(raw);
    const tag = str.match(/<(?:ProviderGuid|ResourceGuid)[^>]*>([^<]+)</i);
    const uuids = findUuids(str);
    console.log('\n--- 9) GetTransactions ---');
    if (tag && /^[0-9a-fA-F-]{36}$/.test(tag[1].trim())) { providerGuid = providerGuid || tag[1].trim(); console.log('  ProviderGuid/ResourceGuid:', tag[1].trim()); }
    else if (uuids.length && !providerGuid) { providerGuid = uuids[0]; console.log('  UUID:', providerGuid); }
    else console.log('  No ProviderGuid/ResourceGuid in GetTransactions.');
  } catch (e) {
    console.log('\n--- 9) GetTransactions ---');
    console.log('  Error:', e.message);
  }

  // ----- Summary and .env update -----
  console.log('\n--- Summary ---');
  console.log('  practiceId:', practiceId ?? '(use env)');
  console.log('  providerId:', providerId ?? '(use env)');
  console.log('  providerGuid:', providerGuid ?? '(NOT FOUND – obtain from Tebra Admin/Support)');

  const updates = {};
  if (practiceId) { updates.TEBRA_PRACTICE_ID_CA = practiceId; updates.TEBRA_PRACTICE_ID = practiceId; }
  if (providerId) { updates.TEBRA_PROVIDER_ID_CA = providerId; updates.TEBRA_PROVIDER_ID = providerId; }
  if (providerGuid) { updates.TEBRA_PROVIDER_GUID_CA = providerGuid; updates.TEBRA_PROVIDER_GUID = providerGuid; }

  if (Object.keys(updates).length > 0) {
    updateEnv(updates);
    console.log('\n  Updated .env with:', Object.keys(updates).join(', '));
  } else {
    console.log('\n  No values to write to .env.');
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
