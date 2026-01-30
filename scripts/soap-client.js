const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

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

function buildRequestHeader({ customerKey, password, user }) {
  return `        <sch:RequestHeader>\n` +
    `          <sch:CustomerKey>${customerKey}</sch:CustomerKey>\n` +
    `          <sch:Password>${password}</sch:Password>\n` +
    `          <sch:User>${user}</sch:User>\n` +
    `        </sch:RequestHeader>\n`;
}

function buildFields(fields, prefix = 'sch') {
  const fieldsXml = fields.map((field) => `          <${prefix}:${field}>true</${prefix}:${field}>\n`).join('');
  return `        <${prefix}:Fields>\n${fieldsXml}        </${prefix}:Fields>\n`;
}

function buildFilter(filterEntries, prefix = 'sch') {
  const filterXml = filterEntries.map(({ key, value }) => `          <${prefix}:${key}>${value}</${prefix}:${key}>\n`).join('');
  return `        <${prefix}:Filter>\n${filterXml}        </${prefix}:Filter>\n`;
}

function buildEnvelope(methodName, requestXml, extraNamespaces = '') {
  const namespaces = extraNamespaces ? `\n                  ${extraNamespaces}` : '';
  return `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"\n` +
    `                  xmlns:sch="http://www.kareo.com/api/schemas/"${namespaces}>\n` +
    `  <soapenv:Header/>\n` +
    `  <soapenv:Body>\n` +
    `    <sch:${methodName}>\n` +
    `      <sch:request>\n` +
    requestXml +
    `      </sch:request>\n` +
    `    </sch:${methodName}>\n` +
    `  </soapenv:Body>\n` +
    `</soapenv:Envelope>`;
}

async function postSoap({ endpoint, methodName, xml }) {
  const url = new URL(endpoint);
  return await new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: `"http://www.kareo.com/api/schemas/KareoServices/${methodName}"`,
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
}

function extractBlocks(xml, tagName) {
  const regex = new RegExp(`<(?:\\w+:)?${tagName}[^>]*>[\\s\\S]*?<\\/(?:\\w+:)?${tagName}>`, 'g');
  return xml.match(regex) || [];
}

function extractFields(block) {
  const obj = {};
  const matches = block.match(/<([^>]+)>([^<]*)<\/\1>/g);
  if (!matches) return obj;
  matches.forEach((fieldMatch) => {
    const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
    if (fieldNameMatch) {
      const rawName = fieldNameMatch[1];
      const fieldName = rawName.includes(':') ? rawName.split(':')[1] : rawName;
      obj[fieldName] = fieldNameMatch[2];
    }
  });
  return obj;
}

module.exports = {
  loadEnvFile,
  resolveEndpoint,
  buildRequestHeader,
  buildFields,
  buildFilter,
  buildEnvelope,
  postSoap,
  extractBlocks,
  extractFields
};
