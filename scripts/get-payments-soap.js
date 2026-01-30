#!/usr/bin/env node

const path = require('path');
const {
  loadEnvFile,
  resolveEndpoint,
  buildRequestHeader,
  buildFields,
  buildFilter,
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
  const practiceId = process.env.TEBRA_PRACTICE_ID;
  const practiceName = process.env.TEBRA_PRACTICE_NAME;
  const patientId = process.env.TEBRA_TEST_PATIENT_ID;
  const fromPostDate = process.env.TEBRA_PAYMENTS_FROM_POST_DATE;
  const toPostDate = process.env.TEBRA_PAYMENTS_TO_POST_DATE;

  if (!endpoint || !customerKey || !password || !user) {
    console.error('Missing required env vars: TEBRA_SOAP_ENDPOINT, TEBRA_CUSTOMER_KEY, TEBRA_PASSWORD, TEBRA_USER');
    process.exit(1);
  }

  const requestHeader = buildRequestHeader({ customerKey, password, user });
  const fields = buildFields([]);
  const filterEntries = [];
  if (practiceId) filterEntries.push({ key: 'PracticeID', value: practiceId });
  if (practiceName) filterEntries.push({ key: 'PracticeName', value: practiceName });
  if (patientId) filterEntries.push({ key: 'PatientID', value: patientId });
  if (fromPostDate) filterEntries.push({ key: 'FromPostDate', value: fromPostDate });
  if (toPostDate) filterEntries.push({ key: 'ToPostDate', value: toPostDate });
  const filter = buildFilter(filterEntries);

  const requestXml = requestHeader + fields + filter;
  const xml = buildEnvelope('GetPayments', requestXml);

  const response = await postSoap({ endpoint, methodName: 'GetPayments', xml });
  console.log(`Status: ${response.status}`);

  const blocks = extractBlocks(response.data, 'PaymentData');
  if (!blocks.length) {
    console.log(response.data);
    return;
  }
  const items = blocks.map(extractFields);
  console.log('Payments:', JSON.stringify(items, null, 2));
}

main().catch((error) => {
  console.error('SOAP request failed');
  console.error(error?.message || error);
  process.exit(1);
});
