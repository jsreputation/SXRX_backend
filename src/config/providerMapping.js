// Simple mapping from US state to Tebra practice/provider configuration
// Extend as needed; values typically come from environment variables or admin UI
//
// Tebra CreateAppointment requires: ServiceLocationID, AppointmentReasonID, ResourceID/ResourceIDs.
// Per-state overrides: TEBRA_SERVICE_LOCATION_ID_<STATE>, TEBRA_APPT_REASON_ID_<STATE>, TEBRA_APPT_REASON_NAME_<STATE>
// Global: TEBRA_SERVICE_LOCATION_ID, TEBRA_DEFAULT_APPT_REASON_ID, TEBRA_DEFAULT_APPT_REASON_GUID, TEBRA_DEFAULT_APPT_REASON_NAME
// CreateAppointmentV3: TEBRA_PRACTICE_GUID, TEBRA_RESOURCE_GUID, TEBRA_RESOURCE_ID, TEBRA_PROVIDER_GUID (optional TEBRA_*_<STATE>)
module.exports = {
  CA: {
    state: 'CA',
    practiceId: process.env.TEBRA_PRACTICE_ID_CA || undefined,
    practiceName: process.env.TEBRA_PRACTICE_NAME_CA || process.env.TEBRA_PRACTICE_NAME || undefined,
    defaultProviderId: process.env.TEBRA_PROVIDER_ID_CA || undefined,
    serviceLocationId: process.env.TEBRA_SERVICE_LOCATION_ID_CA || process.env.TEBRA_SERVICE_LOCATION_ID || undefined,
    appointmentReasonId: process.env.TEBRA_APPT_REASON_ID_CA || process.env.TEBRA_APPT_REASON_NAME_CA || process.env.TEBRA_DEFAULT_APPT_REASON_ID || process.env.TEBRA_DEFAULT_APPT_REASON_GUID || process.env.TEBRA_DEFAULT_APPT_REASON_NAME || undefined,
    providerGuid: process.env.TEBRA_PROVIDER_GUID_CA || process.env.TEBRA_PROVIDER_GUID || undefined,
    resourceGuid: process.env.TEBRA_RESOURCE_GUID_CA || process.env.TEBRA_RESOURCE_GUID || undefined,
    resourceId: process.env.TEBRA_RESOURCE_ID_CA || process.env.TEBRA_RESOURCE_ID || undefined,
    practiceGuid: process.env.TEBRA_PRACTICE_GUID_CA || process.env.TEBRA_PRACTICE_GUID || undefined,
    allowKetamine: false,
  },
  TX: {
    state: 'TX',
    practiceId: process.env.TEBRA_PRACTICE_ID_TX || undefined,
    practiceName: process.env.TEBRA_PRACTICE_NAME_TX || process.env.TEBRA_PRACTICE_NAME || undefined,
    defaultProviderId: process.env.TEBRA_PROVIDER_ID_TX || undefined,
    serviceLocationId: process.env.TEBRA_SERVICE_LOCATION_ID_TX || process.env.TEBRA_SERVICE_LOCATION_ID || undefined,
    appointmentReasonId: process.env.TEBRA_APPT_REASON_ID_TX || process.env.TEBRA_APPT_REASON_NAME_TX || process.env.TEBRA_DEFAULT_APPT_REASON_ID || process.env.TEBRA_DEFAULT_APPT_REASON_GUID || process.env.TEBRA_DEFAULT_APPT_REASON_NAME || undefined,
    providerGuid: process.env.TEBRA_PROVIDER_GUID_TX || process.env.TEBRA_PROVIDER_GUID || undefined,
    resourceGuid: process.env.TEBRA_RESOURCE_GUID_TX || process.env.TEBRA_RESOURCE_GUID || undefined,
    resourceId: process.env.TEBRA_RESOURCE_ID_TX || process.env.TEBRA_RESOURCE_ID || undefined,
    practiceGuid: process.env.TEBRA_PRACTICE_GUID_TX || process.env.TEBRA_PRACTICE_GUID || undefined,
    allowKetamine: true,
  },
  WA: {
    state: 'WA',
    practiceId: process.env.TEBRA_PRACTICE_ID_WA || process.env.TEBRA_PRACTICE_ID || undefined,
    practiceName: process.env.TEBRA_PRACTICE_NAME_WA || process.env.TEBRA_PRACTICE_NAME || undefined,
    defaultProviderId: process.env.TEBRA_PROVIDER_ID_WA || process.env.TEBRA_PROVIDER_ID || undefined,
    serviceLocationId: process.env.TEBRA_SERVICE_LOCATION_ID_WA || process.env.TEBRA_SERVICE_LOCATION_ID || undefined,
    appointmentReasonId: process.env.TEBRA_APPT_REASON_ID_WA || process.env.TEBRA_APPT_REASON_NAME_WA || process.env.TEBRA_DEFAULT_APPT_REASON_ID || process.env.TEBRA_DEFAULT_APPT_REASON_GUID || process.env.TEBRA_DEFAULT_APPT_REASON_NAME || undefined,
    providerGuid: process.env.TEBRA_PROVIDER_GUID_WA || process.env.TEBRA_PROVIDER_GUID || undefined,
    resourceGuid: process.env.TEBRA_RESOURCE_GUID_WA || process.env.TEBRA_RESOURCE_GUID || undefined,
    resourceId: process.env.TEBRA_RESOURCE_ID_WA || process.env.TEBRA_RESOURCE_ID || undefined,
    practiceGuid: process.env.TEBRA_PRACTICE_GUID_WA || process.env.TEBRA_PRACTICE_GUID || undefined,
    allowKetamine: false,
  },
  KL: {
    state: 'KL',
    practiceId: process.env.TEBRA_PRACTICE_ID_KL || process.env.TEBRA_PRACTICE_ID || undefined,
    practiceName: process.env.TEBRA_PRACTICE_NAME_KL || process.env.TEBRA_PRACTICE_NAME || undefined,
    defaultProviderId: process.env.TEBRA_PROVIDER_ID_KL || process.env.TEBRA_PROVIDER_ID || undefined,
    serviceLocationId: process.env.TEBRA_SERVICE_LOCATION_ID_KL || process.env.TEBRA_SERVICE_LOCATION_ID || undefined,
    appointmentReasonId: process.env.TEBRA_APPT_REASON_ID_KL || process.env.TEBRA_APPT_REASON_NAME_KL || process.env.TEBRA_DEFAULT_APPT_REASON_ID || process.env.TEBRA_DEFAULT_APPT_REASON_GUID || process.env.TEBRA_DEFAULT_APPT_REASON_NAME || undefined,
    providerGuid: process.env.TEBRA_PROVIDER_GUID_KL || process.env.TEBRA_PROVIDER_GUID || undefined,
    resourceGuid: process.env.TEBRA_RESOURCE_GUID_KL || process.env.TEBRA_RESOURCE_GUID || undefined,
    resourceId: process.env.TEBRA_RESOURCE_ID_KL || process.env.TEBRA_RESOURCE_ID || undefined,
    practiceGuid: process.env.TEBRA_PRACTICE_GUID_KL || process.env.TEBRA_PRACTICE_GUID || undefined,
    allowKetamine: false,
  },
  SC: {
    state: 'SC',
    practiceId: process.env.TEBRA_PRACTICE_ID_SC || process.env.TEBRA_PRACTICE_ID || undefined,
    practiceName: process.env.TEBRA_PRACTICE_NAME_SC || process.env.TEBRA_PRACTICE_NAME || undefined,
    defaultProviderId: process.env.TEBRA_PROVIDER_ID_SC || process.env.TEBRA_PROVIDER_ID || undefined,
    serviceLocationId: process.env.TEBRA_SERVICE_LOCATION_ID_SC || process.env.TEBRA_SERVICE_LOCATION_ID || undefined,
    appointmentReasonId: process.env.TEBRA_APPT_REASON_ID_SC || process.env.TEBRA_APPT_REASON_NAME_SC || process.env.TEBRA_DEFAULT_APPT_REASON_ID || process.env.TEBRA_DEFAULT_APPT_REASON_GUID || process.env.TEBRA_DEFAULT_APPT_REASON_NAME || undefined,
    providerGuid: process.env.TEBRA_PROVIDER_GUID_SC || process.env.TEBRA_PROVIDER_GUID || undefined,
    resourceGuid: process.env.TEBRA_RESOURCE_GUID_SC || process.env.TEBRA_RESOURCE_GUID || undefined,
    resourceId: process.env.TEBRA_RESOURCE_ID_SC || process.env.TEBRA_RESOURCE_ID || undefined,
    practiceGuid: process.env.TEBRA_PRACTICE_GUID_SC || process.env.TEBRA_PRACTICE_GUID || undefined,
    allowKetamine: false,
  },
};



