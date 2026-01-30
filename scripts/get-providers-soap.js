#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const envPath = path.join(__dirname, '..', '.env');

function loadEnvFile(filePath) {
  let contents = '';
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return;
  }
  contents.split(/\r?\n/).forEach((line) => {
    if (!line || line.trim().startsWith('#')) return;
    const idx = line.indexOf('=');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    if (!key) return;
    if (process.env[key] !== undefined) return;
    let value = raw;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

function resolveEndpoint(raw) {
  if (!raw || typeof raw !== 'string') return raw;
  return raw.split('?')[0];
}

function buildEnvelope({ customerKey, password, user, practiceId, practiceName }) {
  const filter = practiceId
    ? `          <sch:PracticeId>${practiceId}</sch:PracticeId>\n`
    : `          <sch:PracticeName>${practiceName}</sch:PracticeName>\n`;

  const fields = [
    'Active',
    'AddressLine1',
    'AddressLine2',
    'BillingType',
    'City',
    'Country',
    'CreatedDate',
    'Degree',
    'DepartmentName',
    'EmailAddress',
    'EncounterFormName',
    'Fax',
    'FaxExt',
    'FirstName',
    'FullName',
    'HomePhone',
    'HomePhoneExt',
    'ID',
    'LastModifiedDate',
    'LastName',
    'MiddleName',
    'MobilePhone',
    'MobilePhoneExt',
    'NationalProviderIdentifier',
    'Notes',
    'Pager',
    'PagerExt',
    'PracticeID',
    'PracticeName',
    'Prefix',
    'ProviderPerformanceReportActive',
    'ProviderPerformanceReportCCEmailRecipients',
    'ProviderPerformanceReportDelay',
    'ProviderPerformanceReportFequency',
    'ProviderPerformanceReportScope',
    'SocialSecurityNumber',
    'SpecialtyName',
    'State',
    'Suffix',
    'Type',
    'WorkPhone',
    'WorkPhoneExt',
    'ZipCode'
  ];

  const fieldsXml = fields.map((field) => `          <sch:${field}>true</sch:${field}>\n`).join('');

  return `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sch="http://www.kareo.com/api/schemas/">\n` +
    `  <soapenv:Header/>\n` +
    `  <soapenv:Body>\n` +
    `    <sch:GetProviders>\n` +
    `      <sch:request>\n` +
    `        <sch:RequestHeader>\n` +
    `          <sch:CustomerKey>${customerKey}</sch:CustomerKey>\n` +
    `          <sch:Password>${password}</sch:Password>\n` +
    `          <sch:User>${user}</sch:User>\n` +
    `        </sch:RequestHeader>\n` +
    `        <sch:Fields>\n` +
    fieldsXml +
    `        </sch:Fields>\n` +
    `        <sch:Filter>\n` +
    filter +
    `        </sch:Filter>\n` +
    `      </sch:request>\n` +
    `    </sch:GetProviders>\n` +
    `  </soapenv:Body>\n` +
    `</soapenv:Envelope>`;
}

function extractProviders(xml) {
  const providers = [];
  const providerBlocks = xml.match(/<ProviderData>\s*[\s\S]*?<\/ProviderData>/g) || [];
  const allFields = [
    'Active',
    'AddressLine1',
    'AddressLine2',
    'BillingType',
    'City',
    'Country',
    'CreatedDate',
    'Degree',
    'DepartmentName',
    'EmailAddress',
    'EncounterFormName',
    'Fax',
    'FaxExt',
    'FirstName',
    'FullName',
    'HomePhone',
    'HomePhoneExt',
    'ID',
    'LastModifiedDate',
    'LastName',
    'MiddleName',
    'MobilePhone',
    'MobilePhoneExt',
    'NationalProviderIdentifier',
    'Notes',
    'Pager',
    'PagerExt',
    'PracticeID',
    'PracticeName',
    'Prefix',
    'ProviderPerformanceReportActive',
    'ProviderPerformanceReportCCEmailRecipients',
    'ProviderPerformanceReportDelay',
    'ProviderPerformanceReportFequency',
    'ProviderPerformanceReportScope',
    'SocialSecurityNumber',
    'SpecialtyName',
    'State',
    'Suffix',
    'Type',
    'WorkPhone',
    'WorkPhoneExt',
    'ZipCode'
  ];
  providerBlocks.forEach((block) => {
    const provider = Object.fromEntries(allFields.map((field) => [field, null]));
    const fieldMatches = block.match(/<([^>]+)>([^<]*)<\/\1>/g);
    if (fieldMatches) {
      fieldMatches.forEach((fieldMatch) => {
        const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
        if (fieldNameMatch) {
          const fieldName = fieldNameMatch[1];
          const fieldValue = fieldNameMatch[2];
          if (Object.prototype.hasOwnProperty.call(provider, fieldName)) {
            provider[fieldName] = fieldValue;
          } else {
            provider[fieldName] = fieldValue;
          }
        }
      });
    }
    providers.push(provider);
  });
  return providers;
}

async function main() {
  loadEnvFile(envPath);

  const endpoint = resolveEndpoint(process.env.TEBRA_SOAP_ENDPOINT);
  const customerKey = process.env.TEBRA_CUSTOMER_KEY;
  const password = process.env.TEBRA_PASSWORD;
  const user = process.env.TEBRA_USER;
  const practiceId = process.env.TEBRA_PRACTICE_ID;
  const practiceName = process.env.TEBRA_PRACTICE_NAME;

  if (!endpoint || !customerKey || !password || !user) {
    console.error('Missing required env vars: TEBRA_SOAP_ENDPOINT, TEBRA_CUSTOMER_KEY, TEBRA_PASSWORD, TEBRA_USER');
    process.exit(1);
  }

  if (!practiceId && !practiceName) {
    console.error('Missing required env var: TEBRA_PRACTICE_ID or TEBRA_PRACTICE_NAME');
    process.exit(1);
  }

  const xml = buildEnvelope({ customerKey, password, user, practiceId, practiceName });
  const url = new URL(endpoint);

  const response = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: '"http://www.kareo.com/api/schemas/KareoServices/GetProviders"',
          'Content-Length': Buffer.byteLength(xml)
        },
        timeout: 20000
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode, data: body });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
    req.write(xml);
    req.end();
  });

  console.log(`Status: ${response.status}`);
  const providers = extractProviders(response.data);
  if (!providers.length) {
    console.log(response.data);
    return;
  }
  console.log('Providers:', JSON.stringify(providers, null, 2));
}

main().catch((error) => {
  console.error('SOAP request failed');
  console.error(error?.message || error);
  process.exit(1);
});
