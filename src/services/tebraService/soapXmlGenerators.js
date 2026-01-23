// backend/src/services/tebraService/soapXmlGenerators.js
// SOAP XML generation for specific Tebra methods

const { xmlEscape } = require('./soapUtils');

/**
 * Generate raw SOAP XML for generic methods
 * @param {string} methodName - SOAP method name
 * @param {Object} fields - Fields to include
 * @param {Object} filters - Filters to apply
 * @param {Object} auth - Authentication header
 * @returns {string} SOAP XML string
 */
function generateRawSOAPXML(methodName, fields = {}, filters = {}, auth) {
  // Build fields XML - match the working template exactly (with XML escaping)
  const fieldsXml = Object.keys(fields).length > 0 ? 
    Object.keys(fields).map(key => 
      `          <sch:${key}>${xmlEscape(String(fields[key]))}</sch:${key}>`
    ).join('\n') : '';
  
  // Build filters XML - match the working template exactly (with XML escaping)
  // Filter out undefined/null values to prevent API errors
  const validFilters = Object.keys(filters).length > 0 ?
    Object.keys(filters).filter(key => 
      filters[key] !== undefined && filters[key] !== null && filters[key] !== ''
    ) : [];
  
  const filtersXml = validFilters.length > 0 ?
    validFilters.map(key =>
      `          <sch:${key}>${xmlEscape(String(filters[key]))}</sch:${key}>`
    ).join('\n') : '';
  
  // Return raw SOAP XML string exactly like the working client
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sch="http://www.kareo.com/api/schemas/">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:${methodName}>
      <sch:request>
        <sch:RequestHeader>
          <sch:CustomerKey>${xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${xmlEscape(auth.User)}</sch:User>
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

/**
 * Generate CreatePatient SOAP XML with proper structure
 * @param {Object} patientData - Patient data object
 * @param {Object} auth - Authentication header
 * @returns {string} SOAP XML string
 */
function generateCreatePatientSOAPXML(patientData, auth) {
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
        // Handle simple values - escape XML special characters using helper method
        const escapedValue = xmlEscape(String(value));
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
          <sch:CustomerKey>${xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${xmlEscape(auth.User)}</sch:User>
        </sch:RequestHeader>
        <sch:Patient>
${patientXml}        </sch:Patient>
      </sch:request>
    </sch:CreatePatient>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Generate CreateAppointment SOAP XML with proper structure and field ordering
 * @param {Object} appointmentData - Appointment data object
 * @param {Object} auth - Authentication header
 * @returns {string} SOAP XML string
 */
function generateCreateAppointmentSOAPXML(appointmentData, auth) {
  // Define the required field order for CreateAppointment based on API documentation
  // IMPORTANT: Tebra has strict field ordering requirements:
  // - PracticeId must come before StartTime and EndTime
  // - EndTime must come after CustomerId and before ForRecare
  // - StartTime must come after PracticeId
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
    'EndTime', // Must come after CustomerId and before ForRecare
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
    'PracticeId', // Must come before StartTime
    'ProviderId',
    'RecurrenceRule',
    'ResourceId',
    'ResourceIds',
    'ServiceLocationId',
    'StartTime', // Must come after PracticeId
    'UpdatedAt',
    'UpdatedBy',
    'WasCreatedOnline'
  ];
  
  /**
   * Recursively build appointment XML with strict field ordering
   * 
   * Tebra SOAP API has strict requirements for field ordering in XML:
   * - PracticeId must appear before StartTime
   * - EndTime must appear after CustomerId and before ForRecare
   * - ProviderId should appear before StartTime
   * 
   * This function ensures fields are generated in the correct order by:
   * 1. Processing fields in requiredFieldOrder first (ensures critical ordering)
   * 2. Handling nested objects recursively (PatientSummary, RecurrenceRule, etc.)
   * 3. Handling arrays with proper XML structure (PatientSummaries, ResourceIds)
   * 4. Converting Date objects to ISO 8601 strings
   * 5. Escaping XML special characters
   * 6. Skipping null/undefined/empty values appropriately
   * 
   * @param {Object} data - Appointment data object
   * @param {string} indent - XML indentation string (for formatting)
   * @returns {string} XML string for appointment element
   */
  const buildAppointmentXml = (data, indent = '         ') => {
    // Handle null or undefined data gracefully
    if (!data || typeof data !== 'object') {
      return '';
    }
    
    let xml = '';
    
    // PHASE 1: Process fields in required order (critical for Tebra API compliance)
    // This ensures PracticeId appears before StartTime, etc.
    for (const key of requiredFieldOrder) {
      const value = data[key];
      
      // Skip undefined or empty string values (but handle null separately for some fields)
      if (value === undefined || value === '') {
        // Special warning for PracticeId - it's critical and missing it causes API errors
        if (key === 'PracticeId') {
          const hasPracticeId = data.PracticeId !== undefined || data.practiceId !== undefined || data.PracticeID !== undefined;
          if (!hasPracticeId) {
            console.warn(`⚠️ [TEBRA] PracticeId is undefined or empty - this will cause errors!`);
          }
        }
        continue;
      }
      
      // Skip null values for ID fields that should be integers (Tebra rejects null IDs)
      // These fields must either have a value or be omitted entirely
      const skipNullFields = [
        'AppointmentId', 'AppointmentReasonId', 'AppointmentUUID', 'OccurrenceId', 'PatientCaseId', 
        'InsurancePolicyAuthorizationId', 'CreatedBy', 'CustomerId', 'UpdatedBy',
        'Notes', 'DateOfBirth'
      ];
      if (value === null && skipNullFields.includes(key)) continue;
      
      // Order-critical fields can be null (they're optional) but must maintain position
      // If null, we skip them to avoid sending empty XML elements
      const orderCriticalFields = ['ResourceId', 'ResourceIds', 'RecurrenceRule'];
      if (orderCriticalFields.includes(key) && value === null) {
        continue; // Skip null optional fields
      }
      
      // DateTime fields (StartTime, EndTime) are required - log warning if empty
      if ((key === 'StartTime' || key === 'EndTime') && (!value || value === '')) {
        console.log(`⚠️ Skipping empty DateTime field: ${key} = "${value}"`);
        continue;
      }
      
      // Handle different value types
      if (Array.isArray(value)) {
        // Arrays: PatientSummaries (group appointments), ResourceIds, etc.
        if (value.length > 0) {
          xml += `${indent}<sch:${key}>\n`;
          for (const item of value) {
            if (typeof item === 'object') {
              // Complex array items: wrap in GroupPatientSummary for PatientSummaries
              xml += `${indent}   <sch:GroupPatientSummary>\n`;
              xml += buildAppointmentXml(item, indent + '      '); // Recursive call
              xml += `${indent}   </sch:GroupPatientSummary>\n`;
            } else {
              // Simple array items: use arr:long namespace for ResourceIds
              xml += `${indent}   <arr:long>${item}</arr:long>\n`;
            }
          }
          xml += `${indent}</sch:${key}>\n`;
        }
      } else if (typeof value === 'object' && !(value instanceof Date)) {
        // Nested objects: PatientSummary, RecurrenceRule, etc.
        // Recursively build XML for nested structure
        xml += `${indent}<sch:${key}>\n`;
        xml += buildAppointmentXml(value, indent + '   '); // Recursive call with increased indent
        xml += `${indent}</sch:${key}>\n`;
      } else {
        // Simple values: strings, numbers, Date objects
        // Special handling for DateTime fields - Tebra requires ISO 8601 format
        if (key === 'StartTime' || key === 'EndTime' || key === 'CreatedAt' || key === 'UpdatedAt') {
          let dateValue;
          if (value instanceof Date) {
            // Date object: convert to ISO 8601 string
            dateValue = value.toISOString();
          } else if (typeof value === 'string') {
            // String: try to parse and reformat to ISO 8601
            try {
              const parsed = new Date(value);
              if (!isNaN(parsed.getTime())) {
                dateValue = parsed.toISOString();
              } else {
                dateValue = value; // Use as-is if parsing fails (may already be ISO format)
              }
            } catch (e) {
              dateValue = value; // Use as-is if parsing fails
            }
          } else {
            dateValue = value === null ? '' : String(value);
          }
          // Log DateTime values for debugging (critical fields)
          if (key === 'StartTime' || key === 'EndTime') {
            console.log(`🔍 [TEBRA] DateTime field ${key}: ${dateValue} (original: ${value}, type: ${typeof value})`);
          }
          xml += `${indent}<sch:${key}>${dateValue}</sch:${key}>\n`;
        } else {
          // Non-datetime fields: convert Date objects to ISO string, handle null
          const finalValue = value instanceof Date ? value.toISOString() : (value === null ? '' : value);
          xml += `${indent}<sch:${key}>${finalValue}</sch:${key}>\n`;
        }
      }
    }
    
    // PHASE 2: Process any remaining fields not in requiredFieldOrder
    // These are additional fields that may be present but don't have strict ordering requirements
    for (const [key, value] of Object.entries(data)) {
      if (requiredFieldOrder.includes(key)) continue; // Skip already processed fields
      
      // Apply same filtering logic as Phase 1
      if (value === undefined || value === '') continue;
      
      const skipNullFields = [
        'AppointmentId', 'AppointmentReasonId', 'AppointmentUUID', 'OccurrenceId', 'PatientCaseId', 
        'ResourceId', 'InsurancePolicyAuthorizationId', 'CreatedBy', 'CustomerId', 'UpdatedBy',
        'Notes', 'ResourceIds', 'DateOfBirth', 'ProviderId', 'ServiceLocationId'
      ];
      if (value === null && skipNullFields.includes(key)) continue;
      
      // Handle arrays, objects, and simple values (same logic as Phase 1)
      if (Array.isArray(value)) {
        if (value.length > 0) {
          xml += `${indent}<sch:${key}>\n`;
          for (const item of value) {
            if (typeof item === 'object') {
              xml += `${indent}   <sch:GroupPatientSummary>\n`;
              xml += buildAppointmentXml(item, indent + '      ');
              xml += `${indent}   </sch:GroupPatientSummary>\n`;
            } else {
              xml += `${indent}   <arr:long>${item}</arr:long>\n`;
            }
          }
          xml += `${indent}</sch:${key}>\n`;
        }
      } else if (typeof value === 'object') {
        xml += `${indent}<sch:${key}>\n`;
        xml += buildAppointmentXml(value, indent + '   ');
        xml += `${indent}</sch:${key}>\n`;
      } else {
        const finalValue = value instanceof Date ? value.toISOString() : (value === null ? '' : value);
        xml += `${indent}<sch:${key}>${finalValue}</sch:${key}>\n`;
      }
    }
    
    return xml;
  };
  
  const appointmentXml = buildAppointmentXml(appointmentData);
  
  // Log the field order in the generated XML for debugging
  const fieldOrderInXml = [];
  const fieldMatches = appointmentXml.match(/<sch:(\w+)>/g);
  if (fieldMatches) {
    fieldMatches.forEach(match => {
      const fieldName = match.replace(/<sch:|>/g, '');
      if (!fieldOrderInXml.includes(fieldName)) {
        fieldOrderInXml.push(fieldName);
      }
    });
    console.log(`🔍 [TEBRA] Field order in generated XML: ${fieldOrderInXml.join(' -> ')}`);
    // Check if StartTime appears before the required fields
    const startTimeIndex = fieldOrderInXml.indexOf('StartTime');
    const practiceIdIndex = fieldOrderInXml.indexOf('PracticeId');
    if (startTimeIndex !== -1 && practiceIdIndex !== -1) {
      console.log(`🔍 [TEBRA] PracticeId at index ${practiceIdIndex}, StartTime at index ${startTimeIndex}`);
      if (startTimeIndex <= practiceIdIndex + 1) {
        console.warn(`⚠️ [TEBRA] StartTime appears too early! Expected ProviderId/ResourceId/etc. between PracticeId and StartTime`);
      }
    }
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
          <sch:CustomerKey>${xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${xmlEscape(auth.User)}</sch:User>
        </sch:RequestHeader>
        <sch:Appointment>
${appointmentXml}        </sch:Appointment>
      </sch:request>
    </sch:CreateAppointment>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Generate GetAppointment SOAP XML
 * @param {Object} appointmentData - Appointment data object
 * @param {Object} auth - Authentication header
 * @returns {string} SOAP XML string
 */
function generateGetAppointmentSOAPXML(appointmentData, auth) {
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
        const escapedValue = xmlEscape(String(value));
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
          <sch:CustomerKey>${xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${xmlEscape(auth.User)}</sch:User>
        </sch:RequestHeader>
${appointmentXml}
      </sch:request>
    </sch:GetAppointment>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Generate DeleteAppointment SOAP XML
 * @param {Object} appointmentData - Appointment data object
 * @param {Object} auth - Authentication header
 * @returns {string} SOAP XML string
 */
function generateDeleteAppointmentSOAPXML(appointmentData, auth) {
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
        const escapedValue = xmlEscape(String(value));
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
          <sch:CustomerKey>${xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${xmlEscape(auth.User)}</sch:User>
        </sch:RequestHeader>
${appointmentXml}
      </sch:request>
    </sch:DeleteAppointment>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Generate UpdateAppointment SOAP XML
 * @param {Object} appointmentData - Appointment data object
 * @param {Object} auth - Authentication header
 * @returns {string} SOAP XML string
 */
function generateUpdateAppointmentSOAPXML(appointmentData, auth) {
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
        const escapedValue = xmlEscape(String(value));
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
          <sch:CustomerKey>${xmlEscape(auth.CustomerKey)}</sch:CustomerKey>
          <sch:Password>${xmlEscape(auth.Password)}</sch:Password>
          <sch:User>${xmlEscape(auth.User)}</sch:User>
        </sch:RequestHeader>
${appointmentXml}
      </sch:request>
    </sch:UpdateAppointment>
  </soapenv:Body>
</soapenv:Envelope>`;
}

module.exports = {
  generateRawSOAPXML,
  generateCreatePatientSOAPXML,
  generateCreateAppointmentSOAPXML,
  generateGetAppointmentSOAPXML,
  generateDeleteAppointmentSOAPXML,
  generateUpdateAppointmentSOAPXML
};
