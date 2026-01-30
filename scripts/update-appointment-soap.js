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
  const appointmentId = process.env.TEBRA_TEST_APPOINTMENT_ID;
  const appointmentStatus = process.env.TEBRA_UPDATE_APPT_STATUS || 'Scheduled';
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
  if (!appointmentId) {
    console.error('Missing required env var: TEBRA_TEST_APPOINTMENT_ID');
    process.exit(1);
  }
  if (!practiceId || !providerId || !resourceId || !serviceLocationId || !appointmentReasonId || !patientId) {
    console.error('Missing required env vars: TEBRA_PRACTICE_ID, TEBRA_PROVIDER_ID, TEBRA_RESOURCE_ID, TEBRA_SERVICE_LOCATION_ID, TEBRA_DEFAULT_APPT_REASON_ID, TEBRA_TEST_PATIENT_ID');
    process.exit(1);
  }

  const requestHeader = buildRequestHeader({ customerKey, password, user });
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const startIso = start.toISOString().replace('Z', '');
  const endIso = end.toISOString().replace('Z', '');
  const appointmentXml = `        <sch:Appointment>\n` +
    `          <sch:AppointmentId>${appointmentId}</sch:AppointmentId>\n` +
    `          <sch:AppointmentReasonId>${appointmentReasonId}</sch:AppointmentReasonId>\n` +
    `          <sch:AppointmentStatus>${appointmentStatus}</sch:AppointmentStatus>\n` +
    `          <sch:AppointmentType>P</sch:AppointmentType>\n` +
    `          <sch:EndTime>${endIso}</sch:EndTime>\n` +
    `          <sch:IsRecurring>false</sch:IsRecurring>\n` +
    `          <sch:Notes>Updated by SOAP script</sch:Notes>\n` +
    `          <sch:PatientId>${patientId}</sch:PatientId>\n` +
    `          <sch:PracticeId>${practiceId}</sch:PracticeId>\n` +
    `          <sch:ProviderId>${providerId}</sch:ProviderId>\n` +
    `          <sch:ResourceId>${resourceId}</sch:ResourceId>\n` +
    `          <sch:ServiceLocationId>${serviceLocationId}</sch:ServiceLocationId>\n` +
    `          <sch:StartTime>${startIso}</sch:StartTime>\n` +
    `        </sch:Appointment>\n`;

  const requestXml = requestHeader + appointmentXml;
  const xml = buildEnvelope('UpdateAppointment', requestXml);

  const response = await postSoap({ endpoint, methodName: 'UpdateAppointment', xml });
  console.log(`Status: ${response.status}`);
  console.log(response.data);
}

main().catch((error) => {
  console.error('SOAP request failed');
  console.error(error?.message || error);
  process.exit(1);
});
