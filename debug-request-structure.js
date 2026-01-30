#!/usr/bin/env node

require('dotenv').config();
const tebraService = require('./src/services/tebraService');
const axios = require('axios');

async function debugRequestStructure() {
  console.log('🔍 Debugging exact request structure differences...\n');
  
  const customerKey = process.env.TEBRA_CUSTOMER_KEY;
  const user = process.env.TEBRA_USER;
  const password = process.env.TEBRA_PASSWORD;
  const endpoint = process.env.TEBRA_SOAP_ENDPOINT;
  
  // Test 1: Try the exact SOAP client structure but with raw HTTP
  console.log('📋 Test 1: Exact SOAP client structure via raw HTTP');
  const soapClientStyleXml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" 
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"  
               xmlns:i0="http://tempuri.org/" 
               xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" 
               xmlns:msc="http://schemas.microsoft.com/ws/2005/12/wsdl/contract" 
               xmlns:tns="http://www.kareo.com/api/schemas/">
  <soap:Body>
    <KareoServices_GetPractices_InputMessage>
      <request>
        <RequestHeader>
          <CustomerKey>${customerKey}</CustomerKey>
          <User>${user}</User>
          <Password>${password}</Password>
        </RequestHeader>
        <Fields>
          <ID>1</ID>
          <PracticeName>1</PracticeName>
        </Fields>
      </request>
    </KareoServices_GetPractices_InputMessage>
  </soap:Body>
</soap:Envelope>`;

  await testRequest('SOAP Client Style', soapClientStyleXml, endpoint);
  
  // Test 2: Try minimal namespaces
  console.log('\n📋 Test 2: Minimal namespaces');
  const minimalXml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetPractices xmlns="http://www.kareo.com/api/schemas/">
      <request>
        <RequestHeader>
          <CustomerKey>${customerKey}</CustomerKey>
          <User>${user}</User>
          <Password>${password}</Password>
        </RequestHeader>
        <Fields>
          <ID>1</ID>
          <PracticeName>1</PracticeName>
        </Fields>
      </request>
    </GetPractices>
  </soap:Body>
</soap:Envelope>`;

  await testRequest('Minimal Namespaces', minimalXml, endpoint);
  
  // Test 3: Try without Fields section
  console.log('\n📋 Test 3: Without Fields section');
  const noFieldsXml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetPractices xmlns="http://www.kareo.com/api/schemas/">
      <request>
        <RequestHeader>
          <CustomerKey>${customerKey}</CustomerKey>
          <User>${user}</User>
          <Password>${password}</Password>
        </RequestHeader>
      </request>
    </GetPractices>
  </soap:Body>
</soap:Envelope>`;

  await testRequest('No Fields', noFieldsXml, endpoint);
  
  // Test 4: Try GetProviders with minimal structure
  console.log('\n📋 Test 4: GetProviders minimal structure');
  const providersXml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetProviders xmlns="http://www.kareo.com/api/schemas/">
      <request>
        <RequestHeader>
          <CustomerKey>${customerKey}</CustomerKey>
          <User>${user}</User>
          <Password>${password}</Password>
        </RequestHeader>
        <Fields>
          <ID>1</ID>
          <FirstName>1</FirstName>
          <LastName>1</LastName>
        </Fields>
      </request>
    </GetProviders>
  </soap:Body>
</soap:Envelope>`;

  await testRequest('GetProviders Minimal', providersXml, endpoint, 'GetProviders');
  
  // Test 5: Try with different SOAPAction
  console.log('\n📋 Test 5: Different SOAPAction format');
  await testRequest('Different SOAPAction', minimalXml, endpoint, 'GetPractices', 'GetPractices');
}

async function testRequest(testName, soapXml, endpoint, method = 'GetPractices', soapAction = null) {
  try {
    console.log(`   Testing: ${testName}`);
    
    const headers = {
      'Content-Type': 'text/xml; charset=utf-8'
    };
    
    if (soapAction) {
      headers['SOAPAction'] = `"${soapAction}"`;
    } else {
      headers['SOAPAction'] = `"http://www.kareo.com/api/schemas/KareoServices/${method}"`;
    }
    
    const response = await axios.post(endpoint, soapXml, {
      headers,
      timeout: 15000
    });

    // Check authentication status
    const authenticated = response.data.includes('<Authenticated>true</Authenticated>');
    const customerKeyValid = response.data.includes('<CustomerKeyValid>true</CustomerKeyValid>');
    const authorized = response.data.includes('<Authorized>true</Authorized>');
    const isError = response.data.includes('<IsError>true</IsError>');
    
    // Extract details
    const customerId = response.data.match(/<CustomerId[^>]*>([^<]+)<\/CustomerId>/i)?.[1];
    const securityResult = response.data.match(/<SecurityResult[^>]*>([^<]*)<\/SecurityResult>/i)?.[1];
    
    console.log(`   Result: Auth=${authenticated}, CustKey=${customerKeyValid}, Authorized=${authorized}, Error=${isError}`);
    if (customerId) console.log(`   Customer ID: ${customerId}`);
    
    if (authenticated && customerKeyValid && authorized && !isError) {
      console.log(`   🎉 SUCCESS! ${testName} works!`);
      console.log('   Full response:');
      console.log(response.data);
      return true;
    } else if (securityResult) {
      console.log(`   Error: ${securityResult.substring(0, 100)}...`);
    }
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    if (error.response?.status) {
      console.log(`   Status: ${error.response.status}`);
    }
  }
  
  return false;
}

debugRequestStructure().catch(console.error);