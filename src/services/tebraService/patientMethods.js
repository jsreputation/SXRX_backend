// backend/src/services/tebraService/patientMethods.js
// Patient CRUD operations for Tebra service

const { xmlEscape, cleanRequestData, unwrap, parseRawSOAPResponse, parseSoapFault, handleSOAPError } = require('./soapUtils');
const { generateCreatePatientSOAPXML } = require('./soapXmlGenerators');

/**
 * Patient methods for TebraService
 * Provides all patient-related operations
 */
class PatientMethods {
  constructor(serviceInstance) {
    this.service = serviceInstance;
  }

  /**
   * Create a new patient in Tebra
   * @param {Object} userData - Patient data
   * @returns {Promise<Object>} Created patient info with id and practiceId
   */
  async createPatient(userData) {
    try {
      // Use raw SOAP if enabled, otherwise use soap library
      if (this.service.useRawSOAP) {
        const patientData = this.buildPatientData(userData);
        const auth = this.service.getAuthHeader();
        const soapXml = generateCreatePatientSOAPXML(patientData, auth);
        const rawXml = await this.service.soapClient.callRawSOAPMethod('CreatePatient', soapXml);
        const parsed = parseRawSOAPResponse(rawXml, 'CreatePatient');

        // Normalize into { id, patientId, practiceId } for callers like ensureTebraPatient()
        const patientNode = parsed?.CreatePatientResult?.Patient || parsed?.Patient || {};
        let id = patientNode.PatientID || patientNode.id || patientNode.patientId || null;
        if (!id) {
          // Fallback: regex directly on raw XML
          const m = String(rawXml).match(/<PatientID[^>]*>([^<]+)<\/PatientID>/i);
          if (m && m[1]) id = m[1];
        }
        // Extract practiceId if available
        let practiceId = patientNode.PracticeID || patientNode.practiceId || null;
        if (!practiceId) {
          const pm = String(rawXml).match(/<PracticeID[^>]*>([^<]+)<\/PracticeID>/i);
          if (pm && pm[1]) practiceId = pm[1];
        }
        // Detect IsError flag; if explicitly true, throw
        let isError = undefined;
        const errMatch = String(rawXml).match(/<IsError[^>]*>([^<]+)<\/IsError>/i);
        if (errMatch && typeof errMatch[1] === 'string') {
          isError = errMatch[1].toLowerCase() === 'true';
        }
        if (isError === true || !id) {
          const msgMatch = String(rawXml).match(/<ErrorMessage[^>]*>([^<]*)<\/ErrorMessage>/i);
          const msg = msgMatch && msgMatch[1] ? msgMatch[1] : 'CreatePatient returned no PatientID';
          const e = new Error(msg);
          e.code = 'TEBRA_CREATE_PATIENT_FAILED';
          throw e;
        }
        return { id, patientId: id, practiceId };
      }

      const client = await this.service.soapClient.getClient();
      
      // Build the request structure according to the SOAP API
      const args = {
        request: {
          RequestHeader: this.service.buildRequestHeader(),
          Patient: {
            FirstName: userData.firstName,
            LastName: userData.lastName,
            EmailAddress: userData.email,
            HomePhone: userData.phone,
            MobilePhone: userData.mobilePhone,
            DateofBirth: userData.dateOfBirth,
            Gender: userData.gender,
            SocialSecurityNumber: userData.ssn,
            AddressLine1: userData.address?.street,
            City: userData.address?.city,
            State: userData.state,
            ZipCode: userData.address?.zipCode,
            Country: userData.address?.country || 'US',
            PatientExternalID: userData.externalId,
            Practice: {
              PracticeID: userData.practice?.PracticeID || userData.practiceId || process.env.TEBRA_PRACTICE_ID || null,
              PracticeName: userData.practice?.PracticeName || this.service.practiceName
            }
          }
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      cleanRequestData(args);
      
      console.log("CreatePatient args:", JSON.stringify(args, null, 2));
      const [result] = await client.CreatePatientAsync(args);
      console.log("CreatePatient result:", result);
      return this.normalizeCreatePatientResponse(result);
    } catch (error) {
      // Parse SOAP fault if available
      let faultMsg = parseSoapFault(error);
      
      console.error('Tebra SOAP: CreatePatient error', error.message, faultMsg ? `| Fault: ${faultMsg}` : '');
      console.error('CreatePatient error details:', {
        message: error.message,
        fault: faultMsg,
        args: JSON.stringify(args, null, 2)
      });
      
      // If InternalServiceFault, log helpful diagnostic info
      if (faultMsg && /InternalServiceFault/i.test(faultMsg)) {
        console.error('⚠️ [TEBRA] InternalServiceFault - Common causes:');
        console.error('  1. Invalid or missing PracticeID:', args?.request?.Patient?.Practice?.PracticeID || 'MISSING');
        console.error('  2. Invalid PracticeName:', args?.request?.Patient?.Practice?.PracticeName || 'MISSING');
        console.error('  3. Missing required patient fields:');
        console.error('     - firstName:', args?.request?.Patient?.FirstName || 'MISSING');
        console.error('     - lastName:', args?.request?.Patient?.LastName || 'MISSING');
        console.error('     - email:', args?.request?.Patient?.EmailAddress || 'MISSING');
        console.error('     - state:', args?.request?.Patient?.State || 'MISSING');
        console.error('  4. Invalid data format (dates, phone numbers, etc.)');
        console.error('  5. Practice ID not found or inactive in Tebra');
      }
      
      throw error;
    }
  }

  /**
   * Get a single patient by ID
   * @param {string|number} patientId - Patient ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Patient data
   */
  async getPatient(patientId, options = {}) {
    try {
      const client = await this.service.soapClient.getClient();
      
      // Build the request structure according to the SOAP API
      const args = {
        request: {
          RequestHeader: this.service.buildRequestHeader(),
          Filter: {
            PatientID: patientId,
            ExternalID: options.externalId,
            ExternalVendorID: options.externalVendorId
          }
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      cleanRequestData(args);
      
      console.log("GetPatient args:", JSON.stringify(args, null, 2));
      const [result] = await client.GetPatientAsync(args);
      console.log("GetPatient result:", result);
      return this.normalizeGetPatientResponse(result);
    } catch (error) {
      // Parse SOAP fault if available
      let faultMsg = null;
      let isInternalFault = false;
      try {
        const xml = error?.response?.data || error?.data || error?.message || '';
        if (typeof xml === 'string') {
          if (/InternalServiceFault/i.test(xml)) {
            isInternalFault = true;
            faultMsg = 'InternalServiceFault';
          } else if (/Fault/i.test(xml)) {
            const faultStringMatch = xml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
            faultMsg = faultStringMatch && faultStringMatch[1] ? faultStringMatch[1].trim() : null;
            if (/InternalServiceFault/i.test(faultMsg || '')) {
              isInternalFault = true;
              faultMsg = 'InternalServiceFault';
            }
          }
        }
        // Also check error.message directly
        if (!faultMsg && /InternalServiceFault/i.test(error?.message || '')) {
          isInternalFault = true;
          faultMsg = 'InternalServiceFault';
        }
      } catch (_) {}
      
      // InternalServiceFault is a Tebra server-side issue, not our code issue.
      // Log as warning to reduce noise, but still throw so callers can handle gracefully.
      if (isInternalFault) {
        console.warn('⚠️ [TEBRA] GetPatient InternalServiceFault (Tebra server-side error) for patientId:', patientId, '|', faultMsg || error.message);
        console.warn('   This is typically a temporary Tebra server issue. Chart endpoint will continue with other data.');
      } else {
        console.error('Tebra SOAP: GetPatient error', error.message, faultMsg ? `| Fault: ${faultMsg}` : '');
      }
      
      throw error;
    }
  }

  /**
   * Update an existing patient
   * @param {string|number} patientId - Patient ID
   * @param {Object} updates - Patient update data
   * @returns {Promise<Object>} Updated patient data
   */
  async updatePatient(patientId, updates) {
    try {
      const client = await this.service.soapClient.getClient();
      
      // Build the request structure according to the SOAP API
      const args = {
        UpdatePatientReq: {
          RequestHeader: this.service.buildRequestHeader(),
          Patient: {
            PatientID: patientId,
            FirstName: updates.firstName,
            LastName: updates.lastName,
            MiddleName: updates.middleName,
            EmailAddress: updates.email,
            HomePhone: updates.phone,
            MobilePhone: updates.mobilePhone,
            WorkPhone: updates.workPhone,
            DateofBirth: updates.dateOfBirth,
            Gender: updates.gender,
            SocialSecurityNumber: updates.ssn,
            MedicalRecordNumber: updates.medicalRecordNumber,
            AddressLine1: updates.address?.street,
            AddressLine2: updates.address?.street2,
            City: updates.address?.city,
            State: updates.state,
            ZipCode: updates.address?.zipCode,
            Country: updates.address?.country || 'US',
            PatientExternalID: updates.externalId,
            // Emergency contact
            EmergencyName: updates.emergencyContact?.name,
            EmergencyPhone: updates.emergencyContact?.phone,
            EmergencyPhoneExt: updates.emergencyContact?.phoneExt,
            // Employer information
            Employer: updates.employer && {
              EmployerName: updates.employer.name,
              AddressLine1: updates.employer.address?.street,
              AddressLine2: updates.employer.address?.street2,
              City: updates.employer.address?.city,
              State: updates.employer.address?.state,
              ZipCode: updates.employer.address?.zipCode,
              Country: updates.employer.address?.country || 'US',
              EmploymentStatus: updates.employer.employmentStatus
            },
            // Guarantor information
            Guarantor: updates.guarantor && {
              FirstName: updates.guarantor.firstName,
              LastName: updates.guarantor.lastName,
              MiddleName: updates.guarantor.middleName,
              DifferentThanPatient: updates.guarantor.differentThanPatient,
              RelationshiptoGuarantor: updates.guarantor.relationship,
              AddressLine1: updates.guarantor.address?.street,
              AddressLine2: updates.guarantor.address?.street2,
              City: updates.guarantor.address?.city,
              State: updates.guarantor.address?.state,
              ZipCode: updates.guarantor.address?.zipCode,
              Country: updates.guarantor.address?.country || 'US'
            },
            // Provider information
            DefaultRenderingProvider: updates.defaultRenderingProvider && {
              ProviderID: updates.defaultRenderingProvider.id || '1',
              FullName: updates.defaultRenderingProvider.fullName,
              ExternalID: updates.defaultRenderingProvider.externalId
            },
            PrimaryCarePhysician: updates.primaryCarePhysician && {
              PhysicianID: updates.primaryCarePhysician.id,
              FullName: updates.primaryCarePhysician.fullName,
              ExternalID: updates.primaryCarePhysician.externalId
            },
            ReferringProvider: updates.referringProvider && {
              ProviderID: updates.referringProvider.id || '1',
              FullName: updates.referringProvider.fullName,
              ExternalID: updates.referringProvider.externalId
            },
            // Service location
            DefaultServiceLocation: updates.defaultServiceLocation && {
              LocationID: updates.defaultServiceLocation.id,
              LocationName: updates.defaultServiceLocation.name,
              AddressLine1: updates.defaultServiceLocation.address?.street,
              AddressLine2: updates.defaultServiceLocation.address?.street2,
              City: updates.defaultServiceLocation.address?.city,
              State: updates.defaultServiceLocation.address?.state,
              ZipCode: updates.defaultServiceLocation.address?.zipCode,
              Country: updates.defaultServiceLocation.address?.country || 'US',
              Phone: updates.defaultServiceLocation.phone,
              PhoneExt: updates.defaultServiceLocation.phoneExt,
              FaxPhone: updates.defaultServiceLocation.faxPhone,
              FaxPhoneExt: updates.defaultServiceLocation.faxPhoneExt,
              BillingName: updates.defaultServiceLocation.billingName,
              NPI: updates.defaultServiceLocation.npi,
              CLIANumber: updates.defaultServiceLocation.cliaNumber,
              FacilityID: updates.defaultServiceLocation.facilityId,
              FacilityIDType: updates.defaultServiceLocation.facilityIdType,
              POS: updates.defaultServiceLocation.pos
            },
            // Practice information
            Practice: {
              PracticeID: updates.practice?.id,
              PracticeName: this.service.practiceName,
              ExternalID: updates.practice?.externalId
            },
            // Additional fields
            Prefix: updates.prefix,
            Suffix: updates.suffix,
            MaritalStatus: updates.maritalStatus,
            ReferralSource: updates.referralSource,
            Note: updates.note,
            CollectionCategoryName: updates.collectionCategoryName,
            ExternalVendorID: updates.externalVendorId,
            // Alert information
            Alert: updates.alert && {
              Message: updates.alert.message,
              ShowWhenDisplayingPatientDetails: updates.alert.showWhenDisplayingPatientDetails,
              ShowWhenEnteringEncounters: updates.alert.showWhenEnteringEncounters,
              ShowWhenPostingPayments: updates.alert.showWhenPostingPayments,
              ShowWhenPreparingPatientStatements: updates.alert.showWhenPreparingPatientStatements,
              ShowWhenSchedulingAppointments: updates.alert.showWhenSchedulingAppointments,
              ShowWhenViewingClaimDetails: updates.alert.showWhenViewingClaimDetails
            }
          }
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      cleanRequestData(args);
      
      console.log("UpdatePatient args:", JSON.stringify(args, null, 2));
      const [result] = await client.UpdatePatientAsync(args);
      console.log("UpdatePatient result:", result);
      return this.normalizeGetPatientResponse(result);
    } catch (error) {
      console.error('Tebra SOAP: UpdatePatient error', error.message);
      throw error;
    }
  }

  /**
   * Deactivate a patient
   * @param {string|number} patientId - Patient ID
   * @returns {Promise<Object>} Deactivation result
   */
  async deactivatePatient(patientId) {
    try {
      const client = await this.service.soapClient.getClient();
      
      // Build the request structure according to the SOAP API
      const args = {
        request: {
          RequestHeader: this.service.buildRequestHeader(),
          PatientID: patientId
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      cleanRequestData(args);
      
      console.log("DeactivatePatient args:", JSON.stringify(args, null, 2));
      const [result] = await client.DeactivatePatientAsync(args);
      console.log("DeactivatePatient result:", result);
      return { success: 1, tebraResponse: result };
    } catch (error) {
      console.error('Tebra SOAP: DeactivatePatient error', error.message);
      throw error;
    }
  }

  /**
   * Get patients with filtering options
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Patients list with pagination
   */
  async getPatients(options = {}) {
    try {
      // Use raw SOAP if enabled, otherwise use soap library
      if (this.service.useRawSOAP) {
        const fields = options.fields || this.getPatientFieldsBasic();
        const filters = this.buildPatientFilters(options.searchFilters || options);
        const auth = this.service.getAuthHeader();
        const soapXml = this.service.soapXmlGenerators.generateRawSOAPXML('GetPatients', fields, filters, auth);
        const result = await this.service.soapClient.callRawSOAPMethod('GetPatients', soapXml);
        return parseRawSOAPResponse(result, 'GetPatients');
      }

      const client = await this.service.soapClient.getClient();
      
      // Build the request structure according to the SOAP API
      const args = {
        request: {
          RequestHeader: this.service.buildRequestHeader(),
          Fields: options.fields || this.getPatientFieldsBasic(),
          Filter: this.buildPatientFilters(options.searchFilters)
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      cleanRequestData(args);
      
      console.log("GetPatients args:", JSON.stringify(args, null, 2));
      const [result] = await client.GetPatientsAsync(args);
      console.log("GetPatients result:", result);
      return this.normalizeGetPatientsResponse(result);
    } catch (error) {
      handleSOAPError(error, 'GetPatients', { options });
    }
  }

  /**
   * Search patients with specific criteria
   * @param {Object} searchOptions - Search criteria
   * @returns {Promise<Object>} Search results
   */
  async searchPatients(searchOptions = {}) {
    try {
      console.log('🔍 Searching patients with criteria:', searchOptions);
      
      // Build search filters based on the search options
      const searchFilters = {};
      
      if (searchOptions.firstName) {
        searchFilters.FirstName = searchOptions.firstName;
      }
      
      if (searchOptions.lastName) {
        searchFilters.LastName = searchOptions.lastName;
      }
      
      if (searchOptions.email) {
        searchFilters.EmailAddress = searchOptions.email;
      }

      // Use the existing getPatients method with search filters
      const result = await this.getPatients({
        searchFilters: searchFilters
      });

      // Handle the nested structure returned by getPatients
      const patientsData = result.GetPatientsResult || result;
      
      return {
        patients: patientsData.Patients || patientsData.patients || [],
        totalCount: patientsData.TotalCount || patientsData.totalCount || 0
      };
    } catch (error) {
      console.error('❌ Error searching patients:', error);
      throw error;
    }
  }

  /**
   * Get comprehensive patient fields (all available fields)
   * @returns {Object} Fields object
   */
  getPatientFieldsComplete() {
    return {
      AddressLine1: 1,
      AddressLine2: 1,
      Adjustments: 1,
      Age: 1,
      AlertMessage: 1,
      AlertShowWhenDisplayingPatientDetails: 1,
      AlertShowWhenEnteringEncounters: 1,
      AlertShowWhenPostingPayments: 1,
      AlertShowWhenPreparingPatientStatements: 1,
      AlertShowWhenSchedulingAppointments: 1,
      AlertShowWhenViewingClaimDetails: 1,
      Authorization1ContactFullName: 1,
      Authorization1ContactPhone: 1,
      Authorization1ContactPhoneExt: 1,
      Authorization1EndDate: 1,
      Authorization1InsurancePlanName: 1,
      Authorization1Notes: 1,
      Authorization1Number: 1,
      Authorization1NumberOfVisits: 1,
      Authorization1NumberOfVisitsUsed: 1,
      Authorization1StartDate: 1,
      Authorization2ContactFullName: 1,
      Authorization2ContactPhone: 1,
      Authorization2ContactPhoneExt: 1,
      Authorization2EndDate: 1,
      Authorization2InsurancePlanName: 1,
      Authorization2Notes: 1,
      Authorization2Number: 1,
      Authorization2NumberOfVisits: 1,
      Authorization2NumberOfVisitsUsed: 1,
      Authorization2StartDate: 1,
      Authorization3ContactFullName: 1,
      Authorization3ContactPhone: 1,
      Authorization3ContactPhoneExt: 1,
      Authorization3EndDate: 1,
      Authorization3InsurancePlanName: 1,
      Authorization3Notes: 1,
      Authorization3Number: 1,
      Authorization3NumberOfVisits: 1,
      Authorization3NumberOfVisitsUsed: 1,
      Authorization3StartDate: 1,
      Charges: 1,
      City: 1,
      CollectionCategoryName: 1,
      Country: 1,
      CreatedDate: 1,
      DOB: 1,
      DefaultCaseConditionRelatedToAbuse: 1,
      DefaultCaseConditionRelatedToAutoAccident: 1,
      DefaultCaseConditionRelatedToAutoAccidentState: 1,
      DefaultCaseConditionRelatedToEPSDT: 1,
      DefaultCaseConditionRelatedToEmergency: 1,
      DefaultCaseConditionRelatedToEmployment: 1,
      DefaultCaseConditionRelatedToFamilyPlanning: 1,
      DefaultCaseConditionRelatedToOther: 1,
      DefaultCaseConditionRelatedToPregnancy: 1,
      DefaultCaseDatesAccidentDate: 1,
      DefaultCaseDatesAcuteManifestationDate: 1,
      DefaultCaseDatesInjuryEndDate: 1,
      DefaultCaseDatesInjuryStartDate: 1,
      DefaultCaseDatesLastMenstrualPeriodDate: 1,
      DefaultCaseDatesLastSeenDate: 1,
      DefaultCaseDatesLastXRayDate: 1,
      DefaultCaseDatesReferralDate: 1,
      DefaultCaseDatesRelatedDisabilityEndDate: 1,
      DefaultCaseDatesRelatedDisabilityStartDate: 1,
      DefaultCaseDatesRelatedHospitalizationEndDate: 1,
      DefaultCaseDatesRelatedHospitalizationStartDate: 1,
      DefaultCaseDatesSameOrSimilarIllnessEndDate: 1,
      DefaultCaseDatesSameOrSimilarIllnessStartDate: 1,
      DefaultCaseDatesUnableToWorkEndDate: 1,
      DefaultCaseDatesUnableToWorkStartDate: 1,
      DefaultCaseDescription: 1,
      DefaultCaseID: 1,
      DefaultCaseName: 1,
      DefaultCasePayerScenario: 1,
      DefaultCaseReferringProviderFullName: 1,
      DefaultCaseReferringProviderID: 1,
      DefaultCaseSendPatientStatements: 1,
      DefaultRenderingProviderFullName: 1,
      DefaultRenderingProviderId: 1,
      DefaultServiceLocationBillingName: 1,
      DefaultServiceLocationFaxPhone: 1,
      DefaultServiceLocationFaxPhoneExt: 1,
      DefaultServiceLocationId: 1,
      DefaultServiceLocationName: 1,
      DefaultServiceLocationNameAddressLine1: 1,
      DefaultServiceLocationNameAddressLine2: 1,
      DefaultServiceLocationNameCity: 1,
      DefaultServiceLocationNameCountry: 1,
      DefaultServiceLocationNameState: 1,
      DefaultServiceLocationNameZipCode: 1,
      DefaultServiceLocationPhone: 1,
      DefaultServiceLocationPhoneExt: 1,
      EmailAddress: 1,
      EmergencyName: 1,
      EmergencyPhone: 1,
      EmergencyPhoneExt: 1,
      EmployerName: 1,
      EmploymentStatus: 1,
      FirstName: 1,
      Gender: 1,
      GuarantorDifferentThanPatient: 1,
      GuarantorFirstName: 1,
      GuarantorLastName: 1,
      GuarantorMiddleName: 1,
      GuarantorPrefix: 1,
      GuarantorSuffix: 1,
      HomePhone: 1,
      HomePhoneExt: 1,
      ID: 1,
      InsuranceBalance: 1,
      InsurancePayments: 1,
      LastAppointmentDate: 1,
      LastDiagnosis: 1,
      LastEncounterDate: 1,
      LastModifiedDate: 1,
      LastName: 1,
      LastPaymentDate: 1,
      LastStatementDate: 1,
      MaritalStatus: 1,
      MedicalRecordNumber: 1,
      MiddleName: 1,
      MobilePhone: 1,
      MobilePhoneExt: 1,
      MostRecentNote1Date: 1,
      MostRecentNote1Message: 1,
      MostRecentNote1User: 1,
      MostRecentNote2Date: 1,
      MostRecentNote2Message: 1,
      MostRecentNote2User: 1,
      MostRecentNote3Date: 1,
      MostRecentNote3Message: 1,
      MostRecentNote3User: 1,
      MostRecentNote4Date: 1,
      MostRecentNote4Message: 1,
      MostRecentNote4User: 1,
      PatientBalance: 1,
      PatientFullName: 1,
      PatientPayments: 1,
      PracticeId: 1,
      PracticeName: 1,
      Prefix: 1,
      PrimaryCarePhysicianFullName: 1,
      PrimaryCarePhysicianId: 1,
      PrimaryInsurancePolicyCompanyID: 1,
      PrimaryInsurancePolicyCompanyName: 1,
      PrimaryInsurancePolicyCopay: 1,
      PrimaryInsurancePolicyDeductible: 1,
      PrimaryInsurancePolicyEffectiveEndDate: 1,
      PrimaryInsurancePolicyEffectiveStartDate: 1,
      PrimaryInsurancePolicyGroupNumber: 1,
      PrimaryInsurancePolicyInsuredAddressLine1: 1,
      PrimaryInsurancePolicyInsuredAddressLine2: 1,
      PrimaryInsurancePolicyInsuredCity: 1,
      PrimaryInsurancePolicyInsuredCountry: 1,
      PrimaryInsurancePolicyInsuredDateOfBirth: 1,
      PrimaryInsurancePolicyInsuredFullName: 1,
      PrimaryInsurancePolicyInsuredGender: 1,
      PrimaryInsurancePolicyInsuredIDNumber: 1,
      PrimaryInsurancePolicyInsuredNotes: 1,
      PrimaryInsurancePolicyInsuredSocialSecurityNumber: 1,
      PrimaryInsurancePolicyInsuredState: 1,
      PrimaryInsurancePolicyInsuredZipCode: 1,
      PrimaryInsurancePolicyNumber: 1,
      PrimaryInsurancePolicyPatientRelationshipToInsured: 1,
      PrimaryInsurancePolicyPlanAddressLine1: 1,
      PrimaryInsurancePolicyPlanAddressLine2: 1,
      PrimaryInsurancePolicyPlanAdjusterFullName: 1,
      PrimaryInsurancePolicyPlanCity: 1,
      PrimaryInsurancePolicyPlanCountry: 1,
      PrimaryInsurancePolicyPlanFaxNumber: 1,
      PrimaryInsurancePolicyPlanFaxNumberExt: 1,
      PrimaryInsurancePolicyPlanID: 1,
      PrimaryInsurancePolicyPlanName: 1,
      PrimaryInsurancePolicyPlanPhoneNumber: 1,
      PrimaryInsurancePolicyPlanPhoneNumberExt: 1,
      PrimaryInsurancePolicyPlanState: 1,
      PrimaryInsurancePolicyPlanZipCode: 1,
      ReferralSource: 1,
      ReferringProviderFullName: 1,
      ReferringProviderId: 1,
      SSN: 1,
      SecondaryInsurancePolicyCompanyID: 1,
      SecondaryInsurancePolicyCompanyName: 1,
      SecondaryInsurancePolicyCopay: 1,
      SecondaryInsurancePolicyDeductible: 1,
      SecondaryInsurancePolicyEffectiveEndDate: 1,
      SecondaryInsurancePolicyEffectiveStartDate: 1,
      SecondaryInsurancePolicyGroupNumber: 1,
      SecondaryInsurancePolicyInsuredAddressLine1: 1,
      SecondaryInsurancePolicyInsuredAddressLine2: 1,
      SecondaryInsurancePolicyInsuredCity: 1,
      SecondaryInsurancePolicyInsuredCountry: 1,
      SecondaryInsurancePolicyInsuredDateOfBirth: 1,
      SecondaryInsurancePolicyInsuredFullName: 1,
      SecondaryInsurancePolicyInsuredGender: 1,
      SecondaryInsurancePolicyInsuredIDNumber: 1,
      SecondaryInsurancePolicyInsuredNotes: 1,
      SecondaryInsurancePolicyInsuredSocialSecurityNumber: 1,
      SecondaryInsurancePolicyInsuredState: 1,
      SecondaryInsurancePolicyInsuredZipCode: 1,
      SecondaryInsurancePolicyNumber: 1,
      SecondaryInsurancePolicyPatientRelationshipToInsured: 1,
      SecondaryInsurancePolicyPlanAddressLine1: 1,
      SecondaryInsurancePolicyPlanAddressLine2: 1,
      SecondaryInsurancePolicyPlanAdjusterFullName: 1,
      SecondaryInsurancePolicyPlanCity: 1,
      SecondaryInsurancePolicyPlanCountry: 1,
      SecondaryInsurancePolicyPlanFaxNumber: 1,
      SecondaryInsurancePolicyPlanFaxNumberExt: 1,
      SecondaryInsurancePolicyPlanID: 1,
      SecondaryInsurancePolicyPlanName: 1,
      SecondaryInsurancePolicyPlanPhoneNumber: 1,
      SecondaryInsurancePolicyPlanPhoneNumberExt: 1,
      SecondaryInsurancePolicyPlanState: 1,
      SecondaryInsurancePolicyPlanZipCode: 1,
      State: 1,
      StatementNote: 1,
      Suffix: 1,
      TotalBalance: 1,
      WorkPhone: 1,
      WorkPhoneExt: 1,
      ZipCode: 1
    };
  }

  /**
   * Get basic patient fields only
   * @returns {Object} Fields object
   */
  getPatientFieldsBasic() {
    return {
      ID: 1,
      FirstName: 1,
      LastName: 1,
      DOB: 1,
      PatientFullName: 1,
      HomePhone: 1,
      EmailAddress: 1,
      AddressLine1: 1,
      City: 1,
      State: 1,
      ZipCode: 1
    };
  }

  /**
   * Get patients with basic fields only
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Patients list
   */
  async getPatientsBasic(options = {}) {
    const basicFields = this.getPatientFieldsBasic();
    return await this.getPatients({
      ...options,
      fields: basicFields
    });
  }

  /**
   * Get patients with all available fields
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Patients list
   */
  async getPatientsComplete(options = {}) {
    const allFields = this.getPatientFieldsComplete();
    return await this.getPatients({
      ...options,
      fields: allFields
    });
  }

  /**
   * Map gender values to Tebra API enum values
   * @param {string} gender - Gender value
   * @returns {string|null} Mapped gender value
   */
  mapGenderToTebraEnum(gender) {
    if (!gender) return null;
    
    const genderLower = gender.toLowerCase();
    switch (genderLower) {
      case 'male':
      case 'm':
        return 'Male';
      case 'female':
      case 'f':
        return 'Female';
      default:
        console.warn(`⚠️ Unknown gender value: ${gender}, using as-is`);
        return gender;
    }
  }

  /**
   * Format phone number for Tebra API (max 10 characters)
   * @param {string} phone - Phone number
   * @returns {string|null} Formatted phone number
   */
  formatPhoneForTebra(phone) {
    if (!phone) return null;
    
    // Remove all non-digit characters
    const digitsOnly = phone.replace(/\D/g, '');
    
    // If it's an international number (more than 10 digits), take the last 10 digits
    if (digitsOnly.length > 10) {
      const last10Digits = digitsOnly.slice(-10);
      console.log(`📞 Phone number ${phone} formatted to ${last10Digits} (last 10 digits)`);
      return last10Digits;
    }
    
    // If it's exactly 10 digits or less, return as-is
    if (digitsOnly.length <= 10) {
      return digitsOnly;
    }
    
    return phone; // Fallback
  }

  /**
   * Build patient data for CreatePatient SOAP call
   * @param {Object} userData - User data object
   * @returns {Object} Formatted patient data
   */
  buildPatientData(userData) {
    console.log('🔍 Building patient data from:', JSON.stringify(userData, null, 2));
    
    // Build patient data in the correct order according to SOAP schema
    const patientData = {};
    
    // Add fields in the correct order as per SOAP schema
    if (userData.address?.street) patientData.AddressLine1 = userData.address.street;
    if (userData.address?.addressLine2) patientData.AddressLine2 = userData.address.addressLine2;
    
    if (userData.address?.city) patientData.City = userData.address.city;
    if (userData.collectionCategoryName) patientData.CollectionCategoryName = userData.collectionCategoryName;
    if (userData.address?.country) patientData.Country = userData.address.country;
    if (userData.dateOfBirth) patientData.DateofBirth = userData.dateOfBirth;
    
    if (userData.email) patientData.EmailAddress = userData.email;
    if (userData.emergencyName) patientData.EmergencyName = userData.emergencyName;
    if (userData.emergencyPhone) patientData.EmergencyPhone = userData.emergencyPhone;
    if (userData.emergencyPhoneExt) patientData.EmergencyPhoneExt = userData.emergencyPhoneExt;
    
    if (userData.firstName) patientData.FirstName = userData.firstName;
    if (userData.gender) patientData.Gender = this.mapGenderToTebraEnum(userData.gender);
    
    if (userData.phone) patientData.HomePhone = this.formatPhoneForTebra(userData.phone);
    if (userData.homePhoneExt) patientData.HomePhoneExt = userData.homePhoneExt;
    
    if (userData.lastName) patientData.LastName = userData.lastName;
    if (userData.maritalStatus) patientData.MaritalStatus = userData.maritalStatus;
    if (userData.medicalRecordNumber) patientData.MedicalRecordNumber = userData.medicalRecordNumber;
    if (userData.middleName) patientData.MiddleName = userData.middleName;
    
    if (userData.mobilePhone) patientData.MobilePhone = this.formatPhoneForTebra(userData.mobilePhone);
    if (userData.mobilePhoneExt) patientData.MobilePhoneExt = userData.mobilePhoneExt;
    if (userData.note) patientData.Note = userData.note;
    if (userData.externalId) patientData.PatientExternalID = userData.externalId;
    
    // Practice must come after PatientExternalID
    patientData.Practice = {
      PracticeID: userData.practice?.PracticeID || userData.practiceId || process.env.TEBRA_PRACTICE_ID || null,
      PracticeName: userData.practice?.PracticeName || userData.practiceName || this.service.practiceName
    };
    
    if (userData.prefix) patientData.Prefix = userData.prefix;
    if (userData.primaryCarePhysician) patientData.PrimaryCarePhysician = userData.primaryCarePhysician;
    if (userData.referralSource) patientData.ReferralSource = userData.referralSource;
    if (userData.referringProvider) patientData.ReferringProvider = userData.referringProvider;
    
    if (userData.ssn) patientData.SocialSecurityNumber = userData.ssn;
    
    // State must come after SocialSecurityNumber and before Suffix
    if (userData.state) patientData.State = userData.state;
    
    if (userData.suffix) patientData.Suffix = userData.suffix;
    if (userData.workPhone) patientData.WorkPhone = this.formatPhoneForTebra(userData.workPhone);
    if (userData.workPhoneExt) patientData.WorkPhoneExt = userData.workPhoneExt;
    if (userData.address?.zipCode) patientData.ZipCode = userData.address.zipCode;
    
    // Remove undefined/null values from patient data
    const cleanPatientData = {};
    for (const [key, value] of Object.entries(patientData)) {
      if (value !== undefined && value !== null && value !== '') {
        if (typeof value === 'object' && !Array.isArray(value)) {
          // Handle nested objects like Practice
          const cleanNested = {};
          for (const [nestedKey, nestedValue] of Object.entries(value)) {
            if (nestedValue !== undefined && nestedValue !== null && nestedValue !== '') {
              cleanNested[nestedKey] = nestedValue;
            }
          }
          if (Object.keys(cleanNested).length > 0) {
            cleanPatientData[key] = cleanNested;
          }
        } else {
          cleanPatientData[key] = value;
        }
      }
    }

    console.log('🔍 Built patient data:', JSON.stringify(cleanPatientData, null, 2));
    return cleanPatientData;
  }

  /**
   * Build patient filters from options
   * @param {Object} options - Filter options
   * @returns {Object} Filter object
   */
  buildPatientFilters(options) {
    // Handle undefined or null options
    if (!options || typeof options !== 'object') {
      console.warn('⚠️ buildPatientFilters: options is undefined or not an object, returning empty filters');
      return {};
    }

    // Helper function to safely get property value
    const safeGet = (obj, prop) => {
      try {
        return obj && obj.hasOwnProperty(prop) ? obj[prop] : undefined;
      } catch (error) {
        console.warn(`⚠️ buildPatientFilters: Error accessing property '${prop}':`, error.message);
        return undefined;
      }
    };

    const filters = {
      // Basic filters
      FirstName: safeGet(options, 'firstName'),
      LastName: safeGet(options, 'lastName'),
      MiddleName: safeGet(options, 'middleName'),
      FullName: safeGet(options, 'fullName'),
      Gender: safeGet(options, 'gender'),
      SSN: safeGet(options, 'ssn'),
      PracticeID: safeGet(options, 'practiceId'),
      PracticeName: safeGet(options, 'practiceName'),
      EmailAddress: safeGet(options, 'EmailAddress'),
      // Provider filters
      DefaultRenderingProviderFullName: safeGet(options, 'defaultRenderingProvider'),
      PrimaryCarePhysicianFullName: safeGet(options, 'primaryCarePhysician'),
      ReferringProviderFullName: safeGet(options, 'referringProvider'),
      // Service location filters
      DefaultServiceLocationName: safeGet(options, 'defaultServiceLocation'),
      // Insurance filters
      PrimaryInsurancePolicyCompanyName: safeGet(options, 'primaryInsuranceCompany'),
      PrimaryInsurancePolicyPlanName: safeGet(options, 'primaryInsurancePlan'),
      SecondaryInsurancePolicyCompanyName: safeGet(options, 'secondaryInsuranceCompany'),
      SecondaryInsurancePolicyPlanName: safeGet(options, 'secondaryInsurancePlan'),
      // Case filters
      DefaultCasePayerScenario: safeGet(options, 'payerScenario'),
      CollectionCategoryName: safeGet(options, 'collectionCategory'),
      // Date range filters
      FromCreatedDate: safeGet(options, 'fromCreatedDate'),
      ToCreatedDate: safeGet(options, 'toCreatedDate'),
      FromDateOfBirth: safeGet(options, 'fromDateOfBirth'),
      ToDateOfBirth: safeGet(options, 'toDateOfBirth'),
      FromLastEncounterDate: safeGet(options, 'fromLastEncounterDate'),
      ToLastEncounterDate: safeGet(options, 'toLastEncounterDate'),
      FromLastModifiedDate: safeGet(options, 'fromLastModifiedDate'),
      ToLastModifiedDate: safeGet(options, 'toLastModifiedDate'),
      // Other filters
      ReferralSource: safeGet(options, 'referralSource')
    };

    // Remove undefined/null values
    const cleanFilters = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        cleanFilters[key] = value;
      }
    }

    return cleanFilters;
  }

  /**
   * Normalize CreatePatient response
   * @param {Object} result - SOAP response
   * @returns {Object} Normalized response
   */
  normalizeCreatePatientResponse(result) {
    // Accept both plain object or nested response
    const data = unwrap(result);
    const id = data.PatientID || data.id || data.patientId;
    return { id };
  }

  /**
   * Normalize GetPatient response
   * @param {Object} result - SOAP response
   * @returns {Object} Normalized patient data
   */
  normalizeGetPatientResponse(result) {
    const data = unwrap(result);
    
    // Handle different response structures
    if (data.Patients && Array.isArray(data.Patients) && data.Patients.length > 0) {
      return this.normalizePatientData(data.Patients[0]);
    } else if (Array.isArray(data) && data.length > 0) {
      return this.normalizePatientData(data[0]);
    } else {
      // Single patient response
      return this.normalizePatientData(data);
    }
  }

  /**
   * Normalize GetPatients response
   * @param {Object} result - SOAP response
   * @returns {Object} Normalized patients list
   */
  normalizeGetPatientsResponse(result) {
    const data = unwrap(result);
    
    // Handle different response structures
    if (data.Patients && Array.isArray(data.Patients)) {
      return {
        patients: data.Patients.map(patient => this.normalizePatientData(patient)),
        totalCount: data.TotalCount || data.Patients.length,
        hasMore: data.HasMore || false,
        nextStartKey: data.NextStartKey || null
      };
    } else if (Array.isArray(data)) {
      return {
        patients: data.map(patient => this.normalizePatientData(patient)),
        totalCount: data.length,
        hasMore: false,
        nextStartKey: null
      };
    } else {
      // Single patient response
      return {
        patients: [this.normalizePatientData(data)],
        totalCount: 1,
        hasMore: false,
        nextStartKey: null
      };
    }
  }

  /**
   * Normalize patient data object
   * @param {Object} patient - Raw patient data
   * @returns {Object} Normalized patient data
   */
  normalizePatientData(patient) {
    return {
      id: patient.ID || patient.PatientID || patient.id,
      first_name: patient.FirstName || patient.first_name,
      last_name: patient.LastName || patient.last_name,
      full_name: patient.PatientFullName || patient.full_name,
      email: patient.EmailAddress || patient.email,
      home_phone: patient.HomePhone || patient.home_phone,
      mobile_phone: patient.MobilePhone || patient.mobile_phone,
      work_phone: patient.WorkPhone || patient.work_phone,
      date_of_birth: patient.DOB || patient.DateOfBirth || patient.date_of_birth,
      gender: patient.Gender || patient.gender,
      ssn: patient.SSN || patient.ssn,
      medical_record_number: patient.MedicalRecordNumber || patient.medical_record_number,
      address: {
        street: patient.AddressLine1 || patient.address?.street,
        city: patient.City || patient.address?.city,
        state: patient.State || patient.address?.state,
        zip_code: patient.ZipCode || patient.address?.zip_code,
        country: patient.Country || patient.address?.country
      },
      emergency_contact: {
        name: patient.EmergencyName || patient.emergency_contact?.name,
        phone: patient.EmergencyPhone || patient.emergency_contact?.phone
      },
      insurance: {
        primary: {
          company_name: patient.PrimaryInsurancePolicyCompanyName,
          policy_number: patient.PrimaryInsurancePolicyNumber,
          plan_name: patient.PrimaryInsurancePolicyPlanName
        },
        secondary: {
          company_name: patient.SecondaryInsurancePolicyCompanyName,
          policy_number: patient.SecondaryInsurancePolicyNumber,
          plan_name: patient.SecondaryInsurancePolicyPlanName
        }
      },
      providers: {
        default_rendering: patient.DefaultRenderingProviderFullName,
        primary_care: patient.PrimaryCarePhysicianFullName,
        referring: patient.ReferringProviderFullName
      },
      service_location: {
        name: patient.DefaultServiceLocationName,
        id: patient.DefaultServiceLocationId
      },
      practice: {
        id: patient.PracticeId,
        name: patient.PracticeName
      },
      recent_activity: {
        last_appointment: patient.LastAppointmentDate,
        last_encounter: patient.LastEncounterDate,
        last_diagnosis: patient.LastDiagnosis
      },
      notes: {
        statement_note: patient.StatementNote,
        most_recent: {
          message: patient.MostRecentNote1Message,
          date: patient.MostRecentNote1Date,
          user: patient.MostRecentNote1User
        }
      },
      created_at: patient.CreatedDate || patient.created_at,
      updated_at: patient.LastModifiedDate || patient.updated_at
    };
  }
}

module.exports = PatientMethods;
