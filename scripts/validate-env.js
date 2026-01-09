#!/usr/bin/env node

/**
 * Environment Variables Validation Script
 * 
 * This script validates that all required environment variables are set.
 * Run with: node scripts/validate-env.js
 */

require('dotenv').config();

const requiredVars = {
  // Server
  PORT: 'Server port number',
  NODE_ENV: 'Node environment (development/production)',
  JWT_SECRET: 'JWT secret key for token signing',
  
  // Database
  DATABASE_URL: 'PostgreSQL connection string (or use PGHOST, PGPORT, etc.)',
  
  // Shopify
  SHOPIFY_STORE: 'Shopify store domain',
  SHOPIFY_ACCESS_TOKEN: 'Shopify Admin API access token',
  
  // Tebra
  TEBRA_SOAP_WSDL: 'Tebra SOAP WSDL URL',
  TEBRA_SOAP_ENDPOINT: 'Tebra SOAP endpoint URL',
  TEBRA_CUSTOMER_KEY: 'Tebra customer key',
  TEBRA_USER: 'Tebra username',
  TEBRA_PASSWORD: 'Tebra password',
  TEBRA_PRACTICE_NAME: 'Tebra practice name',
};

const optionalVars = {
  // Database (if not using DATABASE_URL)
  PGHOST: 'PostgreSQL host',
  PGPORT: 'PostgreSQL port',
  PGUSER: 'PostgreSQL user',
  PGPASSWORD: 'PostgreSQL password',
  PGDATABASE: 'PostgreSQL database name',
  
  // Shopify
  SHOPIFY_STORE_DOMAIN: 'Shopify store domain (alternative)',
  SHOPIFY_STOREFRONT_ACCESS_TOKEN: 'Shopify Storefront API token',
  SHOPIFY_API_VERSION: 'Shopify API version',
  
  // Tebra
  TEBRA_PRACTICE_ID: 'Default Tebra practice ID',
  TEBRA_PRACTICE_ID_CA: 'California practice ID',
  TEBRA_PROVIDER_ID_CA: 'California provider ID',
  
  // Stripe
  STRIPE_SECRET_KEY: 'Stripe secret key',
  STRIPE_WEBHOOK_SECRET: 'Stripe webhook secret',
  
  // Twilio
  TWILIO_ACCOUNT_SID: 'Twilio account SID',
  TWILIO_AUTH_TOKEN: 'Twilio auth token',
  TWILIO_PHONE_NUMBER: 'Twilio phone number',
  
  // SendGrid
  SENDGRID_API_KEY: 'SendGrid API key',
  SENDGRID_FROM: 'SendGrid from email',
  
  // CORS
  CORS_ALLOWED_ORIGINS: 'CORS allowed origins',
  
  // Other
  LOG_LEVEL: 'Logging level',
  TIMEZONE: 'Timezone for cron jobs',
};

function validateEnv() {
  const missing = [];
  const warnings = [];
  
  // Check required variables
  for (const [key, description] of Object.entries(requiredVars)) {
    if (!process.env[key]) {
      missing.push({ key, description });
    }
  }
  
  // Check database configuration
  if (!process.env.DATABASE_URL) {
    const dbVars = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
    const missingDbVars = dbVars.filter(v => !process.env[v]);
    if (missingDbVars.length > 0) {
      warnings.push({
        key: 'DATABASE_CONFIG',
        message: `Missing database config: ${missingDbVars.join(', ')}. Either set DATABASE_URL or all of: ${dbVars.join(', ')}`
      });
    }
  }
  
  // Check JWT_SECRET strength
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    warnings.push({
      key: 'JWT_SECRET',
      message: 'JWT_SECRET should be at least 32 characters long for security'
    });
  }
  
  // Check NODE_ENV
  if (process.env.NODE_ENV && !['development', 'production', 'test'].includes(process.env.NODE_ENV)) {
    warnings.push({
      key: 'NODE_ENV',
      message: `NODE_ENV should be 'development', 'production', or 'test', got: ${process.env.NODE_ENV}`
    });
  }
  
  // Print results
  console.log('\n🔍 Environment Variables Validation\n');
  console.log('='.repeat(50));
  
  if (missing.length === 0 && warnings.length === 0) {
    console.log('✅ All required environment variables are set!\n');
    return true;
  }
  
  if (missing.length > 0) {
    console.log('\n❌ Missing Required Variables:\n');
    missing.forEach(({ key, description }) => {
      console.log(`   - ${key}: ${description}`);
    });
    console.log('');
  }
  
  if (warnings.length > 0) {
    console.log('\n⚠️  Warnings:\n');
    warnings.forEach(({ key, message }) => {
      console.log(`   - ${key}: ${message}`);
    });
    console.log('');
  }
  
  console.log('='.repeat(50));
  console.log('\n💡 Tip: Copy .env.example to .env and fill in your values\n');
  
  return missing.length === 0;
}

// Run validation
const isValid = validateEnv();
process.exit(isValid ? 0 : 1);

