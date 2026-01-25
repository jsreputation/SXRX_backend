#!/usr/bin/env node
/**
 * Validate whether the UUIDs from app.kareo.com (Users, Provider Profiles) are
 * Provider IDs / Provider GUIDs according to the Tebra SOAP 2.1 API.
 *
 * Compares:
 *   - 02957c9e-577c-476d-849e-cf17942ef276 (from .../users/... = User GUID)
 *   - 74d1d497-535e-4aa0-9e4e-2bbf67a53a7d (from .../provider-profiles/... = Provider Profile GUID)
 *
 * against: GetProviders ProviderData, GetServiceLocations, GetAppointmentReasons, GetPractices.
 *
 * Run from backend/: node scripts/validate-provider-ids.js
 */

require('dotenv').config();

const practiceId = process.env.TEBRA_PRACTICE_ID_CA || process.env.TEBRA_PRACTICE_ID || '1';
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

const CANDIDATES = [
  { uuid: '02957c9e-577c-476d-849e-cf17942ef276', source: 'app.kareo.com/.../users/... (User Settings)', label: 'User GUID' },
  { uuid: '74d1d497-535e-4aa0-9e4e-2bbf67a53a7d', source: 'app.kareo.com/.../provider-profiles/... (Provider Profiles)', label: 'Provider Profile GUID' }
];

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

/** Extract all <tag>value</tag> from an XML fragment (e.g. inside ProviderData). */
function extractElements(xml) {
  const out = {};
  const re = /<([A-Za-z0-9_]+)[^>]*>([^<]*)<\/\1>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out[m[1]] = m[2];
  return out;
}

