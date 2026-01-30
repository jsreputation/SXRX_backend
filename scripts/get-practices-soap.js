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

function buildEnvelope({ customerKey, password, user }) {
  return `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sch="http://www.kareo.com/api/schemas/">\n` +
    `  <soapenv:Header/>\n` +
    `  <soapenv:Body>\n` +
    `    <sch:GetPractices>\n` +
    `      <sch:request>\n` +
    `        <sch:RequestHeader>\n` +
    `          <sch:CustomerKey>${customerKey}</sch:CustomerKey>\n` +
    `          <sch:Password>${password}</sch:Password>\n` +
    `          <sch:User>${user}</sch:User>\n` +
    `        </sch:RequestHeader>\n` +
    `        <sch:Fields>\n` +
    `          <sch:ID>true</sch:ID>\n` +
    `          <sch:PracticeName>true</sch:PracticeName>\n` +
    `          <sch:Active>true</sch:Active>\n` +
    `        </sch:Fields>\n` +
    `        <sch:Filter/>\n` +
    `      </sch:request>\n` +
    `    </sch:GetPractices>\n` +
    `  </soapenv:Body>\n` +
    `</soapenv:Envelope>`;
}

function extractPractices(xml) {
  const practices = [];
  const practiceBlocks = xml.match(/<PracticeData>[\s\S]*?<\/PracticeData>/g) || [];
  practiceBlocks.forEach((block) => {
    const idMatch = block.match(/<ID>([^<]+)<\/ID>/);
    const nameMatch = block.match(/<PracticeName>([^<]+)<\/PracticeName>/);
    practices.push({
      id: idMatch ? idMatch[1] : null,
      name: nameMatch ? nameMatch[1] : null
    });
  });
  return practices;
}

async function main() {
  loadEnvFile(envPath);

  const endpoint = resolveEndpoint(process.env.TEBRA_SOAP_ENDPOINT);
  const customerKey = process.env.TEBRA_CUSTOMER_KEY;
  const password = process.env.TEBRA_PASSWORD;
  const user = process.env.TEBRA_USER;

  if (!endpoint || !customerKey || !password || !user) {
    console.error('Missing required env vars: TEBRA_SOAP_ENDPOINT, TEBRA_CUSTOMER_KEY, TEBRA_PASSWORD, TEBRA_USER');
    process.exit(1);
  }

  const xml = buildEnvelope({ customerKey, password, user });
  const url = new URL(endpoint);

  const response = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: '"http://www.kareo.com/api/schemas/KareoServices/GetPractices"',
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
  const practices = extractPractices(response.data);
  if (!practices.length) {
    console.log(response.data);
    return;
  }
  console.log('Practices:', practices);
}

main().catch((error) => {
  console.error('SOAP request failed');
  console.error(error?.message || error);
  process.exit(1);
});
