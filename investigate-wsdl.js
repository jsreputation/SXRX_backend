#!/usr/bin/env node

require('dotenv').config();
const axios = require('axios');

async function investigateWSDL() {
  console.log('🔍 Investigating WSDL and SOAP client configuration...\n');
  
  const endpoint = process.env.TEBRA_SOAP_ENDPOINT;
  const wsdlUrl = endpoint + '?wsdl';
  
  try {
    console.log(`📋 Fetching WSDL from: ${wsdlUrl}`);
    const response = await axios.get(wsdlUrl, { timeout: 15000 });
    
    console.log(`✅ WSDL fetched successfully (${response.data.length} bytes)`);
    
    // Look for operation definitions
    console.log('\n📋 Analyzing WSDL operations...');
    
    const operations = [
      'GetPractices',
      'GetProviders', 
      'GetCustomerIdFromKey'
    ];
    
    for (const op of operations) {
      console.log(`\n🔍 Looking for ${op} operation:`);
      
      // Look for operation definition
      const opRegex = new RegExp(`<.*operation.*name=["']${op}["']`, 'i');
      const opMatch = response.data.match(opRegex);
      
      if (opMatch) {
        console.log(`   ✅ Found operation: ${opMatch[0]}`);
        
        // Look for input message
        const inputRegex = new RegExp(`${op}.*Input.*Message`, 'gi');
        const inputMatches = response.data.match(inputRegex);
        if (inputMatches) {
          console.log(`   📥 Input messages: ${inputMatches.join(', ')}`);
        }
        
        // Look for the actual message structure
        const messageRegex = new RegExp(`<.*message.*name=["'][^"']*${op}[^"']*["'][^>]*>`, 'gi');
        const messageMatches = response.data.match(messageRegex);
        if (messageMatches) {
          console.log(`   📨 Message definitions:`);
          messageMatches.forEach(msg => console.log(`      ${msg}`));
        }
        
      } else {
        console.log(`   ❌ Operation ${op} not found`);
      }
    }
    
    // Look for service and binding information
    console.log('\n📋 Service and binding information:');
    
    const serviceRegex = /<service[^>]*>/gi;
    const serviceMatches = response.data.match(serviceRegex);
    if (serviceMatches) {
      console.log('   Services:', serviceMatches);
    }
    
    const bindingRegex = /<binding[^>]*>/gi;
    const bindingMatches = response.data.match(bindingRegex);
    if (bindingMatches) {
      console.log('   Bindings:', bindingMatches.slice(0, 3)); // Show first 3
    }
    
    // Look for target namespace
    const namespaceRegex = /targetNamespace=["']([^"']+)["']/i;
    const namespaceMatch = response.data.match(namespaceRegex);
    if (namespaceMatch) {
      console.log(`   Target Namespace: ${namespaceMatch[1]}`);
    }
    
    // Check if there are multiple service versions
    console.log('\n📋 Checking for service versions...');
    const versionRegex = /version|v\d+/gi;
    const versionMatches = response.data.match(versionRegex);
    if (versionMatches) {
      console.log(`   Version references found: ${versionMatches.length}`);
      console.log(`   Examples: ${versionMatches.slice(0, 5).join(', ')}`);
    }
    
    // Look for any hints about the correct request format
    console.log('\n📋 Looking for request format hints...');
    
    // Check for RequestHeader definition
    if (response.data.includes('RequestHeader')) {
      console.log('   ✅ RequestHeader found in WSDL');
      
      // Try to find the RequestHeader structure
      const headerRegex = /<.*RequestHeader.*?>/gi;
      const headerMatches = response.data.match(headerRegex);
      if (headerMatches) {
        console.log('   RequestHeader references:', headerMatches.slice(0, 3));
      }
    } else {
      console.log('   ❌ RequestHeader not found in WSDL');
    }
    
    // Check for Fields definition
    if (response.data.includes('Fields')) {
      console.log('   ✅ Fields found in WSDL');
    } else {
      console.log('   ❌ Fields not found in WSDL');
    }
    
  } catch (error) {
    console.error('❌ WSDL investigation failed:', error.message);
  }
}

investigateWSDL().catch(console.error);