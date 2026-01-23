// backend/src/services/tebraService/soapUtils.js
// SOAP XML generation and parsing utilities

/**
 * Escape XML special characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function xmlEscape(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Clean request data by removing null/undefined/empty values
 * @param {*} obj - Object to clean
 */
function cleanRequestData(obj) {
  if (obj === null || obj === undefined) return;
  
  if (Array.isArray(obj)) {
    for (let i = obj.length - 1; i >= 0; i--) {
      if (obj[i] === null || obj[i] === undefined || obj[i] === '') {
        obj.splice(i, 1);
      } else {
        cleanRequestData(obj[i]);
      }
    }
  } else if (typeof obj === 'object') {
    for (const key in obj) {
      if (obj[key] === null || obj[key] === undefined || obj[key] === '') {
        delete obj[key];
      } else {
        cleanRequestData(obj[key]);
      }
    }
  }
}

/**
 * Unwrap SOAP response object
 * node-soap often returns { MethodResult: {...} }
 * @param {Object} obj - Response object
 * @returns {Object} Unwrapped object
 */
function unwrap(obj) {
  if (!obj) return {};
  const keys = Object.keys(obj || {});
  if (keys.length === 1 && keys[0].toLowerCase().includes('result')) {
    const result = obj[keys[0]] || {};
    return result;
  }
  return obj;
}

/**
 * Parse raw SOAP XML response
 * @param {string} xmlResponse - Raw XML response string
 * @param {string} methodName - SOAP method name
 * @returns {Object} Parsed response object
 */
