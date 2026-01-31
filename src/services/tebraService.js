// backend/src/services/tebraService.js
const axios = require('axios');
const { patientFieldsBasic, patientFieldsComplete } = require('./tebraPatientFields');
const tebraNormalizers = require('./tebraServiceNormalizers');
const tebraSoapParsing = require('./tebraServiceSoapParsing');
const providerMapping = require('../config/providerMapping');

// Ensure Tebra SOAP URLs use 2.1 only (not 3.x). Project uses SOAP 2.1.
function ensureSoap21Url(url) {
  if (!url || typeof url !== 'string') return url;
  const base = url.split('?')[0];
  const rewritten = base.replace(/\/soap\/3(\.\d+)?/g, '/soap/2.1');
  if (rewritten !== base) {
    console.warn(`[TEBRA] SOAP URL contained soap/3.x; overridden to soap/2.1. Project uses SOAP 2.1 only.`);
  }
  return rewritten;
}

function resolveSoapUrls(input) {
  if (!input || typeof input !== 'string') {
    return { endpoint: input, wsdlUrl: input };
  }
  const hasWsdl = /[?&]wsdl\b/i.test(input);
  const base = ensureSoap21Url(input);
  return {
    endpoint: base,
    wsdlUrl: hasWsdl ? `${base}?wsdl` : `${base}?wsdl`
  };
}

class TebraService {
  constructor() {
    const soapConfig = resolveSoapUrls(
      process.env.TEBRA_SOAP_WSDL
        || process.env.TEBRA_SOAP_ENDPOINT
        || 'https://webservice.kareo.com/services/soap/2.1/KareoServices.svc?wsdl'
    );
    this.soapEndpoint = soapConfig.endpoint;
    this.wsdlUrl = soapConfig.wsdlUrl;
    this.customerKey = process.env.TEBRA_CUSTOMER_KEY;
    this.password = process.env.TEBRA_PASSWORD;
    this.user = process.env.TEBRA_USER;
    this.practiceName = process.env.TEBRA_PRACTICE_NAME;
    this.namespace = process.env.TEBRA_SOAP_NAMESPACE || 'http://www.kareo.com/api/schemas/';
    this.useRawSOAP = String(process.env.TEBRA_USE_RAW_SOAP || 'true').toLowerCase() !== 'false';
    
    // API rate limiting configuration
    this.batchSize = parseInt(process.env.TEBRA_BATCH_SIZE) || 5;
    this.delayBetweenCalls = parseInt(process.env.TEBRA_DELAY_BETWEEN_CALLS) || 200; // ms
    this.delayBetweenBatches = parseInt(process.env.TEBRA_DELAY_BETWEEN_BATCHES) || 1000; // ms
    this.delayAfterGetIds = parseInt(process.env.TEBRA_DELAY_AFTER_GET_IDS) || 500; // ms
  }

