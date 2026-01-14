// backend/src/services/tebraService.js
const soap = require('soap');
const axios = require('axios');

class TebraService {
  constructor() {
    this.wsdlUrl = process.env.TEBRA_SOAP_WSDL || process.env.TEBRA_SOAP_ENDPOINT;
    this.soapEndpoint = process.env.TEBRA_SOAP_ENDPOINT || 'https://webservice.kareo.com/services/soap/2.1/KareoServices.svc';
    this.customerKey = process.env.TEBRA_CUSTOMER_KEY;
    this.password = process.env.TEBRA_PASSWORD;
    this.user = process.env.TEBRA_USER;
    this.practiceName = process.env.TEBRA_PRACTICE_NAME;
    this.namespace = process.env.TEBRA_SOAP_NAMESPACE || 'http://www.kareo.com/api/schemas/';
    this.clientPromise = null;
    this.useRawSOAP = process.env.TEBRA_USE_RAW_SOAP !== 'false'; // Default to true unless explicitly disabled
    
    // API rate limiting configuration
    this.batchSize = parseInt(process.env.TEBRA_BATCH_SIZE) || 5;
    this.delayBetweenCalls = parseInt(process.env.TEBRA_DELAY_BETWEEN_CALLS) || 200; // ms
    this.delayBetweenBatches = parseInt(process.env.TEBRA_DELAY_BETWEEN_BATCHES) || 1000; // ms
    this.delayAfterGetIds = parseInt(process.env.TEBRA_DELAY_AFTER_GET_IDS) || 500; // ms
  }

  async getClient() {
    try {
      if (!this.clientPromise) {
        console.log(`🔗 Initializing Tebra SOAP client with WSDL: ${this.wsdlUrl}`);
        this.clientPromise = soap.createClientAsync(this.wsdlUrl);
      }
      const client = await this.clientPromise;
      return client;
    } catch (error) {
      console.error('Tebra SOAP: Failed to initialize client', error.message);
      this.clientPromise = null; // Reset on error to allow retry
      throw error;
    }
  }

