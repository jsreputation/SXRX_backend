// backend/src/services/tebraService/soapClient.js
// SOAP client initialization and connection utilities

const soap = require('soap');
const axios = require('axios');

/**
 * SOAP Client utilities for Tebra service
 * Handles client initialization, connection testing, and raw SOAP method calls
 */
class SoapClient {
  constructor(config) {
    this.wsdlUrl = config.wsdlUrl;
    this.soapEndpoint = config.soapEndpoint;
    this.customerKey = config.customerKey;
    this.password = config.password;
    this.user = config.user;
    this.namespace = config.namespace;
    this.useRawSOAP = config.useRawSOAP;
    this.clientPromise = null;
  }

  /**
   * Initialize and get SOAP client
   * @returns {Promise<Object>} SOAP client instance
   */
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

  /**
   * Test connection to Tebra SOAP API
   * @returns {Promise<Object>} Connection test result
   */
  async testConnection() {
    try {
      console.log(`🔗 Tebra/Kareo SOAP client ready`);
      console.log(`📍 SOAP Endpoint: ${this.soapEndpoint}`);
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

  /**
   * Connect to Tebra (alias for testConnection)
   * @returns {Promise<Object>} Connection result
   */
  async connect() {
    return await this.testConnection();
  }

  /**
   * Call SOAP method using raw XML (alternative to soap library)
   * @param {string} methodName - SOAP method name
   * @param {Object} soapXml - Generated SOAP XML string
   * @returns {Promise<string>} Raw XML response
   */
  async callRawSOAPMethod(methodName, soapXml) {
    try {
      // Log SOAP request XML for CreateAppointment (truncate if too long)
      if (methodName === 'CreateAppointment') {
        const requestPreview = soapXml.length > 2000 
          ? soapXml.substring(0, 2000) + '...' 
          : soapXml;
        console.log('🔍 [TEBRA] CreateAppointment SOAP request XML (preview):', requestPreview);
        // Also log just the StartTime/EndTime parts
        const startTimeMatch = soapXml.match(/<sch:StartTime[^>]*>([^<]+)<\/sch:StartTime>/i);
        const endTimeMatch = soapXml.match(/<sch:EndTime[^>]*>([^<]+)<\/sch:EndTime>/i);
        if (startTimeMatch) console.log(`🔍 [TEBRA] StartTime in XML: ${startTimeMatch[1]}`);
        if (endTimeMatch) console.log(`🔍 [TEBRA] EndTime in XML: ${endTimeMatch[1]}`);
      }
      
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
      
      return data;
    } catch (error) {
      console.error(`❌ [TEBRA] Error calling ${methodName}:`, error.message);
      if (error.response) {
        console.error('Response data:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * Get configuration info
   * @returns {Object} Configuration object
   */
  getConfig() {
    return {
      wsdlUrl: this.wsdlUrl,
      soapEndpoint: this.soapEndpoint,
      user: this.user,
      namespace: this.namespace,
      useRawSOAP: this.useRawSOAP,
      hasCredentials: !!(this.customerKey && this.password && this.user)
    };
  }
}

module.exports = SoapClient;
