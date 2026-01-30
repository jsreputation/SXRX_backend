#!/usr/bin/env node

const path = require('path');
const {
  loadEnvFile,
  resolveEndpoint,
  buildRequestHeader,
  buildEnvelope,
  postSoap
} = require('./soap-client');

const envPath = path.join(__dirname, '..', '.env');

async function main() {
  loadEnvFile(envPath);

  const endpoint = resolveEndpoint(process.env.TEBRA_SOAP_ENDPOINT);
  const customerKey = process.env.TEBRA_CUSTOMER_KEY;
  const password = process.env.TEBRA_PASSWORD;
  const user = process.env.TEBRA_USER;
  const practiceId = process.env.TEBRA_PRACTICE_ID;
  const patientId = process.env.TEBRA_TEST_PATIENT_ID;
  const email = process.env.TEBRA_TEST_PATIENT_EMAIL;
  const firstName = process.env.TEBRA_TEST_PATIENT_FIRST_NAME;
  const lastName = process.env.TEBRA_TEST_PATIENT_LAST_NAME;

  if (!endpoint || !customerKey || !password || !user) {
    console.error('Missing required env vars: TEBRA_SOAP_ENDPOINT, TEBRA_CUSTOMER_KEY, TEBRA_PASSWORD, TEBRA_USER');
    process.exit(1);
  }
  if (!practiceId || !patientId) {
    console.error('Missing required env vars: TEBRA_PRACTICE_ID, TEBRA_TEST_PATIENT_ID');
    process.exit(1);
  }

  const requestHeader = buildRequestHeader({ customerKey, password, user });
  const patientXml = `        <sch:Patient>\n` +
    `          <sch:Practice>\n` +
    `            <sch:PracticeID>${practiceId}</sch:PracticeID>\n` +
    `          </sch:Practice>\n` +
    `          <sch:PatientID>${patientId}</sch:PatientID>\n` +
    (firstName ? `          <sch:FirstName>${firstName}</sch:FirstName>\n` : '') +
    (lastName ? `          <sch:LastName>${lastName}</sch:LastName>\n` : '') +
    (email ? `          <sch:EmailAddress>${email}</sch:EmailAddress>\n` : '') +
    `        </sch:Patient>\n`;

  const requestXml = requestHeader + patientXml;
  const xml = buildEnvelope('UpdatePatient', requestXml);

  const response = await postSoap({ endpoint, methodName: 'UpdatePatient', xml });
  console.log(`Status: ${response.status}`);
  console.log(response.data);
}

main().catch((error) => {
  console.error('SOAP request failed');
  console.error(error?.message || error);
  process.exit(1);
});