  // Connection test method
  async testConnection() {
    try {
      console.log(`🔗 Tebra/Kareo SOAP client ready`);
      console.log(`SOAP Endpoint: ${this.soapEndpoint}`);
      console.log(`🏥 Practice: ${this.practiceName}`);
      console.log(`👤 User: ${this.user}`);
      console.log('✅ Raw SOAP mode enabled');
      console.log('✅ Client initialized successfully');
      return { success: true, mode: 'raw' };
    } catch (error) {
      console.error('❌ Connection test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Get SOAP client (restored original implementation)
  async getClient() {
    if (this.client) {
      return this.client;
    }

    try {
      const soap = require('soap');
      
      // Create SOAP client with WSDL
      const wsdlUrl = this.wsdlUrl || `${this.soapEndpoint}?wsdl`;
      console.log(`🔗 Creating SOAP client from WSDL: ${wsdlUrl}`);
      
      this.client = await soap.createClientAsync(wsdlUrl, {
        endpoint: this.soapEndpoint,
        forceSoap12Headers: false,
        preserveWhitespace: true
      });
      
      console.log('✅ SOAP client created successfully');
      return this.client;
      
    } catch (error) {
      console.error('❌ Failed to create SOAP client:', error.message);
      throw new Error(`Failed to create Tebra SOAP client: ${error.message}`);
    }
  }

  // Helper method to build RequestHeader - follows official Tebra documentation
  buildRequestHeader(practiceId) {
    const header = {
      CustomerKey: this.customerKey,
      Password: this.password,
      User: this.user
    };
    return header;
  }

  // Get auth header (backward compatibility)
  getAuthHeader() {
    return this.buildRequestHeader();
  }

  // Enhanced SOAP XML generation following official Tebra patterns
  generateRawSOAPXML(methodName, fields = {}, filters = {}) {
    const auth = this.getAuthHeader();
    
    // Validate required parameters
    if (!methodName || typeof methodName !== 'string' || methodName.trim() === '') {
      throw new Error('Method name is required and cannot be empty');
    }
    
    // Validate required authentication fields
    if (!auth.CustomerKey || !auth.User || !auth.Password) {
      throw new Error('Missing required authentication fields: CustomerKey, User, and Password are required');
    }
    
    // Special handling for specific methods with custom XML structures
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
    if (methodName === 'GetAppointmentReasons') {
      return this.generateGetAppointmentReasonsSOAPXML(fields);
    }
    if (methodName === 'UpdatePatient') {
      return this.generateUpdatePatientSOAPXML(fields);
    }
    
    // Some methods require Fields/Filter to use the sch1 namespace prefix.
    const useAltPrefix = methodName === 'GetServiceLocations';
    const fieldsPrefix = useAltPrefix ? 'sch1' : 'sch';
    const filterPrefix = useAltPrefix ? 'sch1' : 'sch';
    const envelopeNamespaces = useAltPrefix
      ? '                  xmlns:sch1="http://www.kareo.com/api/schemas/"'
      : '';

    // Build fields XML with proper validation and escaping
    const fieldsXml = Object.keys(fields).length > 0 ?
      Object.keys(fields)
        .filter(key => fields[key] !== undefined && fields[key] !== null)
        .map(key => `          <${fieldsPrefix}:${key}>${this.xmlEscape(String(fields[key]))}</${fieldsPrefix}:${key}>`)
        .join('\n') : '';
    
    // Build filters XML with proper validation
    const validFilters = Object.keys(filters).length > 0 ?
      Object.keys(filters).filter(key => 
        filters[key] !== undefined && 
        filters[key] !== null && 
        filters[key] !== ''
      ) : [];
    
    const filtersXml = validFilters.length > 0 ?
      validFilters.map(key =>
        `          <${filterPrefix}:${key}>${this.xmlEscape(String(filters[key]))}</${filterPrefix}:${key}>`
      ).join('\n') : '';
    
    // Generate SOAP envelope following official Tebra format
    // RequestHeader child elements use the sch: namespace prefix per Tebra SOAP samples.
    return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sch="http://www.kareo.com/api/schemas/"${envelopeNamespaces}>
  <soapenv:Header/>
  <soapenv:Body>
    <sch:${methodName}>
      <sch:request>
        <sch:RequestHeader>
          <sch:CustomerKey>${this.xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${this.xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${this.xmlEscape(auth.User)}</sch:User>
        </sch:RequestHeader>
        <${fieldsPrefix}:Fields>
${fieldsXml}
        </${fieldsPrefix}:Fields>
        <${filterPrefix}:Filter>
${filtersXml}
        </${filterPrefix}:Filter>
      </sch:request>
    </sch:${methodName}>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  // Generate CreatePatient SOAP XML following official Tebra documentation
  generateCreatePatientSOAPXML(patientData) {
    const auth = this.getAuthHeader();
    
    // Validate required authentication
    if (!auth.CustomerKey || !auth.User || !auth.Password) {
      throw new Error('Missing required authentication for CreatePatient');
    }
    
    // Build patient XML with proper nesting and validation
    const buildPatientXml = (data, indent = '          ') => {
      let xml = '';
      
      // Define the proper field order for patient data (based on Tebra schema)
      const fieldOrder = [
        'FirstName', 'LastName', 'MiddleName', 'Suffix',
        'DateOfBirth', 'Gender', 'SSN', 'ExternalID',
        'EmailAddress', 'HomePhone', 'MobilePhone', 'WorkPhone',
        'Address', 'City', 'State', 'ZipCode', 'Country',
        'Practice', 'PrimaryProvider', 'DefaultCase'
      ];
      
      // Process fields in the correct order
      for (const key of fieldOrder) {
        const value = data[key];
        if (value === null || value === undefined || value === '') continue;
        
        if (typeof value === 'object' && !Array.isArray(value)) {
          // Handle nested objects like Practice, Address, etc.
          xml += `${indent}<sch:${key}>\n`;
          xml += buildPatientXml(value, indent + '  ');
          xml += `${indent}</sch:${key}>\n`;
        } else {
          // Handle simple values with proper XML escaping
          xml += `${indent}<sch:${key}>${this.xmlEscape(String(value))}</sch:${key}>\n`;
        }
      }
      
      // Add any remaining fields not in the standard order
      for (const [key, value] of Object.entries(data)) {
        if (fieldOrder.includes(key) || value === null || value === undefined || value === '') continue;
        
        if (typeof value === 'object' && !Array.isArray(value)) {
          xml += `${indent}<sch:${key}>\n`;
          xml += buildPatientXml(value, indent + '  ');
          xml += `${indent}</sch:${key}>\n`;
        } else {
          xml += `${indent}<sch:${key}>${this.xmlEscape(String(value))}</sch:${key}>\n`;
        }
      }
      
      return xml;
    };
    
    const patientXml = buildPatientXml(patientData);
    
    // Generate SOAP envelope following official Tebra format
    return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sch="http://www.kareo.com/api/schemas/">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:CreatePatient>
      <sch:request>
        <sch:RequestHeader>
          <sch:CustomerKey>${this.xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${this.xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${this.xmlEscape(auth.User)}</sch:User>
        </sch:RequestHeader>
        <sch:Patient>
${patientXml}        </sch:Patient>
      </sch:request>
    </sch:CreatePatient>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  // Generate CreateAppointment SOAP XML with proper structure
  // Tebra schema expects element names with ...Id (e.g. PracticeId), not ...ID. Order: PracticeId, PatientSummary before StartTime.
  // RequestHeader (Tebra 2.3) must contain ONLY CustomerKey, Password, User — PracticeId belongs in the Appointment element only.
  generateCreateAppointmentSOAPXML(appointmentData) {
    const auth = this.buildRequestHeader();
    // Map our *ID keys to schema element names (*Id). Tebra .NET deserializer is case-sensitive; wrong casing causes DeserializationFailed.
    const SCHEMA_NAME_MAP = {
      PracticeID: 'PracticeId',
      ServiceLocationID: 'ServiceLocationId',
      AppointmentReasonID: 'AppointmentReasonId',
      ProviderID: 'ProviderId',
      ResourceID: 'ResourceId',
      PatientID: 'PatientId',
      PatientCaseID: 'PatientCaseId',
      InsurancePolicyAuthorizationID: 'InsurancePolicyAuthorizationId'
    };
    const toSchemaName = (k) => SCHEMA_NAME_MAP[k] || k;

    // Schema: follow strict field ordering (aligns with SOAP spec and CreateAppointmentV3 translator).
    // Keep PracticeID/PracticeGuid before StartTime, and ProviderID/ResourceID before StartTime.
    const requiredFieldOrder = [
      'AppointmentId',
      'AppointmentMode',
      'AppointmentName',
      'AppointmentReasonID',
      'AppointmentStatus',
      'AppointmentType',
      'AppointmentUUID',
      'AttendeesCount',
      'CreatedAt',
      'CreatedBy',
      'CustomerId',
      'EndTime',
      'ForRecare',
      'InsurancePolicyAuthorizationID',
      'IsDeleted',
      'IsGroupAppointment',
      'IsRecurring',
      'MaxAttendees',
      'Notes',
      'OccurrenceId',
      'PatientCaseID',
      'PatientSummaries',
      'PatientSummary',
      'PatientGuid',
      'PatientID',
      'PracticeID',
      'PracticeGuid',
      'ServiceLocationID',
      'ServiceLocationGuid',
      'ProviderID',
      'ProviderGuids',
      'RecurrenceRule',
      'ResourceID',
      'ResourceIds',
      'ResourceGuids',
      'StartTime',
      'UpdatedAt',
      'UpdatedBy',
      'WasCreatedOnline'
    ];

    const buildAppointmentXml = (data, indent = '         ') => {
      if (!data || typeof data !== 'object') return '';
      let xml = '';

      for (const key of requiredFieldOrder) {
        const value = data[key];
        if (value === undefined || value === '') {
          if (key === 'PracticeID' && (data.PracticeID === undefined && data.practiceID === undefined))
            console.warn(`⚠️ [TEBRA] PracticeID is missing - required before StartTime`);
          continue;
        }
        const skipNullFields = [
          'AppointmentReasonID', 'PatientCaseID', 'InsurancePolicyAuthorizationID',
          'Notes', 'DateOfBirth', 'PatientSummary'
        ];
        if (value === null && skipNullFields.includes(key)) continue;
        if (key === 'AppointmentReasonID' && (value === 0 || value === '0')) continue;
        const orderCriticalFields = ['ResourceID', 'ResourceIds', 'RecurrenceRule'];
        if (orderCriticalFields.includes(key) && value === null) continue;
        if ((key === 'StartTime' || key === 'EndTime') && (!value || value === '')) continue;

        const tag = toSchemaName(key);
        if (Array.isArray(value)) {
          if (value.length > 0) {
            // CreateAppointmentV3 expects ProviderGuids/ResourceGuids as UUID strings, not arr:long
            if (key === 'ProviderGuids' && value.every((x) => typeof x === 'string')) {
              xml += `${indent}<sch:ProviderGuids>\n`;
              for (const item of value) {
                if (/^[0-9a-fA-F-]{36}$/.test(item)) xml += `${indent}   <sch:ProviderGuid>${this.xmlEscape(item)}</sch:ProviderGuid>\n`;
              }
              xml += `${indent}</sch:ProviderGuids>\n`;
            } else if (key === 'ResourceGuids' && value.every((x) => typeof x === 'string')) {
              xml += `${indent}<sch:ResourceGuids>\n`;
              for (const item of value) {
                if (/^[0-9a-fA-F-]{36}$/.test(item)) xml += `${indent}   <sch:ResourceGuid>${this.xmlEscape(item)}</sch:ResourceGuid>\n`;
              }
              xml += `${indent}</sch:ResourceGuids>\n`;
            } else {
              xml += `${indent}<sch:${tag}>\n`;
              for (const item of value) {
                if (typeof item === 'object') {
                  xml += `${indent}   <sch:GroupPatientSummary>\n`;
                  xml += buildAppointmentXml(item, indent + '      ');
                  xml += `${indent}   </sch:GroupPatientSummary>\n`;
                } else {
                  xml += `${indent}   <arr:long>${this.xmlEscape(String(item))}</arr:long>\n`;
                }
              }
              xml += `${indent}</sch:${tag}>\n`;
            }
          }
        } else if (typeof value === 'object' && !(value instanceof Date)) {
      xml += `${indent}<sch:${tag}>\n`;
      xml += buildAppointmentXml(value, indent + '   ');
      xml += `${indent}</sch:${tag}>\n`;
    } else {
          if (key === 'StartTime' || key === 'EndTime') {
            let dateValue = value instanceof Date ? value.toISOString() : (typeof value === 'string' ? (() => { try { const p = new Date(value); return !isNaN(p.getTime()) ? p.toISOString() : value; } catch (e) { return value; } })() : String(value ?? ''));
            xml += `${indent}<sch:${tag}>${this.xmlEscape(String(dateValue))}</sch:${tag}>\n`;
          } else {
            const finalValue = value instanceof Date ? value.toISOString() : (value === null ? '' : value);
            xml += `${indent}<sch:${tag}>${this.xmlEscape(String(finalValue))}</sch:${tag}>\n`;
          }
        }
      }

      for (const [key, value] of Object.entries(data)) {
        if (requiredFieldOrder.includes(key)) continue;
        if (value === undefined || value === '') continue;
        const skipNullFields = [
          'AppointmentReasonID', 'PatientCaseID', 'ResourceID', 'InsurancePolicyAuthorizationID',
          'Notes', 'ResourceIds', 'DateOfBirth', 'ProviderID', 'ServiceLocationID', 'PatientSummary'
        ];
        if (value === null && skipNullFields.includes(key)) continue;

        const tag = toSchemaName(key);
        if (Array.isArray(value)) {
          if (value.length > 0) {
            xml += `${indent}<sch:${tag}>\n`;
            for (const item of value) {
              if (typeof item === 'object') {
                xml += `${indent}   <sch:GroupPatientSummary>\n`;
                xml += buildAppointmentXml(item, indent + '      ');
                xml += `${indent}   </sch:GroupPatientSummary>\n`;
              } else {
                xml += `${indent}   <arr:long>${this.xmlEscape(String(item))}</arr:long>\n`;
              }
            }
            xml += `${indent}</sch:${tag}>\n`;
          }
        } else if (typeof value === 'object') {
          xml += `${indent}<sch:${tag}>\n`;
          xml += buildAppointmentXml(value, indent + '   ');
          xml += `${indent}</sch:${tag}>\n`;
        } else {
          const finalValue = value instanceof Date ? value.toISOString() : (value === null ? '' : value);
          xml += `${indent}<sch:${tag}>${this.xmlEscape(String(finalValue))}</sch:${tag}>\n`;
        }
      }

      return xml;
    };

    const appointmentXml = buildAppointmentXml(appointmentData);

    // Log the field order in the generated XML for debugging (uses schema names, e.g. PracticeId)
    const fieldOrderInXml = [];
    const fieldMatches = appointmentXml.match(/<sch:(\w+)>/g);
    if (fieldMatches) {
      fieldMatches.forEach(match => {
        const fieldName = match.replace(/<sch:|>/g, '');
        if (!fieldOrderInXml.includes(fieldName)) {
          fieldOrderInXml.push(fieldName);
        }
      });
      this.logSoapDebug('🔍 [TEBRA] Field order in generated XML:', fieldOrderInXml.join(' -> '));
      const startTimeIndex = fieldOrderInXml.indexOf('StartTime');
      const practiceIdIndex = fieldOrderInXml.indexOf('PracticeId');
      if (startTimeIndex !== -1 && practiceIdIndex !== -1 && startTimeIndex <= practiceIdIndex)
        console.warn(`⚠️ [TEBRA] StartTime appears before PracticeId - schema requires PracticeId first`);
    }
    
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sch="http://www.kareo.com/api/schemas/"
                  xmlns:sys="http://schemas.datacontract.org/2004/07/System"
                  xmlns:arr="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:CreateAppointment>
      <sch:request>
        <sch:RequestHeader>
          <sch:CustomerKey>${this.xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${this.xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${this.xmlEscape(auth.User)}</sch:User>
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
          // Handle simple values - escape XML special characters using helper method
          const escapedValue = this.xmlEscape(String(value));
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
          <sch:CustomerKey>${this.xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${this.xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${this.xmlEscape(auth.User)}</sch:User>
        </sch:RequestHeader>
${appointmentXml}
      </sch:request>
    </sch:GetAppointment>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  // Generate GetAppointmentReasons SOAP XML (RequestHeader + PracticeId only; xmlEscape avoids InternalServiceFault from special chars in Password)
  generateGetAppointmentReasonsSOAPXML(fields) {
    const auth = this.getAuthHeader();
    const practiceId = fields?.PracticeId != null ? String(fields.PracticeId) : '';
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sch="http://www.kareo.com/api/schemas/">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:GetAppointmentReasons>
      <sch:request>
        <sch:RequestHeader>
          <sch:CustomerKey>${this.xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${this.xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${this.xmlEscape(auth.User)}</sch:User>
        </sch:RequestHeader>
        <sch:PracticeId>${this.xmlEscape(practiceId)}</sch:PracticeId>
      </sch:request>
    </sch:GetAppointmentReasons>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  // Generate UpdatePatient SOAP XML (RequestHeader + Patient with Practice). xmlEscape on all scalars to avoid InternalServiceFault from special chars in Password or patient data.
  generateUpdatePatientSOAPXML(fields) {
    const auth = this.buildRequestHeader();
    const buildNodeXml = (data, indent = '          ') => {
      if (!data || typeof data !== 'object') return '';
      let xml = '';
      for (const [key, value] of Object.entries(data)) {
        if (value === null || value === undefined) continue;
        if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
          const inner = buildNodeXml(value, indent + '   ');
          xml += `${indent}<sch:${key}>\n${inner}${indent}</sch:${key}>\n`;
        } else {
          xml += `${indent}<sch:${key}>${this.xmlEscape(String(value))}</sch:${key}>\n`;
        }
      }
      return xml;
    };
    const patientPayload = fields?.Patient && typeof fields.Patient === 'object' ? { ...fields.Patient } : {};
    if (!patientPayload.Practice && fields?.Practice && typeof fields.Practice === 'object') {
      patientPayload.Practice = fields.Practice;
    }
    const patientXml = buildNodeXml(patientPayload, '          ');
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sch="http://www.kareo.com/api/schemas/">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:UpdatePatient>
      <sch:request>
        <sch:RequestHeader>
          <sch:CustomerKey>${this.xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${this.xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${this.xmlEscape(auth.User)}</sch:User>
        </sch:RequestHeader>
        <sch:Patient>
${patientXml}        </sch:Patient>
      </sch:request>
    </sch:UpdatePatient>
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
          // Handle simple values - escape XML special characters using helper method
          const escapedValue = this.xmlEscape(String(value));
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
          <sch:CustomerKey>${this.xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${this.xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${this.xmlEscape(auth.User)}</sch:User>
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
          // Use xmlEscape helper method for consistency
          const escapedValue = this.xmlEscape(String(value));
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
          <sch:CustomerKey>${this.xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${this.xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${this.xmlEscape(auth.User)}</sch:User>
        </sch:RequestHeader>
${appointmentXml}
      </sch:request>
    </sch:UpdateAppointment>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  // Enhanced SOAP method caller with improved error handling
  async callRawSOAPMethod(methodName, fields = {}, filters = {}) {
    try {
      // Validate inputs
      if (!methodName) {
        throw new Error('Method name is required');
      }
      
      // Generate SOAP XML
      const soapXml = this.generateRawSOAPXML(methodName, fields, filters);
      
      // Log request for debugging (configurable)
      if (this.shouldLogSoap()) {
        this.logSoapDebug(`🔍 [TEBRA] ${methodName} SOAP request XML:`, soapXml);

        // Log specific fields for appointment methods
        if (methodName === 'CreateAppointment') {
          const startTimeMatch = soapXml.match(/<sch:StartTime[^>]*>([^<]+)<\/sch:StartTime>/i);
          const endTimeMatch = soapXml.match(/<sch:EndTime[^>]*>([^<]+)<\/sch:EndTime>/i);
          if (startTimeMatch) this.logSoapDebug('🔍 [TEBRA] StartTime:', startTimeMatch[1]);
          if (endTimeMatch) this.logSoapDebug('🔍 [TEBRA] EndTime:', endTimeMatch[1]);
        }
      }
      
      // Make SOAP request with proper headers
      const response = await axios.post(
        this.soapEndpoint,
        soapXml,
        {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': `"http://www.kareo.com/api/schemas/KareoServices/${methodName}"`,
            'User-Agent': 'Tebra-SOAP-Client/1.0'
          },
          timeout: 30000, // 30 second timeout
          validateStatus: (status) => status < 500 // Accept 4xx as valid responses
        }
      );
      
      // Log response for debugging
      if (this.shouldLogSoap()) {
        this.logSoapDebug(`🔍 [TEBRA] ${methodName} SOAP response:`, response.data);
      }
      
      // Check for SOAP faults in response
      if (response.data.includes('soap:Fault') || response.data.includes('soapenv:Fault')) {
        const faultMatch = response.data.match(/<faultstring[^>]*>([^<]+)<\/faultstring>/i);
        const faultCode = response.data.match(/<faultcode[^>]*>([^<]+)<\/faultcode>/i);
        
        const errorMessage = faultMatch ? faultMatch[1] : 'Unknown SOAP fault';
        const errorCode = faultCode ? faultCode[1] : 'Unknown';
        
        throw new Error(`Tebra SOAP Fault [${errorCode}]: ${errorMessage}`);
      }
      
      // Check for Tebra-specific error responses
      if (response.data.includes('<IsError>true</IsError>')) {
        const errorMatch = response.data.match(/<ErrorMessage[^>]*>([^<]*)<\/ErrorMessage>/i);
        const errorMessage = errorMatch ? errorMatch[1] : 'Unknown Tebra API error';
        throw new Error(`Tebra API Error: ${errorMessage}`);
      }
      
      if (this.shouldLogSoap()) {
        const authenticated = response.data.includes('<Authenticated>true</Authenticated>');
        const customerKeyValid = response.data.includes('<CustomerKeyValid>true</CustomerKeyValid>');
        const authorized = response.data.includes('<Authorized>true</Authorized>');
        const isError = response.data.includes('<IsError>true</IsError>');
        this.logSoapDebug('[TEBRA DEBUG] Auth status:', { authenticated, customerKeyValid, authorized, isError });
      }

      // Check for authentication/authorization failures
      // Tebra doesn't use SecurityResultSuccess - check actual response format
      if (response.data.includes('<Authenticated>false</Authenticated>')) {
        const securityMatch = response.data.match(/<SecurityResult[^>]*>([^<]*)<\/SecurityResult>/i);
        const securityMessage = securityMatch ? securityMatch[1] : 'Invalid user name and/or password';
        throw new Error(`Tebra Authentication Error: ${securityMessage}`);
      }
      
      // Check for customer key validation failures
      if (response.data.includes('<CustomerKeyValid>false</CustomerKeyValid>')) {
        throw new Error('Tebra Authentication Error: Invalid customer key');
      }
      
      return response.data;
      
    } catch (error) {
      // Enhanced error logging
      console.error(`❌ [TEBRA] ${methodName} failed:`, error.message);
      
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Headers:`, error.response.headers);
        
        // Log response data (truncated for readability)
        const responseData = error.response.data;
        if (typeof responseData === 'string') {
          const preview = responseData.length > 1000 
            ? responseData.substring(0, 1000) + '...' 
            : responseData;
          console.error(`   Response: ${preview}`);
        }
      } else if (error.request) {
        console.error('   No response received from Tebra API');
        console.error('   Request timeout or network error');
      }
      
      // Re-throw with context
      throw new Error(`Tebra ${methodName} API call failed: ${error.message}`);
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
              PracticeID: userData.practice?.PracticeID || userData.practiceId || process.env.TEBRA_PRACTICE_ID || null,
              PracticeName: userData.practice?.PracticeName || this.practiceName
            }
          }
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      this.cleanRequestData(args);
      
      this.logSoapArgs('CreatePatient args:', args);
      const [result] = await client.CreatePatientAsync(args);
      this.logSoapDebug('CreatePatient result:', result);
      return this.normalizeCreatePatientResponse(result);
    } catch (error) {
      // Parse SOAP fault if available
      let faultMsg = null;
      try {
        const xml = error?.response?.data || error?.data || '';
        if (typeof xml === 'string' && /Fault/i.test(xml)) {
          const faultStringMatch = xml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
          faultMsg = faultStringMatch && faultStringMatch[1] ? faultStringMatch[1].trim() : null;
          if (/InternalServiceFault/i.test(xml)) faultMsg = 'InternalServiceFault';
        }
      } catch (_) {}
      
      console.error('Tebra SOAP: CreatePatient error', error.message, faultMsg ? `| Fault: ${faultMsg}` : '');
      console.error('CreatePatient error details:', {
        message: error.message,
        fault: faultMsg,
        args: this.redactSoapArgs(args)
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

  // Get comprehensive patient fields (all available fields)
  getPatientFieldsComplete() {
    return { ...patientFieldsComplete };
  }

  // Get basic patient fields only
  getPatientFieldsBasic() {
    return { ...patientFieldsBasic };
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
      
      this.logSoapArgs('GetPatients args:', args);
      const [result] = await client.GetPatientsAsync(args);
      this.logSoapDebug('GetPatients result:', result);
      return this.normalizeGetPatientsResponse(result);
    } catch (error) {
      this.handleSOAPError(error, 'GetPatients', { options });
    }
  }


  // Search patients with specific criteria
  async searchPatients(searchOptions = {}) {
    try {
      this.logSoapDebug('🔍 Searching patients with criteria:', searchOptions);
      
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
      this.logSoapDebug('📞 Phone number formatted (last 10 digits):', {
        original: phone,
        formatted: last10Digits
      });
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
    this.logSoapDebug('🔍 Building patient data from:', userData);
    
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
      PracticeName: userData.practice?.PracticeName || userData.practiceName || this.practiceName
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

    this.logSoapDebug('🔍 Built patient data:', cleanPatientData);
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

  // Helper method to look up appointment reason ID by numeric ID, GUID (TEBRA_DEFAULT_APPT_REASON_GUID), or name
  async lookupAppointmentReasonId(reasonNameOrId, practiceId) {
    try {
      // If it's already a number, return it
      if (!isNaN(reasonNameOrId) && reasonNameOrId !== '') {
        return parseInt(reasonNameOrId);
      }
      
      if (typeof reasonNameOrId !== 'string' || reasonNameOrId.trim() === '') return null;

      const reasonsResult = await this.getAppointmentReasons(practiceId);
      const reasons = reasonsResult.appointmentReasons || [];
      const input = reasonNameOrId.trim();

      // If it's a UUID (e.g. TEBRA_DEFAULT_APPT_REASON_GUID), find by appointmentReasonGuid
      if (/^[0-9a-fA-F-]{36}$/.test(input)) {
        const byGuid = reasons.find(r => (r.appointmentReasonGuid || '').toLowerCase() === input.toLowerCase());
        if (byGuid && (byGuid.id != null || byGuid.appointmentReasonId != null)) {
          const id = byGuid.id ?? byGuid.appointmentReasonId;
          this.logSoapDebug('✅ Found appointment reason ID for GUID:', { id, guid: input });
          return parseInt(String(id), 10);
        }
        this.logSoapDebug('⚠️ No appointment reason found for GUID:', input);
        return null;
      }

      // Find by name (case-insensitive)
      this.logSoapDebug('🔍 Looking up appointment reason ID for name:', input);
      const idx = reasons.findIndex(reason => reason.name && reason.name.toLowerCase() === input.toLowerCase());
      const matchingReason = idx >= 0 ? reasons[idx] : null;

      if (matchingReason && (matchingReason.id != null || matchingReason.appointmentReasonId != null)) {
        const id = matchingReason.id ?? matchingReason.appointmentReasonId;
        this.logSoapDebug('✅ Found appointment reason ID for name:', { id, name: input });
        return parseInt(String(id), 10);
      }
      if (matchingReason && idx >= 0) {
        const fallbackId = idx + 1;
        this.logSoapDebug('⚠️ Using 1-based index as fallback AppointmentReasonID:', {
          name: input,
          fallbackId
        });
        return fallbackId;
      }
      this.logSoapDebug('⚠️ No appointment reason found for name:', input);
      return null;
    } catch (error) {
      console.error(`❌ Error looking up appointment reason ID for "${reasonNameOrId}":`, error.message);
      return null;
    }
  }

  // Build appointment data for CreateAppointment SOAP call.
  // Tebra 4.14.1 The Request: only required fields. Optional fields omitted.
  async buildAppointmentData(appointmentData) {
    const parseId = (value) => {
      if (value === null || value === undefined || value === '') return undefined;
      if (typeof value === 'number') return value;
      if (typeof value === 'string' && /^\d+$/.test(value)) return parseInt(value, 10);
      return value;
    };

    const practiceID = (() => {
      const v = appointmentData.practiceId ?? appointmentData.PracticeId ?? '1';
      const parsed = typeof v === 'string' ? parseInt(v, 10) : v;
      if (isNaN(parsed)) { console.error(`❌ [TEBRA] Invalid PracticeID: ${v}, using 1`); return 1; }
      return parsed;
    })();
    const providerID = (() => {
      const v = appointmentData.providerId ?? appointmentData.ProviderId;
      if (!v) return 1;
      const parsed = typeof v === 'string' ? parseInt(v, 10) : v;
      return isNaN(parsed) ? 1 : parsed;
    })();
    const serviceLocationID = (() => {
      const v = appointmentData.serviceLocationId ?? appointmentData.ServiceLocationId;
      if (!v || v === 'default-location') return 1;
      const parsed = typeof v === 'string' ? parseInt(v, 10) : v;
      if (isNaN(parsed)) return v;
      return parsed <= 0 ? 1 : parsed;
    })();
    const patientID = parseId(appointmentData.patientId ?? appointmentData.PatientId);

    // Required only (4.14.1): PracticeID, ServiceLocationID, AppointmentStatus, StartTime, EndTime, IsRecurring, PatientSummary, AppointmentReasonID, ProviderID, ResourceID, ResourceIDs, AppointmentType, WasCreatedOnline, PatientID. Optional omitted.
    const appointment = {
      PracticeID: practiceID,
      ServiceLocationID: serviceLocationID,
      AppointmentStatus: appointmentData.appointmentStatus ?? appointmentData.AppointmentStatus ?? 'Scheduled',
      StartTime: appointmentData.startTime ?? appointmentData.StartTime,
      EndTime: appointmentData.endTime ?? appointmentData.EndTime,
      IsRecurring: appointmentData.isRecurring ?? appointmentData.IsRecurring ?? false,
      AppointmentReasonID: null, // set after lookup
      ProviderID: providerID,
      ResourceID: parseId(appointmentData.resourceId ?? appointmentData.ResourceId),
      AppointmentType: appointmentData.appointmentType ?? appointmentData.AppointmentType ?? 'P',
      WasCreatedOnline: appointmentData.wasCreatedOnline ?? appointmentData.WasCreatedOnline ?? true,
      PatientID: patientID
    };

    // PatientSummary (required): only required sub-fields per 4.14 — PatientID, PracticeID, FirstName, LastName, Email.
    const fromInput = appointmentData.patientSummary || appointmentData.PatientSummary;
    appointment.PatientSummary = {
      PatientID: patientID,
      PracticeID: practiceID,
      FirstName: fromInput?.FirstName ?? fromInput?.firstName ?? appointmentData.patientFirstName ?? 'Unknown',
      LastName: fromInput?.LastName ?? fromInput?.lastName ?? appointmentData.patientLastName ?? 'Patient',
      Email: fromInput?.Email ?? fromInput?.email ?? appointmentData.patientEmail ?? 'unknown@example.com'
    };

    // Look up AppointmentReasonId
    const reasonNameOrId = appointmentData.appointmentReasonId ?? appointmentData.AppointmentReasonId;
    if (reasonNameOrId) {
      const reasonId = await this.lookupAppointmentReasonId(reasonNameOrId, appointment.PracticeID);
      appointment.AppointmentReasonID = reasonId;
    }

    // Fallback when AppointmentReasonId is null. Order: TEBRA_DEFAULT_APPT_REASON_ID -> TEBRA_DEFAULT_APPT_REASON_GUID -> TEBRA_DEFAULT_APPT_REASON_NAME -> first from API
    if (appointment.AppointmentReasonID == null) {
      const defaultId = process.env.TEBRA_DEFAULT_APPT_REASON_ID;
      const defaultGuid = (typeof process.env.TEBRA_DEFAULT_APPT_REASON_GUID === 'string' && /^[0-9a-fA-F-]{36}$/.test(process.env.TEBRA_DEFAULT_APPT_REASON_GUID.trim()))
        ? process.env.TEBRA_DEFAULT_APPT_REASON_GUID.trim() : null;
      const defaultName = process.env.TEBRA_DEFAULT_APPT_REASON_NAME;
      if (defaultId != null && defaultId !== '' && !isNaN(parseInt(String(defaultId), 10))) {
        appointment.AppointmentReasonID = parseInt(String(defaultId), 10);
      } else if (defaultGuid) {
        const reasonId = await this.lookupAppointmentReasonId(defaultGuid, appointment.PracticeID);
        if (reasonId != null) appointment.AppointmentReasonID = reasonId;
      }
      if (appointment.AppointmentReasonID == null && defaultName != null && typeof defaultName === 'string' && defaultName.trim() !== '') {
        const reasonId = await this.lookupAppointmentReasonId(defaultName.trim(), appointment.PracticeID);
        if (reasonId != null) appointment.AppointmentReasonID = reasonId;
      }
      if (appointment.AppointmentReasonID == null) {
        try {
          const reasonsResult = await this.getAppointmentReasons(appointment.PracticeID);
          const first = (reasonsResult?.appointmentReasons || [])[0];
          const firstId = first?.id ?? first?.appointmentReasonId;
          if (firstId != null) appointment.AppointmentReasonID = parseInt(String(firstId), 10);
        } catch (e) {
          console.warn(`⚠️ [TEBRA] getAppointmentReasons fallback failed:`, e?.message || e);
        }
      }
      if (appointment.AppointmentReasonID == null) {
        console.warn(`⚠️ [TEBRA] AppointmentReasonID is still null. Set TEBRA_DEFAULT_APPT_REASON_ID, TEBRA_DEFAULT_APPT_REASON_GUID, or TEBRA_DEFAULT_APPT_REASON_NAME.`);
      }
    }

    // ResourceID: use env.TEBRA_RESOURCE_ID (with state override); fallback to ProviderID only when TEBRA_RESOURCE_ID not set.
    // ResourceIds: SOAP 4.14 expects array of integer IDs (arr:long). Use [TEBRA_RESOURCE_ID]; GUIDs go in ResourceGuids/ProviderGuids.
    const uuid = (s) => (typeof s === 'string' && /^[0-9a-fA-F-]{36}$/.test(String(s).trim()) ? String(s).trim() : null);
    const hasResourceId = (v) => (v != null && v !== '') && (typeof v !== 'number' || !isNaN(v));
    const state = (appointmentData.state || 'CA').toString().toUpperCase();
    if (!hasResourceId(appointment.ResourceID)) {
      const ridEnv = parseId(process.env['TEBRA_RESOURCE_ID_' + state]) || parseId(process.env.TEBRA_RESOURCE_ID);
      if (ridEnv != null) appointment.ResourceID = ridEnv;
    }
    if (!hasResourceId(appointment.ResourceID)) {
      const pid = appointment.ProviderID;
      if (pid != null && !isNaN(parseInt(String(pid), 10))) appointment.ResourceID = parseInt(String(pid), 10);
    }
    // Always use duplicated ResourceID: [1, 1] as workaround for V3 translator validation
    if (hasResourceId(appointment.ResourceID)) {
      const resourceId = parseInt(String(appointment.ResourceID), 10);
      appointment.ResourceIds = [resourceId, resourceId]; // Duplicate: [1, 1] for ResourceID 1
    } else if (Array.isArray(appointmentData.resourceIds) && appointmentData.resourceIds.length) {
      const ids = appointmentData.resourceIds.map((id) => parseId(id)).filter((id) => id != null && id !== '');
      // If resourceIds provided but ResourceID not set, duplicate the first one
      if (ids.length > 0) {
        const firstId = parseInt(String(ids[0]), 10);
        appointment.ResourceIds = [firstId, firstId]; // Duplicate: [1, 1]
      } else {
        appointment.ResourceIds = [];
      }
    } else {
      appointment.ResourceIds = [];
    }

    // CreateAppointmentV3 requires PracticeGuid (practice UUID); getPracticeGuid() is null otherwise. Not in SOAP 4.14.
    const practiceGuidVal = uuid(appointmentData.practiceGuid) || uuid(process.env['TEBRA_PRACTICE_GUID_' + state]) || uuid(process.env.TEBRA_PRACTICE_GUID);
    if (practiceGuidVal) appointment.PracticeGuid = practiceGuidVal;

    // ServiceLocationGuid (V3): when set in env or appointmentData, include for translation to CreateAppointmentV3.
    const slGuid = uuid(appointmentData.serviceLocationGuid) || uuid(process.env['TEBRA_SERVICE_LOCATION_GUID_' + state]) || uuid(process.env.TEBRA_SERVICE_LOCATION_GUID);
    if (slGuid) appointment.ServiceLocationGuid = slGuid;

    // CreateAppointmentV3 requires ProviderGuids or ResourceGuids (not in 4.14). When provided via appointmentData or env, add them so V3 accepts the request.
    // Set TEBRA_SKIP_PROVIDER_RESOURCE_GUIDS=true to omit them (e.g. to test if 4.14→V3 translator infers from ProviderID/ResourceID).
    const skipGuids = process.env.TEBRA_SKIP_PROVIDER_RESOURCE_GUIDS === 'true' || process.env.TEBRA_SKIP_PROVIDER_RESOURCE_GUIDS === '1';
    if (!skipGuids) {
      if (Array.isArray(appointmentData.resourceGuids) && appointmentData.resourceGuids.length) {
        const guids = appointmentData.resourceGuids.map((g) => uuid(g)).filter(Boolean);
        if (guids.length) appointment.ResourceGuids = guids;
      } else {
        const r = uuid(appointmentData.resourceGuid) || uuid(process.env['TEBRA_RESOURCE_GUID_' + state]) || uuid(process.env.TEBRA_RESOURCE_GUID);
        if (r) appointment.ResourceGuids = [r];
      }
      if (Array.isArray(appointmentData.providerGuids) && appointmentData.providerGuids.length) {
        const guids = appointmentData.providerGuids.map((g) => uuid(g)).filter(Boolean);
        if (guids.length) appointment.ProviderGuids = guids;
      } else {
        const p = uuid(appointmentData.providerGuid) || uuid(process.env['TEBRA_PROVIDER_GUID_' + state]) || uuid(process.env.TEBRA_PROVIDER_GUID);
        if (p) appointment.ProviderGuids = [p];
      }
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

  resolvePracticeName(options = {}) {
    const direct = options.practiceName || options.PracticeName;
    if (direct) return direct;

    const stateInput = options.state || options.State;
    if (stateInput) {
      const key = String(stateInput).trim().toUpperCase();
      const mapping = providerMapping[key];
      if (mapping && mapping.practiceName) return mapping.practiceName;
    }

    const practiceId = options.practiceId || options.PracticeId;
    if (practiceId != null && practiceId !== '') {
      const practiceIdStr = String(practiceId);
      const match = Object.values(providerMapping).find(
        (entry) => entry && entry.practiceId && String(entry.practiceId) === practiceIdStr && entry.practiceName
      );
      if (match && match.practiceName) return match.practiceName;
    }

    return this.practiceName || undefined;
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

    const { startDate, endDate, timeZoneOffsetFromGMT } = this.getAppointmentDateFilters(options);
    const resolvedPracticeName = this.resolvePracticeName(options);
    const filters = {
      // Basic filters - removed PatientID filter to get all appointments
      PatientFullName: safeGet(options, 'patientFullName'),
      PracticeName: resolvedPracticeName,
      ServiceLocationName: safeGet(options, 'serviceLocationName'),
      ResourceName: safeGet(options, 'resourceName'),
      // Date filters
      StartDate: startDate,
      EndDate: endDate,
      FromCreatedDate: safeGet(options, 'fromCreatedDate'),
      ToCreatedDate: safeGet(options, 'toCreatedDate'),
      FromLastModifiedDate: safeGet(options, 'fromLastModifiedDate'),
      ToLastModifiedDate: safeGet(options, 'toLastModifiedDate'),
      // Other filters
      AppointmentReason: safeGet(options, 'appointmentReason'),
      ConfirmationStatus: safeGet(options, 'confirmationStatus'),
      PatientCasePayerScenario: safeGet(options, 'patientCasePayerScenario'),
      Type: safeGet(options, 'type'),
      TimeZoneOffsetFromGMT: timeZoneOffsetFromGMT
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

  normalizeAppointmentDateFilter(value, isEnd) {
    if (!value) return value;
    if (value instanceof Date && !isNaN(value.getTime())) {
      return value.toISOString();
    }
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return value;
    if (trimmed.includes('T')) return trimmed;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return isEnd ? `${trimmed}T23:59:59` : `${trimmed}T00:00:00`;
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
    return value;
  }

  getAppointmentDateFilters(options) {
    const startRaw = options?.startDate || options?.fromDate;
    const endRaw = options?.endDate || options?.toDate;
    const startDate = this.normalizeAppointmentDateFilter(startRaw, false);
    const endDate = this.normalizeAppointmentDateFilter(endRaw, true);
    const timeZoneOffsetFromGMT = options?.timeZoneOffsetFromGMT ?? process.env.TEBRA_TIMEZONE_OFFSET;
    return { startDate, endDate, timeZoneOffsetFromGMT };
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
      
      this.logSoapArgs('GetPatient args:', args);
      const [result] = await client.GetPatientAsync(args);
      this.logSoapDebug('GetPatient result:', result);
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

  async updatePatient(patientId, updates) {
    try {
      // Build the request structure per Tebra 4.21: RequestHeader (CustomerKey, User, Password only), Patient (includes Practice).
      // RequestHeader must NOT include PracticeId (Tebra 2.3). Practice is nested under Patient.
      const patientPractice = {
        PracticeID: updates.practice?.id || process.env.TEBRA_PRACTICE_ID,
        PracticeName: this.practiceName || updates.practice?.name
      };
      if (!patientPractice.PracticeID && !patientPractice.PracticeName) {
        patientPractice.PracticeID = process.env.TEBRA_PRACTICE_ID || '1';
      }
      const args = {
        UpdatePatientReq: {
          RequestHeader: this.buildRequestHeader(),
          Patient: {
            PatientID: patientId,
            FirstName: updates.firstName,
            LastName: updates.lastName,
            MiddleName: updates.middleName,
            EmailAddress: updates.email,
            HomePhone: this._sanitizePhoneForUpdate(updates.phone),
            MobilePhone: this._sanitizePhoneForUpdate(updates.mobilePhone),
            WorkPhone: this._sanitizePhoneForUpdate(updates.workPhone),
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
            EmergencyPhone: this._sanitizePhoneForUpdate(updates.emergencyContact?.phone),
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
            },
            Practice: patientPractice
          }
        }
      };

      // Raw SOAP path: Tebra 4.21.1 – RequestHeader; Patient (PatientID, FirstName, LastName) with Practice (one of PracticeID, PracticeName). On InternalServiceFault, fallback to node-soap.
      if (this.useRawSOAP) {
        const P = args.UpdatePatientReq.Patient;
        const minimalPatient = {
          PatientID: P.PatientID,
          FirstName: (P.FirstName != null && P.FirstName !== '') ? P.FirstName : 'Unknown',
          LastName: (P.LastName != null && P.LastName !== '') ? P.LastName : 'Unknown'
        };
        const pId = args.UpdatePatientReq.Patient?.Practice?.PracticeID ?? process.env.TEBRA_PRACTICE_ID;
        const pName = args.UpdatePatientReq.Patient?.Practice?.PracticeName ?? this.practiceName;
        const practice = {};
        if (pId != null && String(pId).trim() !== '') practice.PracticeID = pId;
        if (pName != null && String(pName).trim() !== '') practice.PracticeName = pName;
        if (Object.keys(practice).length === 0) practice.PracticeID = process.env.TEBRA_PRACTICE_ID || '1';
        minimalPatient.Practice = practice;
        const payload = { Patient: minimalPatient };
        try {
          const rawXml = await this.callRawSOAPMethod('UpdatePatient', payload, {});
          const faultMatch = String(rawXml).match(/<faultstring[^>]*>([^<]*)<\/faultstring>/i);
          if (faultMatch && faultMatch[1]) {
            const msg = faultMatch[1].trim();
            if (/internal error|InternalServiceFault/i.test(msg)) {
              console.warn('[TEBRA] UpdatePatient raw SOAP InternalServiceFault, falling back to node-soap');
              this.cleanRequestData(args);
              const client = await this.getClient();
              const [result] = await client.UpdatePatientAsync(args);
              return this.normalizeGetPatientResponse(result);
            }
            throw new Error(msg);
          }
          const parsed = this.parseRawSOAPResponse(rawXml, 'UpdatePatient');
          const errResp = parsed?.UpdatePatientResult?.ErrorResponse;
          if (errResp && errResp.IsError === true) throw new Error(errResp.ErrorMessage || 'UpdatePatient failed');
          return this.normalizeGetPatientResponse(parsed?.UpdatePatientResult || parsed) || { success: true };
        } catch (rawErr) {
          if (/internal error|InternalServiceFault/i.test(String(rawErr.message || rawErr))) {
            console.warn('[TEBRA] UpdatePatient raw SOAP failed, falling back to node-soap:', rawErr.message);
            this.cleanRequestData(args);
            const client = await this.getClient();
            const [result] = await client.UpdatePatientAsync(args);
            return this.normalizeGetPatientResponse(result);
          }
          throw rawErr;
        }
      }

      // Remove undefined/null values to avoid sending '?' placeholders
      this.cleanRequestData(args);
      const client = await this.getClient();
      this.logSoapArgs('UpdatePatient args:', args);
      const [result] = await client.UpdatePatientAsync(args);
      this.logSoapDebug('UpdatePatient result:', result);
      return this.normalizeGetPatientResponse(result);
    } catch (error) {
      console.error('Tebra SOAP: UpdatePatient error', error.message);
      throw error;
    }
  }

  async deactivatePatient(patientId) {
    try {
      const client = await this.getClient();
      
      // Build the request structure according to the SOAP API
      const args = {
        request: {
          RequestHeader: this.buildRequestHeader(),
          PatientID: patientId
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      this.cleanRequestData(args);
      
      this.logSoapArgs('DeactivatePatient args:', args);
      const [result] = await client.DeactivatePatientAsync(args);
      this.logSoapDebug('DeactivatePatient result:', result);
      return { success: 1, tebraResponse: result };
    } catch (error) {
      console.error('Tebra SOAP: DeactivatePatient error', error.message);
      throw error;
    }
  }

  // Documents
  async createDocument(documentData) {
    // Import document service for local storage
    const documentService = require('./tebraDocumentService');
    
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
        
        // Extract detailed exception information if IncludeExceptionDetailInFaults is enabled
        const exceptionDetails = {
          faultString: null,
          faultCode: null,
          faultActor: null,
          detail: null,
          innerException: null,
          stackTrace: null,
          message: null,
          type: null,
          rawXml: xml
        };
        
        if (/Fault/i.test(xml)) {
          // Extract faultstring
          const faultStringMatch = xml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
          if (faultStringMatch && faultStringMatch[1]) {
            exceptionDetails.faultString = faultStringMatch[1].trim();
          }
          
          // Extract faultcode
          const faultCodeMatch = xml.match(/<faultcode[^>]*>([\s\S]*?)<\/faultcode>/i);
          if (faultCodeMatch && faultCodeMatch[1]) {
            exceptionDetails.faultCode = faultCodeMatch[1].trim();
          }
          
          // Extract detail section (where exception details would be if IncludeExceptionDetailInFaults is enabled)
          const detailMatch = xml.match(/<detail[^>]*>([\s\S]*?)<\/detail>/i);
          if (detailMatch && detailMatch[1]) {
            exceptionDetails.detail = detailMatch[1].trim();
            
            // Try to extract ExceptionDetail if present
            const exceptionDetailMatch = detailMatch[1].match(/<ExceptionDetail[^>]*>([\s\S]*?)<\/ExceptionDetail>/i);
            if (exceptionDetailMatch && exceptionDetailMatch[1]) {
              const excDetail = exceptionDetailMatch[1];
              
              // Extract exception type
              const typeMatch = excDetail.match(/<ExceptionType[^>]*>([\s\S]*?)<\/ExceptionType>/i);
              if (typeMatch && typeMatch[1]) exceptionDetails.type = typeMatch[1].trim();
              
              // Extract message
              const messageMatch = excDetail.match(/<Message[^>]*>([\s\S]*?)<\/Message>/i);
              if (messageMatch && messageMatch[1]) exceptionDetails.message = messageMatch[1].trim();
              
              // Extract stack trace
              const stackMatch = excDetail.match(/<StackTrace[^>]*>([\s\S]*?)<\/StackTrace>/i);
              if (stackMatch && stackMatch[1]) exceptionDetails.stackTrace = stackMatch[1].trim();
              
              // Extract inner exception
              const innerMatch = excDetail.match(/<InnerException[^>]*>([\s\S]*?)<\/InnerException>/i);
              if (innerMatch && innerMatch[1]) exceptionDetails.innerException = innerMatch[1].trim();
            }
          }
          
          // Extract Reason/Text (alternative fault format)
          const reasonMatch = xml.match(/<Reason>[\s\S]*?<Text[^>]*>([\s\S]*?)<\/Text>[\s\S]*?<\/Reason>/i);
          if (reasonMatch && reasonMatch[1]) {
            exceptionDetails.faultString = exceptionDetails.faultString || reasonMatch[1].trim();
          }
          
          // Return the most informative message
          const msg = exceptionDetails.message || exceptionDetails.faultString || exceptionDetails.detail || 'SOAP Fault';
          
          // If we have detailed exception info, attach it to the error
          if (exceptionDetails.type || exceptionDetails.stackTrace || exceptionDetails.innerException) {
            err.exceptionDetails = exceptionDetails;
          }
          
          return msg ? msg.trim() : 'SOAP Fault';
        }
        // Tebra-specific internal service fault string
        if (/InternalServiceFault/i.test(xml)) {
          // Try to extract any additional details even for InternalServiceFault
          const detailMatch = xml.match(/<detail[^>]*>([\s\S]*?)<\/detail>/i);
          if (detailMatch && detailMatch[1]) {
            exceptionDetails.detail = detailMatch[1].trim();
            err.exceptionDetails = exceptionDetails;
          }
          return 'InternalServiceFault';
        }
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
      this.logSoapArgs('CreateDocument args:', args);
      const [result] = await client.CreateDocumentAsync(args);
      this.logSoapDebug('CreateDocument result:', result);
      
      // Write raw Tebra response to file for debugging
      try {
        const fs = require('fs');
        const path = require('path');
        const responseFile = path.join(__dirname, '../../scripts/tebra-create-document-raw-response.json');
        fs.writeFileSync(responseFile, JSON.stringify({
          timestamp: new Date().toISOString(),
          rawTebraResponse: result,
          normalizedResponse: this.normalizeCreateDocumentResponse(result)
        }, null, 2), 'utf8');
      } catch (fileErr) {
        // Non-critical
      }
      
      const normalizedResult = this.normalizeCreateDocumentResponse(result);
      
      // Store document metadata in local database for retrieval (optional - only if database is available)
      // (since Tebra SOAP 2.1 doesn't support GetDocuments/GetDocumentContent)
      // Skip database storage if DATABASE_URL is not set or if we're just testing Tebra API
      if (process.env.DATABASE_URL && !process.env.TEBRA_SKIP_DB_STORAGE) {
        try {
          await documentService.initialize(); // Ensure table exists
          await documentService.storeDocument({
            tebraDocumentId: normalizedResult.id,
            patientId: documentData.patientId,
            practiceId: documentData.practiceId,
            name: documentData.name || 'Document',
            fileName: documentData.fileName || `document-${Date.now()}.json`,
            label: documentData.label || 'General',
            status: documentData.status || 'Completed',
            documentDate: documentData.documentDate || new Date().toISOString(),
            documentNotes: documentData.documentNotes || documentData.notes || '',
            fileContentBase64: documentData.fileContent || '',
            mimeType: documentData.mimeType || 'application/json'
          });
          console.log(`✅ [DOCUMENT] Stored document metadata in local database: ${normalizedResult.id}`);
        } catch (dbError) {
          // Non-critical: log but don't fail document creation
          // Silently skip if it's a connection error (database not available for testing)
          const isConnectionError = dbError.message && (
            dbError.message.includes('ECONNREFUSED') || 
            dbError.message.includes('connect') ||
            dbError.code === 'ECONNREFUSED'
          );
          if (!isConnectionError) {
            console.warn('⚠️ [DOCUMENT] Failed to store document metadata in database (non-critical):', dbError?.message || dbError);
          }
        }
      } else {
        console.log('ℹ️  [DOCUMENT] Skipping local database storage (TEBRA_SKIP_DB_STORAGE set or DATABASE_URL not configured)');
      }
      
      return normalizedResult;
    } catch (error) {
      const faultMsg = parseSoapFault(error);
      console.error('Tebra SOAP: CreateDocument error', error.message, faultMsg ? `| Fault: ${faultMsg}` : '');

      // Retry once with a minimal payload if we hit an internal fault
      if (faultMsg) {
        try {
          const client = await this.getClient();
          const minimalArgs = buildArgs(documentData, true);
          this.logSoapArgs('CreateDocument retry (minimal) args:', minimalArgs);
          const [result2] = await client.CreateDocumentAsync(minimalArgs);
          this.logSoapDebug('CreateDocument retry result:', result2);
          const normalizedResult2 = this.normalizeCreateDocumentResponse(result2);
          
          // Store document metadata in local database for retrieval (optional - only if database is available)
          if (process.env.DATABASE_URL && !process.env.TEBRA_SKIP_DB_STORAGE) {
            try {
              await documentService.initialize();
              await documentService.storeDocument({
                tebraDocumentId: normalizedResult2.id,
                patientId: documentData.patientId,
                practiceId: documentData.practiceId,
                name: documentData.name || 'Document',
                fileName: documentData.fileName || `document-${Date.now()}.json`,
                label: documentData.label || 'General',
                status: documentData.status || 'Completed',
                documentDate: documentData.documentDate || new Date().toISOString(),
                documentNotes: documentData.documentNotes || documentData.notes || '',
                fileContentBase64: documentData.fileContent || '',
                mimeType: documentData.mimeType || 'application/json'
              });
              console.log(`✅ [DOCUMENT] Stored document metadata in local database (retry): ${normalizedResult2.id}`);
            } catch (dbError) {
              // Non-critical: silently skip if database not available
              const isConnectionError = dbError.message && (
                dbError.message.includes('ECONNREFUSED') || 
                dbError.message.includes('connect') ||
                dbError.code === 'ECONNREFUSED'
              );
              if (!isConnectionError) {
                console.warn('⚠️ [DOCUMENT] Failed to store document metadata in database (non-critical):', dbError?.message || dbError);
              }
            }
          }
          
          return normalizedResult2;
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
      
      this.logSoapArgs('DeleteDocument args:', args);
      const [result] = await client.DeleteDocumentAsync(args);
      this.logSoapDebug('DeleteDocument result:', result);
      
      // Also delete from local database (soft delete)
      try {
        const documentService = require('./tebraDocumentService');
        await documentService.deleteDocument(documentId);
        console.log(`✅ [DOCUMENT] Deleted document from local database: ${documentId}`);
      } catch (dbError) {
        // Non-critical: log but don't fail document deletion
        console.warn('⚠️ [DOCUMENT] Failed to delete document from database (non-critical):', dbError?.message || dbError);
      }
      
      return { success: 1, tebraResponse: result };
    } catch (error) {
      console.error('Tebra SOAP: DeleteDocument error', error.message);
      throw error;
    }
  }

  // Appointments
  async getAppointments(options = {}) {
    try {
      this.logSoapDebug('🔍 [GET APPOINTMENTS] Starting with options:', options);
      
      // Step 1: Get appointment IDs using GetAppointments
      const appointmentIds = await this.getAppointmentIds(options);
      this.logSoapDebug('📋 [GET APPOINTMENTS] Found appointment IDs:', {
        count: appointmentIds.length
      });
      this.logSoapDebug('📋 [GET APPOINTMENTS] Appointment IDs array:', appointmentIds);
      
      // Add a small delay after getting IDs before processing details
      if (appointmentIds.length > 0) {
        this.logSoapDebug('⏳ [GET APPOINTMENTS] Waiting before fetching details (ms):', this.delayAfterGetIds);
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
      this.logSoapDebug('🔍 [GET APPOINTMENTS] Fetching full details for each appointment...', {});
      const appointments = await this.getAppointmentDetails(appointmentIds, options.requestingPatientId);
      
      this.logSoapDebug('✅ [GET APPOINTMENTS] Retrieved appointments with full details:', {
        count: appointments.length
      });
      
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
      this.logSoapDebug('🔍 [GET APPOINTMENT IDS] Starting with options:', options);
      
      // Use raw SOAP if enabled, otherwise use soap library
      if (this.useRawSOAP) {
        const fields = { ID: 1 }; // Only request ID field for efficiency
        const filters = this.buildAppointmentFilters(options);
        this.logSoapDebug('🔍 [RAW SOAP] GetAppointmentIds fields requested:', fields);
        this.logSoapDebug('🔍 [RAW SOAP] GetAppointmentIds filters:', filters);
        const result = await this.callRawSOAPMethod('GetAppointments', fields, filters);
        const parsedResult = this.parseRawSOAPResponse(result, 'GetAppointments');
        const appointmentIds = this.extractAppointmentIds(parsedResult);
        this.logSoapDebug('📋 [GET APPOINTMENT IDS] Final appointment IDs array:', appointmentIds);
        return appointmentIds;
      }

      const client = await this.getClient();
      
      // Build the request structure for GetAppointments (only requesting IDs)
      const { startDate, endDate, timeZoneOffsetFromGMT } = this.getAppointmentDateFilters(options);
      const resolvedPracticeName = this.resolvePracticeName(options);
      const args = {
        request: {
          RequestHeader: this.buildRequestHeader(),
          Fields: {
            ID: 1 // Only request ID field for efficiency
          },
          Filter: {
            // Basic filters - removed PatientID filter to get all appointments
            PatientFullName: options.patientFullName,
            PracticeName: resolvedPracticeName,
            ServiceLocationName: options.serviceLocationName,
            ResourceName: options.resourceName,
            // Date filters
            StartDate: startDate,
            EndDate: endDate,
            FromCreatedDate: options.fromCreatedDate,
            ToCreatedDate: options.toCreatedDate,
            FromLastModifiedDate: options.fromLastModifiedDate,
            ToLastModifiedDate: options.toLastModifiedDate,
            // Other filters
            AppointmentReason: options.appointmentReason,
            ConfirmationStatus: options.confirmationStatus,
            PatientCasePayerScenario: options.patientCasePayerScenario,
            Type: options.type,
            TimeZoneOffsetFromGMT: timeZoneOffsetFromGMT
          }
        }
      };

      // Remove undefined/null values to avoid sending '?' placeholders
      this.cleanRequestData(args);
      
      this.logSoapArgs('GetAppointmentIds args:', args);
      const [result] = await client.GetAppointmentsAsync(args);
      this.logSoapDebug('GetAppointmentIds result:', result);
      const appointmentIds = this.extractAppointmentIds(result);
      this.logSoapDebug('📋 [GET APPOINTMENT IDS] Final appointment IDs array:', appointmentIds);
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
    
    this.logSoapDebug('📋 [EXTRACT IDS] Extracted appointment IDs:', {
      count: appointmentIds.length,
      ids: appointmentIds
    });
    return appointmentIds;
  }

  // Get full details for multiple appointments
  async getAppointmentDetails(appointmentIds, requestingPatientId = null) {
    const appointments = [];
    
    // Process appointments in batches to avoid overwhelming the API
    const batchSize = this.batchSize;
    for (let i = 0; i < appointmentIds.length; i += batchSize) {
      const batch = appointmentIds.slice(i, i + batchSize);
      this.logSoapDebug('🔄 [BATCH] Processing appointment batch:', {
        batchIndex: Math.floor(i / batchSize) + 1,
        batchTotal: Math.ceil(appointmentIds.length / batchSize),
        batchSize: batch.length
      });
      
      // Process batch with small delays between calls to be respectful to the API
      const batchResults = [];
      for (let j = 0; j < batch.length; j++) {
        const appointmentId = batch[j];
        try {
          this.logSoapDebug('🔍 [BATCH] Getting appointment:', {
            index: j + 1,
            total: batch.length,
            appointmentId
          });
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
        this.logSoapDebug('⏳ [BATCH] Waiting before next batch (ms):', this.delayBetweenBatches);
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
      
      this.logSoapArgs('GetAppointment args:', args);
      const [result] = await client.GetAppointmentAsync(args);
      this.logSoapDebug('GetAppointment result:', result);
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
        this.logSoapDebug('🔍 Built appointment data:', appointment);
        // Tebra requires AppointmentReasonID; avoid sending without it (causes 500 / "Error translating AppointmentCreate to CreateAppointmentV3Request")
        if (appointment.AppointmentReasonID == null) {
          const hint = 'Set TEBRA_DEFAULT_APPT_REASON_ID or TEBRA_DEFAULT_APPT_REASON_NAME (e.g. "Counseling"). Run: node scripts/list-tebra-appointment-reasons.js <practiceId> to list IDs.';
          throw new Error(`AppointmentReasonID is required by Tebra but could not be resolved. ${hint}`);
        }
        // Log the appointment data being sent (required 4.14 fields)
        this.logSoapDebug('🔍 [TEBRA] Appointment data being sent:', {
          PracticeID: appointment.PracticeID,
          ServiceLocationID: appointment.ServiceLocationID,
          StartTime: appointment.StartTime,
          EndTime: appointment.EndTime,
          PatientID: appointment.PatientID,
          AppointmentReasonID: appointment.AppointmentReasonID,
          ProviderID: appointment.ProviderID,
          ResourceID: appointment.ResourceID,
          ResourceIds: appointment.ResourceIds
        });
        
        let rawXml, parsed, appointmentId;
        const errTranslate = 'Error translating AppointmentCreate to CreateAppointmentV3Request';
        const baseSummary = appointment.PatientSummary;
        const payloadVariants = [
          { label: 'base', data: { ...appointment } },
          { label: 'no-practice-guid', data: { ...appointment, PracticeGuid: undefined } },
          { label: 'no-service-location-guid', data: { ...appointment, ServiceLocationGuid: undefined } },
          { label: 'no-practice-service-guids', data: { ...appointment, PracticeGuid: undefined, ServiceLocationGuid: undefined } },
          { label: 'provider-guids-only', data: { ...appointment, ResourceGuids: undefined } },
          { label: 'resource-guids-only', data: { ...appointment, ProviderGuids: undefined } },
          { label: 'guids-only-no-ids', data: { ...appointment, ProviderID: undefined, ResourceID: undefined, ResourceIds: undefined } },
          { label: 'ids-only-no-guids', data: { ...appointment, ProviderGuids: undefined, ResourceGuids: undefined } },
          { label: 'no-top-level-patient-id', data: { ...appointment, PatientID: undefined } },
          { label: 'patient-summaries-only', data: { ...appointment, PatientSummary: undefined, PatientSummaries: baseSummary ? [baseSummary] : undefined } },
          { label: 'guids-only-no-ids-no-top-patient-id', data: { ...appointment, ProviderID: undefined, ResourceID: undefined, ResourceIds: undefined, PatientID: undefined } }
        ];
        let lastPayload = appointment;

        for (const variant of payloadVariants) {
          const payload = variant.data;
          lastPayload = payload;
          if (!payload.AppointmentReasonID || payload.AppointmentReasonID === 0) {
            const defaultId = process.env.TEBRA_DEFAULT_APPT_REASON_ID;
            if (defaultId && defaultId !== '0' && !isNaN(parseInt(String(defaultId), 10))) {
              payload.AppointmentReasonID = parseInt(String(defaultId), 10);
            }
          }
          this.logSoapDebug('🔄 [TEBRA] CreateAppointment attempt:', variant.label);

          rawXml = await this.callRawSOAPMethod('CreateAppointment', payload, {});
          const xmlPreview = typeof rawXml === 'string' && rawXml.length > 500 ? rawXml.substring(0, 500) + '...' : rawXml;
          this.logSoapDebug('🔍 [TEBRA] Raw CreateAppointment XML response (preview):', xmlPreview);

          parsed = this.parseRawSOAPResponse(rawXml, 'CreateAppointment');
          const appointmentNode = parsed?.CreateAppointmentResult?.Appointment || {};
          appointmentId = appointmentNode.AppointmentID || appointmentNode.AppointmentId || appointmentNode.id;

          if (!appointmentId && typeof rawXml === 'string') {
            const faultMatch = rawXml.match(/<s:Fault>[\s\S]*?<faultstring[^>]*>([^<]*)<\/faultstring>/i);
            if (faultMatch && faultMatch[1]) {
              const faultString = faultMatch[1].trim();
              const faultCodeMatch = rawXml.match(/<faultcode[^>]*>([^<]*)<\/faultcode>/i);
              const faultCode = faultCodeMatch ? faultCodeMatch[1].trim() : 'Unknown';
              console.error(`❌ [TEBRA] SOAP Fault in CreateAppointment response:`);
              console.error(`   Fault Code: ${faultCode}`);
              console.error(`   Fault String: ${faultString}`);
              throw new Error(`Tebra CreateAppointment SOAP Fault: ${faultCode} - ${faultString}`);
            }
            const idMatch = rawXml.match(/<AppointmentID[^>]*>([^<]+)<\/AppointmentID>/i) || rawXml.match(/<AppointmentId[^>]*>([^<]+)<\/AppointmentId>/i);
            if (idMatch && idMatch[1]) {
              appointmentId = idMatch[1].trim();
              this.logSoapDebug('✅ [TEBRA] Extracted AppointmentID from raw XML using regex:', appointmentId);
            }
            const errorMatch = rawXml.match(/<ErrorMessage[^>]*>([\s\S]*?)<\/ErrorMessage>/i);
            const errorMsg = errorMatch && errorMatch[1] ? errorMatch[1].trim() : null;
            if (errorMsg) console.error(`❌ [TEBRA] Error message in CreateAppointment response: ${errorMsg}`);
            if (errorMsg && errorMsg.toLowerCase() !== 'success') {
              if (errorMsg === errTranslate) {
                continue;
              }
              let h = '';
              if (/ProviderGuids or ResourceGuids/i.test(errorMsg)) {
                h = ' CreateAppointmentV3 requires valid TEBRA_PROVIDER_GUID and/or TEBRA_RESOURCE_GUID. Obtain from Tebra Support and set in .env. See docs/TEBRA_CREATE_APPOINTMENT_V3_FINDINGS.md.';
                console.warn('[TEBRA] Hint:', h);
              } else if (/not authorized for Practice/i.test(errorMsg)) {
                h = ' Use an authorized practice: GetPractices({}).then(console.log), then set TEBRA_PRACTICE_ID and TEBRA_PRACTICE_ID_CA to that ID.';
                console.warn('[TEBRA] Hint:', h);
              }
              const short = errorMsg.length > 280 ? errorMsg.slice(0, 280) + '…' : errorMsg;
              throw new Error(`Tebra CreateAppointment failed: ${short}${h}`);
            }
            const isErrorMatch = rawXml.match(/<IsError[^>]*>([^<]+)<\/IsError>/i);
            if (isErrorMatch && isErrorMatch[1] && isErrorMatch[1].toLowerCase() === 'true') {
              throw new Error(`Tebra CreateAppointment returned IsError=true: ${errorMsg || 'Unknown error'}`);
            }
          }

          if (appointmentId) {
            if (!parsed.CreateAppointmentResult) parsed.CreateAppointmentResult = {};
            if (!parsed.CreateAppointmentResult.Appointment) parsed.CreateAppointmentResult.Appointment = {};
            parsed.CreateAppointmentResult.Appointment.AppointmentID = appointmentId;
            parsed.CreateAppointmentResult.Appointment.AppointmentId = appointmentId;
            parsed.CreateAppointmentResult.Appointment.id = appointmentId;
            return parsed;
          }
        }

        // Fallback: try node-soap CreateAppointmentAsync when raw SOAP fails all variants (WSDL-shaped XML may satisfy CreateAppointmentV3)
        try {
          this.logSoapDebug('🔄 [TEBRA] Trying node-soap CreateAppointmentAsync (raw SOAP retries exhausted)', {});
          const client = await this.getClient();
          const args = { request: { RequestHeader: this.buildRequestHeader(), Appointment: lastPayload || appointment } };
          this.cleanRequestData(args);
          const [result] = await client.CreateAppointmentAsync(args);
          return this.normalizeCreateAppointmentResponse(result);
        } catch (nodeSoapErr) {
          console.warn('[TEBRA] node-soap CreateAppointmentAsync also failed:', nodeSoapErr.message);
        }

        const lastErr = typeof rawXml === 'string' && rawXml.match(/<ErrorMessage[^>]*>([^<]*)<\/ErrorMessage>/i);
        const msg = (lastErr && lastErr[1]) || 'No AppointmentID in response';
        let hint = '';
        if (/ProviderGuids or ResourceGuids/i.test(msg)) {
          hint = ' CreateAppointmentV3 requires valid TEBRA_PROVIDER_GUID and/or TEBRA_RESOURCE_GUID. SOAP Get* APIs do not return them — obtain from Tebra Support/Customer Care and set in .env. See docs/TEBRA_CREATE_APPOINTMENT_V3_FINDINGS.md.';
        } else if (/not authorized for Practice/i.test(msg)) {
          hint = ' Use a practice your user is authorized for: run GetPractices (or node -e "require(\'./src/services/tebraService\').getPractices({}).then(console.log)"), then set TEBRA_PRACTICE_ID and TEBRA_PRACTICE_ID_CA to that practice\'s ID.';
        } else if (/CreateAppointmentV3Request|Error translating/i.test(msg)) {
          hint = ' Set TEBRA_DEFAULT_APPT_REASON_ID from: node scripts/list-tebra-appointment-reasons.js ' + (appointment.PracticeID || '1') + '. If "not authorized for Practice", switch to an authorized practice (GetPractices). If "ProviderGuids or ResourceGuids", obtain TEBRA_PROVIDER_GUID/TEBRA_RESOURCE_GUID from Tebra.';
        }
        if (hint) console.warn('[TEBRA] Hint:', hint);
        const shortMsg = msg.length > 320 ? msg.slice(0, 320) + '…' : msg;
        throw new Error(`Tebra CreateAppointment failed: ${shortMsg}${hint}`);
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
            AttendeesCount: appointmentData.attendeesCount,
            EndTime: appointmentData.endTime,
            ForRecare: appointmentData.forRecare,
            InsurancePolicyAuthorizationId: appointmentData.insurancePolicyAuthorizationId,
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
      
      this.logSoapArgs('CreateAppointment args:', args);
      const [result] = await client.CreateAppointmentAsync(args);
      this.logSoapDebug('CreateAppointment result:', result);
      return this.normalizeCreateAppointmentResponse(result);
    } catch (error) {
      console.error('Tebra SOAP: CreateAppointment error', error.message);
      throw error;
    }
  }

  async deleteAppointment(appointmentId) {
    try {
      this.logSoapDebug('❌ [TEBRA SERVICE] Deleting appointment:', appointmentId);
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
      
      this.logSoapArgs('DeleteAppointment args:', args);
      const [result] = await client.DeleteAppointmentAsync(args);
      this.logSoapDebug('DeleteAppointment result:', result);
      
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

      if (this.shouldLogSoap()) {
        // Generate and log raw SOAP XML for debugging (but don't send it)
        try {
          const appointmentPayload = { Appointment: { AppointmentId: appointmentId } };
          const rawXml = this.generateRawSOAPXML('DeleteAppointment', appointmentPayload, {});
          this.logSoapDebug('🔍 Generated raw SOAP XML for DeleteAppointment (debug):', rawXml);
        } catch (xmlErr) {
          console.error('Failed to generate raw SOAP XML for debugging:', xmlErr && xmlErr.message ? xmlErr.message : xmlErr);
        }

        // If soap client exists, log lastRequest/lastResponse for further clues
        try {
          const client = await this.getClient();
          if (client && client.lastRequest) {
            this.logSoapDebug('🔍 SOAP client lastRequest:', client.lastRequest);
          }
          if (client && client.lastResponse) {
            this.logSoapDebug('🔍 SOAP client lastResponse:', client.lastResponse);
          }
        } catch (cliErr) {
          console.error('Failed to log SOAP client lastRequest/lastResponse:', cliErr && cliErr.message ? cliErr.message : cliErr);
        }
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
      this.logSoapDebug('✏️ [TEBRA SERVICE] Updating appointment:', appointmentId);

      // Coerce numeric string IDs to integers to match SOAP type expectations
      const appointmentIdToUse = (typeof appointmentId === 'string' && /^\d+$/.test(appointmentId)) ? parseInt(appointmentId, 10) : appointmentId;

      const getUpdate = (camel, pascal) => {
        if (!updates || typeof updates !== 'object') return undefined;
        return updates[camel] ?? updates[pascal];
      };

      // If required fields are missing, fetch base appointment to fill gaps per Tebra guide 4.19.1
      const requiredFieldsPresent = [
        getUpdate('appointmentStatus', 'AppointmentStatus'),
        getUpdate('serviceLocationId', 'ServiceLocationId'),
        getUpdate('startTime', 'StartTime'),
        getUpdate('endTime', 'EndTime'),
        getUpdate('appointmentReasonId', 'AppointmentReasonId'),
        getUpdate('resourceId', 'ResourceId'),
        getUpdate('patientId', 'PatientId'),
        getUpdate('appointmentName', 'AppointmentName'),
        getUpdate('maxAttendees', 'MaxAttendees')
      ].every(v => v != null && v !== '');

      let baseAppointment = null;
      if (!requiredFieldsPresent) {
        try {
          baseAppointment = await this.getAppointment(appointmentIdToUse);
        } catch (baseErr) {
          console.warn('⚠️ [TEBRA SERVICE] Failed to fetch base appointment for update:', baseErr?.message || baseErr);
        }
      }

      const baseServiceLocationId = baseAppointment?.serviceLocation?.id || baseAppointment?.serviceLocationId;
      const baseStartTime = baseAppointment?.startDateTime || baseAppointment?.startTime;
      const baseEndTime = baseAppointment?.endDateTime || baseAppointment?.endTime;
      const baseResourceId = baseAppointment?.resourceId || baseAppointment?.providerId;

      // Build Appointment payload
      const appointmentPayload = {
        Appointment: {
          AppointmentId: appointmentIdToUse,
          AppointmentMode: getUpdate('appointmentMode', 'AppointmentMode'),
          AppointmentName: getUpdate('appointmentName', 'AppointmentName') ?? baseAppointment?.appointmentName,
          AppointmentReasonId: getUpdate('appointmentReasonId', 'AppointmentReasonId') ?? baseAppointment?.appointmentReasonId,
          AppointmentStatus: getUpdate('appointmentStatus', 'AppointmentStatus') ?? baseAppointment?.appointmentStatus,
          EndTime: getUpdate('endTime', 'EndTime') ?? baseEndTime,
          InsurancePolicyAuthorizationId: getUpdate('insurancePolicyAuthorizationId', 'InsurancePolicyAuthorizationId'),
          IsRecurring: getUpdate('isRecurring', 'IsRecurring'),
          MaxAttendees: getUpdate('maxAttendees', 'MaxAttendees') ?? baseAppointment?.maxAttendees ?? 1,
          Notes: getUpdate('notes', 'Notes'),
          OccurrenceId: getUpdate('occurrenceId', 'OccurrenceId'),
          PatientCaseId: getUpdate('patientCaseId', 'PatientCaseId'),
          PatientId: getUpdate('patientId', 'PatientId') ?? baseAppointment?.patientId,
          ProviderId: getUpdate('providerId', 'ProviderId') || baseAppointment?.providerId || '1',
          ResourceId: getUpdate('resourceId', 'ResourceId') ?? baseResourceId,
          ResourceIds: getUpdate('resourceIds', 'ResourceIds'),
          ServiceLocationId: getUpdate('serviceLocationId', 'ServiceLocationId') ?? baseServiceLocationId,
          StartTime: getUpdate('startTime', 'StartTime') ?? baseStartTime,
          UpdatedAt: getUpdate('updatedAt', 'UpdatedAt'),
          UpdatedBy: getUpdate('updatedBy', 'UpdatedBy')
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

      this.logSoapArgs('UpdateAppointment args:', args);
      const [result] = await client.UpdateAppointmentAsync(args);
      this.logSoapDebug('UpdateAppointment result:', result);
      return this.normalizeGetAppointmentResponse(result);
    } catch (error) {
      console.error('❌ Tebra SOAP: UpdateAppointment error', error && error.message ? error.message : error);
      if (error && error.stack) console.error('Stack:', error.stack);
      if (error && error.response && error.response.data) console.error('Upstream response data:', error.response.data);

      if (this.shouldLogSoap()) {
        // Generate and log raw SOAP XML for debugging (do not send)
        try {
          const rawXml = this.generateRawSOAPXML(
            'UpdateAppointment',
            appointmentPayload && appointmentPayload.Appointment ? appointmentPayload.Appointment : updates,
            {}
          );
          this.logSoapDebug('🔍 Generated raw SOAP XML for UpdateAppointment (debug):', rawXml);
        } catch (xmlErr) {
          console.error('Failed to generate raw SOAP XML for debugging:', xmlErr && xmlErr.message ? xmlErr.message : xmlErr);
        }

        // If soap client exists, log lastRequest/lastResponse for further clues
        try {
          const client = await this.getClient();
          if (client && client.lastRequest) {
            this.logSoapDebug('🔍 SOAP client lastRequest:', client.lastRequest);
          }
          if (client && client.lastResponse) {
            this.logSoapDebug('🔍 SOAP client lastResponse:', client.lastResponse);
          }
        } catch (cliErr) {
          console.error('Failed to log SOAP client lastRequest/lastResponse:', cliErr && cliErr.message ? cliErr.message : cliErr);
        }
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
      
      this.logSoapArgs('CreateAppointmentReason args:', args);
      const [result] = await client.CreateAppointmentReasonAsync(args);
      this.logSoapDebug('CreateAppointmentReason result:', result);
      return this.normalizeCreateAppointmentReasonResponse(result);
    } catch (error) {
      console.error('Tebra SOAP: CreateAppointmentReason error', error.message);
      throw error;
    }
  }

  async getAppointmentReasons(practiceId) {
    try {
      // Use raw SOAP when enabled so RequestHeader (Password, etc.) is xmlEscape'd and avoids InternalServiceFault from special chars
      if (this.useRawSOAP) {
        const rawXml = await this.callRawSOAPMethod('GetAppointmentReasons', { PracticeId: practiceId }, {});
        if (process.env.DEBUG_TEBRA_RAW === 'GetAppointmentReasons') {
          this.logSoapDebug('[DEBUG_TEBRA_RAW] GetAppointmentReasons response (preview):', String(rawXml).slice(0, 4000), { maxLength: 4000 });
        }
        const parsed = this.parseRawSOAPResponse(rawXml, 'GetAppointmentReasons');
        return this.normalizeGetAppointmentReasonsResponse(parsed);
      }

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
      
      this.logSoapArgs('GetAppointmentReasons args:', args);
      const [result] = await client.GetAppointmentReasonsAsync(args);
      this.logSoapDebug('GetAppointmentReasons result:', result);
      return this.normalizeGetAppointmentReasonsResponse(result);
    } catch (error) {
      console.error('Tebra SOAP: GetAppointmentReasons error', error.message);
      throw error;
    }
  }

  // Helper methods to get Practice and Provider information
  async getPractices(options = {}) {
    try {
      this.logSoapDebug('🔍 [TEBRA] Getting practices with options:', options);
      
      // Validate credentials before making request
      if (!this.customerKey || !this.user || !this.password) {
        throw new Error('Tebra credentials missing. Please set TEBRA_CUSTOMER_KEY, TEBRA_USER, and TEBRA_PASSWORD in environment variables.');
      }
      
      // Use raw SOAP implementation (this was working before)
      const fields = {
        ID: 1,
        PracticeName: 1,
        Active: 1,
        AddressLine1: 1,
        City: 1,
        State: 1,
        Phone: 1,
        NPI: 1,
        TaxID: 1
      };
      
      const filters = {};
      if (options.id) filters.ID = options.id;
      if (options.practiceName) filters.PracticeName = options.practiceName;
      if (options.active !== undefined) filters.Active = options.active;
      if (options.npi) filters.NPI = options.npi;
      if (options.taxId) filters.TaxID = options.taxId;
      if (options.fromCreatedDate) filters.FromCreatedDate = options.fromCreatedDate;
      if (options.toCreatedDate) filters.ToCreatedDate = options.toCreatedDate;
      if (options.fromLastModifiedDate) filters.FromLastModifiedDate = options.fromLastModifiedDate;
      if (options.toLastModifiedDate) filters.ToLastModifiedDate = options.toLastModifiedDate;
      
      const rawXml = await this.callRawSOAPMethod('GetPractices', fields, filters);
      const parsed = this.parseRawSOAPResponse(rawXml, 'GetPractices');
      return this.normalizeGetPracticesResponse(parsed);
      
    } catch (error) {
      console.error('Tebra SOAP: GetPractices error', error.message);
      console.error('GetPractices error details:', {
        message: error.message,
        fault: error.fault || null,
        args: 'Raw SOAP implementation',
        credentials: {
          hasCustomerKey: !!this.customerKey,
          hasUser: !!this.user,
          hasPassword: !!this.password,
          customerKeyLength: this.customerKey ? this.customerKey.length : 0
        }
      });
      throw error;
    }
  }

  async getProviders(options = {}) {
    try {
      this.logSoapDebug('🔍 [TEBRA] Getting providers with options:', options);
      
      // Use raw SOAP implementation (this was working before)
      const fields = {
        ID: 1,
        FirstName: 1,
        LastName: 1,
        Active: 1,
        GUID: 1
      };
      
      const filters = {};
      if (options.practiceId) filters.PracticeId = options.practiceId;
      if (options.practiceName) filters.PracticeName = options.practiceName;
      if (options.id) filters.ID = options.id;
      if (options.active !== undefined) filters.Active = options.active;
      
      // Tebra requires PracticeName in filter - use from options or environment
      if (Object.keys(filters).length === 0 && this.practiceName) {
        filters.PracticeName = this.practiceName;
      }

      const result = await this.callRawSOAPMethod('GetProviders', fields, filters);
      const parsed = this.parseRawSOAPResponse(result, 'GetProviders');
      return this.normalizeGetProvidersResponse(parsed);
      
    } catch (error) {
      this.handleSOAPError(error, 'GetProviders', { options });
    }
  }

  // Availability and Scheduling
  /**
   * Get availability slots
   * ⚠️ NOTE: GetAvailability is NOT available in Tebra SOAP 2.1 API
   * This method calculates availability using GetAppointments to find existing appointments,
   * then generates available slots based on business hours and filters out conflicts.
   * 
   * @param {Object} options - Availability options
   * @param {string} options.practiceId - Practice ID
   * @param {string} options.providerId - Provider ID (optional)
   * @param {string} options.fromDate - Start date (YYYY-MM-DD)
   * @param {string} options.toDate - End date (YYYY-MM-DD)
   * @param {number} options.slotDuration - Slot duration in minutes (default: 30)
   * @returns {Promise<Object>} Availability result with slots array
   */
  async getAvailability(options = {}) {
    try {
      const availabilityCalculator = require('./availabilityCalculator');
      
      // Use the availability calculator which uses GetAppointments
      const result = await availabilityCalculator.calculateAvailability({
        practiceId: options.practiceId,
        providerId: options.providerId || '1',
        fromDate: options.fromDate || options.FromDate,
        toDate: options.toDate || options.ToDate,
        slotDuration: options.slotDuration || 30,
        state: options.state
      });

      return result;
    } catch (error) {
      console.error('[TEBRA] Failed to calculate availability:', error.message);
      
      // Return empty result on error to maintain backward compatibility
      return {
        availability: [],
        totalCount: 0,
        error: error.message,
        message: 'Failed to calculate availability. GetAvailability is not available in Tebra SOAP 2.1 API.'
      };
    }
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

  shouldLogSoap() {
    return process.env.TEBRA_DEBUG_SOAP === 'true'
      || process.env.TEBRA_DEBUG_REQUESTS === 'true'
      || process.env.TEBRA_DEBUG_RESPONSES === 'true'
      || process.env.TEBRA_DEBUG_AUTH === 'true';
  }

  redactSoapXml(xml) {
    if (typeof xml !== 'string') return xml;
    return xml
      .replace(/<(?:\w+:)?CustomerKey>[^<]*<\/(?:\w+:)?CustomerKey>/gi, '<CustomerKey>***</CustomerKey>')
      .replace(/<(?:\w+:)?Password>[^<]*<\/(?:\w+:)?Password>/gi, '<Password>***</Password>')
      .replace(/<(?:\w+:)?User>[^<]*<\/(?:\w+:)?User>/gi, '<User>***</User>');
  }

  redactSoapArgs(args) {
    try {
      const safeArgs = JSON.parse(JSON.stringify(args || {}));
      if (safeArgs.request && safeArgs.request.RequestHeader) {
        safeArgs.request.RequestHeader = {
          CustomerKey: safeArgs.request.RequestHeader.CustomerKey ? '***' : undefined,
          User: safeArgs.request.RequestHeader.User ? '***' : undefined,
          Password: safeArgs.request.RequestHeader.Password ? '***' : undefined,
          ClientVersion: safeArgs.request.RequestHeader.ClientVersion || undefined
        };
      }
      return safeArgs;
    } catch (e) {
      return { redactionFailed: true };
    }
  }

  logSoapArgs(label, args) {
    if (!this.shouldLogSoap()) return;
    const safeArgs = this.redactSoapArgs(args);
    console.log(label, JSON.stringify(safeArgs, null, 2));
  }

  logSoapDebug(label, payload, options = {}) {
    if (!this.shouldLogSoap()) return;
    const maxLength = options.maxLength || 2000;
    if (typeof payload === 'string') {
      const redacted = this.redactSoapXml(payload);
      const preview = redacted.length > maxLength ? `${redacted.slice(0, maxLength)}...` : redacted;
      console.log(label, preview);
      return;
    }
    try {
      console.log(label, JSON.stringify(payload, null, 2));
    } catch (error) {
      console.log(label, payload);
    }
  }


  unwrap(obj) {
    if (!obj) return {};
    // node-soap often returns { MethodResult: {...} }
    const keys = Object.keys(obj || {});
    if (keys.length === 1 && keys[0].toLowerCase().includes('result')) {
      const result = obj[keys[0]] || {};
      return result;
    }
    return obj;
  }

  // ============================================
  // ENCOUNTER MANAGEMENT (Official API Methods)
  // ============================================

  /**
   * Create Encounter - Creates encounter with service lines (charges)
   * This is the OFFICIAL way to create charges in Tebra
   * Reference: Official API Guide Section 4.16
   */
  async createEncounter(encounterData) {
    try {
      const auth = this.getAuthHeader();
      const practiceId = encounterData.practiceId || encounterData.PracticeId || encounterData.Practice?.PracticeID;
      const practiceName = encounterData.practiceName || encounterData.Practice?.PracticeName;
      
      if (!practiceId && !practiceName) {
        throw new Error('PracticeId or PracticeName is required for CreateEncounter');
      }

      // Build encounter XML according to official API structure
      const buildEncounterXml = (data, indent = '         ') => {
        let xml = '';
        
        // Practice (required)
        if (data.Practice || practiceId || practiceName) {
          xml += `${indent}<sch:Practice>\n`;
          if (practiceId) xml += `${indent}  <sch:PracticeID>${this.xmlEscape(String(practiceId))}</sch:PracticeID>\n`;
          if (practiceName) xml += `${indent}  <sch:PracticeName>${this.xmlEscape(practiceName)}</sch:PracticeName>\n`;
          xml += `${indent}</sch:Practice>\n`;
        }

        // Appointment (optional)
        if (data.Appointment || data.appointmentId) {
          xml += `${indent}<sch:Appointment>\n`;
          if (data.appointmentId || data.Appointment?.AppointmentID) {
            xml += `${indent}  <sch:AppointmentID>${this.xmlEscape(String(data.appointmentId || data.Appointment.AppointmentID))}</sch:AppointmentID>\n`;
          }
          xml += `${indent}</sch:Appointment>\n`;
        }

        // Patient (required)
        if (data.Patient || data.patientId) {
          xml += `${indent}<sch:Patient>\n`;
          if (data.patientId || data.Patient?.PatientID) {
            xml += `${indent}  <sch:PatientID>${this.xmlEscape(String(data.patientId || data.Patient.PatientID))}</sch:PatientID>\n`;
          }
          if (data.Patient?.FirstName) xml += `${indent}  <sch:FirstName>${this.xmlEscape(data.Patient.FirstName)}</sch:FirstName>\n`;
          if (data.Patient?.LastName) xml += `${indent}  <sch:LastName>${this.xmlEscape(data.Patient.LastName)}</sch:LastName>\n`;
          xml += `${indent}</sch:Patient>\n`;
        }

        // Case (required)
        if (data.Case || data.caseId || data.caseName) {
          xml += `${indent}<sch:Case>\n`;
          if (data.caseId || data.Case?.CaseID) {
            xml += `${indent}  <sch:CaseID>${this.xmlEscape(String(data.caseId || data.Case.CaseID))}</sch:CaseID>\n`;
          }
          if (data.caseName || data.Case?.CaseName) {
            xml += `${indent}  <sch:CaseName>${this.xmlEscape(data.caseName || data.Case.CaseName)}</sch:CaseName>\n`;
          }
          if (data.payerScenario || data.Case?.CasePayerScenario) {
            xml += `${indent}  <sch:CasePayerScenario>${this.xmlEscape(data.payerScenario || data.Case.CasePayerScenario)}</sch:CasePayerScenario>\n`;
          }
          xml += `${indent}</sch:Case>\n`;
        }

        // Service Start/End Date (required)
        if (data.serviceStartDate) {
          xml += `${indent}<sch:ServiceStartDate>${this.xmlEscape(data.serviceStartDate)}</sch:ServiceStartDate>\n`;
        }
        if (data.serviceEndDate) {
          xml += `${indent}<sch:ServiceEndDate>${this.xmlEscape(data.serviceEndDate)}</sch:ServiceEndDate>\n`;
        }

        // Post Date (required)
        if (data.postDate) {
          xml += `${indent}<sch:PostDate>${this.xmlEscape(data.postDate)}</sch:PostDate>\n`;
        }

        // Service Lines (required) - This is where charges are created
        if (data.serviceLines && Array.isArray(data.serviceLines) && data.serviceLines.length > 0) {
          xml += `${indent}<sch:ServiceLines>\n`;
          data.serviceLines.forEach((line) => {
            xml += `${indent}  <sch:ServiceLine>\n`;
            if (line.procedureCode) xml += `${indent}    <sch:ProcedureCode>${this.xmlEscape(line.procedureCode)}</sch:ProcedureCode>\n`;
            if (line.diagnosisCode1) xml += `${indent}    <sch:DiagnosisCode1>${this.xmlEscape(line.diagnosisCode1)}</sch:DiagnosisCode1>\n`;
            if (line.units) xml += `${indent}    <sch:Units>${this.xmlEscape(String(line.units))}</sch:Units>\n`;
            if (line.unitCharge !== undefined) xml += `${indent}    <sch:UnitCharge>${this.xmlEscape(String(line.unitCharge))}</sch:UnitCharge>\n`;
            xml += `${indent}  </sch:ServiceLine>\n`;
          });
          xml += `${indent}</sch:ServiceLines>\n`;
        }

        return xml;
      };

      const encounterXml = buildEncounterXml(encounterData);
      
      const soapXml = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sch="http://www.kareo.com/api/schemas/">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:CreateEncounter>
      <sch:request>
        <sch:RequestHeader>
          <sch:CustomerKey>${this.xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${this.xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${this.xmlEscape(auth.User)}</sch:User>
        </sch:RequestHeader>
        <sch:Encounter>
${encounterXml}        </sch:Encounter>
      </sch:request>
    </sch:CreateEncounter>
  </soapenv:Body>
</soapenv:Envelope>`;

      const { data } = await axios.post(
        this.soapEndpoint,
        soapXml,
        {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': '"http://www.kareo.com/api/schemas/KareoServices/CreateEncounter"'
          }
        }
      );

      // Parse response
      const encounterIdMatch = String(data).match(/<EncounterID>(.*?)<\/EncounterID>/i);
      const encounterId = encounterIdMatch ? encounterIdMatch[1] : null;

      return {
        encounterId,
        success: !!encounterId,
        raw: data
      };
    } catch (error) {
      console.error('❌ [TEBRA] Error creating encounter:', error.message);
      throw error;
    }
  }

  /**
   * Get Encounter Details
   * Reference: Official API Guide Section 4.5
   */
  async getEncounterDetails(encounterId, practiceId) {
    try {
      const auth = this.getAuthHeader();
      
      const soapXml = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sch="http://www.kareo.com/api/schemas/">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:GetEncounterDetails>
      <sch:request>
        <sch:RequestHeader>
          <sch:CustomerKey>${this.xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${this.xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${this.xmlEscape(auth.User)}</sch:User>
        </sch:RequestHeader>
        <sch:PracticeID>${this.xmlEscape(String(practiceId))}</sch:PracticeID>
        <sch:PracticeName>${this.xmlEscape(this.practiceName)}</sch:PracticeName>
        <sch:EncounterID>${this.xmlEscape(String(encounterId))}</sch:EncounterID>
      </sch:request>
    </sch:GetEncounterDetails>
  </soapenv:Body>
</soapenv:Envelope>`;

      const { data } = await axios.post(
        this.soapEndpoint,
        soapXml,
        {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': '"http://www.kareo.com/api/schemas/KareoServices/GetEncounterDetails"'
          }
        }
      );

      return this.parseRawSOAPResponse(data, 'GetEncounterDetails');
    } catch (error) {
      console.error('❌ [TEBRA] Error getting encounter details:', error.message);
      throw error;
    }
  }

  /**
   * Update Encounter Status
   * Reference: Official API Guide Section 4.20
   */
  async updateEncounterStatus(encounterId, status, practiceId) {
    try {
      const auth = this.getAuthHeader();
      
      const soapXml = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sch="http://www.kareo.com/api/schemas/">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:UpdateEncounterStatus>
      <sch:request>
        <sch:RequestHeader>
          <sch:CustomerKey>${this.xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${this.xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${this.xmlEscape(auth.User)}</sch:User>
        </sch:RequestHeader>
        <sch:Practice>
          <sch:PracticeID>${this.xmlEscape(String(practiceId))}</sch:PracticeID>
        </sch:Practice>
        <sch:EncounterID>${this.xmlEscape(String(encounterId))}</sch:EncounterID>
        <sch:EncounterStatus>${this.xmlEscape(status)}</sch:EncounterStatus>
      </sch:request>
    </sch:UpdateEncounterStatus>
  </soapenv:Body>
</soapenv:Envelope>`;

      const { data } = await axios.post(
        this.soapEndpoint,
        soapXml,
        {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': '"http://www.kareo.com/api/schemas/KareoServices/UpdateEncounterStatus"'
          }
        }
      );

      return this.parseRawSOAPResponse(data, 'UpdateEncounterStatus');
    } catch (error) {
      console.error('❌ [TEBRA] Error updating encounter status:', error.message);
      throw error;
    }
  }

  // ============================================
  // BILLING OPERATIONS (Official API Methods)
  // ============================================

  /**
   * Get Charges
   * Reference: Official API Guide Section 4.4
   */
  async getCharges(options = {}) {
    try {
      const filters = {
        PracticeName: options.practiceName || this.practiceName,
        ...(options.fromCreatedDate && { FromCreatedDate: options.fromCreatedDate }),
        ...(options.toCreatedDate && { ToCreatedDate: options.toCreatedDate }),
        ...(options.patientId && { PatientID: String(options.patientId) }),
        ...(options.patientName && { PatientName: options.patientName })
      };

      return await this.callRawSOAPMethod('GetCharges', {}, filters);
    } catch (error) {
      this.handleSOAPError(error, 'GetCharges', { options });
    }
  }

  /**
   * Get Payments
   * Reference: Official API Guide Section 4.8
   */
  async getPayments(options = {}) {
    try {
      const filters = {
        ...(options.practiceId && { PracticeID: String(options.practiceId) }),
        ...(options.practiceName && { PracticeName: options.practiceName }),
        ...(options.patientId && { PatientID: String(options.patientId) }),
        ...(options.fromPostDate && { FromPostDate: options.fromPostDate }),
        ...(options.toPostDate && { ToPostDate: options.toPostDate })
      };

      return await this.callRawSOAPMethod('GetPayments', {}, filters);
    } catch (error) {
      this.handleSOAPError(error, 'GetPayments', { options });
    }
  }

  /**
   * Create Payments (Official method - plural)
   * Reference: Official API Guide Section 4.18
   */
  async createPayments(paymentData) {
    try {
      const auth = this.getAuthHeader();
      const practiceId = paymentData.practiceId || paymentData.Practice?.PracticeID;
      const practiceName = paymentData.practiceName || paymentData.Practice?.PracticeName;
      
      const buildPaymentXml = (data, indent = '         ') => {
        let xml = '';
        
        // Practice (optional but recommended)
        if (practiceId || practiceName) {
          xml += `${indent}<sch:Practice>\n`;
          if (practiceId) xml += `${indent}  <sch:PracticeID>${this.xmlEscape(String(practiceId))}</sch:PracticeID>\n`;
          if (practiceName) xml += `${indent}  <sch:PracticeName>${this.xmlEscape(practiceName)}</sch:PracticeName>\n`;
          xml += `${indent}</sch:Practice>\n`;
        }

        // Patient (required)
        if (data.Patient || data.patientId) {
          xml += `${indent}<sch:Patient>\n`;
          if (data.patientId || data.Patient?.PatientID) {
            xml += `${indent}  <sch:PatientID>${this.xmlEscape(String(data.patientId || data.Patient.PatientID))}</sch:PatientID>\n`;
          }
          if (data.Patient?.FirstName) xml += `${indent}  <sch:FirstName>${this.xmlEscape(data.Patient.FirstName)}</sch:FirstName>\n`;
          if (data.Patient?.LastName) xml += `${indent}  <sch:LastName>${this.xmlEscape(data.Patient.LastName)}</sch:LastName>\n`;
          xml += `${indent}</sch:Patient>\n`;
        }

        // Insurance (optional)
        if (data.Insurance || data.companyPlanId || data.companyPlanName) {
          xml += `${indent}<sch:Insurance>\n`;
          if (data.companyPlanId || data.Insurance?.CompanyPlanID) {
            xml += `${indent}  <sch:CompanyPlanID>${this.xmlEscape(String(data.companyPlanId || data.Insurance.CompanyPlanID))}</sch:CompanyPlanID>\n`;
          }
          if (data.companyPlanName || data.Insurance?.CompanyPlanName) {
            xml += `${indent}  <sch:CompanyPlanName>${this.xmlEscape(data.companyPlanName || data.Insurance.CompanyPlanName)}</sch:CompanyPlanName>\n`;
          }
          xml += `${indent}</sch:Insurance>\n`;
        }

        // Payment (required)
        xml += `${indent}<sch:Payment>\n`;
        if (data.amountPaid !== undefined) xml += `${indent}  <sch:AmountPaid>${this.xmlEscape(String(data.amountPaid))}</sch:AmountPaid>\n`;
        if (data.paymentMethod) xml += `${indent}  <sch:PaymentMethod>${this.xmlEscape(data.paymentMethod)}</sch:PaymentMethod>\n`;
        if (data.referenceNumber) xml += `${indent}  <sch:ReferenceNumber>${this.xmlEscape(data.referenceNumber)}</sch:ReferenceNumber>\n`;
        if (data.postDate) xml += `${indent}  <sch:PostDate>${this.xmlEscape(data.postDate)}</sch:PostDate>\n`;
        if (data.payerType) xml += `${indent}  <sch:PayerType>${this.xmlEscape(data.payerType)}</sch:PayerType>\n`;
        xml += `${indent}</sch:Payment>\n`;

        return xml;
      };

      const paymentXml = buildPaymentXml(paymentData);
      
      const soapXml = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sch="http://www.kareo.com/api/schemas/">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:CreatePayments>
      <sch:request>
        <sch:RequestHeader>
          <sch:CustomerKey>${this.xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${this.xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${this.xmlEscape(auth.User)}</sch:User>
        </sch:RequestHeader>
        <sch:Payment>
${paymentXml}        </sch:Payment>
      </sch:request>
    </sch:CreatePayments>
  </soapenv:Body>
</soapenv:Envelope>`;

      const { data } = await axios.post(
        this.soapEndpoint,
        soapXml,
        {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': '"http://www.kareo.com/api/schemas/KareoServices/CreatePayments"'
          }
        }
      );

      // Parse response
      const paymentIdMatch = String(data).match(/<PaymentID>(.*?)<\/PaymentID>/i);
      const paymentId = paymentIdMatch ? paymentIdMatch[1] : null;

      return {
        paymentId,
        success: !!paymentId,
        raw: data
      };
    } catch (error) {
      console.error('❌ [TEBRA] Error creating payment:', error.message);
      throw error;
    }
  }

  // ============================================
  // SERVICE LOCATIONS
  // ============================================

  /**
   * Get Service Locations
   * Reference: Official API Guide Section 4.12
   */
  async getServiceLocations(options = {}) {
    try {
      const filters = {
        PracticeName: options.practiceName || this.practiceName,
        PracticeId: String(options.practiceId || process.env.TEBRA_PRACTICE_ID || ''),
        ...(options.id && { ID: String(options.id) })
      };

      // GetServiceLocations requires non-empty Fields to avoid DeserializationFailed
      const fields = { ID: 1, Name: 1 };
      return await this.callRawSOAPMethod('GetServiceLocations', fields, filters);
    } catch (error) {
      this.handleSOAPError(error, 'GetServiceLocations', { options });
    }
  }

  // ============================================
  // PROCEDURE CODES
  // ============================================

  /**
   * Get Procedure Codes
   * Reference: Official API Guide Section 4.10
   */
  async getProcedureCode(options = {}) {
    try {
      const filters = {
        ...(options.id && { ID: String(options.id) }),
        ...(options.procedureCode && { ProcedureCode: options.procedureCode }),
        ...(options.active !== undefined && { Active: options.active })
      };
      const fields = {
        ProcedureCode: 1,
        OfficialName: 1,
        OfficialDescription: 1,
        ID: 1,
        Active: 1
      };
      return await this.callRawSOAPMethod('GetProcedureCodes', fields, filters);
    } catch (error) {
      this.handleSOAPError(error, 'GetProcedureCodes', { options });
    }
  }

  // ============================================
  // TRANSACTIONS
  // ============================================

  /**
   * Get Transactions
   * Reference: Official API Guide Section 4.13
   */
  async getTransactions(options = {}) {
    try {
      const filters = {
        PracticeName: options.practiceName || this.practiceName,
        ...(options.fromTransactionDate && { FromTransactionDate: options.fromTransactionDate }),
        ...(options.toTransactionDate && { ToTransactionDate: options.toTransactionDate }),
        ...(options.patientId && { PatientID: String(options.patientId) })
      };

      return await this.callRawSOAPMethod('GetTransactions', {}, filters);
    } catch (error) {
      this.handleSOAPError(error, 'GetTransactions', { options });
    }
  }

  // ============================================
  // PATIENT CASE MANAGEMENT
  // ============================================

  /**
   * Update Primary Patient Case
   * Reference: Official API Guide Section 4.22
   */
  async updatePrimaryPatientCase(patientCaseId) {
    try {
      const auth = this.getAuthHeader();
      
      const soapXml = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sch="http://www.kareo.com/api/schemas/">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:UpdatePrimaryPatientCase>
      <sch:request>
        <sch:RequestHeader>
          <sch:CustomerKey>${this.xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${this.xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${this.xmlEscape(auth.User)}</sch:User>
        </sch:RequestHeader>
        <sch:PatientCaseID>${this.xmlEscape(String(patientCaseId))}</sch:PatientCaseID>
      </sch:request>
    </sch:UpdatePrimaryPatientCase>
  </soapenv:Body>
</soapenv:Envelope>`;

      const { data } = await axios.post(
        this.soapEndpoint,
        soapXml,
        {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': '"http://www.kareo.com/api/schemas/KareoServices/UpdatePrimaryPatientCase"'
          }
        }
      );

      const successMatch = String(data).match(/<Success>(.*?)<\/Success>/i);
      const success = successMatch ? successMatch[1].toLowerCase() === 'true' : false;

      return {
        success,
        raw: data
      };
    } catch (error) {
      console.error('❌ [TEBRA] Error updating primary patient case:', error.message);
      throw error;
    }
  }

  // Helper method for XML escaping
  xmlEscape(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

Object.assign(TebraService.prototype, tebraNormalizers, tebraSoapParsing);

// Export both the class and an instance for flexibility
const tebraServiceInstance = new TebraService();

// Document APIs with local database workaround
// NOTE: KareoServices SOAP 2.1 does NOT expose document-listing or document-download operations
// (WSDL includes CreateDocument/DeleteDocument only). We store document metadata locally
// when creating documents, so we can retrieve them even though Tebra doesn't support listing.
tebraServiceInstance.getDocuments = async function({ patientId, label, name }) {
  if (!patientId) throw new Error('patientId is required');
  
  try {
    const documentService = require('./tebraDocumentService');
    try {
      await documentService.initialize(); // Ensure table exists
    } catch (initError) {
      // If initialization fails due to connection error, that's okay - we'll return empty list
      const isConnectionError = initError.message && (
        initError.message.includes('ECONNREFUSED') || 
        initError.message.includes('connect') ||
        initError.code === 'ECONNREFUSED'
      );
      if (isConnectionError) {
        return { documents: [] };
      }
      throw initError;
    }
    
    const documents = await documentService.getDocumentsForPatient({ patientId, label, name });
    
    // Transform database records to match expected format
    const transformed = documents.map(doc => ({
      id: doc.tebra_document_id || doc.id,
      documentId: doc.tebra_document_id || doc.id,
      patientId: doc.patient_id,
      practiceId: doc.practice_id,
      name: doc.name,
      fileName: doc.file_name,
      label: doc.label,
      status: doc.status,
      documentDate: doc.document_date,
      createdAt: doc.created_at,
      notes: doc.document_notes,
      fileSize: doc.file_size_bytes,
      mimeType: doc.mime_type,
      // Include fileContent if available (for backward compatibility)
      fileContent: doc.file_content_base64 || null
    }));
    
    return { documents: transformed };
  } catch (error) {
    // Check if it's a database connection error
    const isConnectionError = error.message && (
      error.message.includes('ECONNREFUSED') || 
      error.message.includes('connect') ||
      error.code === 'ECONNREFUSED'
    );
    
    if (isConnectionError) {
      // Don't log connection errors as errors - they're expected if DB is not running
      // The calling code can handle this gracefully
    } else {
      console.error('❌ [TEBRA] Error getting documents from local database:', error.message);
    }
    // Fallback to empty list if database query fails
    return { documents: [] };
  }
};

tebraServiceInstance.getDocumentContent = async function(documentId) {
  if (!documentId) throw new Error('documentId is required');
  
  try {
    const documentService = require('./tebraDocumentService');
    await documentService.initialize(); // Ensure table exists
    
    const doc = await documentService.getDocumentContent(documentId);
    
    if (!doc) {
      return { 
        fileName: `document-${documentId}.pdf`, 
        mimeType: 'application/pdf', 
        base64Content: null 
      };
    }
    
    // Return document content in expected format
    return {
      id: doc.tebra_document_id || doc.id,
      documentId: doc.tebra_document_id || doc.id,
      patientId: doc.patient_id,
      practiceId: doc.practice_id,
      fileName: doc.file_name,
      name: doc.name,
      label: doc.label,
      status: doc.status,
      documentDate: doc.document_date,
      notes: doc.document_notes,
      mimeType: doc.mime_type || 'application/json',
      base64Content: doc.file_content_base64 || null,
      fileSize: doc.file_size_bytes
    };
  } catch (error) {
    console.error('❌ [TEBRA] Error getting document content from local database:', error.message);
    // Fallback to null content if database query fails
    return { 
      fileName: `document-${documentId}.pdf`, 
      mimeType: 'application/pdf', 
      base64Content: null 
    };
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