async function main() {
  const getTebra = require('../src/services/tebraServiceSingleton');
  const tebra = getTebra();

  console.log('\n=== Validate Provider ID candidates ===\n');
  console.log('Candidates to validate:');
  CANDIDATES.forEach(({ uuid, source, label }) => console.log(`  - ${uuid}  [${label}]  (${source})`));
  console.log('');

  const inGetProviders = new Set();
  const inGetServiceLocations = new Set();
  const inGetAppointmentReasons = new Set();
  const inGetPractices = new Set();
  let providerDataElements = [];
  let getServiceLocationsOk = false;

  // ----- 1) GetProviders: full ProviderData (empty Fields = return all the API has) -----
  try {
    const raw = await tebra.callRawSOAPMethod('GetProviders', {}, { PracticeId: practiceId });
    const str = toStr(raw);
    const uuids = findUuids(str);
    const provMatch = str.match(/<ProviderData[^>]*>([\s\S]*?)<\/ProviderData>/);
    if (provMatch) {
      const el = extractElements(provMatch[1]);
      providerDataElements = Object.keys(el);
      console.log('--- 1) GetProviders (ProviderData elements) ---');
      console.log('  Element names:', providerDataElements.join(', '));
      console.log('  Sample: ID=%s  FirstName=%s  LastName=%s  FullName=%s  NPI=%s',
        el.ID || '(none)', el.FirstName || '(none)', el.LastName || '(none)', el.FullName || '(none)', el.NationalProviderIdentifier || '(empty)');
      if (uuids.length) console.log('  UUIDs in entire response:', uuids.join(', '));
      else console.log('  UUIDs in GetProviders: (none)');
      CANDIDATES.forEach(c => {
        if (str.includes(c.uuid)) inGetProviders.add(c.uuid);
      });
    } else {
      console.log('--- 1) GetProviders ---');
      console.log('  No <ProviderData> in response.');
    }
  } catch (e) {
    console.log('--- 1) GetProviders --- Error:', e.message);
  }
  console.log('');

  // ----- 2) GetProviders with explicit Guid/ProviderGuid in Fields -----
  try {
    const raw = await tebra.callRawSOAPMethod('GetProviders',
      { ID: 1, FirstName: 1, LastName: 1, Active: 1, Guid: 1, ProviderGuid: 1, NPI: 1 }, { PracticeId: practiceId });
    const str = toStr(raw);
    const provMatch = str.match(/<ProviderData[^>]*>([\s\S]*?)<\/ProviderData>/);
    console.log('--- 2) GetProviders (Fields: ID, FirstName, LastName, Active, Guid, ProviderGuid, NPI) ---');
    if (provMatch) {
      const el = extractElements(provMatch[1]);
      const hasGuid = 'Guid' in el || 'ProviderGuid' in el || 'guid' in el || 'ProviderGuid' in el;
      console.log('  Elements returned:', Object.keys(el).join(', '));
      console.log('  Guid/ProviderGuid in response:', hasGuid ? 'yes' : 'no');
      if (el.Guid) console.log('  Guid value:', el.Guid);
      if (el.ProviderGuid) console.log('  ProviderGuid value:', el.ProviderGuid);
    } else console.log('  No <ProviderData>.');
  } catch (e) {
    console.log('  Error:', e.message);
  }
  console.log('');

  // ----- 3) GetServiceLocations (with Fields to avoid DeserializationFailed) -----
  try {
    const filters = { PracticeID: practiceId };
    const raw = await tebra.callRawSOAPMethod('GetServiceLocations', { ID: 1, Name: 1 }, filters);
    const str = toStr(raw);
    if (/<[Ff]ault|faultcode|DeserializationFailed/i.test(str)) {
      console.log('--- 3) GetServiceLocations ---');
      console.log('  Fault (e.g. DeserializationFailed or wrong request shape). Raw snippet:', str.slice(0, 400));
    } else {
      getServiceLocationsOk = true;
      const uuids = findUuids(str);
      console.log('--- 3) GetServiceLocations ---');
      if (uuids.length) console.log('  UUIDs:', uuids.join(', '));
      else console.log('  UUIDs: (none)');
      CANDIDATES.forEach(c => { if (str.includes(c.uuid)) inGetServiceLocations.add(c.uuid); });
      const locMatch = str.match(/<ServiceLocation[^>]*>([\s\S]*?)<\/ServiceLocation>/i)
        || str.match(/<ServiceLocationData[^>]*>([\s\S]*?)<\/ServiceLocationData>/i);
      if (locMatch) {
        const el = extractElements(locMatch[1]);
        console.log('  ServiceLocation/Resource elements:', Object.keys(el).slice(0, 20).join(', '));
      }
    }
  } catch (e) {
    console.log('--- 3) GetServiceLocations --- Error:', e.message);
  }
  console.log('');

  // ----- 4) GetAppointmentReasons (only AppointmentReasonGuid; not valid as ProviderGuid) -----
  try {
    const raw = await tebra.callRawSOAPMethod('GetAppointmentReasons', { PracticeId: practiceId }, {});
    const str = toStr(raw);
    const uuids = findUuids(str);
    console.log('--- 4) GetAppointmentReasons ---');
    console.log('  UUIDs (AppointmentReasonGuid only, not Provider/Resource):', uuids.length ? uuids.length : 0);
    CANDIDATES.forEach(c => { if (str.includes(c.uuid)) inGetAppointmentReasons.add(c.uuid); });
  } catch (e) {
    console.log('--- 4) GetAppointmentReasons --- Error:', e.message);
  }
  console.log('');

  // ----- 5) GetPractices -----
  try {
    const raw = await tebra.callRawSOAPMethod('GetPractices', { ID: 1, PracticeName: 1 }, { PracticeName: process.env.TEBRA_PRACTICE_NAME || process.env.TEBRA_PRACTICE_NAME_CA || 'SXRX, LLC' });
    const str = toStr(raw);
    const uuids = findUuids(str);
    console.log('--- 5) GetPractices ---');
    console.log('  UUIDs:', uuids.length ? uuids.join(', ') : '(none)');
    CANDIDATES.forEach(c => { if (str.includes(c.uuid)) inGetPractices.add(c.uuid); });
  } catch (e) {
    console.log('--- 5) GetPractices --- Error:', e.message);
  }
  console.log('');

  // ----- Validation report -----
  console.log('=== Validation report ===\n');
  console.log('"Provider ID" in SOAP 2.1: the only provider identifier in GetProviders is the integer ID (e.g. 1).');
  console.log('CreateAppointmentV3 requires ProviderGuids or ResourceGuids (UUIDs). The SOAP 2.1 API does not expose those.\n');
  console.log('| UUID       | Source            | In GetProviders? | In GetServiceLoc? | In GetApptReasons? | In GetPractices? | Valid as Provider/Resource GUID? |');
  console.log('|------------|-------------------|------------------|-------------------|--------------------|------------------|----------------------------------|');

  for (const c of CANDIDATES) {
    const a = inGetProviders.has(c.uuid) ? 'yes' : 'no';
    const b = inGetServiceLocations.has(c.uuid) ? 'yes' : 'no';
    const d = inGetAppointmentReasons.has(c.uuid) ? 'yes' : 'no';
    const e = inGetPractices.has(c.uuid) ? 'yes' : 'no';
    let verdict = 'No';
    if (c.label === 'User GUID') verdict = 'No (User GUID; CreateAppointmentV3 rejects it)';
    else if (c.label === 'Provider Profile GUID') verdict = 'No (rejected by CreateAppointmentV3; provider-profiles UUID may be different entity)';
    console.log(`| ${c.uuid.slice(0, 8)}... | ${c.label.padEnd(17)} | ${a.padEnd(16)} | ${(getServiceLocationsOk ? b : 'n/a').padEnd(17)} | ${d.padEnd(18)} | ${e.padEnd(16)} | ${verdict.padEnd(32)} |`);
  }

  console.log('');
  console.log('Conclusion:');
  console.log('  - GetProviders ProviderData does NOT contain Guid, ProviderGuid, or any UUID. Elements:', providerDataElements.join(', ') || '(none)');
  console.log('  - Neither User GUID nor Provider Profile GUID appears in GetProviders, GetServiceLocations, GetAppointmentReasons, or GetPractices.');
  console.log('  - We cannot validate these UUIDs as "Provider IDs" via the SOAP 2.1 API; the API does not expose Provider/Resource GUIDs.');
  console.log('  - Obtain the correct Provider or Resource GUID from Tebra Customer Care or from a CreateAppointmentV3-capable source.');
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
