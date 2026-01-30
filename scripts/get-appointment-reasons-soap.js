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

function buildEnvelope({ customerKey, password, user, practiceId }) {
  return `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sch="http://www.kareo.com/api/schemas/">\n` +
    `  <soapenv:Header/>\n` +
    `  <soapenv:Body>\n` +
    `    <sch:GetAppointmentReasons>\n` +
    `      <sch:request>\n` +
    `        <sch:RequestHeader>\n` +
    `          <sch:CustomerKey>${customerKey}</sch:CustomerKey>\n` +
    `          <sch:Password>${password}</sch:Password>\n` +
    `          <sch:User>${user}</sch:User>\n` +
    `        </sch:RequestHeader>\n` +
    `        <sch:PracticeId>${practiceId}</sch:PracticeId>\n` +
    `      </sch:request>\n` +
    `    </sch:GetAppointmentReasons>\n` +
    `  </soapenv:Body>\n` +
    `</soapenv:Envelope>`;
}

function extractAppointmentReasons(xml) {
  const reasons = [];
  const reasonBlocks = xml.match(/<AppointmentReasonData[^>]*>[\s\S]*?<\/AppointmentReasonData>/g) || [];
  reasonBlocks.forEach((block) => {
    const reason = {};
    const fieldMatches = block.match(/<([^>]+)>([^<]*)<\/\1>/g);
    if (fieldMatches) {
      fieldMatches.forEach((fieldMatch) => {
        const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
        if (fieldNameMatch) {
          const fieldName = fieldNameMatch[1];
          const fieldValue = fieldNameMatch[2];
          reason[fieldName] = fieldValue;
        }
      });
    }
    if (Object.keys(reason).length) {
      reasons.push(reason);
    }
  });
  return reasons;
}

async function main() {
  loadEnvFile(envPath);

  const endpoint = resolveEndpoint(process.env.TEBRA_SOAP_ENDPOINT);
  const customerKey = process.env.TEBRA_CUSTOMER_KEY;
  const password = process.env.TEBRA_PASSWORD;
  const user = process.env.TEBRA_USER;
  const practiceId = process.env.TEBRA_PRACTICE_ID;

  if (!endpoint || !customerKey || !password || !user) {
    console.error('Missing required env vars: TEBRA_SOAP_ENDPOINT, TEBRA_CUSTOMER_KEY, TEBRA_PASSWORD, TEBRA_USER');
    process.exit(1);
  }

  if (!practiceId) {
    console.error('Missing required env var: TEBRA_PRACTICE_ID');
    process.exit(1);
  }

  const xml = buildEnvelope({ customerKey, password, user, practiceId });
  const url = new URL(endpoint);

  const response = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: '"http://www.kareo.com/api/schemas/KareoServices/GetAppointmentReasons"',
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
  const reasons = extractAppointmentReasons(response.data);
  if (!reasons.length) {
    console.log(response.data);
    return;
  }
  console.log('AppointmentReasons:', JSON.stringify(reasons, null, 2));
}

main().catch((error) => {
  console.error('SOAP request failed');
  console.error(error?.message || error);
  process.exit(1);
});
