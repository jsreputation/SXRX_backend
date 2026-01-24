# Tebra CreateAppointment and CreateAppointmentV3 – Root Cause

## Summary

CreateAppointment (SOAP 2.1) is translated by Tebra to **CreateAppointmentV3**. That V3 API returns:

> **"Appointment must have valid ProviderGuids or ResourceGuids."**

Our SOAP request sends **ProviderID** and **ResourceID** / **ResourceIds** (integer IDs). The V3 layer expects **ProviderGuids** and/or **ResourceGuids** (UUIDs). The SOAP 2.1 → V3 translator **does not** map ProviderID/ResourceID to ProviderGuids/ResourceGuids, so the request fails.

---

## What We Tried

| Attempt | Payload change | Result |
|--------|----------------|--------|
| 1 | Full: ProviderID=1, ResourceID=1, ResourceIds=[1], AppointmentReasonID=1 | "Error translating AppointmentCreate to CreateAppointmentV3Request" |
| 2 | No ResourceID, ResourceIds, Notes | Same |
| 3 | Minimal (no ResourceID, ResourceIds, Notes, ForRecare, IsGroupAppointment, MaxAttendees) | Same |
| 4 | Full + **AppointmentReasonID=0** | **"Appointment must have valid ProviderGuids or ResourceGuids."** |
| 5 | Minimal + AppointmentReasonID=0, no PatientID | Same |

With **AppointmentReasonID=0** we get past the generic “Error translating” and see the real V3 validation error: ProviderGuids or ResourceGuids are required. Using **ResourceID=0 / ResourceIds=[0]** (Telehealth) or **ResourceID=1 / ResourceIds=[1]** does not change this; in both cases V3 still demands GUIDs.

---

## GetProviders and GetAppointmentReasons

- **GetProviders**: The normalized response has `id`, `providerId`, `fullName`. There is **no `guid`** (or `ProviderGuid`) in the parsed structure. The **Tebra API Integration Technical Guide (4.11 Get Providers, Response)** does **not** list a `Guid` or `ProviderGuid` field—only `ID`, `FullName`, `PracticeName`, etc. So the SOAP 2.1 API does not expose provider GUIDs.
- **GetAppointmentReasons**: `id` can be `undefined` for some reason objects; names are correct. The **Tebra API Guide (4.3.2)** documents `AppointmentReasonID` in the response. We have added `AppointmentReasonId` (Pascal `Id`) to the parser fallback and normalizer. If `id` is still `undefined`, inspect the raw `GetAppointmentReasons` XML (e.g. run with `DEBUG_TEBRA_RAW=GetAppointmentReasons` or log `GetAppointmentReasonsResult.rawXml`).

---

## Tebra API Guide (PDF) cross-check

The **Tebra API Integration Technical Guide** ([PDF](https://kareocustomertraining.s3.amazonaws.com/Help%20Center/Guides/Tebra%20API%20Integration%20Technical%20Guide.pdf)) documents SOAP 2.1 only:

- **4.11 Get Providers, Response**: Lists `ID`, `FullName`, `PracticeName`, etc. **No** `Guid` or `ProviderGuid`.
- **4.14 Create Appointment, Request**: Required fields include `ProviderID`, `ResourceID`, `ResourceIDs` (integers). **No** `ProviderGuids` or `ResourceGuids`. The CreateAppointmentV3 requirement for GUIDs is **internal to Tebra** and not described in the 2.1 guide.

---

## Implemented: Sending ProviderGuids in SOAP 2.1

We now **send ProviderGuids** when available:

- **buildAppointmentData** resolves `ProviderGuids` from: `appointmentData.providerGuids` → `appointmentData.providerGuid` → `TEBRA_PROVIDER_GUID_<STATE>` → `TEBRA_PROVIDER_GUID`. Only UUID-shaped values are used.
- **generateCreateAppointmentSOAPXML** emits `<sch:ProviderGuids>` with `<sch:ProviderGuid>uuid</sch:ProviderGuid>` for each. `ResourceGuids`/`<sch:ResourceGuid>` are also supported if provided.
- **/book** passes `state` and `providerGuid: mapping.providerGuid` into `appointmentData`. **providerMapping** and **.env.example** include `TEBRA_PROVIDER_GUID`, `TEBRA_PROVIDER_GUID_CA`, etc.

**To fix CreateAppointment:** Obtain Provider (or Resource) **GUIDs** from Tebra Support or another API, then set e.g. `TEBRA_PROVIDER_GUID_CA=<uuid>` in `.env`. CreateAppointment will include `ProviderGuids` in the SOAP XML. If the SOAP 2.1 → V3 layer accepts it, the call will succeed.

---

## Other options (if ProviderGuids in SOAP 2.1 are not accepted)

1. **Tebra enables ID→GUID mapping**  
   Tebra could map ProviderID/ResourceID from the SOAP 2.1 payload to the corresponding Provider/Resource GUIDs when building the CreateAppointmentV3 request.

2. **Use a different API**  
   If Tebra exposes a CreateAppointment API that accepts ProviderID/ResourceID or that is not translated through this V3 path, switching to that could avoid the ProviderGuids/ResourceGuids requirement.

---

## How to Reproduce

From `backend/`:

```bash
node scripts/test-booking-flow-tebra.js [practiceId] [patientId]
```

Example:

```bash
node scripts/test-booking-flow-tebra.js 1 2
```

The script runs GetProviders (for Guid), GetAppointmentReasons, UpdatePatient (minimal and with "not provided"), buildAppointmentData, and CreateAppointment. It prints ProviderGuids in built data and hints when ProviderGuids/ResourceGuids or InternalServiceFault occur. Optional: set `TEBRA_PROVIDER_GUID` or `TEBRA_PROVIDER_GUID_CA` to a valid UUID to test ProviderGuids in CreateAppointment.

---

## References

- Tebra SOAP 2.1: `https://webservice.kareo.com/services/soap/2.1/KareoServices.svc?wsdl`
- [Tebra API Integration Technical Guide](https://kareocustomertraining.s3.amazonaws.com/Help%20Center/Guides/Tebra%20API%20Integration%20Technical%20Guide.pdf) (PDF): 4.3 Get Appointment Reasons, 4.11 Get Providers, 4.14 Create Appointment. CreateAppointmentV3 and ProviderGuids/ResourceGuids are **not** in the 2.1 guide.
- Test script: `backend/scripts/test-booking-flow-tebra.js`

## UpdatePatient and InternalServiceFault

UpdatePatient often returns `InternalServiceFault` (Tebra server-side) even with minimal payloads. We:

- **Sanitize phone fields** in `updatePatient`: `HomePhone`, `MobilePhone`, `WorkPhone`, `EmergencyPhone` are omitted when the value is a placeholder (`"not provided"`, `"n/a"`, `"none"`, etc.) or has fewer than 10 digits. This avoids sending invalid strings that may contribute to faults.
- **Recommend** `TEBRA_SKIP_UPDATE_PATIENT_ON_BOOK=true` if UpdatePatient keeps failing; booking can still proceed without updating the patient on each book.
