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
  const procedureCode = process.env.TEBRA_TEST_PROCEDURE_CODE;

  if (!endpoint || !customerKey || !password || !user) {
    console.error('Missing required env vars: TEBRA_SOAP_ENDPOINT, TEBRA_CUSTOMER_KEY, TEBRA_PASSWORD, TEBRA_USER');
    process.exit(1);
  }

  const requestHeader = buildRequestHeader({ customerKey, password, user });
  const fields = buildFields(['ProcedureCode', 'OfficialName', 'OfficialDescription', 'ID', 'Active']);
  const filterEntries = [];
  if (procedureCode) filterEntries.push({ key: 'ProcedureCode', value: procedureCode });
  const filter = buildFilter(filterEntries);

  const requestXml = requestHeader + fields + filter;
  const xml = buildEnvelope('GetProcedureCodes', requestXml);

  const response = await postSoap({ endpoint, methodName: 'GetProcedureCodes', xml });
  console.log(`Status: ${response.status}`);

  const blocks = extractBlocks(response.data, 'ProcedureCodeData');
  if (!blocks.length) {
    console.log(response.data);
    return;
  }
  const items = blocks.map(extractFields);
  console.log('ProcedureCodes:', JSON.stringify(items, null, 2));
}

main().catch((error) => {
  console.error('SOAP request failed');
  console.error(error?.message || error);
  process.exit(1);
});