  // Connection test method (matches working client)
  async testConnection() {
    try {
      console.log(`🔗 Tebra/Kareo SOAP client ready`);
      console.log(`📍 SOAP Endpoint: ${this.soapEndpoint}`);
      console.log(`🏥 Practice: ${this.practiceName}`);
      console.log(`👤 User: ${this.user}`);
      
      if (this.useRawSOAP) {
        console.log('✅ Raw SOAP mode enabled');
        console.log('✅ Client initialized successfully');
        return { success: true, mode: 'raw' };
      } else {
        const client = await this.getClient();
        console.log('✅ SOAP client initialized successfully');
        return { success: true, mode: 'soap', client: !!client };
      }
    } catch (error) {
      console.error('❌ Connection test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Connect method (matches working client)
  async connect() {
    return await this.testConnection();
  }

  // Helper method to build RequestHeader; optionally include PracticeId if provided
  buildRequestHeader(practiceId) {
    const header = {
      CustomerKey: this.customerKey,
      Password: this.password,
      User: this.user
    };
    if (practiceId) {
      header.PracticeId = practiceId;
    }
    return header;
  }

  // Get auth header (matches working client)
  getAuthHeader() {
    return this.buildRequestHeader();
  }

  // Generate raw SOAP XML exactly like the working client
  generateRawSOAPXML(methodName, fields = {}, filters = {}) {
    const auth = this.getAuthHeader();
    
    // Special handling for CreatePatient, CreateAppointment, and GetAppointment methods
    if (methodName === 'CreatePatient') {
      return this.generateCreatePatientSOAPXML(fields);
    }
    if (methodName === 'CreateAppointment') {
      return this.generateCreateAppointmentSOAPXML(fields);
    }
    if (methodName === 'DeleteAppointment') {
      return this.generateDeleteAppointmentSOAPXML(fields);
    }
    if (methodName === 'UpdateAppointment') {
      return this.generateUpdateAppointmentSOAPXML(fields);
    }
    if (methodName === 'GetAppointment') {
      return this.generateGetAppointmentSOAPXML(fields);
    }
    
    // Build fields XML - match the working template exactly
    const fieldsXml = Object.keys(fields).length > 0 ? 
      Object.keys(fields).map(key => 
        `          <sch:${key}>${fields[key]}</sch:${key}>`
      ).join('\n') : '';
    
    // Build filters XML - match the working template exactly
    // Filter out undefined/null values to prevent API errors
    const validFilters = Object.keys(filters).length > 0 ?
      Object.keys(filters).filter(key => 
        filters[key] !== undefined && filters[key] !== null && filters[key] !== ''
      ) : [];
    
    const filtersXml = validFilters.length > 0 ?
      validFilters.map(key =>
        `          <sch:${key}>${filters[key]}</sch:${key}>`
      ).join('\n') : '';
    
    // Return raw SOAP XML string exactly like the working client
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sch="http://www.kareo.com/api/schemas/">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:${methodName}>
      <sch:request>
        <sch:RequestHeader>
          <sch:CustomerKey>${auth.CustomerKey}</sch:CustomerKey>
          <sch:Password>${auth.Password}</sch:Password>
          <sch:User>${auth.User}</sch:User>
        </sch:RequestHeader>
        <sch:Fields>
${fieldsXml}
        </sch:Fields>
        <sch:Filter>
${filtersXml}
        </sch:Filter>
      </sch:request>
    </sch:${methodName}>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  // Generate CreatePatient SOAP XML with proper structure
  generateCreatePatientSOAPXML(patientData) {
    const auth = this.getAuthHeader();
    
    // Build patient XML - handle nested objects properly
    const buildPatientXml = (data, indent = '         ') => {
      let xml = '';
      for (const [key, value] of Object.entries(data)) {
        if (value === null || value === undefined) continue;
        
        if (typeof value === 'object' && !Array.isArray(value)) {
          // Handle nested objects like Practice
          xml += `${indent}<sch:${key}>\n`;
          xml += buildPatientXml(value, indent + '   ');
          xml += `${indent}</sch:${key}>\n`;
        } else {
          // Handle simple values - escape XML special characters
          const escapedValue = String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
          xml += `${indent}<sch:${key}>${escapedValue}</sch:${key}>\n`;
        }
      }
      return xml;
    };
    
    const patientXml = buildPatientXml(patientData);
    
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sch="http://www.kareo.com/api/schemas/">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:CreatePatient>
      <sch:request>
        <sch:RequestHeader>
          <sch:CustomerKey>${auth.CustomerKey}</sch:CustomerKey>
          <sch:Password>${auth.Password}</sch:Password>
          <sch:User>${auth.User}</sch:User>
        </sch:RequestHeader>
        <sch:Patient>
${patientXml}        </sch:Patient>
      </sch:request>
    </sch:CreatePatient>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  // Generate CreateAppointment SOAP XML with proper structure
  generateCreateAppointmentSOAPXML(appointmentData) {
    const auth = this.getAuthHeader();
    
    // Define the required field order for CreateAppointment based on API documentation
    const requiredFieldOrder = [
      'AppointmentId',
      'AppointmentMode', 
      'AppointmentName',
      'AppointmentReasonId',
      'AppointmentStatus',
      'AppointmentType',
      'AppointmentUUID',
      'AttendeesCount',
      'CreatedAt',
      'CreatedBy',
      'CustomerId',
      'EndTime',
      'ForRecare',
      'InsurancePolicyAuthorizationId',
      'IsDeleted',
      'IsGroupAppointment',
      'IsRecurring',
      'MaxAttendees',
      'Notes',
      'OccurrenceId',
      'PatientCaseId',
      'PatientSummaries',
      'PatientSummary',
      'PatientGuid',
      'PatientId',
      'PracticeId',
      'ProviderId',
      'RecurrenceRule',
      'ResourceId',
      'ResourceIds',
      'ServiceLocationId',
      'StartTime',
      'UpdatedAt',
      'UpdatedBy',
      'WasCreatedOnline'
    ];
    
    // Build appointment XML with proper field ordering
    const buildAppointmentXml = (data, indent = '         ') => {
      // Handle null or undefined data
      if (!data || typeof data !== 'object') {
        return '';
      }
      
      let xml = '';
      
      // First, add fields in the required order
      for (const key of requiredFieldOrder) {
        const value = data[key];
        // Skip if undefined, empty string, or null for certain field types
        if (value === undefined || value === '') continue;
        
        // Skip null values for ID fields that should be integers or empty fields that cause parsing errors
        const skipNullFields = [
          'AppointmentId', 'AppointmentReasonId', 'AppointmentUUID', 'OccurrenceId', 'PatientCaseId', 
          'ResourceId', 'InsurancePolicyAuthorizationId', 'CreatedBy', 'CustomerId', 'UpdatedBy',
          'Notes', 'ResourceIds', 'DateOfBirth'
        ];
        if (value === null && skipNullFields.includes(key)) continue;
        
        // Special handling for DateTime fields - don't include if empty
        if ((key === 'StartTime' || key === 'EndTime') && (!value || value === '')) {
          console.log(`⚠️ Skipping empty DateTime field: ${key} = "${value}"`);
          continue;
        }
        
        if (Array.isArray(value)) {
          // Handle arrays like PatientSummaries, ResourceIds, DayOfWeek, etc.
          if (value.length > 0) {
            xml += `${indent}<sch:${key}>\n`;
            for (const item of value) {
              if (typeof item === 'object') {
                // Handle complex array items like PatientSummaries
                xml += `${indent}   <sch:GroupPatientSummary>\n`;
                xml += buildAppointmentXml(item, indent + '      ');
                xml += `${indent}   </sch:GroupPatientSummary>\n`;
              } else {
                // Handle simple array items like ResourceIds
                xml += `${indent}   <arr:long>${item}</arr:long>\n`;
              }
            }
            xml += `${indent}</sch:${key}>\n`;
          }
        } else if (typeof value === 'object' && !(value instanceof Date)) {
          // Handle nested objects like PatientSummary, RecurrenceRule (but not Date objects)
          xml += `${indent}<sch:${key}>\n`;
          xml += buildAppointmentXml(value, indent + '   ');
          xml += `${indent}</sch:${key}>\n`;
        } else {
          // Handle simple values and Date objects
          // Convert Date objects to ISO string for SOAP API
          const finalValue = value instanceof Date ? value.toISOString() : (value === null ? '' : value);
          xml += `${indent}<sch:${key}>${finalValue}</sch:${key}>\n`;
        }
      }
      
      // Then add any remaining fields not in the required order
      for (const [key, value] of Object.entries(data)) {
        if (requiredFieldOrder.includes(key)) continue; // Skip already processed fields
        // Skip if undefined, empty string, or null for certain field types
        if (value === undefined || value === '') continue;
        
        // Skip null values for ID fields that should be integers or empty fields that cause parsing errors
        const skipNullFields = [
          'AppointmentId', 'AppointmentReasonId', 'AppointmentUUID', 'OccurrenceId', 'PatientCaseId', 
          'ResourceId', 'InsurancePolicyAuthorizationId', 'CreatedBy', 'CustomerId', 'UpdatedBy',
          'Notes', 'ResourceIds', 'DateOfBirth'
        ];
        if (value === null && skipNullFields.includes(key)) continue;
        
        if (Array.isArray(value)) {
          // Handle arrays like PatientSummaries, ResourceIds, DayOfWeek, etc.
          if (value.length > 0) {
            xml += `${indent}<sch:${key}>\n`;
            for (const item of value) {
              if (typeof item === 'object') {
                // Handle complex array items like PatientSummaries
                xml += `${indent}   <sch:GroupPatientSummary>\n`;
                xml += buildAppointmentXml(item, indent + '      ');
                xml += `${indent}   </sch:GroupPatientSummary>\n`;
              } else {
                // Handle simple array items like ResourceIds
                xml += `${indent}   <arr:long>${item}</arr:long>\n`;
              }
            }
            xml += `${indent}</sch:${key}>\n`;
          }
        } else if (typeof value === 'object') {
          // Handle nested objects like PatientSummary, RecurrenceRule
          xml += `${indent}<sch:${key}>\n`;
          xml += buildAppointmentXml(value, indent + '   ');
          xml += `${indent}</sch:${key}>\n`;
        } else {
          // Handle simple values
          const finalValue = value instanceof Date ? value.toISOString() : (value === null ? '' : value);
          xml += `${indent}<sch:${key}>${finalValue}</sch:${key}>\n`;
        }
      }
      
      return xml;
    };
    
    const appointmentXml = buildAppointmentXml(appointmentData);
    
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sch="http://www.kareo.com/api/schemas/"
                  xmlns:sys="http://schemas.datacontract.org/2004/07/System"
                  xmlns:arr="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:CreateAppointment>
      <sch:request>
        <sch:RequestHeader>
          <sch:CustomerKey>${auth.CustomerKey}</sch:CustomerKey>
          <sch:Password>${auth.Password}</sch:Password>
          <sch:User>${auth.User}</sch:User>
        </sch:RequestHeader>
        <sch:Appointment>
${appointmentXml}        </sch:Appointment>
      </sch:request>
    </sch:CreateAppointment>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  generateGetAppointmentSOAPXML(appointmentData) {
    const auth = this.getAuthHeader();
    
    // Build appointment XML - handle nested objects properly
    const buildAppointmentXml = (data, indent = '         ') => {
      let xml = '';
      for (const [key, value] of Object.entries(data)) {
        if (value === null || value === undefined) continue;
        
        if (typeof value === 'object' && !Array.isArray(value)) {
          // Handle nested objects
          xml += `${indent}<sch:${key}>\n`;
          xml += buildAppointmentXml(value, indent + '   ');
          xml += `${indent}</sch:${key}>\n`;
        } else {
          // Handle simple values - escape XML special characters
          const escapedValue = String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
          xml += `${indent}<sch:${key}>${escapedValue}</sch:${key}>\n`;
        }
      }
      return xml;
    };
    
    const appointmentXml = buildAppointmentXml(appointmentData);
    
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sch="http://www.kareo.com/api/schemas/">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:GetAppointment>
      <sch:request>
        <sch:RequestHeader>
          <sch:CustomerKey>${auth.CustomerKey}</sch:CustomerKey>
          <sch:Password>${auth.Password}</sch:Password>
          <sch:User>${auth.User}</sch:User>
        </sch:RequestHeader>
${appointmentXml}
      </sch:request>
    </sch:GetAppointment>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  // Generate DeleteAppointment SOAP XML specifically
  generateDeleteAppointmentSOAPXML(appointmentData) {
    const auth = this.getAuthHeader();

    // Build appointment XML - handle nested objects properly
    const buildAppointmentXml = (data, indent = '         ') => {
      let xml = '';
      for (const [key, value] of Object.entries(data)) {
        if (value === null || value === undefined) continue;

        if (typeof value === 'object' && !Array.isArray(value)) {
          // Handle nested objects like Appointment
          xml += `${indent}<sch:${key}>\n`;
          xml += buildAppointmentXml(value, indent + '   ');
          xml += `${indent}</sch:${key}>\n`;
        } else {
          // Handle simple values - escape XML special characters
          const escapedValue = String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
          xml += `${indent}<sch:${key}>${escapedValue}</sch:${key}>\n`;
        }
      }
      return xml;
    };

    const appointmentXml = buildAppointmentXml(appointmentData);

    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sch="http://www.kareo.com/api/schemas/">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:DeleteAppointment>
      <sch:request>
        <sch:RequestHeader>
          <sch:CustomerKey>${auth.CustomerKey}</sch:CustomerKey>
          <sch:Password>${auth.Password}</sch:Password>
          <sch:User>${auth.User}</sch:User>
        </sch:RequestHeader>
${appointmentXml}
      </sch:request>
    </sch:DeleteAppointment>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  // Generate UpdateAppointment SOAP XML
  generateUpdateAppointmentSOAPXML(appointmentData) {
    const auth = this.getAuthHeader();

    const buildAppointmentXml = (data, indent = '         ') => {
      let xml = '';
      for (const [key, value] of Object.entries(data)) {
        if (value === null || value === undefined) continue;

        if (typeof value === 'object' && !Array.isArray(value)) {
          xml += `${indent}<sch:${key}>\n`;
          xml += buildAppointmentXml(value, indent + '   ');
          xml += `${indent}</sch:${key}>\n`;
        } else {
          const escapedValue = String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
          xml += `${indent}<sch:${key}>${escapedValue}</sch:${key}>\n`;
        }
      }
      return xml;
    };

    const appointmentXml = buildAppointmentXml(appointmentData);

    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sch="http://www.kareo.com/api/schemas/">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:UpdateAppointment>
      <sch:request>
        <sch:RequestHeader>
          <sch:CustomerKey>${auth.CustomerKey}</sch:CustomerKey>
          <sch:Password>${auth.Password}</sch:Password>
          <sch:User>${auth.User}</sch:User>
        </sch:RequestHeader>
${appointmentXml}
      </sch:request>
    </sch:UpdateAppointment>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  // Call SOAP method using raw XML (alternative to soap library)
  async callRawSOAPMethod(methodName, fields = {}, filters = {}) {
    try {
      console.log(`\n🚀 Calling method: ${methodName}`);
      
      // Generate raw SOAP XML exactly like the working client
      const soapXml = this.generateRawSOAPXML(methodName, fields, filters);
      
      console.log(`📥 Sending raw SOAP request to: ${this.soapEndpoint}`);
      console.log('📤 Raw XML Request:');
      console.log(soapXml);
      
      const { data } = await axios.post(
        this.soapEndpoint,
        soapXml,
        {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': `"http://www.kareo.com/api/schemas/KareoServices/${methodName}"`
          }
        }
      );
      
      console.log('✅ Method call successful');
      console.log('📤 Raw XML Response:');
      console.log(data);
      
      return data;
    } catch (error) {
      console.error(`❌ Error calling method ${methodName}:`, error.message);
      if (error.response) {
        console.error('Response data:', error.response.data);
      }
      throw error;
    }
  }

  // Patients
  async createPatient(userData) {
    try {
      // Use raw SOAP if enabled, otherwise use soap library
      if (this.useRawSOAP) {
        const patientData = this.buildPatientData(userData);
        const rawXml = await this.callRawSOAPMethod('CreatePatient', patientData, {});
        const parsed = this.parseRawSOAPResponse(rawXml, 'CreatePatient');

        // Normalize into { id, patientId, practiceId } for callers like ensureTebraPatient()
        // Try several shapes in order of reliability
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

      const client = await this.getClient();
      
      // Build the request structure according to the SOAP API
      const args = {
        request: {
          RequestHeader: this.buildRequestHeader(),
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
              PracticeName: this.practiceName
            }
          }
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      this.cleanRequestData(args);
      
      console.log("CreatePatient args:", JSON.stringify(args, null, 2));
      const [result] = await client.CreatePatientAsync(args);
      console.log("CreatePatient result:", result);
      return this.normalizeCreatePatientResponse(result);
    } catch (error) {
      console.error('Tebra SOAP: CreatePatient error', error.message);
      throw error;
    }
  }

  // Get comprehensive patient fields (all available fields)
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

  // Get basic patient fields only
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

  // Get patients with basic fields only (matches working client)
  async getPatientsBasic(options = {}) {
    const basicFields = this.getPatientFieldsBasic();
    return await this.getPatients({
      ...options,
      fields: basicFields
    });
  }

  // Get patients with all available fields (matches working client)
  async getPatientsComplete(options = {}) {
    const allFields = this.getPatientFieldsComplete();
    return await this.getPatients({
      ...options,
      fields: allFields
    });
  }

  async getPatients(options = {}) {
    try {
      // Use raw SOAP if enabled, otherwise use soap library
      if (this.useRawSOAP) {
        const fields = options.fields || this.getPatientFieldsBasic();
        const filters = this.buildPatientFilters(options.searchFilters || options);
        const result = await this.callRawSOAPMethod('GetPatients', fields, filters);
        return this.parseRawSOAPResponse(result, 'GetPatients');
      }

      const client = await this.getClient();
      
      // Build the request structure according to the SOAP API
      const args = {
        request: {
          RequestHeader: this.buildRequestHeader(),
          Fields: options.fields || {
            // Basic patient information fields
            ID: 1,
            FirstName: 1,
            LastName: 1,
            PatientFullName: 1,
            EmailAddress: 1,
            HomePhone: 1,
            MobilePhone: 1,
            WorkPhone: 1,
            DOB: 1,
            Gender: 1,
            SSN: 1,
            AddressLine1: 1,
            City: 1,
            State: 1,
            ZipCode: 1,
            Country: 1,
            MedicalRecordNumber: 1,
            CreatedDate: 1,
            LastModifiedDate: 1,
            PracticeId: 1,
            PracticeName: 1,
            // Emergency contact
            EmergencyName: 1,
            EmergencyPhone: 1,
            // Insurance information
            PrimaryInsurancePolicyCompanyName: 1,
            PrimaryInsurancePolicyNumber: 1,
            PrimaryInsurancePolicyPlanName: 1,
            SecondaryInsurancePolicyCompanyName: 1,
            SecondaryInsurancePolicyNumber: 1,
            SecondaryInsurancePolicyPlanName: 1,
            // Provider information
            DefaultRenderingProviderFullName: 1,
            PrimaryCarePhysicianFullName: 1,
            ReferringProviderFullName: 1,
            // Service location
            DefaultServiceLocationName: 1,
            DefaultServiceLocationId: 1,
            // Recent activity
            LastAppointmentDate: 1,
            LastEncounterDate: 1,
            LastDiagnosis: 1,
            // Notes
            StatementNote: 1,
            MostRecentNote1Message: 1,
            MostRecentNote1Date: 1,
            MostRecentNote1User: 1,
            // Financial information
            PatientBalance: 1,
            InsuranceBalance: 1,
            TotalBalance: 1,
            PatientPayments: 1,
            InsurancePayments: 1,
            Charges: 1,
            Adjustments: 1,
            LastPaymentDate: 1,
            LastStatementDate: 1
          },
          Filter: this.buildPatientFilters(options.searchFilters)
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      this.cleanRequestData(args);
      
      console.log("GetPatients args:", JSON.stringify(args, null, 2));
      const [result] = await client.GetPatientsAsync(args);
      console.log("GetPatients result:", result);
      return this.normalizeGetPatientsResponse(result);
    } catch (error) {
      this.handleSOAPError(error, 'GetPatients', { options });
    }
  }


  // Search patients with specific criteria
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


  // Map gender values to Tebra API enum values
  mapGenderToTebraEnum(gender) {
    if (!gender) return null;
    
    const genderLower = gender.toLowerCase();
    switch (genderLower) {
      case 'male':
      case 'm':
        return 'Male'; // Try capitalized version first
      case 'female':
      case 'f':
        return 'Female'; // Try capitalized version first
      default:
        console.warn(`⚠️ Unknown gender value: ${gender}, using as-is`);
        return gender;
    }
  }

  // Format phone number for Tebra API (max 10 characters)
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

  // Build patient data for CreatePatient SOAP call
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
      PracticeName: userData.practiceName || this.practiceName
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

  // Helper method to build appointment notes with health category
  buildAppointmentNotes(appointmentData) {
    const notes = appointmentData.notes || appointmentData.Notes || '';
    const healthCategory = appointmentData.healthCategory || appointmentData.HealthCategory;
    
    if (healthCategory && healthCategory.trim() !== '') {
      const categoryNote = `Health Category: ${healthCategory}`;
      return notes ? `${notes}\n${categoryNote}` : categoryNote;
    }
    
    return notes || null;
  }

  // Helper method to look up appointment reason ID by name
  async lookupAppointmentReasonId(reasonNameOrId, practiceId) {
    try {
      // If it's already a number, return it
      if (!isNaN(reasonNameOrId) && reasonNameOrId !== '') {
        return parseInt(reasonNameOrId);
      }
      
      // If it's a string name, look it up
      if (typeof reasonNameOrId === 'string' && reasonNameOrId.trim() !== '') {
        console.log(`🔍 Looking up appointment reason ID for name: "${reasonNameOrId}"`);
        const reasonsResult = await this.getAppointmentReasons(practiceId);
        const reasons = reasonsResult.appointmentReasons || [];
        
        // Find the reason by name (case-insensitive)
        const matchingReason = reasons.find(reason => 
          reason.name && reason.name.toLowerCase() === reasonNameOrId.toLowerCase()
        );
        
        if (matchingReason && matchingReason.id) {
          console.log(`✅ Found appointment reason ID: ${matchingReason.id} for name: "${reasonNameOrId}"`);
          return parseInt(matchingReason.id);
        } else {
          console.log(`⚠️ No appointment reason found for name: "${reasonNameOrId}"`);
          return null;
        }
      }
      
      return null;
    } catch (error) {
      console.error(`❌ Error looking up appointment reason ID for "${reasonNameOrId}":`, error.message);
      return null;
    }
  }

  // Build appointment data for CreateAppointment SOAP call
  async buildAppointmentData(appointmentData) {
    const appointment = {
      // Required fields with defaults if not provided
      AppointmentId: appointmentData.appointmentId || appointmentData.AppointmentId || null,
      AppointmentMode: appointmentData.appointmentMode || appointmentData.AppointmentMode || 'Telehealth', // Default mode
      AppointmentName: appointmentData.appointmentName || appointmentData.AppointmentName || 'Appointment',
      AppointmentReasonId: null, // Will be set after lookup
      AppointmentStatus: appointmentData.appointmentStatus || appointmentData.AppointmentStatus || 'Scheduled',
      // Required fields
      AppointmentType: appointmentData.appointmentType || appointmentData.AppointmentType || 'P', // Default to Patient
      IsRecurring: appointmentData.isRecurring || appointmentData.IsRecurring || false,
      WasCreatedOnline: appointmentData.wasCreatedOnline || appointmentData.WasCreatedOnline || true,
      PatientId: appointmentData.patientId || appointmentData.PatientID || appointmentData.PatientId,
      PatientGuid: appointmentData.patientGuid || appointmentData.PatientGuid || appointmentData.PatientGUID,
      // Add missing required fields with defaults
      AppointmentUUID: appointmentData.appointmentUUID || appointmentData.AppointmentUUID || null,
      AttendeesCount: appointmentData.attendeesCount || appointmentData.AttendeesCount || 1,
      CreatedAt: appointmentData.createdAt || appointmentData.CreatedAt || new Date().toISOString(),
      CreatedBy: appointmentData.createdBy || appointmentData.CreatedBy || null,
      CustomerId: appointmentData.customerId || appointmentData.CustomerId || null,
      EndTime: appointmentData.endTime || appointmentData.EndTime,
      ForRecare: appointmentData.forRecare || appointmentData.ForRecare || false,
      InsurancePolicyAuthorizationId: appointmentData.insurancePolicyAuthorizationId || appointmentData.InsurancePolicyAuthorizationId || appointmentData.InsurancePolicyAuthorizationID || null,
      IsDeleted: appointmentData.isDeleted || appointmentData.IsDeleted || false,
      IsGroupAppointment: appointmentData.isGroupAppointment || appointmentData.IsGroupAppointment || false,
      MaxAttendees: appointmentData.maxAttendees || appointmentData.MaxAttendees || 1,
      Notes: this.buildAppointmentNotes(appointmentData),
      OccurrenceId: appointmentData.occurrenceId || appointmentData.OccurrenceId || null,
      PatientCaseId: appointmentData.patientCaseId || appointmentData.PatientCaseId || appointmentData.PatientCaseID || null,
      PracticeId: appointmentData.practiceId || (appointmentData.PracticeID && appointmentData.PracticeID !== '') ? appointmentData.PracticeID : appointmentData.PracticeId || '1',
      ProviderId: appointmentData.providerId || appointmentData.ProviderID || appointmentData.ProviderId || '1',
      ResourceId: appointmentData.resourceId || appointmentData.ResourceId || null,
      ResourceIds: appointmentData.resourceIds || appointmentData.ResourceIds || appointmentData.ResourceIDs || null,
      ServiceLocationId: appointmentData.serviceLocationId || (appointmentData.ServiceLocationID && appointmentData.ServiceLocationID !== 'default-location') ? appointmentData.ServiceLocationID : appointmentData.ServiceLocationId || '1',
      StartTime: appointmentData.startTime || appointmentData.StartTime,
      UpdatedAt: appointmentData.updatedAt || appointmentData.UpdatedAt || new Date().toISOString(),
      UpdatedBy: appointmentData.updatedBy || appointmentData.UpdatedBy || null,
      // Required PatientSummary structure
      PatientSummary: appointmentData.patientSummary || appointmentData.PatientSummary || {
        PatientId: appointmentData.patientId || appointmentData.PatientID || appointmentData.PatientId,
        FirstName: appointmentData.patientFirstName || appointmentData.PatientFirstName || appointmentData.FirstName || 'Unknown',
        LastName: appointmentData.patientLastName || appointmentData.PatientLastName || appointmentData.LastName || 'Patient',
        Email: appointmentData.patientEmail || appointmentData.PatientEmail || appointmentData.Email || 'unknown@example.com',
        DateOfBirth: appointmentData.patientDateOfBirth || appointmentData.PatientDateOfBirth || appointmentData.DateOfBirth || null,
        PracticeId: appointmentData.practiceId || (appointmentData.PracticeID && appointmentData.PracticeID !== '') ? appointmentData.PracticeID : appointmentData.PracticeId || '1'
      }
    };

    // Add PatientSummary if provided
    if (appointmentData.patientSummary || appointmentData.PatientSummary) {
      const patientSummary = appointmentData.patientSummary || appointmentData.PatientSummary;
      appointment.PatientSummary = {
        DateOfBirth: patientSummary.dateOfBirth || patientSummary.DateOfBirth,
        Email: patientSummary.email || patientSummary.Email,
        FirstName: patientSummary.firstName || patientSummary.FirstName,
        GenderId: patientSummary.genderId || patientSummary.GenderId,
        Guid: patientSummary.guid || patientSummary.Guid,
        HomePhone: patientSummary.homePhone || patientSummary.HomePhone,
        LastName: patientSummary.lastName || patientSummary.LastName,
        MiddleName: patientSummary.middleName || patientSummary.MiddleName,
        MobilePhone: patientSummary.mobilePhone || patientSummary.MobilePhone,
        OtherEmail: patientSummary.otherEmail || patientSummary.OtherEmail,
        OtherPhone: patientSummary.otherPhone || patientSummary.OtherPhone,
        PatientId: patientSummary.patientId || patientSummary.PatientID || patientSummary.PatientId,
        PracticeId: patientSummary.practiceId || (patientSummary.PracticeID && patientSummary.PracticeID !== '') ? patientSummary.PracticeID : patientSummary.PracticeId || '1',
        PreferredEmailType: patientSummary.preferredEmailType || patientSummary.PreferredEmailType,
        PreferredPhoneType: patientSummary.preferredPhoneType || patientSummary.PreferredPhoneType,
        WorkEmail: patientSummary.workEmail || patientSummary.WorkEmail,
        WorkPhone: patientSummary.workPhone || patientSummary.WorkPhone,
        Status: patientSummary.status || patientSummary.Status
      };
    }

    // Add PatientSummaries if provided (for group appointments)
    if (appointmentData.patientSummaries && Array.isArray(appointmentData.patientSummaries)) {
      appointment.PatientSummaries = appointmentData.patientSummaries.map(patient => ({
        DateOfBirth: patient.dateOfBirth,
        Email: patient.email,
        FirstName: patient.firstName,
        GenderId: patient.genderId,
        Guid: patient.guid,
        HomePhone: patient.homePhone,
        LastName: patient.lastName,
        MiddleName: patient.middleName,
        MobilePhone: patient.mobilePhone,
        OtherEmail: patient.otherEmail,
        OtherPhone: patient.otherPhone,
        PatientId: patient.patientId,
        PracticeId: patient.practiceId,
        PreferredEmailType: patient.preferredEmailType,
        PreferredPhoneType: patient.preferredPhoneType,
        WorkEmail: patient.workEmail,
        WorkPhone: patient.workPhone,
        Status: patient.status
      }));
    }

    // Add RecurrenceRule if provided
    if (appointmentData.recurrenceRule) {
      appointment.RecurrenceRule = {
        AppointmentId: appointmentData.recurrenceRule.appointmentId,
        DayInterval: appointmentData.recurrenceRule.dayInterval,
        DayOfMonth: appointmentData.recurrenceRule.dayOfMonth,
        DayOfWeek: appointmentData.recurrenceRule.dayOfWeek,
        DayOfWeekFlags: appointmentData.recurrenceRule.dayOfWeekFlags,
        DayOfWeekMonthlyOrdinal: appointmentData.recurrenceRule.dayOfWeekMonthlyOrdinal,
        DayOfWeekMonthlyOrdinalFlags: appointmentData.recurrenceRule.dayOfWeekMonthlyOrdinalFlags,
        EndDate: appointmentData.recurrenceRule.endDate,
        MonthInterval: appointmentData.recurrenceRule.monthInterval,
        MonthOfYear: appointmentData.recurrenceRule.monthOfYear,
        NumOccurrences: appointmentData.recurrenceRule.numOccurrences,
        NumberOfTimes: appointmentData.recurrenceRule.numberOfTimes,
        RecurrenceRuleId: appointmentData.recurrenceRule.recurrenceRuleId,
        StartDate: appointmentData.recurrenceRule.startDate,
        TypeOfDay: appointmentData.recurrenceRule.typeOfDay,
        TypeOfDayMonthlyOrdinal: appointmentData.recurrenceRule.typeOfDayMonthlyOrdinal,
        TypeOfDayMonthlyOrdinalFlags: appointmentData.recurrenceRule.typeOfDayMonthlyOrdinalFlags
      };
    }

    // Look up appointment reason ID if a name was provided instead of an ID
    const reasonNameOrId = appointmentData.appointmentReasonId || appointmentData.AppointmentReasonId || appointmentData.AppointmentReasonID;
    if (reasonNameOrId) {
      const practiceId = appointment.PracticeId;
      const reasonId = await this.lookupAppointmentReasonId(reasonNameOrId, practiceId);
      appointment.AppointmentReasonId = reasonId;
    }

    return appointment;
  }

  // Build appointment fields for GetAppointments SOAP call
  buildAppointmentFields() {
    return {
      // Basic appointment information - matching SOAP schema
      ID: 1,
      StartDate: 1,
      EndDate: 1,
      AppointmentDuration: 1,
      AllDay: 1,
      Type: 1,
      ConfirmationStatus: 1,
      Notes: 1,
      CreatedDate: 1,
      LastModifiedDate: 1,
      // Patient information - matching SOAP schema
      PatientID: 1,
      PatientFullName: 1,
      PatientCaseID: 1,
      PatientCaseName: 1,
      PatientCasePayerScenario: 1,
      // Practice information - matching SOAP schema
      PracticeID: 1,
      PracticeName: 1,
      // Service location - matching SOAP schema
      ServiceLocationID: 1,
      ServiceLocationName: 1,
      // Authorization information - matching SOAP schema
      AuthorizationID: 1,
      AuthorizationNumber: 1,
      AuthorizationStartDate: 1,
      AuthorizationEndDate: 1,
      AuthorizationInsurancePlan: 1,
      // Appointment reasons - matching SOAP schema
      AppointmentReason1: 1,
      AppointmentReason2: 1,
      AppointmentReason3: 1,
      AppointmentReason4: 1,
      AppointmentReason5: 1,
      AppointmentReason6: 1,
      AppointmentReason7: 1,
      AppointmentReason8: 1,
      AppointmentReason9: 1,
      AppointmentReason10: 1,
      AppointmentReasonID1: 1,
      AppointmentReasonID2: 1,
      AppointmentReasonID3: 1,
      AppointmentReasonID4: 1,
      AppointmentReasonID5: 1,
      AppointmentReasonID6: 1,
      AppointmentReasonID7: 1,
      AppointmentReasonID8: 1,
      AppointmentReasonID9: 1,
      AppointmentReasonID10: 1,
      // Resources - matching SOAP schema
      ResourceID1: 1,
      ResourceID2: 1,
      ResourceID3: 1,
      ResourceID4: 1,
      ResourceID5: 1,
      ResourceID6: 1,
      ResourceID7: 1,
      ResourceID8: 1,
      ResourceID9: 1,
      ResourceID10: 1,
      ResourceName1: 1,
      ResourceName2: 1,
      ResourceName3: 1,
      ResourceName4: 1,
      ResourceName5: 1,
      ResourceName6: 1,
      ResourceName7: 1,
      ResourceName8: 1,
      ResourceName9: 1,
      ResourceName10: 1,
      ResourceTypeID1: 1,
      ResourceTypeID2: 1,
      ResourceTypeID3: 1,
      ResourceTypeID4: 1,
      ResourceTypeID5: 1,
      ResourceTypeID6: 1,
      ResourceTypeID7: 1,
      ResourceTypeID8: 1,
      ResourceTypeID9: 1,
      ResourceTypeID10: 1
    };
  }

  // Build appointment filters from options
  buildAppointmentFilters(options) {
    // Handle undefined or null options
    if (!options || typeof options !== 'object') {
      console.warn('⚠️ buildAppointmentFilters: options is undefined or not an object, returning empty filters');
      return {};
    }

    const safeGet = (obj, prop) => {
      try {
        return obj && obj.hasOwnProperty(prop) ? obj[prop] : undefined;
      } catch (error) {
        console.warn(`⚠️ buildAppointmentFilters: Error accessing property '${prop}':`, error.message);
        return undefined;
      }
    };

    const filters = {
      // Basic filters - removed PatientID filter to get all appointments
      PatientFullName: safeGet(options, 'patientFullName'),
      PracticeName: safeGet(options, 'practiceName'),
      ServiceLocationName: safeGet(options, 'serviceLocationName'),
      ResourceName: safeGet(options, 'resourceName'),
      // Date filters
      StartDate: safeGet(options, 'startDate'),
      EndDate: safeGet(options, 'endDate'),
      FromCreatedDate: safeGet(options, 'fromCreatedDate'),
      ToCreatedDate: safeGet(options, 'toCreatedDate'),
      FromLastModifiedDate: safeGet(options, 'fromLastModifiedDate'),
      ToLastModifiedDate: safeGet(options, 'toLastModifiedDate'),
      // Other filters
      AppointmentReason: safeGet(options, 'appointmentReason'),
      ConfirmationStatus: safeGet(options, 'confirmationStatus'),
      PatientCasePayerScenario: safeGet(options, 'patientCasePayerScenario'),
      Type: safeGet(options, 'type'),
      TimeZoneOffsetFromGMT: safeGet(options, 'timeZoneOffsetFromGMT')
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

  // Build patient filters from options
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

  async getPatient(patientId, options = {}) {
    try {
      const client = await this.getClient();
      
      // Build the request structure according to the SOAP API
      const args = {
        request: {
          RequestHeader: this.buildRequestHeader(),
          Filter: {
            PatientID: patientId,
            ExternalID: options.externalId,
            ExternalVendorID: options.externalVendorId
          }
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      this.cleanRequestData(args);
      
      console.log("GetPatient args:", JSON.stringify(args, null, 2));
      const [result] = await client.GetPatientAsync(args);
      console.log("GetPatient result:", result);
      return this.normalizeGetPatientResponse(result);
    } catch (error) {
      console.error('Tebra SOAP: GetPatient error', error.message);
      throw error;
    }
  }

  async updatePatient(patientId, updates) {
    try {
      const client = await this.getClient();
      
      // Build the request structure according to the SOAP API
      const args = {
        UpdatePatientReq: {
          RequestHeader: this.buildRequestHeader(),
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
              PracticeName: this.practiceName,
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
      this.cleanRequestData(args);
      
      console.log("UpdatePatient args:", JSON.stringify(args, null, 2));
      const [result] = await client.UpdatePatientAsync(args);
      console.log("UpdatePatient result:", result);
      return this.normalizeGetPatientResponse(result);
    } catch (error) {
      console.error('Tebra SOAP: UpdatePatient error', error.message);
      throw error;
    }
  }

  async deactivatePatient(patientId) {
    try {
      const client = await this.getClient();
      const args = { PatientID: patientId };
      const [result] = await client.DeactivatePatientAsync(args);
      return { success: 1, tebraResponse: result };
    } catch (error) {
      console.error('Tebra SOAP: DeactivatePatient error', error.message);
      throw error;
    }
  }

  // Documents
  async createDocument(documentData) {
    // Hardened document creation with validation, SOAP Fault parsing, and retries with minimal payloads
    const ensureBase64 = (input) => {
      if (!input) return '';
      // Heuristic: if it looks like JSON or plain text, base64-encode it
      const looksBase64 = typeof input === 'string' && /^[A-Za-z0-9+/=\r\n]+$/.test(input) && input.length % 4 === 0;
      if (looksBase64) return input;
      try {
        const buf = Buffer.isBuffer(input) ? input : Buffer.from(typeof input === 'string' ? input : JSON.stringify(input), 'utf8');
        return buf.toString('base64');
      } catch (_) {
        return String(input);
      }
    };

    const buildArgs = (doc, minimal = false) => {
      const practiceIdRaw = doc.practiceId || process.env.TEBRA_PRACTICE_ID || undefined;
      // Coerce numeric identifiers to integers where possible (SOAP often expects xs:int)
      const practiceId = (practiceIdRaw && /^\d+$/.test(String(practiceIdRaw))) ? parseInt(String(practiceIdRaw), 10) : practiceIdRaw;
      const patientIdRaw = doc.patientId;
      const patientId = (patientIdRaw && /^\d+$/.test(String(patientIdRaw))) ? parseInt(String(patientIdRaw), 10) : patientIdRaw;
      const payload = {
        request: {
          RequestHeader: this.buildRequestHeader(practiceId),
          DocumentToCreate: minimal ? {
            // minimal payload for retry path
            DocumentDate: doc.documentDate || new Date().toISOString(),
            FileContent: ensureBase64(doc.fileContent || ''),
            FileName: doc.fileName || `document-${Date.now()}.json`,
            Name: doc.name || 'Document',
            PatientId: patientId,
            PracticeId: practiceId,
            Status: doc.status || 'Completed',
          } : {
            DocumentDate: doc.documentDate || new Date().toISOString(),
            DocumentNotes: doc.documentNotes || doc.notes || '',
            FileContent: ensureBase64(doc.fileContent || ''),
            FileName: doc.fileName || `document-${Date.now()}.json`,
            Label: doc.label || 'General',
            Name: doc.name || 'Document',
            PatientId: patientId,
            PracticeId: practiceId,
            Status: doc.status || 'Completed'
          }
        }
      };
      this.cleanRequestData(payload);
      return payload;
    };

    const parseSoapFault = (err) => {
      try {
        const xml = err?.response?.data || err?.data || '';
        if (typeof xml !== 'string') return null;
        if (/Fault/i.test(xml)) {
          const faultStringMatch = xml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
          const reasonMatch = xml.match(/<Reason>[\s\S]*?<Text[^>]*>([\s\S]*?)<\/Text>[\s\S]*?<\/Reason>/i);
          const msg = (faultStringMatch && faultStringMatch[1]) || (reasonMatch && reasonMatch[1]) || null;
          return msg ? msg.trim() : 'SOAP Fault';
        }
        // Tebra-specific internal service fault string
        if (/InternalServiceFault/i.test(xml)) return 'InternalServiceFault';
      } catch (_) {}
      return null;
    };

    const tooLarge = (b64) => {
      try {
        // rough limit ~1MB decoded
        const sizeApprox = Math.floor((b64.length * 3) / 4);
        return sizeApprox > 1024 * 1024;
      } catch { return false; }
    };

    // Validate inputs early
    if (!documentData || !documentData.patientId) {
      const e = new Error('Missing patientId for document creation');
      e.status = 400;
      throw e;
    }

    let args = buildArgs(documentData, false);

    // If FileContent looks huge, trim to 1MB to avoid upstream faults
    try {
      const b64 = args.request.DocumentToCreate.FileContent || '';
      if (tooLarge(b64)) {
        console.warn('CreateDocument: file too large; truncating to 1MB for upload');
        const trimmed = Buffer.from(b64, 'base64').subarray(0, 1024 * 1024).toString('base64');
        args.request.DocumentToCreate.FileContent = trimmed;
      }
    } catch (_) {}

    try {
      const client = await this.getClient();
      console.log('CreateDocument args:', JSON.stringify(args, null, 2));
      const [result] = await client.CreateDocumentAsync(args);
      console.log('CreateDocument result:', result);
      return this.normalizeCreateDocumentResponse(result);
    } catch (error) {
      const faultMsg = parseSoapFault(error);
      console.error('Tebra SOAP: CreateDocument error', error.message, faultMsg ? `| Fault: ${faultMsg}` : '');

      // Retry once with a minimal payload if we hit an internal fault
      if (faultMsg) {
        try {
          const client = await this.getClient();
          const minimalArgs = buildArgs(documentData, true);
          console.log('CreateDocument retry (minimal) args:', JSON.stringify(minimalArgs, null, 2));
          const [result2] = await client.CreateDocumentAsync(minimalArgs);
          console.log('CreateDocument retry result:', result2);
          return this.normalizeCreateDocumentResponse(result2);
        } catch (retryErr) {
          const e = new Error(`Tebra CreateDocument failed: ${faultMsg}`);
          e.status = 502;
          e.code = 'TEBRA_CREATE_DOCUMENT_FAULT';
          e.details = retryErr?.response?.data || retryErr?.message;
          throw e;
        }
      }

      // Non-fault path: rethrow with mapped status
      const e = new Error(error?.message || 'CreateDocument failed');
      e.status = error?.status || 502;
      e.code = 'TEBRA_CREATE_DOCUMENT_ERROR';
      e.details = error?.response?.data || undefined;
      throw e;
    }
  }

  async deleteDocument(documentId) {
    try {
      const client = await this.getClient();
      
      // Build the request structure according to the SOAP API
      const args = {
        request: {
          RequestHeader: this.buildRequestHeader(),
          DocumentId: documentId
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      this.cleanRequestData(args);
      
      console.log("DeleteDocument args:", JSON.stringify(args, null, 2));
      const [result] = await client.DeleteDocumentAsync(args);
      console.log("DeleteDocument result:", result);
      return { success: 1, tebraResponse: result };
    } catch (error) {
      console.error('Tebra SOAP: DeleteDocument error', error.message);
      throw error;
    }
  }

  // Appointments
  async getAppointments(options = {}) {
    console.log('asdfasdfasdfasdfasdfasdf');
    try {
      console.log('🔍 [GET APPOINTMENTS] Starting with options:', options);
      
      // Step 1: Get appointment IDs using GetAppointments
      const appointmentIds = await this.getAppointmentIds(options);
      console.log(`📋 [GET APPOINTMENTS] Found ${appointmentIds.length} appointment IDs`);
      console.log("📋 [GET APPOINTMENTS] Appointment IDs array:", appointmentIds);
      
      // Add a small delay after getting IDs before processing details
      if (appointmentIds.length > 0) {
        console.log(`⏳ [GET APPOINTMENTS] Waiting ${this.delayAfterGetIds}ms before fetching details...`);
        await new Promise(resolve => setTimeout(resolve, this.delayAfterGetIds));
      }
      
      if (appointmentIds.length === 0) {
        return {
          appointments: [],
          totalCount: 0,
          hasMore: false,
          nextStartKey: null
        };
      }
      
      // Step 2: Get full details for each appointment using GetAppointment
      console.log('🔍 [GET APPOINTMENTS] Fetching full details for each appointment...');
      const appointments = await this.getAppointmentDetails(appointmentIds, options.requestingPatientId);
      
      console.log(`✅ [GET APPOINTMENTS] Successfully retrieved ${appointments.length} appointments with full details`);
      
      return {
        appointments: appointments,
        totalCount: appointments.length,
        hasMore: false,
        nextStartKey: null
      };
    } catch (error) {
      console.error('Tebra SOAP: GetAppointments error', error.message);
      throw error;
    }
  }

  // Get appointment IDs using GetAppointments SOAP call
  async getAppointmentIds(options = {}) {
    try {
      console.log("🔍 [GET APPOINTMENT IDS] Starting with options:", JSON.stringify(options, null, 2));
      
      // Use raw SOAP if enabled, otherwise use soap library
      if (this.useRawSOAP) {
        const fields = { ID: 1 }; // Only request ID field for efficiency
        const filters = this.buildAppointmentFilters(options);
        console.log("🔍 [RAW SOAP] GetAppointmentIds fields requested:", JSON.stringify(fields, null, 2));
        console.log("🔍 [RAW SOAP] GetAppointmentIds filters:", JSON.stringify(filters, null, 2));
        const result = await this.callRawSOAPMethod('GetAppointments', fields, filters);
        const parsedResult = this.parseRawSOAPResponse(result, 'GetAppointments');
        const appointmentIds = this.extractAppointmentIds(parsedResult);
        console.log("📋 [GET APPOINTMENT IDS] Final appointment IDs array:", appointmentIds);
        return appointmentIds;
      }

      const client = await this.getClient();
      
      // Build the request structure for GetAppointments (only requesting IDs)
      const args = {
        request: {
          RequestHeader: this.buildRequestHeader(),
          Fields: {
            ID: 1 // Only request ID field for efficiency
          },
          Filter: {
            // Basic filters - removed PatientID filter to get all appointments
            PatientFullName: options.patientFullName,
            PracticeName: options.practiceName,
            ServiceLocationName: options.serviceLocationName,
            ResourceName: options.resourceName,
            // Date filters
            StartDate: options.startDate,
            EndDate: options.endDate,
            FromCreatedDate: options.fromCreatedDate,
            ToCreatedDate: options.toCreatedDate,
            FromLastModifiedDate: options.fromLastModifiedDate,
            ToLastModifiedDate: options.toLastModifiedDate,
            // Other filters
            AppointmentReason: options.appointmentReason,
            ConfirmationStatus: options.confirmationStatus,
            PatientCasePayerScenario: options.patientCasePayerScenario,
            Type: options.type,
            TimeZoneOffsetFromGMT: options.timeZoneOffsetFromGMT
          }
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      this.cleanRequestData(args);
      
      console.log("GetAppointmentIds args:", JSON.stringify(args, null, 2));
      const [result] = await client.GetAppointmentsAsync(args);
      console.log("GetAppointmentIds result:", result);
      const appointmentIds = this.extractAppointmentIds(result);
      console.log("📋 [GET APPOINTMENT IDS] Final appointment IDs array:", appointmentIds);
      return appointmentIds;
    } catch (error) {
      console.error('Tebra SOAP: GetAppointmentIds error', error.message);
      throw error;
    }
  }

  // Extract appointment IDs from GetAppointments response
  extractAppointmentIds(result) {
    const data = this.unwrap(result);
    const appointmentIds = [];
    
    if (data.Appointments && Array.isArray(data.Appointments)) {
      for (const appointment of data.Appointments) {
        const id = appointment.ID || appointment.AppointmentID || appointment.id;
        if (id) {
          appointmentIds.push(id);
        }
      }
    } else if (Array.isArray(data)) {
      for (const appointment of data) {
        const id = appointment.ID || appointment.AppointmentID || appointment.id;
        if (id) {
          appointmentIds.push(id);
        }
      }
    }
    
    console.log(`📋 [EXTRACT IDS] Extracted ${appointmentIds.length} appointment IDs:`, appointmentIds);
    return appointmentIds;
  }

  // Get full details for multiple appointments
  async getAppointmentDetails(appointmentIds, requestingPatientId = null) {
    const appointments = [];
    
    // Process appointments in batches to avoid overwhelming the API
    const batchSize = this.batchSize;
    for (let i = 0; i < appointmentIds.length; i += batchSize) {
      const batch = appointmentIds.slice(i, i + batchSize);
      console.log(`🔄 [BATCH] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(appointmentIds.length / batchSize)} (${batch.length} appointments)`);
      
      // Process batch with small delays between calls to be respectful to the API
      const batchResults = [];
      for (let j = 0; j < batch.length; j++) {
        const appointmentId = batch[j];
        try {
          console.log(`🔍 [BATCH] Getting appointment ${j + 1}/${batch.length}: ${appointmentId}`);
          const appointment = await this.getAppointment(appointmentId, requestingPatientId);
          batchResults.push(appointment);
          
          // Add a small delay between individual calls (except for the last one in the batch)
          if (j < batch.length - 1) {
            await new Promise(resolve => setTimeout(resolve, this.delayBetweenCalls));
          }
        } catch (error) {
          console.error(`❌ [BATCH] Failed to get appointment ${appointmentId}:`, error.message);
          batchResults.push(null); // Add null for failed appointments
        }
      }
      
      // Filter out null results and add to appointments array
      const validAppointments = batchResults.filter(appointment => appointment !== null);
      appointments.push(...validAppointments);
      
      // Add a delay between batches to be respectful to the API
      if (i + batchSize < appointmentIds.length) {
        console.log(`⏳ [BATCH] Waiting ${this.delayBetweenBatches}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
      }
    }
    
    return appointments;
  }

  async getAppointment(appointmentId, requestingPatientId = null) {
    try {
      // Use raw SOAP if enabled, otherwise use soap library
      if (this.useRawSOAP) {
        const result = await this.callRawSOAPMethod('GetAppointment', { Appointment: { AppointmentId: appointmentId } }, {});
        const parsedResult = this.parseRawSOAPResponse(result, 'GetAppointment');
        return this.normalizeGetAppointmentResponse(parsedResult, requestingPatientId);
      }

      const client = await this.getClient();
      
      // Build the request structure according to the SOAP API
      // GetAppointment expects Appointment object with AppointmentId inside
      const args = {
        request: {
          RequestHeader: this.buildRequestHeader(),
          Appointment: {
            AppointmentId: (typeof appointmentId === 'string' && /^\d+$/.test(appointmentId)) ? parseInt(appointmentId, 10) : appointmentId
          }
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      this.cleanRequestData(args);
      
      console.log("GetAppointment args:", JSON.stringify(args, null, 2));
      const [result] = await client.GetAppointmentAsync(args);
      console.log("GetAppointment result:", result);
      return this.normalizeGetAppointmentResponse(result, requestingPatientId);
    } catch (error) {
      console.error('Tebra SOAP: GetAppointment error', error.message);
      throw error;
    }
  }

  async createAppointment(appointmentData) {
    try {
      // Use raw SOAP if enabled, otherwise use soap library
      if (this.useRawSOAP) {
        const appointment = await this.buildAppointmentData(appointmentData);
        console.log('🔍 Built appointment data:', JSON.stringify(appointment, null, 2));
        const result = await this.callRawSOAPMethod('CreateAppointment', appointment, {});
        return this.parseRawSOAPResponse(result, 'CreateAppointment');
      }

      const client = await this.getClient();
      
      // Build the request structure according to the SOAP API
      const args = {
        request: {
          RequestHeader: this.buildRequestHeader(),
          Appointment: {
            AppointmentId: appointmentData.appointmentId,
            AppointmentMode: appointmentData.appointmentMode,
            AppointmentName: appointmentData.appointmentName,
            AppointmentReasonId: appointmentData.appointmentReasonId,
            AppointmentStatus: appointmentData.appointmentStatus,
            AppointmentType: appointmentData.appointmentType,
            AppointmentUUID: appointmentData.appointmentUUID,
            AttendeesCount: appointmentData.attendeesCount,
            CreatedAt: appointmentData.createdAt,
            CreatedBy: appointmentData.createdBy,
            CustomerId: appointmentData.customerId,
            EndTime: appointmentData.endTime,
            ForRecare: appointmentData.forRecare,
            InsurancePolicyAuthorizationId: appointmentData.insurancePolicyAuthorizationId,
            IsDeleted: appointmentData.isDeleted,
            IsGroupAppointment: appointmentData.isGroupAppointment,
            IsRecurring: appointmentData.isRecurring,
            MaxAttendees: appointmentData.maxAttendees,
            Notes: appointmentData.notes,
            OccurrenceId: appointmentData.occurrenceId,
            PatientCaseId: appointmentData.patientCaseId,
            PracticeId: appointmentData.practiceId,
            ProviderId: appointmentData.providerId || '1',
            ResourceId: appointmentData.resourceId,
            ResourceIds: appointmentData.resourceIds,
            ServiceLocationId: appointmentData.serviceLocationId,
            StartTime: appointmentData.startTime,
            UpdatedAt: appointmentData.updatedAt,
            UpdatedBy: appointmentData.updatedBy,
            WasCreatedOnline: appointmentData.wasCreatedOnline,
            // Patient summary
            PatientSummary: appointmentData.patientSummary && {
              DateOfBirth: appointmentData.patientSummary.dateOfBirth,
              Email: appointmentData.patientSummary.email,
              FirstName: appointmentData.patientSummary.firstName,
              GenderId: appointmentData.patientSummary.genderId,
              Guid: appointmentData.patientSummary.guid,
              HomePhone: appointmentData.patientSummary.homePhone,
              LastName: appointmentData.patientSummary.lastName,
              MiddleName: appointmentData.patientSummary.middleName,
              MobilePhone: appointmentData.patientSummary.mobilePhone,
              OtherEmail: appointmentData.patientSummary.otherEmail,
              OtherPhone: appointmentData.patientSummary.otherPhone,
              PatientId: appointmentData.patientSummary.patientId,
              PracticeId: appointmentData.patientSummary.practiceId,
              PreferredEmailType: appointmentData.patientSummary.preferredEmailType,
              PreferredPhoneType: appointmentData.patientSummary.preferredPhoneType,
              WorkEmail: appointmentData.patientSummary.workEmail,
              WorkPhone: appointmentData.patientSummary.workPhone
            },
            // Group patient summaries
            PatientSummaries: appointmentData.patientSummaries,
            // Recurrence rule
            RecurrenceRule: appointmentData.recurrenceRule && {
              AppointmentId: appointmentData.recurrenceRule.appointmentId,
              DayInterval: appointmentData.recurrenceRule.dayInterval,
              DayOfMonth: appointmentData.recurrenceRule.dayOfMonth,
              DayOfWeek: appointmentData.recurrenceRule.dayOfWeek,
              DayOfWeekFlags: appointmentData.recurrenceRule.dayOfWeekFlags,
              DayOfWeekMonthlyOrdinal: appointmentData.recurrenceRule.dayOfWeekMonthlyOrdinal,
              DayOfWeekMonthlyOrdinalFlags: appointmentData.recurrenceRule.dayOfWeekMonthlyOrdinalFlags,
              EndDate: appointmentData.recurrenceRule.endDate,
              MonthInterval: appointmentData.recurrenceRule.monthInterval,
              MonthOfYear: appointmentData.recurrenceRule.monthOfYear,
              NumOccurrences: appointmentData.recurrenceRule.numOccurrences,
              NumberOfTimes: appointmentData.recurrenceRule.numberOfTimes,
              RecurrenceRuleId: appointmentData.recurrenceRule.recurrenceRuleId,
              StartDate: appointmentData.recurrenceRule.startDate,
              TypeOfDay: appointmentData.recurrenceRule.typeOfDay,
              TypeOfDayMonthlyOrdinal: appointmentData.recurrenceRule.typeOfDayMonthlyOrdinal,
              TypeOfDayMonthlyOrdinalFlags: appointmentData.recurrenceRule.typeOfDayMonthlyOrdinalFlags
            }
          }
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      this.cleanRequestData(args);
      
      console.log("CreateAppointment args:", JSON.stringify(args, null, 2));
      const [result] = await client.CreateAppointmentAsync(args);
      console.log("CreateAppointment result:", result);
      return this.normalizeCreateAppointmentResponse(result);
    } catch (error) {
      console.error('Tebra SOAP: CreateAppointment error', error.message);
      throw error;
    }
  }

  async deleteAppointment(appointmentId) {
    try {
      console.log(`❌ [TEBRA SERVICE] Deleting appointment ${appointmentId}`);
      // Coerce numeric string IDs to integers to match SOAP type expectations
      const appointmentIdToUse = (typeof appointmentId === 'string' && /^\d+$/.test(appointmentId)) ? parseInt(appointmentId, 10) : appointmentId;

      // Use raw SOAP if enabled, otherwise use soap library
      if (this.useRawSOAP) {
        const appointmentPayload = { Appointment: { AppointmentId: appointmentIdToUse } };
        const result = await this.callRawSOAPMethod('DeleteAppointment', appointmentPayload, {});
        return this.parseRawSOAPResponse(result, 'DeleteAppointment');
      }

      const client = await this.getClient();
      
      // Build the request structure according to the SOAP API
      const args = {
        request: {
          RequestHeader: this.buildRequestHeader(),
          Appointment: {
            AppointmentId: appointmentIdToUse
          }
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      this.cleanRequestData(args);
      
      console.log("DeleteAppointment args:", JSON.stringify(args, null, 2));
      const [result] = await client.DeleteAppointmentAsync(args);
      console.log("DeleteAppointment result:", result);
      
      // Return success structure
      return { success: true, message: 'Appointment deleted successfully', appointmentId: appointmentIdToUse };
    } catch (error) {
      console.error('❌ Tebra SOAP: DeleteAppointment error', error && error.message ? error.message : error);
      
      // Enhanced error logging for debugging
      if (error.response) {
        console.error('Response data:', error.response.data);
        console.error('Response status:', error.response.status);
        console.error('Response headers:', error.response.headers);
      }
      
      if (error.request) {
        console.error('Request details:', {
          method: error.request.method,
          url: error.request.url,
          headers: error.request.headers
        });
      }

      // Generate and log raw SOAP XML for debugging (but don't send it)
      try {
        const appointmentPayload = { Appointment: { AppointmentId: appointmentId } };
        const rawXml = this.generateRawSOAPXML('DeleteAppointment', appointmentPayload, {});
        console.error('🔍 Generated raw SOAP XML for DeleteAppointment (debug):\n', rawXml);
      } catch (xmlErr) {
        console.error('Failed to generate raw SOAP XML for debugging:', xmlErr && xmlErr.message ? xmlErr.message : xmlErr);
      }

      // If soap client exists, log lastRequest/lastResponse for further clues
      try {
        const client = await this.getClient();
        if (client && client.lastRequest) {
          console.error('🔍 SOAP client lastRequest:\n', client.lastRequest);
        }
        if (client && client.lastResponse) {
          console.error('🔍 SOAP client lastResponse:\n', client.lastResponse);
        }
      } catch (cliErr) {
        console.error('Failed to log SOAP client lastRequest/lastResponse:', cliErr && cliErr.message ? cliErr.message : cliErr);
      }

      // Throw a more descriptive error
      const enhancedError = new Error(`Failed to delete appointment ${appointmentId}: ${error.message}`);
      enhancedError.originalError = error;
      enhancedError.appointmentId = appointmentId;
      throw enhancedError;
    }
  }

  async updateAppointment(appointmentId, updates) {
    try {
      console.log(`✏️ [TEBRA SERVICE] Updating appointment ${appointmentId}`);

      // Coerce numeric string IDs to integers to match SOAP type expectations
      const appointmentIdToUse = (typeof appointmentId === 'string' && /^\d+$/.test(appointmentId)) ? parseInt(appointmentId, 10) : appointmentId;

      // Build Appointment payload
      const appointmentPayload = {
        Appointment: {
          AppointmentId: appointmentIdToUse,
          AppointmentMode: updates.appointmentMode,
          AppointmentName: updates.appointmentName,
          AppointmentReasonId: updates.appointmentReasonId,
          AppointmentStatus: updates.appointmentStatus,
          EndTime: updates.endTime,
          InsurancePolicyAuthorizationId: updates.insurancePolicyAuthorizationId,
          IsRecurring: updates.isRecurring,
          MaxAttendees: updates.maxAttendees,
          Notes: updates.notes,
          OccurrenceId: updates.occurrenceId,
          PatientCaseId: updates.patientCaseId,
          PatientId: updates.patientId,
          ProviderId: updates.providerId || '1',
          ResourceId: updates.resourceId,
          ResourceIds: updates.resourceIds,
          ServiceLocationId: updates.serviceLocationId,
          StartTime: updates.startTime,
          UpdatedAt: updates.updatedAt,
          UpdatedBy: updates.updatedBy
        }
      };

      // Clean payload
      this.cleanRequestData(appointmentPayload);

      // If raw SOAP mode, call raw method and parse response
      if (this.useRawSOAP) {
        const rawResult = await this.callRawSOAPMethod('UpdateAppointment', appointmentPayload.Appointment, {});
        return this.parseRawSOAPResponse(rawResult, 'UpdateAppointment');
      }

      const client = await this.getClient();

      const args = {
        request: {
          RequestHeader: this.buildRequestHeader(),
          Appointment: appointmentPayload.Appointment
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      this.cleanRequestData(args);

      console.log("UpdateAppointment args:", JSON.stringify(args, null, 2));
      const [result] = await client.UpdateAppointmentAsync(args);
      console.log("UpdateAppointment result:", result);
      return this.normalizeGetAppointmentResponse(result);
    } catch (error) {
      console.error('❌ Tebra SOAP: UpdateAppointment error', error && error.message ? error.message : error);
      if (error && error.stack) console.error('Stack:', error.stack);
      if (error && error.response && error.response.data) console.error('Upstream response data:', error.response.data);

      // Generate and log raw SOAP XML for debugging (do not send)
      try {
        const rawXml = this.generateRawSOAPXML('UpdateAppointment', appointmentPayload && appointmentPayload.Appointment ? appointmentPayload.Appointment : updates, {});
        console.error('🔍 Generated raw SOAP XML for UpdateAppointment (debug):\n', rawXml);
      } catch (xmlErr) {
        console.error('Failed to generate raw SOAP XML for debugging:', xmlErr && xmlErr.message ? xmlErr.message : xmlErr);
      }

      // If soap client exists, log lastRequest/lastResponse for further clues
      try {
        const client = await this.getClient();
        if (client && client.lastRequest) {
          console.error('🔍 SOAP client lastRequest:\n', client.lastRequest);
        }
        if (client && client.lastResponse) {
          console.error('🔍 SOAP client lastResponse:\n', client.lastResponse);
        }
      } catch (cliErr) {
        console.error('Failed to log SOAP client lastRequest/lastResponse:', cliErr && cliErr.message ? cliErr.message : cliErr);
      }

      const enhancedError = new Error(`Failed to update appointment ${appointmentId}: ${error.message}`);
      enhancedError.originalError = error;
      enhancedError.appointmentId = appointmentId;
      throw enhancedError;
    }
  }

  // Appointment Reasons
  async createAppointmentReason(appointmentReasonData) {
    try {
      const client = await this.getClient();
      
      // Build the request structure according to the SOAP API
      const args = {
        request: {
          RequestHeader: this.buildRequestHeader(),
          AppointmentReason: {
            DefaultColorCode: appointmentReasonData.defaultColorCode,
            DefaultDurationMinutes: appointmentReasonData.defaultDurationMinutes,
            Name: appointmentReasonData.name,
            PracticeId: appointmentReasonData.practiceId,
            PracticeReasourceIds: appointmentReasonData.practiceResourceIds,
            ProcedureCodeIds: appointmentReasonData.procedureCodeIds,
            ProviderIds: appointmentReasonData.providerIds
          }
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      this.cleanRequestData(args);
      
      console.log("CreateAppointmentReason args:", JSON.stringify(args, null, 2));
      const [result] = await client.CreateAppointmentReasonAsync(args);
      console.log("CreateAppointmentReason result:", result);
      return this.normalizeCreateAppointmentReasonResponse(result);
    } catch (error) {
      console.error('Tebra SOAP: CreateAppointmentReason error', error.message);
      throw error;
    }
  }

  async getAppointmentReasons(practiceId) {
    try {
      const client = await this.getClient();
      
      // Build the request structure according to the SOAP API
      const args = {
        request: {
          RequestHeader: this.buildRequestHeader(),
          PracticeId: practiceId
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      this.cleanRequestData(args);
      
      console.log("GetAppointmentReasons args:", JSON.stringify(args, null, 2));
      const [result] = await client.GetAppointmentReasonsAsync(args);
      console.log("GetAppointmentReasons result:", result);
      return this.normalizeGetAppointmentReasonsResponse(result);
    } catch (error) {
      console.error('Tebra SOAP: GetAppointmentReasons error', error.message);
      throw error;
    }
  }

  // Helper methods to get Practice and Provider information
  async getPractices(options = {}) {
    try {
      const client = await this.getClient();
      
      // Build the request structure according to the SOAP API
      const args = {
        request: {
          RequestHeader: this.buildRequestHeader(),
          Fields: {
            // Basic practice information
            ID: 1,
            PracticeName: 1,
            Active: 1,
            CreatedDate: 1,
            LastModifiedDate: 1,
            // Practice address
            PracticeAddressLine1: 1,
            PracticeAddressLine2: 1,
            PracticeCity: 1,
            PracticeState: 1,
            PracticeZipCode: 1,
            PracticeCountry: 1,
            // Contact information
            Phone: 1,
            PhoneExt: 1,
            Fax: 1,
            FaxExt: 1,
            Email: 1,
            WebSite: 1,
            // Business information
            NPI: 1,
            TaxID: 1,
            SubscriptionEdition: 1,
            Notes: 1,
            // Administrator information
            AdministratorFullName: 1,
            AdministratorEmail: 1,
            AdministratorPhone: 1,
            AdministratorAddressLine1: 1,
            AdministratorCity: 1,
            AdministratorState: 1,
            AdministratorZipCode: 1,
            // Billing contact information
            BillingContactFullName: 1,
            BillingContactEmail: 1,
            BillingContactPhone: 1,
            BillingContactAddressLine1: 1,
            BillingContactCity: 1,
            BillingContactState: 1,
            BillingContactZipCode: 1
          },
          Filter: {
            // Basic filters
            ID: options.id,
            PracticeName: options.practiceName,
            Active: options.active,
            NPI: options.npi,
            TaxID: options.taxId,
            // Date filters
            FromCreatedDate: options.fromCreatedDate,
            ToCreatedDate: options.toCreatedDate,
            FromLastModifiedDate: options.fromLastModifiedDate,
            ToLastModifiedDate: options.toLastModifiedDate
          }
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      this.cleanRequestData(args);
      
      console.log("GetPractices args:", JSON.stringify(args, null, 2));
      const [result] = await client.GetPracticesAsync(args);
      console.log("GetPractices result:", result);
      return this.normalizeGetPracticesResponse(result);
    } catch (error) {
      console.error('Tebra SOAP: GetPractices error', error.message);
      throw error;
    }
  }

  async getProviders(options = {}) {
    try {
      // Use raw SOAP if enabled, otherwise use soap library
      if (this.useRawSOAP) {
        const fields = { Active: 1 };
        const filters = {};
        const result = await this.callRawSOAPMethod('GetProviders', fields, filters);
        return this.parseRawSOAPResponse(result, 'GetProviders');
      }

      const client = await this.getClient();
      
      // Build the request structure according to the SOAP API
      // Start with minimal fields to avoid internal server errors
      const args = {
        request: {
          RequestHeader: this.buildRequestHeader(),
          Fields: {
            // Start with just the most basic fields
            Active: 1
          },
          Filter: {}
        }
      };

      this.cleanRequestData(args);
      
      console.log("GetProviders args:", JSON.stringify(args, null, 2));
      const [result] = await client.GetProvidersAsync(args);
      console.log("GetProviders result:", result);
      return this.normalizeGetProvidersResponse(result);
    } catch (error) {
      this.handleSOAPError(error, 'GetProviders', { options });
    }
  }

  // Get providers with basic fields (matches working client)
  async getProvidersBasic() {
    const fields = { Active: 1 };
    return await this.callMethod('GetProviders', fields);
  }

  // Get appointments (matches working client)
  async getAppointmentsBasic() {
    return await this.callMethod('GetAppointments');
  }

  // Availability and Scheduling
  async getAvailability(options = {}) {
    try {
      const client = await this.getClient();
      
      // Build the request structure according to the SOAP API
      const args = {
        request: {
          RequestHeader: this.buildRequestHeader(),
          Fields: {
            // Basic availability information
            ID: 1,
            StartDate: 1,
            EndDate: 1,
            StartTime: 1,
            EndTime: 1,
            Duration: 1,
            IsAvailable: 1,
            // Provider information
            ProviderID: 1,
            ProviderName: 1,
            // Service location
            ServiceLocationID: 1,
            ServiceLocationName: 1,
            // Practice information
            PracticeID: 1,
            PracticeName: 1,
            // Appointment type
            AppointmentType: 1,
            AppointmentReason: 1
          },
          Filter: {
            // Basic filters
            ProviderID: options.providerId || '1',
            ProviderName: options.providerName,
            PracticeID: options.practiceId,
            PracticeName: options.practiceName,
            ServiceLocationID: options.serviceLocationId,
            ServiceLocationName: options.serviceLocationName,
            // Date filters
            StartDate: options.startDate,
            EndDate: options.endDate,
            FromDate: options.fromDate,
            ToDate: options.toDate,
            // Time filters
            StartTime: options.startTime,
            EndTime: options.endTime,
            // Other filters
            AppointmentType: options.appointmentType,
            AppointmentReason: options.appointmentReason,
            IsAvailable: options.isAvailable
          }
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      this.cleanRequestData(args);
      
      console.log("GetAvailability args:", JSON.stringify(args, null, 2));
      const [result] = await client.GetAvailabilityAsync(args);
      console.log("GetAvailability result:", result);
      return this.normalizeGetAvailabilityResponse(result);
    } catch (error) {
      console.error('Tebra SOAP: GetAvailability error', error.message);
      throw error;
    }
  }

  // Normalizers
  normalizeCreatePatientResponse(result) {
    // Accept both plain object or nested response
    const data = this.unwrap(result);
    const id = data.PatientID || data.id || data.patientId;
    return { id };
  }

  normalizeGetPatientResponse(result) {
    const data = this.unwrap(result);
    
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

  normalizeGetPatientsResponse(result) {
    const data = this.unwrap(result);
    
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

  cleanRequestData(obj) {
    if (obj === null || obj === undefined) return;
    
    if (Array.isArray(obj)) {
      for (let i = obj.length - 1; i >= 0; i--) {
        if (obj[i] === null || obj[i] === undefined || obj[i] === '') {
          obj.splice(i, 1);
        } else {
          this.cleanRequestData(obj[i]);
        }
      }
    } else if (typeof obj === 'object') {
      for (const key in obj) {
        if (obj[key] === null || obj[key] === undefined || obj[key] === '') {
          delete obj[key];
        } else {
          this.cleanRequestData(obj[key]);
        }
      }
    }
  }

  normalizeCreateDocumentResponse(result) {
    const data = this.unwrap(result);
    return {
      id: data.DocumentID || data.id || data.documentId,
      name: data.Name || data.name,
      fileName: data.FileName || data.fileName,
      documentDate: data.DocumentDate || data.documentDate,
      status: data.Status || data.status,
      patientId: data.PatientId || data.patientId,
      practiceId: data.PracticeId || data.practiceId,
      created_at: data.CreatedDate || data.created_at
    };
  }

  normalizeGetAppointmentsResponse(result, requestingPatientId = null) {
    const data = this.unwrap(result);
    
    // Handle different response structures
    if (data.Appointments && Array.isArray(data.Appointments)) {
      return {
        appointments: data.Appointments.map(appointment => this.normalizeAppointmentData(appointment, requestingPatientId)),
        totalCount: data.TotalCount || data.Appointments.length,
        hasMore: data.HasMore || false,
        nextStartKey: data.NextStartKey || null
      };
    } else if (Array.isArray(data)) {
      return {
        appointments: data.map(appointment => this.normalizeAppointmentData(appointment, requestingPatientId)),
        totalCount: data.length,
        hasMore: false,
        nextStartKey: null
      };
    } else {
      // Single appointment response
      return {
        appointments: [this.normalizeAppointmentData(data, requestingPatientId)],
        totalCount: 1,
        hasMore: false,
        nextStartKey: null
      };
    }
  }

  normalizeGetAppointmentResponse(result, requestingPatientId = null) {
    const data = this.unwrap(result);
    
    // Debug: Log the unwrapped data to understand the structure
    console.log('🔍 [DEBUG] Unwrapped GetAppointment result:', JSON.stringify(data, null, 2));
    
    // Handle different response structures
    if (data.Appointments && Array.isArray(data.Appointments) && data.Appointments.length > 0) {
      console.log('🔍 [DEBUG] Found Appointments array, using first appointment');
      return this.normalizeAppointmentData(data.Appointments[0], requestingPatientId);
    } else if (data.Appointment) {
      console.log('🔍 [DEBUG] Found single Appointment object');
      return this.normalizeAppointmentData(data.Appointment, requestingPatientId);
    } else if (Array.isArray(data) && data.length > 0) {
      console.log('🔍 [DEBUG] Found data array, using first item');
      return this.normalizeAppointmentData(data[0], requestingPatientId);
    } else if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      console.log('🔍 [DEBUG] Using data directly as appointment');
      // Single appointment response
      return this.normalizeAppointmentData(data, requestingPatientId);
    } else {
      console.log('🔍 [DEBUG] No valid appointment data found, returning empty appointment');
      // Return empty appointment structure if no data found
      return this.normalizeAppointmentData({}, requestingPatientId);
    }
  }

  normalizeCreateAppointmentResponse(result) {
    const data = this.unwrap(result);
    return {
      id: data.AppointmentID || data.id || data.appointmentId,
      appointmentId: data.AppointmentID || data.appointmentId,
      startTime: data.StartTime || data.startTime,
      endTime: data.EndTime || data.endTime,
      status: data.AppointmentStatus || data.status,
      patientId: data.PatientId || data.patientId,
      practiceId: data.PracticeId || data.practiceId,
      created_at: data.CreatedDate || data.created_at
    };
  }

  normalizeAppointmentData(appointment, requestingPatientId = null) {
    // Handle null/undefined appointment
    if (!appointment || typeof appointment !== 'object') {
      return {};
    }
    
    // Debug: Log the raw appointment data to understand the structure
    console.log('🔍 [DEBUG] Raw appointment data:', JSON.stringify(appointment, null, 2));
    
    // Handle date and time fields from GetAppointment API
    // GetAppointment returns StartTime and EndTime in UTC format (e.g., 2020-01-24T22:00:00.000Z)
    const startTime = appointment.StartTime || appointment.startTime;
    const endTime = appointment.EndTime || appointment.endTime;
    
    // Extract date and time components from UTC datetime strings
    let startDate = null;
    let startTimeFormatted = null;
    let endDate = null;
    let endTimeFormatted = null;
    
    if (startTime) {
      try {
        const startDateTime = new Date(startTime);
        startDate = startDateTime.toISOString().split('T')[0]; // YYYY-MM-DD
        startTimeFormatted = startDateTime.toTimeString().split(' ')[0]; // HH:MM:SS
      } catch (error) {
        console.warn('Failed to parse start time:', startTime);
        startTimeFormatted = startTime;
      }
    }
    
    if (endTime) {
      try {
        const endDateTime = new Date(endTime);
        endDate = endDateTime.toISOString().split('T')[0]; // YYYY-MM-DD
        endTimeFormatted = endDateTime.toTimeString().split(' ')[0]; // HH:MM:SS
      } catch (error) {
        console.warn('Failed to parse end time:', endTime);
        endTimeFormatted = endTime;
      }
    }
    
    return {
      id: appointment.ID || appointment.AppointmentID || appointment.id || appointment.AppointmentId,
      appointmentId: appointment.ID || appointment.AppointmentID || appointment.appointmentId || appointment.AppointmentId,
      // Extract patientId to top level for filter compatibility
      patientId: appointment.PatientID || appointment.PatientId || appointment.patientId,
      startDate: startDate,
      endDate: endDate,
      startTime: startTimeFormatted,
      endTime: endTimeFormatted,
      appointmentDuration: appointment.AppointmentDuration || appointment.appointmentDuration,
      allDay: appointment.AllDay || appointment.allDay,
      type: appointment.Type || appointment.type,
      appointmentType: appointment.AppointmentType || appointment.appointmentType,
      appointmentStatus: appointment.AppointmentStatus || appointment.appointmentStatus,
      confirmationStatus: appointment.ConfirmationStatus || appointment.confirmationStatus,
      notes: appointment.Notes || appointment.Note || appointment.notes || appointment.note,
      recurring: appointment.Recurring || appointment.recurring,
      isRecurring: appointment.IsRecurring || appointment.isRecurring,
      occurrenceId: appointment.OccurrenceID || appointment.occurrenceId,
      appointmentReasonId: appointment.AppointmentReasonID || appointment.appointmentReasonId,
      providerId: appointment.ProviderID || appointment.providerId,
      resourceId: appointment.ResourceID || appointment.resourceId,
      resourceIds: appointment.ResourceIDs || appointment.resourceIds,
      appointmentName: appointment.AppointmentName || appointment.appointmentName,
      wasCreatedOnline: appointment.WasCreatedOnline || appointment.wasCreatedOnline,
      insurancePolicyAuthorizationId: appointment.InsurancePolicyAuthorizationID || appointment.insurancePolicyAuthorizationId,
      isGroupAppointment: appointment.IsGroupAppointment || appointment.isGroupAppointment,
      maxAttendees: appointment.MaxAttendees || appointment.maxAttendees,
      attendeesCount: appointment.AttendeesCount || appointment.attendeesCount,
      forRecare: appointment.ForRecare || appointment.forRecare,
      createdDate: appointment.CreatedDate || appointment.createdDate,
      lastModifiedDate: appointment.LastModifiedDate || appointment.lastModifiedDate,
      // Patient information - comprehensive data from GetAppointment API
      patient: {
        id: appointment.PatientID || appointment.PatientId || appointment.patientId,
        // Prefer API-provided full name; otherwise synthesize from available Patient/PatientSummary fields
        fullName: (
          appointment.PatientFullName ||
          appointment.patientFullName ||
          `${(appointment.FirstName || appointment.firstName || (appointment.PatientSummary && (appointment.PatientSummary.FirstName || appointment.PatientSummary.firstName)) || (appointment.patientSummary && (appointment.patientSummary.FirstName || appointment.patientSummary.firstName)) || '').toString()} ${(appointment.LastName || appointment.lastName || (appointment.PatientSummary && (appointment.PatientSummary.LastName || appointment.PatientSummary.lastName)) || (appointment.patientSummary && (appointment.patientSummary.LastName || appointment.patientSummary.lastName)) || '').toString()}`.trim()
        ),
        firstName: appointment.FirstName || appointment.firstName || (appointment.PatientSummary && (appointment.PatientSummary.FirstName || appointment.PatientSummary.firstName)) || (appointment.patientSummary && (appointment.patientSummary.FirstName || appointment.patientSummary.firstName)),
        middleName: appointment.MiddleName || appointment.middleName,
        lastName: appointment.LastName || appointment.lastName || (appointment.PatientSummary && (appointment.PatientSummary.LastName || appointment.PatientSummary.lastName)) || (appointment.patientSummary && (appointment.patientSummary.LastName || appointment.patientSummary.lastName)),
        email: appointment.Email || appointment.email || (appointment.PatientSummary && (appointment.PatientSummary.Email || appointment.PatientSummary.email)) || (appointment.patientSummary && (appointment.patientSummary.Email || appointment.patientSummary.email)),
        homePhone: appointment.HomePhone || appointment.homePhone || (appointment.PatientSummary && (appointment.PatientSummary.HomePhone || appointment.PatientSummary.homePhone)) || (appointment.patientSummary && (appointment.patientSummary.HomePhone || appointment.patientSummary.homePhone)),
        workPhone: appointment.WorkPhone || appointment.workPhone,
        mobilePhone: appointment.MobilePhone || appointment.mobilePhone || (appointment.PatientSummary && (appointment.PatientSummary.MobilePhone || appointment.PatientSummary.mobilePhone)) || (appointment.patientSummary && (appointment.patientSummary.MobilePhone || appointment.patientSummary.mobilePhone)),
        workEmail: appointment.WorkEmail || appointment.workEmail,
        otherEmail: appointment.OtherEmail || appointment.otherEmail,
        dateOfBirth: appointment.DateOfBirth || appointment.dateOfBirth || (appointment.PatientSummary && (appointment.PatientSummary.DateOfBirth || appointment.PatientSummary.dateOfBirth)) || (appointment.patientSummary && (appointment.patientSummary.DateOfBirth || appointment.patientSummary.dateOfBirth)),
        genderId: appointment.GenderID || appointment.genderId,
        preferredPhoneType: appointment.PreferredPhoneType || appointment.preferredPhoneType,
        preferredEmailType: appointment.PreferredEmailType || appointment.preferredEmailType,
        guid: appointment.Guid || appointment.guid,
        caseId: appointment.PatientCaseID || appointment.patientCaseId,
        caseName: appointment.PatientCaseName || appointment.patientCaseName,
        casePayerScenario: appointment.PatientCasePayerScenario || appointment.patientCasePayerScenario
      },
      // Extract meeting link from notes (explicit field wins, then first URL in notes)
      meetingLink: (() => {
        try {
          if (appointment.meetingLink || appointment.MeetingLink) return appointment.meetingLink || appointment.MeetingLink;
          const notesStr = String(appointment.Notes || appointment.Note || appointment.notes || appointment.note || '');
          const m = notesStr.match(/https?:\/\/[^\s)]+/);
          return m && m[0] ? m[0].replace(/[).,;]*$/, '') : null;
        } catch (e) { return appointment.meetingLink || appointment.MeetingLink || null; }
      })(),
      // Practice information
      practice: {
        id: appointment.PracticeID || appointment.PracticeId || appointment.practiceId,
        name: appointment.PracticeName || appointment.practiceName
      },
      // Service location
      serviceLocation: {
        id: appointment.ServiceLocationID || appointment.ServiceLocationId || appointment.serviceLocationId,
        name: appointment.ServiceLocationName || appointment.serviceLocationName
      },
      // Authorization information
      authorization: {
        id: appointment.AuthorizationID || appointment.authorizationId,
        number: appointment.AuthorizationNumber || appointment.authorizationNumber,
        startDate: appointment.AuthorizationStartDate || appointment.authorizationStartDate,
        endDate: appointment.AuthorizationEndDate || appointment.authorizationEndDate,
        insurancePlan: appointment.AuthorizationInsurancePlan || appointment.authorizationInsurancePlan
      },
      // Appointment reasons
      reasons: this.buildAppointmentReasons(appointment),
      // Resources
      resources: this.buildAppointmentResources(appointment),
      // Patient summaries
      patientSummaries: this.buildPatientSummaries(appointment),
      // Mine field - check if appointment belongs to requesting patient
      mine: requestingPatientId ? (appointment.PatientID || appointment.PatientId || appointment.patientId) === requestingPatientId : false
    };
  }

  buildAppointmentReasons(appointment) {
    const reasons = [];
    for (let i = 1; i <= 10; i++) {
      const reason = appointment[`AppointmentReason${i}`] || appointment[`appointmentReason${i}`];
      const reasonId = appointment[`AppointmentReasonID${i}`] || appointment[`appointmentReasonId${i}`];
      if (reason || reasonId) {
        reasons.push({
          reason: reason,
          reasonId: reasonId
        });
      }
    }
    return reasons;
  }

  buildAppointmentResources(appointment) {
    const resources = [];
    for (let i = 1; i <= 10; i++) {
      const resourceId = appointment[`ResourceID${i}`] || appointment[`resourceId${i}`];
      const resourceName = appointment[`ResourceName${i}`] || appointment[`resourceName${i}`];
      const resourceTypeId = appointment[`ResourceTypeID${i}`] || appointment[`resourceTypeId${i}`];
      if (resourceId || resourceName || resourceTypeId) {
        resources.push({
          id: resourceId,
          name: resourceName,
          typeId: resourceTypeId
        });
      }
    }
    return resources;
  }

  buildPatientSummaries(appointment) {
    // Handle PatientSummaries field if it exists
    if (appointment.PatientSummaries && Array.isArray(appointment.PatientSummaries)) {
      return appointment.PatientSummaries.map(summary => ({
        patientId: summary.PatientId || summary.patientId,
        firstName: summary.FirstName || summary.firstName,
        lastName: summary.LastName || summary.lastName,
        email: summary.Email || summary.email,
        dateOfBirth: summary.DateOfBirth || summary.dateOfBirth,
        genderId: summary.GenderId || summary.genderId,
        homePhone: summary.HomePhone || summary.homePhone,
        mobilePhone: summary.MobilePhone || summary.mobilePhone,
        workPhone: summary.WorkPhone || summary.workPhone,
        workEmail: summary.WorkEmail || summary.workEmail,
        otherEmail: summary.OtherEmail || summary.otherEmail,
        practiceId: summary.PracticeId || summary.practiceId,
        guid: summary.Guid || summary.guid,
        status: summary.Status || summary.status
      }));
    }
    
    // If no PatientSummaries, return empty array
    return [];
  }

  // Add mine field to appointment based on requesting patient ID
  addMineFieldToAppointment(appointment, requestingPatientId) {
    if (!appointment || !requestingPatientId) {
      return appointment;
    }

    // Check if the appointment belongs to the requesting patient
    const appointmentPatientId = appointment.PatientID || appointment.PatientId || appointment.patientId;
    const isMine = appointmentPatientId && appointmentPatientId.toString() === requestingPatientId.toString();

    return {
      ...appointment,
      mine: isMine
    };
  }

  // Check if appointment belongs to requesting patient
  isAppointmentMine(appointment, requestingPatientId) {
    if (!appointment || !requestingPatientId) {
      return false;
    }

    // Check if the appointment belongs to the requesting patient
    const appointmentPatientId = appointment.PatientID || appointment.PatientId || appointment.patientId;
    return appointmentPatientId && appointmentPatientId.toString() === requestingPatientId.toString();
  }

  normalizeCreateAppointmentReasonResponse(result) {
    const data = this.unwrap(result);
    return {
      id: data.AppointmentReasonID || data.id || data.appointmentReasonId,
      appointmentReasonId: data.AppointmentReasonID || data.appointmentReasonId,
      name: data.Name || data.name,
      practiceId: data.PracticeId || data.practiceId,
      defaultColorCode: data.DefaultColorCode || data.defaultColorCode,
      defaultDurationMinutes: data.DefaultDurationMinutes || data.defaultDurationMinutes,
      practiceResourceIds: data.PracticeReasourceIds || data.practiceResourceIds,
      procedureCodeIds: data.ProcedureCodeIds || data.procedureCodeIds,
      providerIds: data.ProviderIds || data.providerIds,
      created_at: data.CreatedDate || data.created_at
    };
  }

  normalizeGetAppointmentReasonsResponse(result) {
    const data = this.unwrap(result);
    
    // Handle different response structures
    if (data.AppointmentReasons && Array.isArray(data.AppointmentReasons)) {
      return {
        appointmentReasons: data.AppointmentReasons.map(reason => this.normalizeAppointmentReasonData(reason)),
        totalCount: data.TotalCount || data.AppointmentReasons.length
      };
    } else if (Array.isArray(data)) {
      return {
        appointmentReasons: data.map(reason => this.normalizeAppointmentReasonData(reason)),
        totalCount: data.length
      };
    } else {
      // Single appointment reason response
      return {
        appointmentReasons: [this.normalizeAppointmentReasonData(data)],
        totalCount: 1
      };
    }
  }

  normalizeAppointmentReasonData(reason) {
    return {
      id: reason.ID || reason.AppointmentReasonID || reason.id,
      appointmentReasonId: reason.ID || reason.AppointmentReasonID || reason.appointmentReasonId,
      name: reason.Name || reason.name,
      practiceId: reason.PracticeId || reason.practiceId,
      defaultColorCode: reason.DefaultColorCode || reason.defaultColorCode,
      defaultDurationMinutes: reason.DefaultDurationMinutes || reason.defaultDurationMinutes,
      practiceResourceIds: reason.PracticeReasourceIds || reason.practiceResourceIds || [],
      procedureCodeIds: reason.ProcedureCodeIds || reason.procedureCodeIds || [],
      providerIds: reason.ProviderIds || reason.providerIds || [],
      createdDate: reason.CreatedDate || reason.createdDate,
      lastModifiedDate: reason.LastModifiedDate || reason.lastModifiedDate
    };
  }

  normalizeGetAvailabilityResponse(result) {
    const data = this.unwrap(result);
    
    // Handle different response structures
    if (data.Availability && Array.isArray(data.Availability)) {
      return {
        availability: data.Availability.map(slot => this.normalizeAvailabilityData(slot)),
        totalCount: data.TotalCount || data.Availability.length
      };
    } else if (Array.isArray(data)) {
      return {
        availability: data.map(slot => this.normalizeAvailabilityData(slot)),
        totalCount: data.length
      };
    } else {
      // Single availability response
      return {
        availability: [this.normalizeAvailabilityData(data)],
        totalCount: 1
      };
    }
  }

  normalizeAvailabilityData(availability) {
    return {
      id: availability.ID || availability.id,
      startDate: availability.StartDate || availability.startDate,
      endDate: availability.EndDate || availability.endDate,
      startTime: availability.StartTime || availability.startTime,
      endTime: availability.EndTime || availability.endTime,
      duration: availability.Duration || availability.duration,
      isAvailable: availability.IsAvailable || availability.isAvailable,
      provider: {
        id: availability.ProviderID || availability.providerId || '1',
        name: availability.ProviderName || availability.providerName
      },
      serviceLocation: {
        id: availability.ServiceLocationID || availability.serviceLocationId,
        name: availability.ServiceLocationName || availability.serviceLocationName
      },
      practice: {
        id: availability.PracticeID || availability.practiceId,
        name: availability.PracticeName || availability.practiceName
      },
      appointmentType: availability.AppointmentType || availability.appointmentType,
      appointmentReason: availability.AppointmentReason || availability.appointmentReason
    };
  }

  normalizeGetPracticesResponse(result) {
    const data = this.unwrap(result);
    
    // Handle different response structures
    if (data.Practices && Array.isArray(data.Practices)) {
      return {
        practices: data.Practices.map(practice => this.normalizePracticeData(practice)),
        totalCount: data.TotalCount || data.Practices.length
      };
    } else if (Array.isArray(data)) {
      return {
        practices: data.map(practice => this.normalizePracticeData(practice)),
        totalCount: data.length
      };
    } else {
      // Single practice response
      return {
        practices: [this.normalizePracticeData(data)],
        totalCount: 1
      };
    }
  }

  normalizeGetProvidersResponse(result) {
    const data = this.unwrap(result);
    
    // Handle different response structures
    if (data.Providers && Array.isArray(data.Providers)) {
      return {
        providers: data.Providers.map(provider => this.normalizeProviderData(provider)),
        totalCount: data.TotalCount || data.Providers.length
      };
    } else if (Array.isArray(data)) {
      return {
        providers: data.map(provider => this.normalizeProviderData(provider)),
        totalCount: data.length
      };
    } else {
      // Single provider response
      return {
        providers: [this.normalizeProviderData(data)],
        totalCount: 1
      };
    }
  }

  normalizePracticeData(practice) {
    return {
      id: practice.ID || practice.id,
      practiceId: practice.ID || practice.id,
      name: practice.PracticeName || practice.name,
      active: practice.Active || practice.active,
      address: {
        line1: practice.PracticeAddressLine1 || practice.addressLine1,
        line2: practice.PracticeAddressLine2 || practice.addressLine2,
        city: practice.PracticeCity || practice.city,
        state: practice.PracticeState || practice.state,
        zipCode: practice.PracticeZipCode || practice.zipCode,
        country: practice.PracticeCountry || practice.country
      },
      phone: practice.Phone || practice.phone,
      phoneExt: practice.PhoneExt || practice.phoneExt,
      fax: practice.Fax || practice.fax,
      faxExt: practice.FaxExt || practice.faxExt,
      email: practice.Email || practice.email,
      website: practice.WebSite || practice.website,
      npi: practice.NPI || practice.npi,
      taxId: practice.TaxID || practice.taxId,
      subscriptionEdition: practice.SubscriptionEdition || practice.subscriptionEdition,
      notes: practice.Notes || practice.notes,
      administrator: {
        fullName: practice.AdministratorFullName || practice.administratorFullName,
        email: practice.AdministratorEmail || practice.administratorEmail,
        phone: practice.AdministratorPhone || practice.administratorPhone,
        address: {
          line1: practice.AdministratorAddressLine1 || practice.administratorAddressLine1,
          city: practice.AdministratorCity || practice.administratorCity,
          state: practice.AdministratorState || practice.administratorState,
          zipCode: practice.AdministratorZipCode || practice.administratorZipCode
        }
      },
      billingContact: {
        fullName: practice.BillingContactFullName || practice.billingContactFullName,
        email: practice.BillingContactEmail || practice.billingContactEmail,
        phone: practice.BillingContactPhone || practice.billingContactPhone,
        address: {
          line1: practice.BillingContactAddressLine1 || practice.billingContactAddressLine1,
          city: practice.BillingContactCity || practice.billingContactCity,
          state: practice.BillingContactState || practice.billingContactState,
          zipCode: practice.BillingContactZipCode || practice.billingContactZipCode
        }
      },
      createdDate: practice.CreatedDate || practice.createdDate,
      lastModifiedDate: practice.LastModifiedDate || practice.lastModifiedDate
    };
  }

  normalizeProviderData(provider) {
    return {
      id: provider.ID || provider.id,
      providerId: provider.ID || provider.id || '1',
      firstName: provider.FirstName || provider.firstName,
      lastName: provider.LastName || provider.lastName,
      middleName: provider.MiddleName || provider.middleName,
      fullName: provider.FullName || provider.fullName || `${provider.FirstName || provider.firstName} ${provider.LastName || provider.lastName}`,
      prefix: provider.Prefix || provider.prefix,
      suffix: provider.Suffix || provider.suffix,
      active: provider.Active || provider.active,
      degree: provider.Degree || provider.degree,
      specialty: provider.SpecialtyName || provider.specialty,
      type: provider.Type || provider.type,
      npi: provider.NationalProviderIdentifier || provider.npi,
      ssn: provider.SocialSecurityNumber || provider.ssn,
      billingType: provider.BillingType || provider.billingType,
      email: provider.EmailAddress || provider.email,
      workPhone: provider.WorkPhone || provider.workPhone,
      workPhoneExt: provider.WorkPhoneExt || provider.workPhoneExt,
      homePhone: provider.HomePhone || provider.homePhone,
      homePhoneExt: provider.HomePhoneExt || provider.homePhoneExt,
      mobilePhone: provider.MobilePhone || provider.mobilePhone,
      mobilePhoneExt: provider.MobilePhoneExt || provider.mobilePhoneExt,
      fax: provider.Fax || provider.fax,
      faxExt: provider.FaxExt || provider.faxExt,
      pager: provider.Pager || provider.pager,
      pagerExt: provider.PagerExt || provider.pagerExt,
      address: {
        line1: provider.AddressLine1 || provider.addressLine1,
        line2: provider.AddressLine2 || provider.addressLine2,
        city: provider.City || provider.city,
        state: provider.State || provider.state,
        zipCode: provider.ZipCode || provider.zipCode,
        country: provider.Country || provider.country
      },
      practiceId: provider.PracticeID || provider.practiceId,
      practiceName: provider.PracticeName || provider.practiceName,
      departmentName: provider.DepartmentName || provider.departmentName,
      notes: provider.Notes || provider.notes,
      encounterFormName: provider.EncounterFormName || provider.encounterFormName,
      // Additional fields for discovery script compatibility
      isActive: provider.Active || provider.active || provider.IsActive || provider.isActive,
      title: provider.Title || provider.title,
      phone: provider.WorkPhone || provider.workPhone || provider.Phone || provider.phone,
      performanceReport: {
        active: provider.ProviderPerformanceReportActive || provider.performanceReportActive,
        ccEmailRecipients: provider.ProviderPerformanceReportCCEmailRecipients || provider.performanceReportCCEmailRecipients,
        delay: provider.ProviderPerformanceReportDelay || provider.performanceReportDelay,
        frequency: provider.ProviderPerformanceReportFequency || provider.performanceReportFrequency,
        scope: provider.ProviderPerformanceReportScope || provider.performanceReportScope
      },
      createdDate: provider.CreatedDate || provider.createdDate,
      lastModifiedDate: provider.LastModifiedDate || provider.lastModifiedDate
    };
  }

  // Parse raw SOAP XML response
  parseRawSOAPResponse(xmlResponse, methodName) {
    try {
      console.log(`📄 Parsing raw SOAP response for ${methodName}`);
      
      // Extract the result from the XML response using a more robust approach
      const resultMatch = xmlResponse.match(new RegExp(`<${methodName}Result[^>]*>(.*?)</${methodName}Result>`, 's'));
      if (resultMatch) {
        const resultXml = resultMatch[1];
        console.log(`📄 Extracted result XML for ${methodName}:`, resultXml);
        
        // Special handling for CreatePatient and CreateAppointment responses
        if (methodName === 'CreatePatient') {
          const patient = {};
          
          // Extract patient fields from CreatePatient response
          const fieldMatches = resultXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
          if (fieldMatches) {
            for (const fieldMatch of fieldMatches) {
              const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
              if (fieldNameMatch) {
                const fieldName = fieldNameMatch[1];
                const fieldValue = fieldNameMatch[2];
                patient[fieldName] = fieldValue;
              }
            }
          }
          
          return {
            [`${methodName}Result`]: {
              Patient: patient,
              rawXml: resultXml
            }
          };
        }
        
        if (methodName === 'CreateAppointment') {
          const appointment = {};
          
          // Extract appointment fields from CreateAppointment response
          const fieldMatches = resultXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
          if (fieldMatches) {
            for (const fieldMatch of fieldMatches) {
              const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
              if (fieldNameMatch) {
                const fieldName = fieldNameMatch[1];
                const fieldValue = fieldNameMatch[2];
                appointment[fieldName] = fieldValue;
              }
            }
          }
          
          return {
            [`${methodName}Result`]: {
              Appointment: appointment,
              rawXml: resultXml
            }
          };
        }

        // Handle DeleteAppointment response
        if (methodName === 'DeleteAppointment') {
          const successMatch = resultXml.match(/<Success>([^<]+)<\/Success>/i);
          const success = successMatch ? successMatch[1].toLowerCase() === 'true' : false;

          // Try to extract an AppointmentId element if present in the result XML
          const idMatch = resultXml.match(/<AppointmentId>([^<]+)<\/AppointmentId>/i) || resultXml.match(/<AppointmentID>([^<]+)<\/AppointmentID>/i) || [];
          const appointmentId = idMatch[1] || null;

          return {
            [`${methodName}Result`]: {
              Success: success,
              AppointmentId: appointmentId,
              rawXml: resultXml
            }
          };
        }

        // Handle UpdateAppointment response
        if (methodName === 'UpdateAppointment') {
          const appointment = {};
          const fieldMatches = resultXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
          if (fieldMatches) {
            for (const fieldMatch of fieldMatches) {
              const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
              if (fieldNameMatch) {
                const fieldName = fieldNameMatch[1];
                const fieldValue = fieldNameMatch[2];
                appointment[fieldName] = fieldValue;
              }
            }
          }

          return {
            [`${methodName}Result`]: {
              Appointment: appointment,
              rawXml: resultXml
            }
          };
        }
        
        // Handle GetPatients response
        if (methodName === 'GetPatients') {
          const patients = [];
          const patientMatches = resultXml.match(/<PatientData[^>]*>(.*?)<\/PatientData>/gs);
          
          if (patientMatches) {
            for (const patientXml of patientMatches) {
              const patient = {};
              
              // Extract patient fields
              const fieldMatches = patientXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
              if (fieldMatches) {
                for (const fieldMatch of fieldMatches) {
                  const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
                  if (fieldNameMatch) {
                    const fieldName = fieldNameMatch[1];
                    const fieldValue = fieldNameMatch[2];
                    patient[fieldName] = fieldValue;
                  }
                }
              }
              
              if (Object.keys(patient).length > 0) {
                patients.push(patient);
              }
            }
          }
          
          // Return structure that matches what the normalizers expect
          return {
            [`${methodName}Result`]: {
              Patients: patients,
              TotalCount: patients.length,
              rawXml: resultXml
            }
          };
        }
        
        // Handle GetAppointments response
        if (methodName === 'GetAppointments') {
          const appointments = [];
          const appointmentMatches = resultXml.match(/<AppointmentData>(.*?)<\/AppointmentData>/gs);
          
          if (appointmentMatches) {
            for (const appointmentXml of appointmentMatches) {
              const appointment = {};
              
              // Extract appointment fields
              const fieldMatches = appointmentXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
              if (fieldMatches) {
                for (const fieldMatch of fieldMatches) {
                  const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
                  if (fieldNameMatch) {
                    const fieldName = fieldNameMatch[1];
                    const fieldValue = fieldNameMatch[2];
                    appointment[fieldName] = fieldValue;
                  }
                }
              }
              
              if (Object.keys(appointment).length > 0) {
                appointments.push(appointment);
              }
            }
          }
          
          // Return structure that matches what the normalizers expect
          return {
            [`${methodName}Result`]: {
              Appointments: appointments,
              TotalCount: appointments.length,
              rawXml: resultXml
            }
          };
        }
        
        // Handle GetAppointment response
        if (methodName === 'GetAppointment') {
          const appointment = {};
          
          // Extract appointment fields from GetAppointment response
          const fieldMatches = resultXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
          if (fieldMatches) {
            for (const fieldMatch of fieldMatches) {
              const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
              if (fieldNameMatch) {
                const fieldName = fieldNameMatch[1];
                const fieldValue = fieldNameMatch[2];
                appointment[fieldName] = fieldValue;
              }
            }
          }
          
          return {
            [`${methodName}Result`]: {
              Appointment: appointment,
              rawXml: resultXml
            }
          };
        }
        
        // Default handling for other methods
        return {
          [`${methodName}Result`]: {
            rawXml: resultXml
          }
        };
      }
      
      // If no result found, return empty structure
      console.log(`⚠️ No result found in XML response for ${methodName}`);
      return {
        [`${methodName}Result`]: {
          Patients: methodName === 'GetPatients' ? [] : undefined,
          Appointments: methodName === 'GetAppointments' ? [] : undefined,
          Appointment: methodName === 'GetAppointment' ? {} : undefined,
          TotalCount: 0
        }
      };
    } catch (error) {
      console.error(`❌ Error parsing raw SOAP response for ${methodName}:`, error.message);
      return { rawResponse: xmlResponse, parseError: error.message };
    }
  }

  // Legacy method for backward compatibility - parse patients from XML
  parsePatientsFromXML(resultXml) {
    const patients = [];
    const patientMatches = resultXml.match(/<Patient[^>]*>(.*?)<\/Patient>/gs);
    
    if (patientMatches) {
      for (const patientXml of patientMatches) {
        const patient = {};
        
        // Extract common patient fields
        const fieldMatches = patientXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
        if (fieldMatches) {
          for (const fieldMatch of fieldMatches) {
            const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
            if (fieldNameMatch) {
              const fieldName = fieldNameMatch[1];
              const fieldValue = fieldNameMatch[2];
              patient[fieldName] = fieldValue;
            }
          }
        }
        
        if (Object.keys(patient).length > 0) {
          patients.push(patient);
        }
      }
    }
    
    return patients;
  }

  // Generate SOAP envelope for debugging (matches working client)
  generateSOAPEnvelope(methodName, args = {}) {
    const authHeader = this.buildRequestHeader();
    const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sch="http://www.kareo.com/api/schemas/">
   <soapenv:Header/>
   <soapenv:Body>
      <sch:${methodName}>
         <sch:request>
            <sch:RequestHeader>
               <sch:CustomerKey>${authHeader.CustomerKey}</sch:CustomerKey>
               <sch:Password>${authHeader.Password}</sch:Password>
               <sch:User>${authHeader.User}</sch:User>
            </sch:RequestHeader>
            ${Object.keys(args).map(key => {
              if (typeof args[key] === 'object' && args[key] !== null) {
                return `<sch:${key}>
               ${Object.keys(args[key]).map(subKey => 
                 `<sch:${subKey}>${args[key][subKey]}</sch:${subKey}>`
               ).join('\n               ')}
            </sch:${key}>`;
              }
              return `<sch:${key}>${args[key]}</sch:${key}>`;
            }).join('\n            ')}
         </sch:request>
      </sch:${methodName}>
   </soapenv:Body>
</soapenv:Envelope>`;
    
    return soapEnvelope;
  }

  // Generate SOAP XML based on working template (legacy method)
  generateSOAPXML(methodName, fields = {}, filters = {}) {
    return this.generateRawSOAPXML(methodName, fields, filters);
  }

  // Enhanced error handling with better logging
  handleSOAPError(error, methodName, context = {}) {
    console.error(`❌ Tebra SOAP Error in ${methodName}:`, {
      message: error.message,
      code: error.code,
      context: context,
      timestamp: new Date().toISOString()
    });
    
    if (error.response) {
      console.error('Response details:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    
    if (error.request) {
      console.error('Request details:', {
        url: error.request.url,
        method: error.request.method,
        headers: error.request.headers
      });
    }
    
    // Re-throw with enhanced context
    const enhancedError = new Error(`Tebra SOAP ${methodName} failed: ${error.message}`);
    enhancedError.originalError = error;
    enhancedError.context = context;
    enhancedError.methodName = methodName;
    throw enhancedError;
  }

  // Generic method caller (similar to the client's callMethod)
  async callMethod(methodName, fields = {}, filters = {}) {
    try {
      console.log(`🚀 Calling Tebra method: ${methodName}`);
      
      if (this.useRawSOAP) {
        const result = await this.callRawSOAPMethod(methodName, fields, filters);
        return this.parseRawSOAPResponse(result, methodName);
      } else {
        const client = await this.getClient();
        const args = {
          request: {
            RequestHeader: this.buildRequestHeader(),
            Fields: fields,
            Filter: filters
          }
        };
        
        this.cleanRequestData(args);
        
        console.log(`${methodName} args:`, JSON.stringify(args, null, 2));
        const [result] = await client[`${methodName}Async`](args);
        console.log(`${methodName} result:`, result);
        
        // Use appropriate normalizer based on method name
        const normalizerMethod = `normalize${methodName}Response`;
        if (this[normalizerMethod]) {
          return this[normalizerMethod](result);
        }
        
        return result;
      }
    } catch (error) {
      this.handleSOAPError(error, methodName, { fields, filters });
    }
  }

  // Get configuration info
  getConfig() {
    return {
      wsdlUrl: this.wsdlUrl,
      soapEndpoint: this.soapEndpoint,
      practiceName: this.practiceName,
      user: this.user,
      namespace: this.namespace,
      useRawSOAP: this.useRawSOAP,
      hasCredentials: !!(this.customerKey && this.password && this.user)
    };
  }

  unwrap(obj) {
    if (!obj) return {};
    // node-soap often returns { MethodResult: {...} }
    const keys = Object.keys(obj || {});
    console.log('🔍 [DEBUG] Unwrap - Object keys:', keys);
    if (keys.length === 1 && keys[0].toLowerCase().includes('result')) {
      console.log('🔍 [DEBUG] Unwrap - Found result key:', keys[0]);
      const result = obj[keys[0]] || {};
      console.log('🔍 [DEBUG] Unwrap - Result content:', JSON.stringify(result, null, 2));
      return result;
    }
    console.log('🔍 [DEBUG] Unwrap - Returning object directly:', JSON.stringify(obj, null, 2));
    return obj;
  }
}

// Export both the class and an instance for flexibility
const tebraServiceInstance = new TebraService();

// Minimal document APIs to support listing and downloading patient documents
// These use the generic callMethod; response parsing tolerates multiple shapes.
tebraServiceInstance.getDocuments = async function({ patientId }) {
  if (!patientId) throw new Error('patientId is required');
  try {
    // Attempt using a generic SOAP call with Filter.PatientId
    const resp = await this.callMethod('GetDocuments', {}, { PatientId: String(patientId) });
    // Normalize a few common shapes
    const list = resp?.GetDocumentsResult?.Documents || resp?.documents || resp?.Documents || [];
    const documents = Array.isArray(list) ? list.map((d) => ({
      id: d.Id || d.id,
      name: d.Name || d.name,
      fileName: d.FileName || d.fileName || null,
      documentDate: d.DocumentDate || d.documentDate || null,
      status: d.Status || d.status || 'Active',
      patientId: d.PatientId || d.patientId || patientId,
      practiceId: d.PracticeId || d.practiceId || null,
      createdAt: d.CreatedAt || d.createdAt || null,
    })) : [];
    return { documents };
  } catch (err) {
    console.warn('getDocuments failed (returning empty list):', err?.message || err);
    return { documents: [] };
  }
};

tebraServiceInstance.getDocumentContent = async function(documentId) {
  if (!documentId) throw new Error('documentId is required');
  try {
    // Some APIs expect the id in Fields, others in Filter; try Fields first.
    const resp = await this.callMethod('GetDocumentContent', { DocumentId: String(documentId) }, {});
    const item = resp?.GetDocumentContentResult || resp?.Document || resp || {};
    return {
      fileName: item.FileName || item.fileName || `document-${documentId}.pdf`,
      mimeType: item.MimeType || item.mimeType || 'application/pdf',
      base64Content: item.Content || item.Base64Data || item.base64Content || null,
    };
  } catch (err) {
    console.warn('getDocumentContent failed:', err?.message || err);
    return { fileName: `document-${documentId}.pdf`, mimeType: 'application/pdf', base64Content: null };
  }
};

// Export both the instance (default) and the class
// Use a more reliable export pattern that ensures TebraService is always accessible
// First, attach the class to the instance
tebraServiceInstance.TebraService = TebraService;

// Export the instance directly (which has TebraService attached)
module.exports = tebraServiceInstance;

// Also set TebraService as a non-enumerable property for additional compatibility
Object.defineProperty(module.exports, 'TebraService', {
  value: TebraService,
  writable: false,
  enumerable: true,
  configurable: false
});