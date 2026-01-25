#!/usr/bin/env node
/**
 * Dump raw XML from GetProviders, GetServiceLocations, GetAppointmentReasons
 * to find any ProviderGuid/ResourceGuid or Guid-like elements.
 * Run from backend/: node scripts/dump-tebra-xml-for-guid.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'tmp');
const pid = process.env.TEBRA_PRACTICE_ID_CA || process.env.TEBRA_PRACTICE_ID || '1';
const practiceName = process.env.TEBRA_PRACTICE_NAME || process.env.TEBRA_PRACTICE_NAME_CA || 'SXRX, LLC';

function toStr(v) {
  if (typeof v === 'string') return v;
  if (v?.data != null) return String(v.data);
  return String(v ?? '');
}

function write(name, body) {
  try { fs.mkdirSync(OUT, { recursive: true }); } catch (_) {}
  const p = path.join(OUT, name);
  fs.writeFileSync(p, body, 'utf8');
  console.log('  wrote', p);
}

async function main() {
  const getTebra = require('../src/services/tebraServiceSingleton');
  const tebra = getTebra();

  console.log('\n=== Dump Tebra XML for Guid hunt ===\n');

  // 1) GetProviders – several request variants
  for (const [label, fields, filters] of [
    ['GetProviders_default', { ID: 1, FirstName: 1, LastName: 1, Active: 1, Guid: 1, ProviderGuid: 1 }, { PracticeId: pid }],
    ['GetProviders_empty_fields', {}, { PracticeId: pid }],
    ['GetProviders_no_filter', { ID: 1, Guid: 1, ProviderGuid: 1 }, {}],
  ]) {
    try {
      const raw = await tebra.callRawSOAPMethod('GetProviders', fields, filters);
      const str = toStr(raw);
      write(`${label}.xml`, str);
      // also print tags that contain "guid" (case insensitive)
      const guidTags = str.match(/<[^>]*[Gg]uid[^>]*>[^<]*<\/[^>]+>/g) || [];
      if (guidTags.length) console.log('  GUID-like tags in', label, ':', guidTags.slice(0, 5));
    } catch (e) {
      console.log('  ', label, 'error:', e.message);
    }
  }

  // 2) GetServiceLocations
  try {
    const raw = await tebra.getServiceLocations({ practiceId: pid });
    const str = toStr(raw);
    write('GetServiceLocations.xml', str);
    const guidTags = str.match(/<[^>]*[Gg]uid[^>]*>[^<]*<\/[^>]+>/g) || [];
    if (guidTags.length) console.log('  GUID-like tags in GetServiceLocations:', guidTags.slice(0, 5));
  } catch (e) {
    console.log('  GetServiceLocations error:', e.message);
  }

  // 3) GetAppointmentReasons
  try {
    const raw = await tebra.callRawSOAPMethod('GetAppointmentReasons', { PracticeId: pid }, {});
    const str = toStr(raw);
    write('GetAppointmentReasons.xml', str);
    const guidTags = str.match(/<[^>]*[Gg]uid[^>]*>[^<]*<\/[^>]+>/g) || [];
    if (guidTags.length) console.log('  GUID-like tags in GetAppointmentReasons:', guidTags.length, '(', guidTags.slice(0, 3), '...)');
  } catch (e) {
    console.log('  GetAppointmentReasons error:', e.message);
  }

  // 4) GetPractices – full
  try {
    const raw = await tebra.callRawSOAPMethod('GetPractices', { ID: 1, PracticeName: 1, Active: 1 }, { PracticeName: practiceName });
    write('GetPractices.xml', toStr(raw));
  } catch (e) {
    console.log('  GetPractices error:', e.message);
  }

  console.log('\nDone. Inspect backend/tmp/*.xml for any Guid/ProviderGuid/ResourceGuid.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
