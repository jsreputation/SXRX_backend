// backend/src/services/tebraService/index.js
// Main TebraService class that imports and uses all modular methods
// This provides a unified interface while keeping code organized in separate modules

const SoapClient = require('./soapClient');
const { xmlEscape, cleanRequestData, unwrap, parseRawSOAPResponse, parseSoapFault, handleSOAPError } = require('./soapUtils');
const { 
  generateRawSOAPXML, 
  generateCreatePatientSOAPXML, 
  generateCreateAppointmentSOAPXML,
  generateGetAppointmentSOAPXML,
  generateDeleteAppointmentSOAPXML,
  generateUpdateAppointmentSOAPXML
} = require('./soapXmlGenerators');
const PatientMethods = require('./patientMethods');

/**
 * Main TebraService class
 * Integrates all domain-specific method modules
 */
class TebraService {
  constructor() {
    // Configuration
    this.wsdlUrl = process.env.TEBRA_SOAP_WSDL || process.env.TEBRA_SOAP_ENDPOINT;
    this.soapEndpoint = process.env.TEBRA_SOAP_ENDPOINT || 'https://webservice.kareo.com/services/soap/2.1/KareoServices.svc';
    this.customerKey = process.env.TEBRA_CUSTOMER_KEY;
    this.password = process.env.TEBRA_PASSWORD;
    this.user = process.env.TEBRA_USER;
    this.practiceName = process.env.TEBRA_PRACTICE_NAME;
    this.namespace = process.env.TEBRA_SOAP_NAMESPACE || 'http://www.kareo.com/api/schemas/';
    this.useRawSOAP = process.env.TEBRA_USE_RAW_SOAP !== 'false';
    
    // API rate limiting configuration
    this.batchSize = parseInt(process.env.TEBRA_BATCH_SIZE) || 5;
    this.delayBetweenCalls = parseInt(process.env.TEBRA_DELAY_BETWEEN_CALLS) || 200;
    this.delayBetweenBatches = parseInt(process.env.TEBRA_DELAY_BETWEEN_BATCHES) || 1000;
    this.delayAfterGetIds = parseInt(process.env.TEBRA_DELAY_AFTER_GET_IDS) || 500;

    // Initialize SOAP client
    this.soapClient = new SoapClient({
      wsdlUrl: this.wsdlUrl,
      soapEndpoint: this.soapEndpoint,
      customerKey: this.customerKey,
      password: this.password,
      user: this.user,
      namespace: this.namespace,
      useRawSOAP: this.useRawSOAP
    });

    // Initialize domain-specific method modules
    this.patients = new PatientMethods(this);
    
    // Expose utility methods for backward compatibility
    this.xmlEscape = xmlEscape;
    this.cleanRequestData = cleanRequestData;
    this.unwrap = unwrap;
    this.parseRawSOAPResponse = parseRawSOAPResponse;
    this.parseSoapFault = parseSoapFault;
    this.handleSOAPError = handleSOAPError;
    this.generateRawSOAPXML = (methodName, fields, filters) => {
      return generateRawSOAPXML(methodName, fields, filters, this.getAuthHeader());
    };
  }

  // Connection and authentication methods
  async getClient() {
    return await this.soapClient.getClient();
  }

  async testConnection() {
    return await this.soapClient.testConnection();
  }

  async connect() {
    return await this.soapClient.connect();
  }

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

  getAuthHeader() {
    return this.buildRequestHeader();
  }

  getConfig() {
    return this.soapClient.getConfig();
  }

  // Delegate patient methods to PatientMethods module
  async createPatient(userData) {
    return await this.patients.createPatient(userData);
  }

  async getPatient(patientId, options = {}) {
    return await this.patients.getPatient(patientId, options);
  }

  async updatePatient(patientId, updates) {
    return await this.patients.updatePatient(patientId, updates);
  }

  async deactivatePatient(patientId) {
    return await this.patients.deactivatePatient(patientId);
  }

  async getPatients(options = {}) {
    return await this.patients.getPatients(options);
  }

  async getPatientsBasic(options = {}) {
    return await this.patients.getPatientsBasic(options);
  }

  async getPatientsComplete(options = {}) {
    return await this.patients.getPatientsComplete(options);
  }

  async searchPatients(searchOptions = {}) {
    return await this.patients.searchPatients(searchOptions);
  }

  getPatientFieldsComplete() {
    return this.patients.getPatientFieldsComplete();
  }

  getPatientFieldsBasic() {
    return this.patients.getPatientFieldsBasic();
  }

  mapGenderToTebraEnum(gender) {
    return this.patients.mapGenderToTebraEnum(gender);
  }

  formatPhoneForTebra(phone) {
    return this.patients.formatPhoneForTebra(phone);
  }

  buildPatientData(userData) {
    return this.patients.buildPatientData(userData);
  }

  buildPatientFilters(options) {
    return this.patients.buildPatientFilters(options);
  }

  normalizeCreatePatientResponse(result) {
    return this.patients.normalizeCreatePatientResponse(result);
  }

  normalizeGetPatientResponse(result) {
    return this.patients.normalizeGetPatientResponse(result);
  }

  normalizeGetPatientsResponse(result) {
    return this.patients.normalizeGetPatientsResponse(result);
  }

  normalizePatientData(patient) {
    return this.patients.normalizePatientData(patient);
  }

  // Call raw SOAP method (delegates to soapClient)
  async callRawSOAPMethod(methodName, fields = {}, filters = {}) {
    // Generate SOAP XML
    let soapXml;
    const auth = this.getAuthHeader();
    
    if (methodName === 'CreatePatient') {
      const patientData = typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
      soapXml = generateCreatePatientSOAPXML(patientData, auth);
    } else if (methodName === 'CreateAppointment') {
      const appointmentData = typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
      soapXml = generateCreateAppointmentSOAPXML(appointmentData, auth);
    } else if (methodName === 'GetAppointment') {
      const appointmentData = typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
      soapXml = generateGetAppointmentSOAPXML(appointmentData, auth);
    } else if (methodName === 'DeleteAppointment') {
      const appointmentData = typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
      soapXml = generateDeleteAppointmentSOAPXML(appointmentData, auth);
    } else if (methodName === 'UpdateAppointment') {
      const appointmentData = typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
      soapXml = generateUpdateAppointmentSOAPXML(appointmentData, auth);
    } else {
      soapXml = generateRawSOAPXML(methodName, fields, filters, auth);
    }
    
    return await this.soapClient.callRawSOAPMethod(methodName, soapXml);
  }

  // Generic method caller
  async callMethod(methodName, fields = {}, filters = {}) {
    try {
      console.log(`🚀 Calling Tebra method: ${methodName}`);
      
      if (this.useRawSOAP) {
        const result = await this.callRawSOAPMethod(methodName, fields, filters);
        return parseRawSOAPResponse(result, methodName);
      } else {
        const client = await this.getClient();
        const args = {
          request: {
            RequestHeader: this.buildRequestHeader(),
            Fields: fields,
            Filter: filters
          }
        };
        
        cleanRequestData(args);
        
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
      handleSOAPError(error, methodName, { fields, filters });
    }
  }
}

module.exports = TebraService;
