// backend/src/services/tebraBillingService.js
// Minimal SOAP wrappers to create a Charge and post a Payment in Tebra (Kareo) accounting.
// Uses the existing tebraService instance for auth header construction and SOAP endpoint.

const axios = require('axios');
const tebraService = require('./tebraService');

function xmlEscape(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildHeader(practiceId) {
  const ns = tebraService.namespace || 'http://www.kareo.com/api/schemas/';
  const h = tebraService.buildRequestHeader(practiceId);
  return `
    <sch:RequestHeader>
      <sch:CustomerKey>${xmlEscape(h.CustomerKey || '')}</sch:CustomerKey>
      <sch:Password>${xmlEscape(h.Password || '')}</sch:Password>
      <sch:User>${xmlEscape(h.User || '')}</sch:User>
      ${h.PracticeId ? `<sch:PracticeId>${xmlEscape(h.PracticeId)}</sch:PracticeId>` : ''}
    </sch:RequestHeader>`;
}

async function soapCall(action, bodyXml) {
  const endpoint = tebraService.soapEndpoint;
  const ns = tebraService.namespace || 'http://www.kareo.com/api/schemas/';
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sch="${ns}">
    <soapenv:Header/>
    <soapenv:Body>
      ${bodyXml}
    </soapenv:Body>
  </soapenv:Envelope>`;
  const res = await axios.post(endpoint, envelope, {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${ns}KareoServices/${action}"`
    },
    timeout: 15000,
    validateStatus: () => true,
  });
  if (res.status >= 400 || /<Fault/i.test(res.data)) {
    const msgMatch = String(res.data).match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
    const msg = msgMatch ? msgMatch[1].trim() : `SOAP ${action} failed`;
    const err = new Error(msg);
    err.response = res.data;
    throw err;
  }
  return res.data;
}

function buildChargeItemsXml(items = []) {
  // items: [{ cpt, modifier, units, amountCents }]
  const toMoney = (cents) => (Math.round(Number(cents || 0)) / 100).toFixed(2);
  return items.map((it) => `
    <sch:ChargeItem>
      <sch:CptCode>${xmlEscape(it.cpt)}</sch:CptCode>
      ${it.modifier ? `<sch:Modifier>${xmlEscape(it.modifier)}</sch:Modifier>` : ''}
      <sch:Units>${xmlEscape(it.units || 1)}</sch:Units>
      <sch:Amount>${toMoney(it.amountCents || 0)}</sch:Amount>
    </sch:ChargeItem>`).join('');
}

async function createCharge({ practiceId, patientId, dateOfService, placeOfService = '10', items = [] }) {
  const ns = tebraService.namespace || 'http://www.kareo.com/api/schemas/';
  const header = buildHeader(practiceId);
  const itemsXml = buildChargeItemsXml(items);
  const body = `
    <sch:CreateCharge>
      <sch:request>
        ${header}
        <sch:ChargeToCreate>
          <sch:PatientId>${xmlEscape(patientId)}</sch:PatientId>
          <sch:DateOfService>${xmlEscape(dateOfService || new Date().toISOString().slice(0,10))}</sch:DateOfService>
          <sch:PlaceOfService>${xmlEscape(placeOfService)}</sch:PlaceOfService>
          <sch:ChargeItems>
            ${itemsXml}
          </sch:ChargeItems>
        </sch:ChargeToCreate>
      </sch:request>
    </sch:CreateCharge>`;
  const xml = await soapCall('CreateCharge', body);
  // naive parse for ChargeID
  const idMatch = String(xml).match(/<ChargeId>(.*?)<\/ChargeId>/i) || String(xml).match(/<ChargeID>(.*?)<\/ChargeID>/i);
  return { chargeId: idMatch ? idMatch[1] : null, raw: xml };
}

async function postPayment({ practiceId, patientId, amountCents, referenceNumber, date }) {
  const ns = tebraService.namespace || 'http://www.kareo.com/api/schemas/';
  const header = buildHeader(practiceId);
  const toMoney = (cents) => (Math.round(Number(cents || 0)) / 100).toFixed(2);
  const body = `
    <sch:PostPayment>
      <sch:request>
        ${header}
        <sch:PaymentToPost>
          <sch:PatientId>${xmlEscape(patientId)}</sch:PatientId>
          <sch:Amount>${toMoney(amountCents || 0)}</sch:Amount>
          <sch:PaymentMethod>CreditCard</sch:PaymentMethod>
          ${referenceNumber ? `<sch:ReferenceNumber>${xmlEscape(referenceNumber)}</sch:ReferenceNumber>` : ''}
          <sch:Date>${xmlEscape(date || new Date().toISOString().slice(0,10))}</sch:Date>
        </sch:PaymentToPost>
      </sch:request>
    </sch:PostPayment>`;
  const xml = await soapCall('PostPayment', body);
  const idMatch = String(xml).match(/<PaymentId>(.*?)<\/PaymentId>/i) || String(xml).match(/<PaymentID>(.*?)<\/PaymentID>/i);
  return { paymentId: idMatch ? idMatch[1] : null, raw: xml };
}

module.exports = { createCharge, postPayment };
