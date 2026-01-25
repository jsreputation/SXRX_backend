#!/usr/bin/env node
/**
 * Fetch provider GUIDs from Tebra for use in TEBRA_PROVIDER_GUID_CA etc.
 * CreateAppointmentV3 requires valid ProviderGuids or ResourceGuids (UUIDs).
 * Tries: GetProviders (normalized + raw XML scan), GetPractices, GetServiceLocations, GetAppointmentReasons.
 *
 * Run from backend/: node scripts/fetch-provider-guids.js
 * Uses .env for Tebra credentials. Practice: TEBRA_PRACTICE_ID_CA || TEBRA_PRACTICE_ID || 1
 */

require('dotenv').config();

const practiceId = process.env.TEBRA_PRACTICE_ID_CA || process.env.TEBRA_PRACTICE_ID || '1';
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

function snippet(xml, tag, max = 2200) {
  const re = new RegExp(`<[^>]*${tag}[^>]*>[\\s\\S]*?<\\/[^>]*${tag}[^>]*>`, 'i');
  const m = xml.match(re);
  if (!m) return null;
  return m[0].length > max ? m[0].slice(0, max) + '...' : m[0];
}

async function main() {
  const getTebra = require('../src/services/tebraServiceSingleton');
  const tebra = getTebra();

  console.log('\n=== Fetch Provider/Resource GUIDs from Tebra ===');
  console.log('practiceId:', practiceId);
  console.log('');

  let foundGuid = null;

  // ----- 1) GetProviders (normalized) -----
  try {
    const result = await tebra.getProviders({ practiceId });
    const list = result?.providers || result?.Providers || [];
    console.log('--- 1) GetProviders (normalized) ---');
    if (list.length === 0) {
      console.log('  No providers returned.');
    } else {
      for (const p of list) {
        const id = p.id ?? p.providerId ?? p.ID;
        const name = p.fullName ?? p.FullName ?? [p.firstName, p.lastName].filter(Boolean).join(' ');
        const guid = p.guid ?? p.Guid ?? p.ProviderGuid ?? p['sch:Guid'];
        console.log(`  id=${id}  fullName="${name || '(n/a)'}"  guid=${guid || '(none)'}`);
        if (guid && /^[0-9a-fA-F-]{36}$/.test(guid) && !foundGuid) foundGuid = guid;
      }
    }
  } catch (e) {
    console.log('  GetProviders error:', e.message);
  }

  // ----- 2) GetProviders RAW – direct call, scan full XML for UUIDs and ProviderData -----
  try {
    const expandedFields = {
      ID: 1, FirstName: 1, LastName: 1, Active: 1, NPI: 1,
      Guid: 1, ProviderGuid: 1, GUID: 1, ExternalId: 1, UniqueId: 1, UserId: 1
    };
    const raw = await tebra.callRawSOAPMethod('GetProviders', expandedFields, { PracticeId: practiceId });
    const str = toStr(raw);
    const uuids = findUuids(str);
    console.log('\n--- 2) GetProviders (raw XML scan) ---');
    if (uuids.length) {
      console.log('  UUIDs in response:', uuids.join(', '));
      if (!foundGuid) foundGuid = uuids[0];
    } else {
      console.log('  No UUIDs in raw GetProviders response.');
    }
    const provBlock = snippet(str, 'ProviderData');
    if (provBlock) {
      console.log('  First <ProviderData> snippet:');
      console.log(provBlock.replace(/^/gm, '    '));
    }
  } catch (e) {
    console.log('\n--- 2) GetProviders raw ---');
    console.log('  Error:', e.message);
  }

  // ----- 3) GetPractices raw – scan for UUIDs -----
  try {
    const fields = { ID: 1, PracticeName: 1, Active: 1 };
    const filters = { PracticeName: process.env.TEBRA_PRACTICE_NAME || process.env.TEBRA_PRACTICE_NAME_CA || 'SXRX, LLC' };
    const raw = await tebra.callRawSOAPMethod('GetPractices', fields, filters);
    const str = toStr(raw);
    const uuids = findUuids(str);
    console.log('\n--- 3) GetPractices (raw XML scan) ---');
    if (uuids.length) {
      console.log('  UUIDs in response:', uuids.join(', '));
      if (!foundGuid) foundGuid = uuids[0];
    } else {
      console.log('  No UUIDs in GetPractices response.');
    }
  } catch (e) {
    console.log('\n--- 3) GetPractices ---');
    console.log('  Error:', e.message);
  }

  // ----- 4) GetServiceLocations raw -----
  try {
    const raw = await tebra.getServiceLocations({ practiceId });
    const str = toStr(raw);
    const uuids = findUuids(str);
    console.log('\n--- 4) GetServiceLocations (raw XML scan) ---');
    if (uuids.length) {
      console.log('  UUIDs in response:', uuids.join(', '));
      if (!foundGuid) foundGuid = uuids[0];
    } else {
      console.log('  No UUIDs in GetServiceLocations response.');
    }
    const locBlock = snippet(str, 'ServiceLocation');
    if (locBlock) {
      console.log('  First <ServiceLocation> snippet:');
      console.log(locBlock.replace(/^/gm, '    '));
    }
  } catch (e) {
    console.log('\n--- 4) GetServiceLocations ---');
    console.log('  Error:', e.message);
  }

  // ----- 5) GetAppointmentReasons raw -----
  try {
    const raw = await tebra.callRawSOAPMethod('GetAppointmentReasons', { PracticeId: practiceId }, {});
    const str = toStr(raw);
    const uuids = findUuids(str);
    console.log('\n--- 5) GetAppointmentReasons (raw XML scan) ---');
    if (uuids.length) console.log('  UUIDs (AppointmentReasonGuid):', uuids.length, 'found');
    const provTag = str.match(/<(?:ProviderGuid|ResourceGuid|Provider_?[Gg]uid|Resource_?[Gg]uid)[^>]*>([^<]+)</i);
    if (provTag && /^[0-9a-fA-F-]{36}$/.test(provTag[1].trim()) && !foundGuid) {
      foundGuid = provTag[1].trim();
      console.log('  ProviderGuid/ResourceGuid tag found:', foundGuid);
    }
    if (!uuids.length && !provTag) console.log('  No UUIDs in GetAppointmentReasons response.');
  } catch (e) {
    console.log('\n--- 5) GetAppointmentReasons ---');
    console.log('  Error:', e.message);
  }

  // ----- 6) GetAppointment (existing) – may contain ProviderGuid/ResourceGuid -----
  try {
    const past = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const next = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ids = await tebra.getAppointmentIds({ practiceId, startDate: past, endDate: next });
    console.log('\n--- 6) GetAppointment (existing appts) ---');
    if (ids && ids.length > 0) {
      const raw = await tebra.callRawSOAPMethod('GetAppointment', { Appointment: { AppointmentId: String(ids[0]) } }, {});
      const str = toStr(raw);
      const provTag = str.match(/<(?:ProviderGuid|ResourceGuid)[^>]*>([^<]+)</i);
      if (provTag && /^[0-9a-fA-F-]{36}$/.test(provTag[1].trim()) && !foundGuid) {
        foundGuid = provTag[1].trim();
        console.log('  ProviderGuid/ResourceGuid in appt', ids[0], ':', foundGuid);
      } else console.log('  No <ProviderGuid> or <ResourceGuid> in first appointment.');
    } else console.log('  No existing appointments to inspect.');
  } catch (e) {
    console.log('\n--- 6) GetAppointment ---');
    console.log('  Error:', e.message);
  }

  // ----- Summary -----
  if (foundGuid) {
    console.log('\n# Add or update in .env:');
    console.log(`TEBRA_PROVIDER_GUID_CA=${foundGuid}`);
    console.log(`TEBRA_PROVIDER_GUID=${foundGuid}`);
  } else {
    console.log('\n# No Provider/Resource GUID found via SOAP 2.1.');
    console.log('Obtain from Tebra: Admin (Provider Profiles / Service Locations) or Tebra Support.');
    console.log('Then set in .env: TEBRA_PROVIDER_GUID_CA=<uuid>  and  TEBRA_PROVIDER_GUID=<uuid>');
  }
  console.log('');
}

main();
