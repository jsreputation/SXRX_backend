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

function formatSoapDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function buildEnvelope({ customerKey, password, user, practiceId, providerId, resourceId, serviceLocationId, appointmentReasonId, patientId, startTime, endTime }) {
  const status = String(process.env.APPOINTMENT_REQUEST_AS_TENTATIVE || '').toLowerCase() === 'true'
    ? 'Tentative'
    : 'Scheduled';
  return `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sch="http://www.kareo.com/api/schemas/" xmlns:arr="http://schemas.microsoft.com/2003/10/Serialization/Arrays">\n` +
    `  <soapenv:Header/>\n` +
    `  <soapenv:Body>\n` +
    `    <sch:CreateAppointment>\n` +
    `      <sch:request>\n` +
    `        <sch:RequestHeader>\n` +
    `          <sch:CustomerKey>${customerKey}</sch:CustomerKey>\n` +
    `          <sch:Password>${password}</sch:Password>\n` +
    `          <sch:User>${user}</sch:User>\n` +
    `        </sch:RequestHeader>\n` +
    `        <sch:Appointment>\n` +
    `          <sch:AppointmentReasonId>${appointmentReasonId}</sch:AppointmentReasonId>\n` +
    `          <sch:AppointmentStatus>${status}</sch:AppointmentStatus>\n` +
    `          <sch:AppointmentType>P</sch:AppointmentType>\n` +
    `          <sch:EndTime>${endTime}</sch:EndTime>\n` +
    `          <sch:IsRecurring>false</sch:IsRecurring>\n` +
    `          <sch:Notes>Created by SOAP script</sch:Notes>\n` +
    `          <sch:PatientSummary>\n` +
    `            <sch:PatientId>${patientId}</sch:PatientId>\n` +
    `            <sch:PracticeId>${practiceId}</sch:PracticeId>\n` +
    `          </sch:PatientSummary>\n` +
    `          <sch:PracticeId>${practiceId}</sch:PracticeId>\n` +
    `          <sch:ProviderId>${providerId}</sch:ProviderId>\n` +
    `          <sch:ResourceId>${resourceId}</sch:ResourceId>\n` +
    `          <sch:ResourceIds>\n` +
    `            <arr:long>${resourceId}</arr:long>\n` +
    `          </sch:ResourceIds>\n` +
    `          <sch:ServiceLocationId>${serviceLocationId}</sch:ServiceLocationId>\n` +
    `          <sch:StartTime>${startTime}</sch:StartTime>\n` +
    `          <sch:WasCreatedOnline>true</sch:WasCreatedOnline>\n` +
    `        </sch:Appointment>\n` +
    `      </sch:request>\n` +
    `    </sch:CreateAppointment>\n` +
    `  </soapenv:Body>\n` +
    `</soapenv:Envelope>`;
}

async function main() {
  loadEnvFile(envPath);

  const endpoint = resolveEndpoint(process.env.TEBRA_SOAP_ENDPOINT);
  const customerKey = process.env.TEBRA_CUSTOMER_KEY;
  const password = process.env.TEBRA_PASSWORD;
  const user = process.env.TEBRA_USER;
  const practiceId = process.env.TEBRA_PRACTICE_ID;
  const providerId = process.env.TEBRA_PROVIDER_ID;
  const resourceId = process.env.TEBRA_RESOURCE_ID;
  const serviceLocationId = process.env.TEBRA_SERVICE_LOCATION_ID;
  const appointmentReasonId = process.env.TEBRA_DEFAULT_APPT_REASON_ID;
  const patientId = process.env.TEBRA_TEST_PATIENT_ID;

  if (!endpoint || !customerKey || !password || !user) {
    console.error('Missing required env vars: TEBRA_SOAP_ENDPOINT, TEBRA_CUSTOMER_KEY, TEBRA_PASSWORD, TEBRA_USER');
    process.exit(1);
  }

  const required = { practiceId, providerId, resourceId, serviceLocationId, appointmentReasonId, patientId };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  const xml = buildEnvelope({
    customerKey,
    password,
    user,
    practiceId,
    providerId,
    resourceId,
    serviceLocationId,
    appointmentReasonId,
    patientId,
    startTime: formatSoapDate(start),
    endTime: formatSoapDate(end)
  });

  const url = new URL(endpoint);

  const response = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: '"http://www.kareo.com/api/schemas/KareoServices/CreateAppointment"',
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
  console.log(response.data);
}

main().catch((error) => {
  console.error('SOAP request failed');
  console.error(error?.message || error);
  process.exit(1);
});