function parseRawSOAPResponse(xmlResponse, methodName) {
  try {
    // Extract the result from the XML response using a more robust approach
    const resultMatch = xmlResponse.match(new RegExp(`<${methodName}Result[^>]*>(.*?)</${methodName}Result>`, 's'));
    if (resultMatch) {
      const resultXml = resultMatch[1];
      
      // Special handling for different method responses
      if (methodName === 'CreatePatient') {
        return parseCreatePatientResponse(resultXml, methodName);
      }
      
      if (methodName === 'CreateAppointment') {
        return parseCreateAppointmentResponse(resultXml, methodName);
      }
      
      if (methodName === 'DeleteAppointment') {
        return parseDeleteAppointmentResponse(resultXml, methodName);
      }
      
      if (methodName === 'UpdateAppointment') {
        return parseUpdateAppointmentResponse(resultXml, methodName);
      }
      
      if (methodName === 'GetPractices') {
        return parseGetPracticesResponse(resultXml, methodName);
      }
      
      if (methodName === 'GetProviders') {
        return parseGetProvidersResponse(resultXml, methodName);
      }
      
      if (methodName === 'GetPatients') {
        return parseGetPatientsResponse(resultXml, methodName);
      }
      
      if (methodName === 'GetAppointments') {
        return parseGetAppointmentsResponse(resultXml, methodName);
      }
      
      if (methodName === 'GetAppointment') {
        return parseGetAppointmentResponse(resultXml, methodName);
      }
      
      // Default handling for other methods
      return {
        [`${methodName}Result`]: {
          rawXml: resultXml
        }
      };
    }
    
    // If no result found, return empty structure
    console.warn(`⚠️ [TEBRA] No result found in XML response for ${methodName}`);
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

/**
 * Parse CreatePatient response
 */
function parseCreatePatientResponse(resultXml, methodName) {
  const patient = {};
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

/**
 * Parse CreateAppointment response
 */
function parseCreateAppointmentResponse(resultXml, methodName) {
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

/**
 * Parse DeleteAppointment response
 */
function parseDeleteAppointmentResponse(resultXml, methodName) {
  const successMatch = resultXml.match(/<Success>([^<]+)<\/Success>/i);
  const success = successMatch ? successMatch[1].toLowerCase() === 'true' : false;

  const idMatch = resultXml.match(/<AppointmentId>([^<]+)<\/AppointmentId>/i) || 
                  resultXml.match(/<AppointmentID>([^<]+)<\/AppointmentID>/i) || [];
  const appointmentId = idMatch[1] || null;

  return {
    [`${methodName}Result`]: {
      Success: success,
      AppointmentId: appointmentId,
      rawXml: resultXml
    }
  };
}

/**
 * Parse UpdateAppointment response
 */
function parseUpdateAppointmentResponse(resultXml, methodName) {
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

/**
 * Parse GetPractices response
 */
function parseGetPracticesResponse(resultXml, methodName) {
  const practices = [];
  const practiceMatches = resultXml.match(/<PracticeData[^>]*>(.*?)<\/PracticeData>/gs);
  
  if (practiceMatches) {
    for (const practiceXml of practiceMatches) {
      const practice = {};
      const fieldMatches = practiceXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
      if (fieldMatches) {
        for (const fieldMatch of fieldMatches) {
          const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
          if (fieldNameMatch) {
            const fieldName = fieldNameMatch[1];
            const fieldValue = fieldNameMatch[2];
            practice[fieldName] = fieldValue;
          }
        }
      }
      
      if (Object.keys(practice).length > 0) {
        practices.push(practice);
      }
    }
  }
  
  return {
    [`${methodName}Result`]: {
      Practices: practices,
      TotalCount: practices.length,
      rawXml: resultXml
    }
  };
}

/**
 * Parse GetProviders response
 */
function parseGetProvidersResponse(resultXml, methodName) {
  const providers = [];
  const providerMatches = resultXml.match(/<ProviderData[^>]*>(.*?)<\/ProviderData>/gs);
  
  if (providerMatches) {
    for (const providerXml of providerMatches) {
      const provider = {};
      const fieldMatches = providerXml.match(/<([^>]+)>([^<]*)<\/\1>/g);
      if (fieldMatches) {
        for (const fieldMatch of fieldMatches) {
          const fieldNameMatch = fieldMatch.match(/<([^>]+)>([^<]*)<\/\1>/);
          if (fieldNameMatch) {
            const fieldName = fieldNameMatch[1];
            const fieldValue = fieldNameMatch[2];
            provider[fieldName] = fieldValue;
          }
        }
      }
      
      if (Object.keys(provider).length > 0) {
        providers.push(provider);
      }
    }
  }
  
  return {
    [`${methodName}Result`]: {
      Providers: providers,
      TotalCount: providers.length,
      rawXml: resultXml
    }
  };
}

/**
 * Parse GetPatients response
 */
function parseGetPatientsResponse(resultXml, methodName) {
  const patients = [];
  const patientMatches = resultXml.match(/<PatientData[^>]*>(.*?)<\/PatientData>/gs);
  
  if (patientMatches) {
    for (const patientXml of patientMatches) {
      const patient = {};
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
  
  return {
    [`${methodName}Result`]: {
      Patients: patients,
      TotalCount: patients.length,
      rawXml: resultXml
    }
  };
}

/**
 * Parse GetAppointments response
 */
function parseGetAppointmentsResponse(resultXml, methodName) {
  const appointments = [];
  const appointmentMatches = resultXml.match(/<AppointmentData>(.*?)<\/AppointmentData>/gs);
  
  if (appointmentMatches) {
    for (const appointmentXml of appointmentMatches) {
      const appointment = {};
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
  
  return {
    [`${methodName}Result`]: {
      Appointments: appointments,
      TotalCount: appointments.length,
      rawXml: resultXml
    }
  };
}

/**
 * Parse GetAppointment response
 */
function parseGetAppointmentResponse(resultXml, methodName) {
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

/**
 * Parse SOAP fault from error
 * @param {Error} error - Error object
 * @returns {string|null} Fault message or null
 */
function parseSoapFault(error) {
  try {
    const xml = error?.response?.data || error?.data || '';
    if (typeof xml === 'string' && /Fault/i.test(xml)) {
      const faultStringMatch = xml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
      const faultMsg = faultStringMatch && faultStringMatch[1] ? faultStringMatch[1].trim() : null;
      if (/InternalServiceFault/i.test(xml)) return 'InternalServiceFault';
      return faultMsg;
    }
  } catch (_) {}
  return null;
}

/**
 * Handle SOAP error with enhanced logging
 * @param {Error} error - Error object
 * @param {string} methodName - Method name
 * @param {Object} context - Additional context
 * @throws {Error} Enhanced error
 */
function handleSOAPError(error, methodName, context = {}) {
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

module.exports = {
  xmlEscape,
  cleanRequestData,
  unwrap,
  parseRawSOAPResponse,
  parseSoapFault,
  handleSOAPError
};
