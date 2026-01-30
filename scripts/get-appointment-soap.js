#!/usr/bin/env node

const path = require('path');
const {
  loadEnvFile,
  resolveEndpoint,
  buildRequestHeader,
  buildEnvelope,
  postSoap,
  extractBlocks,
  extractFields
} = require('./soap-client');

const envPath = path.join(__dirname, '..', '.env');

async function main() {
  loadEnvFile(envPath);

  const endpoint = resolveEndpoint(process.env.TEBRA_SOAP_ENDPOINT);
  const customerKey = process.env.TEBRA_CUSTOMER_KEY;
  const password = process.env.TEBRA_PASSWORD;
  const user = process.env.TEBRA_USER;
  const appointmentId = process.env.TEBRA_TEST_APPOINTMENT_ID;

  if (!endpoint || !customerKey || !password || !user) {
    console.error('Missing required env vars: TEBRA_SOAP_ENDPOINT, TEBRA_CUSTOMER_KEY, TEBRA_PASSWORD, TEBRA_USER');
    process.exit(1);
  }
  if (!appointmentId) {
    console.error('Missing required env var: TEBRA_TEST_APPOINTMENT_ID');
    process.exit(1);
  }

  const requestHeader = buildRequestHeader({ customerKey, password, user });
  const appointmentXml = `        <sch:Appointment>\n          <sch:AppointmentId>${appointmentId}</sch:AppointmentId>\n        </sch:Appointment>\n`;
  const requestXml = requestHeader + appointmentXml;
  const xml = buildEnvelope('GetAppointment', requestXml);

  const response = await postSoap({ endpoint, methodName: 'GetAppointment', xml });
  console.log(`Status: ${response.status}`);

  const blocks = extractBlocks(response.data, 'Appointment');
  if (!blocks.length) {
    console.log(response.data);
    return;
  }
  const items = blocks.map(extractFields);
  console.log('Appointment:', JSON.stringify(items, null, 2));
}

main().catch((error) => {
  console.error('SOAP request failed');
  console.error(error?.message || error);
  process.exit(1);
});
