#!/usr/bin/env node

require('dotenv').config();
const axios = require('axios');

async function testCredentialVariations() {
  console.log('🔍 Testing credential variations for GetProviders (CustomerKeyValid=true)...\n');
  
  const customerKey = process.env.TEBRA_CUSTOMER_KEY;
  const user = process.env.TEBRA_USER;
  const password = process.env.TEBRA_PASSWORD;
  const endpoint = process.env.TEBRA_SOAP_ENDPOINT;
  
  console.log('Original credentials:');
  console.log(`CustomerKey: "${customerKey}"`);
  console.log(`User: "${user}"`);
  console.log(`Password: "${password}"`);
  console.log('');
  
  // Test different user formats
  const userVariations = [
    user, // Original
    user.toLowerCase(), // All lowercase
    user.toUpperCase(), // All uppercase
    user.trim(), // Trimmed
  ];
  
  // Test different password formats
  const passwordVariations = [
    password, // Original
    password.trim(), // Trimmed
  ];
  
  let testCount = 0;
  
  for (const testUser of userVariations) {
    for (const testPassword of passwordVariations) {
      testCount++;
      console.log(`📋 Test ${testCount}: User="${testUser}", Password="${testPassword}"`);
      
      const success = await testGetProviders(customerKey, testUser, testPassword, endpoint);
      if (success) {
        console.log(`🎉 SUCCESS! Working credentials found:`);
        console.log(`   CustomerKey: "${customerKey}"`);
        console.log(`   User: "${testUser}"`);
        console.log(`   Password: "${testPassword}"`);
        return { customerKey, user: testUser, password: testPassword };
      }
    }
  }
  
  // Test with different request structures for GetProviders
  console.log('\n📋 Testing different GetProviders request structures...');
  
  // Test 1: With Filter section
  console.log('\nTest: GetProviders with Filter');
  const withFilterXml = `<?xml version="1.0" encoding="utf-8"?>
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
        <Filter>
          <PracticeName>SXRX, LLC</PracticeName>
        </Filter>
      </request>
    </GetProviders>
  </soap:Body>
</soap:Envelope>`;

  await testRequestDirect('GetProviders with Filter', withFilterXml, endpoint, 'GetProviders');
  
  // Test 2: Without Filter section
  console.log('\nTest: GetProviders without Filter');
  const withoutFilterXml = `<?xml version="1.0" encoding="utf-8"?>
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

  await testRequestDirect('GetProviders without Filter', withoutFilterXml, endpoint, 'GetProviders');
  
  return null;
}

async function testGetProviders(customerKey, user, password, endpoint) {
  const soapXml = `<?xml version="1.0" encoding="utf-8"?>
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

  try {
    const response = await axios.post(endpoint, soapXml, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': '"http://www.kareo.com/api/schemas/KareoServices/GetProviders"'
      },
      timeout: 10000
    });

    const authenticated = response.data.includes('<Authenticated>true</Authenticated>');
    const customerKeyValid = response.data.includes('<CustomerKeyValid>true</CustomerKeyValid>');
    const authorized = response.data.includes('<Authorized>true</Authorized>');
    const isError = response.data.includes('<IsError>true</IsError>');
    
    console.log(`   Result: Auth=${authenticated}, CustKey=${customerKeyValid}, Authorized=${authorized}, Error=${isError}`);
    
    if (authenticated && customerKeyValid && authorized && !isError) {
      return true;
    } else {
      const securityResult = response.data.match(/<SecurityResult[^>]*>([^<]*)<\/SecurityResult>/i)?.[1];
      if (securityResult) {
        console.log(`   Error: ${securityResult.substring(0, 80)}...`);
      }
    }
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
  
  return false;
}

async function testRequestDirect(testName, soapXml, endpoint, method) {
  try {
    console.log(`   Testing: ${testName}`);
    
    const response = await axios.post(endpoint, soapXml, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': `"http://www.kareo.com/api/schemas/KareoServices/${method}"`
      },
      timeout: 10000
    });

    const authenticated = response.data.includes('<Authenticated>true</Authenticated>');
    const customerKeyValid = response.data.includes('<CustomerKeyValid>true</CustomerKeyValid>');
    const authorized = response.data.includes('<Authorized>true</Authorized>');
    const isError = response.data.includes('<IsError>true</IsError>');
    
    console.log(`   Result: Auth=${authenticated}, CustKey=${customerKeyValid}, Authorized=${authorized}, Error=${isError}`);
    
    if (authenticated && customerKeyValid && authorized && !isError) {
      console.log(`   🎉 SUCCESS! ${testName} works!`);
      console.log('   Response preview:');
      console.log(response.data.substring(0, 500) + '...');
      return true;
    } else {
      const securityResult = response.data.match(/<SecurityResult[^>]*>([^<]*)<\/SecurityResult>/i)?.[1];
      if (securityResult) {
        console.log(`   Error: ${securityResult.substring(0, 80)}...`);
      }
    }
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
  
  return false;
}

testCredentialVariations().catch(console.error);