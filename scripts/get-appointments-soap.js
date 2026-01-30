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

function buildEnvelope({ customerKey, password, user, practiceName }) {
  const fields = [
    'AllDay',
    'AppointmentDuration',
    'AppointmentReason1',
    'AppointmentReason2',
    'AppointmentReason3',
    'AppointmentReason4',
    'AppointmentReason5',
    'AppointmentReason6',
    'AppointmentReason7',
    'AppointmentReason8',
    'AppointmentReason9',
    'AppointmentReason10',
    'AppointmentReasonID1',
    'AppointmentReasonID2',
    'AppointmentReasonID3',
    'AppointmentReasonID4',
    'AppointmentReasonID5',
    'AppointmentReasonID6',
    'AppointmentReasonID7',
    'AppointmentReasonID8',
    'AppointmentReasonID9',
    'AppointmentReasonID10',
    'AuthorizationEndDate',
    'AuthorizationID',
    'AuthorizationInsurancePlan',
    'AuthorizationNumber',
    'AuthorizationStartDate',
    'ConfirmationStatus',
    'CreatedDate',
    'EndDate',
    'ID',
    'LastModifiedDate',
    'Notes',
    'PatientCaseID',
    'PatientCaseName',
    'PatientCasePayerScenario',
    'PatientFullName',
    'PatientID',
    'PracticeID',
    'PracticeName',
    'Recurring',
    'ResourceID1',
    'ResourceID2',
    'ResourceID3',
    'ResourceID4',
    'ResourceID5',
    'ResourceID6',
    'ResourceID7',
    'ResourceID8',
    'ResourceID9',
    'ResourceID10',
    'ResourceName1',
    'ResourceName2',
    'ResourceName3',
    'ResourceName4',
    'ResourceName5',
    'ResourceName6',
    'ResourceName7',
    'ResourceName8',
    'ResourceName9',
    'ResourceName10',
    'ResourceTypeID1',
    'ResourceTypeID2',
    'ResourceTypeID3',
    'ResourceTypeID4',
    'ResourceTypeID5',
    'ResourceTypeID6',
    'ResourceTypeID7',
    'ResourceTypeID8',
    'ResourceTypeID9',
    'ResourceTypeID10',
    'ServiceLocationID',
    'ServiceLocationName',
    'StartDate',
    'Type'
  ];

  const fieldsXml = fields.map((field) => `          <sch:${field}>true</sch:${field}>\n`).join('');

  const filterXml = practiceName
    ? `        <sch:Filter>\n          <sch:PracticeName>${practiceName}</sch:PracticeName>\n        </sch:Filter>\n`
    : '';

  return `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sch="http://www.kareo.com/api/schemas/">\n` +
    `  <soapenv:Header/>\n` +
    `  <soapenv:Body>\n` +
    `    <sch:GetAppointments>\n` +
    `      <sch:request>\n` +
    `        <sch:RequestHeader>\n` +
    `          <sch:CustomerKey>${customerKey}</sch:CustomerKey>\n` +
    `          <sch:Password>${password}</sch:Password>\n` +
    `          <sch:User>${user}</sch:User>\n` +
    `        </sch:RequestHeader>\n` +
    `        <sch:Fields>\n` +
    fieldsXml +
    `        </sch:Fields>\n` +
    filterXml +
    `      </sch:request>\n` +
    `    </sch:GetAppointments>\n` +
    `  </soapenv:Body>\n` +
    `</soapenv:Envelope>`;
}

function extractAppointments(xml) {
  const appointments = [];
  const appointmentBlocks = xml.match(/<AppointmentData[^>]*>[\s\S]*?<\/AppointmentData>/g) || [];
  appointmentBlocks.forEach((block) => {
    const appointment = {};
    const fieldMatches = block.match(/<([^>]+)>([^<]*)<\/\1>/g);
    if (fieldMatches) {
      fieldMatches.forEach((fieldMatch) => {
        const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
        if (fieldNameMatch) {
          const fieldName = fieldNameMatch[1];
          const fieldValue = fieldNameMatch[2];
          appointment[fieldName] = fieldValue;
        }
      });
    }
    if (Object.keys(appointment).length) {
      appointments.push(appointment);
    }
  });
  return appointments;
}

async function main() {
  loadEnvFile(envPath);

  const endpoint = resolveEndpoint(process.env.TEBRA_SOAP_ENDPOINT);
  const customerKey = process.env.TEBRA_CUSTOMER_KEY;
  const password = process.env.TEBRA_PASSWORD;
  const user = process.env.TEBRA_USER;
  const practiceName = process.env.TEBRA_PRACTICE_NAME;

  if (!endpoint || !customerKey || !password || !user) {
    console.error('Missing required env vars: TEBRA_SOAP_ENDPOINT, TEBRA_CUSTOMER_KEY, TEBRA_PASSWORD, TEBRA_USER');
    process.exit(1);
  }

  const xml = buildEnvelope({ customerKey, password, user, practiceName });
  const url = new URL(endpoint);

  const response = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: '"http://www.kareo.com/api/schemas/KareoServices/GetAppointments"',
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
  const appointments = extractAppointments(response.data);
  if (!appointments.length) {
    console.log(response.data);
    return;
  }
  console.log('Appointments:', JSON.stringify(appointments, null, 2));
}

main().catch((error) => {
  console.error('SOAP request failed');
  console.error(error?.message || error);
  process.exit(1);
});
