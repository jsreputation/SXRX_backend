#!/usr/bin/env node

require('dotenv').config();
const tebraService = require('./src/services/tebraService');

async function testSoapClientSuccess() {
  console.log('🔍 Testing if SOAP client can achieve successful authentication...\n');
  
  try {
    // Test different methods with SOAP client to see if any work
    const methods = [
      { name: 'GetCustomerIdFromKey', args: { request: { CustomerKey: process.env.TEBRA_CUSTOMER_KEY } } },
      { name: 'GetPractices', args: { request: { RequestHeader: { CustomerKey: process.env.TEBRA_CUSTOMER_KEY, User: process.env.TEBRA_USER, Password: process.env.TEBRA_PASSWORD }, Fields: { ID: 1, PracticeName: 1 } } } },
      { name: 'GetProviders', args: { request: { RequestHeader: { CustomerKey: process.env.TEBRA_CUSTOMER_KEY, User: process.env.TEBRA_USER, Password: process.env.TEBRA_PASSWORD }, Fields: { ID: 1, FirstName: 1, LastName: 1 } } } }
    ];
    
    const client = await tebraService.getClient();
    console.log('✅ SOAP client created successfully\n');
    
    for (const method of methods) {
      console.log(`📋 Testing ${method.name}...`);
      
      try {
        const methodAsync = client[method.name + 'Async'];
        if (!methodAsync) {
          console.log(`   ❌ Method ${method.name}Async not found`);
          continue;
        }
        
        console.log('   Request args:', JSON.stringify(method.args, null, 2));
        
        const [result] = await methodAsync(method.args);
        
        console.log(`   ✅ SUCCESS! ${method.name} worked!`);
        console.log('   Result:', JSON.stringify(result, null, 2));
        
        // Check for authentication success indicators
        if (result && typeof result === 'object') {
          const resultStr = JSON.stringify(result);
          if (resultStr.includes('"Authenticated":true') || 
              resultStr.includes('"CustomerKeyValid":true') ||
              resultStr.includes('"IsAuthorized":true')) {
            console.log('   🎉 Authentication successful in SOAP client!');
          }
        }
        
      } catch (error) {
        console.log(`   ❌ ${method.name} failed: ${error.message}`);
        
        // Check if it's an authentication error or something else
        if (error.message.includes('InternalServiceFault')) {
          console.log('   💡 InternalServiceFault suggests authentication passed but request structure issue');
        } else if (error.message.includes('Authentication') || error.message.includes('Invalid')) {
          console.log('   💡 Authentication error');
        }
        
        // Log the actual SOAP request if available
        if (client.lastRequest) {
          console.log('   📋 SOAP request sent:');
          console.log('   ' + client.lastRequest.substring(0, 300) + '...');
        }
      }
      
      console.log('');
    }
    
    // Test if we can get any successful response at all
    console.log('📋 Testing simple methods that might not require full authentication...');
    
    // Try methods that might work with just customer key
    const simpleTests = [
      { method: 'GetCustomerIdFromKey', args: { request: { CustomerKey: process.env.TEBRA_CUSTOMER_KEY } } }
    ];
    
    for (const test of simpleTests) {
      try {
        console.log(`   Testing ${test.method}...`);
        const methodAsync = client[test.method + 'Async'];
        if (methodAsync) {
          const [result] = await methodAsync(test.args);
          console.log(`   ✅ ${test.method} result:`, JSON.stringify(result, null, 2));
        }
      } catch (error) {
        console.log(`   ❌ ${test.method} failed: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('❌ SOAP client test failed:', error.message);
  }
}

testSoapClientSuccess().catch(console.error);