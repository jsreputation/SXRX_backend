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

  if (!endpoint || !customerKey || !password || !user) {
    console.error('Missing required env vars: TEBRA_SOAP_ENDPOINT, TEBRA_CUSTOMER_KEY, TEBRA_PASSWORD, TEBRA_USER');
    process.exit(1);
  }

  const requestHeader = buildRequestHeader({ customerKey, password, user });
  const fields = buildFields(['ID', 'Name'], 'sch1');
  const filterEntries = [];
  if (practiceName) filterEntries.push({ key: 'PracticeName', value: practiceName });
  if (practiceId) filterEntries.push({ key: 'PracticeId', value: practiceId });
  const filter = buildFilter(filterEntries, 'sch1');

  const requestXml = requestHeader + fields + filter;
  const xml = buildEnvelope('GetServiceLocations', requestXml, 'xmlns:sch1=\"http://www.kareo.com/api/schemas\"');

  const response = await postSoap({ endpoint, methodName: 'GetServiceLocations', xml });
  console.log(`Status: ${response.status}`);

  const blocks = extractBlocks(response.data, 'ServiceLocationData');
  if (!blocks.length) {
    console.log(response.data);
    return;
  }
  const items = blocks.map(extractFields);
  console.log('ServiceLocations:', JSON.stringify(items, null, 2));
}

main().catch((error) => {
  console.error('SOAP request failed');
  console.error(error?.message || error);
  process.exit(1);
});
