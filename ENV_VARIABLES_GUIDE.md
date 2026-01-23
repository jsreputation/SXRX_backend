# Environment Variables Guide

This document provides detailed descriptions, validation rules, and requirements for all environment variables used in the SXRX backend.

## Quick Reference

- **Required**: Must be set for the application to function
- **Optional**: Can be omitted, but may limit functionality
- **Development**: Only needed in development/staging environments
- **Production**: Critical for production deployment

---

## Server Configuration

### PORT
- **Type**: Number
- **Required**: No (default: 3000)
- **Description**: Port number for the Express server
- **Example**: `3000`
- **Validation**: Must be a valid port number (1-65535)

### NODE_ENV
- **Type**: String
- **Required**: No (default: development)
- **Description**: Environment mode (development, staging, production)
- **Example**: `production`
- **Validation**: Must be one of: `development`, `staging`, `production`
- **Notes**: Affects logging level, error details, and security settings

---

## Tebra (EHR) Configuration

### TEBRA_SOAP_WSDL
- **Type**: URL
- **Required**: Yes
- **Description**: WSDL URL for Tebra SOAP API
- **Example**: `https://webservice.kareo.com/services/soap/2.1/KareoServices.svc?wsdl`
- **Validation**: Must be a valid HTTPS URL

### TEBRA_SOAP_ENDPOINT
- **Type**: URL
- **Required**: Yes
- **Description**: SOAP endpoint URL for Tebra API
- **Example**: `https://webservice.kareo.com/services/soap/2.1/KareoServices.svc`
- **Validation**: Must be a valid HTTPS URL

### TEBRA_CUSTOMER_KEY
- **Type**: String
- **Required**: Yes
- **Description**: Tebra customer key for API authentication
- **Example**: `your_customer_key`
- **Validation**: Non-empty string
- **Security**: Keep secret, do not commit to version control

### TEBRA_PASSWORD
- **Type**: String
- **Required**: Yes
- **Description**: Tebra API password
- **Example**: `your_password`
- **Validation**: Non-empty string
- **Security**: Keep secret, do not commit to version control

### TEBRA_USER
- **Type**: String
- **Required**: Yes
- **Description**: Tebra API username
- **Example**: `your_username`
- **Validation**: Non-empty string

### TEBRA_PRACTICE_ID
- **Type**: String/Number
- **Required**: Yes (or state-specific practice IDs)
- **Description**: Default Tebra practice ID
- **Example**: `12345`
- **Validation**: Numeric string or number

### TEBRA_PRACTICE_ID_[STATE]
- **Type**: String/Number
- **Required**: No (but recommended for multi-state operations)
- **Description**: State-specific practice IDs (CA, TX, WA, KL, SC)
- **Example**: `TEBRA_PRACTICE_ID_CA=12345`
- **Validation**: Numeric string or number
- **States Supported**: CA, TX, WA, KL, SC

### TEBRA_PROVIDER_ID
- **Type**: String/Number
- **Required**: Yes (or state-specific provider IDs)
- **Description**: Default Tebra provider ID (Medical Director)
- **Example**: `67890`
- **Validation**: Numeric string or number

### TEBRA_PROVIDER_ID_[STATE]
- **Type**: String/Number
- **Required**: No (but recommended for multi-state operations)
- **Description**: State-specific provider IDs
- **Example**: `TEBRA_PROVIDER_ID_CA=67890`
- **Validation**: Numeric string or number

---

## SendGrid Email Configuration

### SENDGRID_API_KEY
- **Type**: String
- **Required**: Yes (for email functionality)
- **Description**: SendGrid API key for sending emails
- **Example**: `SG.your_sendgrid_api_key_here`
- **Validation**: Must start with `SG.`
- **Security**: Keep secret, do not commit to version control
- **How to get**: https://app.sendgrid.com/settings/api_keys

### SENDGRID_FROM
- **Type**: Email
- **Required**: Yes (for email functionality)
- **Description**: From email address (must be verified in SendGrid)
- **Example**: `noreply@yourdomain.com`
- **Validation**: Valid email address
- **Notes**: Must be verified in SendGrid dashboard

### MEDICAL_DIRECTOR_EMAIL
- **Type**: Email
- **Required**: Yes (for red flag notifications)
- **Description**: Email address for medical director alerts
- **Example**: `medical.director@yourdomain.com`
- **Validation**: Valid email address

---

## Database Configuration

### DATABASE_URL
- **Type**: Connection String
- **Required**: Yes (or use individual DB_* variables)
- **Description**: PostgreSQL connection string
- **Example**: `postgresql://username:password@localhost:5432/sxrx_db`
- **Validation**: Valid PostgreSQL connection string
- **Security**: Contains credentials, keep secret

### DB_HOST
- **Type**: String
- **Required**: Yes (if DATABASE_URL not provided)
- **Description**: PostgreSQL host
- **Example**: `localhost`
- **Default**: `localhost`

### DB_PORT
- **Type**: Number
- **Required**: No (default: 5432)
- **Description**: PostgreSQL port
- **Example**: `5432`
- **Validation**: Valid port number

### DB_NAME
- **Type**: String
- **Required**: Yes (if DATABASE_URL not provided)
- **Description**: PostgreSQL database name
- **Example**: `sxrx_db`

### DB_USER
- **Type**: String
- **Required**: Yes (if DATABASE_URL not provided)
- **Description**: PostgreSQL username
- **Example**: `sxrx_user`
- **Security**: Keep secret

### DB_PASSWORD
- **Type**: String
- **Required**: Yes (if DATABASE_URL not provided)
- **Description**: PostgreSQL password
- **Example**: `your_db_password`
- **Security**: Keep secret, do not commit to version control

**Note:** The database is also used for storing Tebra document metadata (`tebra_documents` table) to enable document retrieval functionality, as Tebra SOAP 2.1 doesn't support `GetDocuments`/`GetDocumentContent` operations.

---

## Shopify Configuration

### SHOPIFY_STORE_DOMAIN
- **Type**: String
- **Required**: Yes
- **Description**: Shopify store domain
- **Example**: `your-store.myshopify.com`
- **Validation**: Must be a valid Shopify domain

### SHOPIFY_API_KEY
- **Type**: String
- **Required**: Yes
- **Description**: Shopify API key
- **Example**: `your_shopify_api_key`
- **Security**: Keep secret

### SHOPIFY_API_SECRET_KEY
- **Type**: String
- **Required**: Yes
- **Description**: Shopify API secret key
- **Example**: `your_shopify_api_secret`
- **Security**: Keep secret, do not commit to version control

### SHOPIFY_ACCESS_TOKEN
- **Type**: String
- **Required**: Yes
- **Description**: Shopify Admin API access token
- **Example**: `your_shopify_access_token`
- **Security**: Keep secret

### SHOPIFY_STOREFRONT_ACCESS_TOKEN
- **Type**: String
- **Required**: Yes (for customer registration)
- **Description**: Shopify Storefront API access token
- **Example**: `your_storefront_access_token`
- **Security**: Keep secret

### SHOPIFY_WEBHOOK_SECRET
- **Type**: String
- **Required**: Yes (for webhook verification)
- **Description**: Shopify webhook secret for signature verification
- **Example**: `your_shopify_webhook_secret_here`
- **Security**: Keep secret
- **How to get**: Shopify Admin > Settings > Notifications > Webhooks

---

## Security Configuration

### ADMIN_API_KEY
- **Type**: String
- **Required**: Yes (for admin endpoints)
- **Description**: API key for admin endpoint authentication
- **Example**: `your_admin_api_key_here`
- **Security**: Keep secret, use strong random key
- **Generate**: `openssl rand -hex 32`
- **Usage**: Include in `X-Admin-API-Key` header for admin requests

### JWT_SECRET
- **Type**: String
- **Required**: No (if not using JWT)
- **Description**: Secret key for JWT token signing
- **Example**: `your_jwt_secret_key_here`
- **Security**: Keep secret, use strong random key
- **Generate**: `openssl rand -hex 32`

### SESSION_SECRET
- **Type**: String
- **Required**: No (if not using sessions)
- **Description**: Secret key for session encryption
- **Example**: `your_session_secret_here`
- **Security**: Keep secret, use strong random key

### ENCRYPTION_KEY
- **Type**: String
- **Required**: No (encryption disabled if not set)
- **Description**: Encryption key for PII data encryption at rest (AES-256-GCM)
- **Example**: `your-strong-encryption-key-32-chars-minimum`
- **Security**: Keep secret, use strong random key (minimum 32 characters)
- **Generate**: `openssl rand -hex 32`
- **Notes**: 
  - If not set, encryption is disabled and data stored in plain text
  - Must be at least 32 characters for AES-256
  - Used for encrypting sensitive PII fields (SSN, phone, email, etc.)

### CSRF_TOKEN_SECRET
- **Type**: String
- **Required**: No (defaults to JWT_SECRET if not set)
- **Description**: Secret key for CSRF token generation and verification
- **Example**: `your-csrf-secret-key-here`
- **Security**: Keep secret, use strong random key
- **Generate**: `openssl rand -hex 32`
- **Notes**: 
  - Falls back to JWT_SECRET if not provided
  - Used for HMAC-based CSRF token signing

### CSRF_REQUIRED
- **Type**: Boolean
- **Required**: No (default: true)
- **Description**: Enable/disable CSRF protection
- **Example**: `true`
- **Validation**: Must be `true` or `false`
- **Notes**: 
  - Set to `false` to disable CSRF protection (not recommended for production)
  - Useful for development/testing

### CSRF_TOKEN_EXPIRY
- **Type**: Number
- **Required**: No (default: 3600)
- **Description**: CSRF token expiry time in seconds
- **Example**: `3600` (1 hour)
- **Validation**: Must be positive number
- **Notes**: Tokens expire after this duration and must be regenerated

### CACHE_VERSION
- **Type**: String
- **Required**: No (default: 1.0.0)
- **Description**: Cache version for cache invalidation on schema changes
- **Example**: `1.0.0`
- **Notes**: 
  - Increment when cache schema changes
  - Used for cache versioning to invalidate old cached data

---

## Webhook Configuration

### RevenueHunt v2 Webhooks
**Note:** RevenueHunt v2 does not use webhook secrets or signatures. All RevenueHunt webhooks are accepted without signature verification. The webhook endpoint validates the payload structure instead.

### ALLOW_UNSIGNED_WEBHOOKS
- **Type**: Boolean
- **Required**: No (default: false)
- **Description**: Allow unsigned webhooks in development (legacy setting, not used for RevenueHunt v2)
- **Example**: `false`
- **Validation**: Must be `true` or `false`
- **Notes**: This setting is deprecated for RevenueHunt v2 webhooks

---

## Application URLs

### BACKEND_URL
- **Type**: URL
- **Required**: Yes
- **Description**: Base URL for the backend API
- **Example**: `https://api.yourdomain.com`
- **Validation**: Must be a valid URL
- **Notes**: Used for CORS and internal API calls

### FRONTEND_URL
- **Type**: URL
- **Required**: Yes (for email verification)
- **Description**: Base URL for the Shopify frontend (used for email verification links)
- **Example**: `https://your-store.myshopify.com`
- **Validation**: Must be a valid URL
- **Notes**: Used in email verification emails to generate verification links

### SHOPIFY_STORE_URL
- **Type**: URL
- **Required**: Yes
- **Description**: Full Shopify store URL
- **Example**: `https://your-store.myshopify.com`
- **Validation**: Must be a valid HTTPS URL

---

## Redis Configuration (Optional but Recommended)

### REDIS_URL
- **Type**: Connection String
- **Required**: No (caching disabled if not set)
- **Description**: Redis connection URL
- **Example**: `redis://localhost:6379` or `redis://user:password@host:6379`
- **Validation**: Valid Redis connection string
- **Notes**: 
  - If not set, caching is disabled and app continues without cache
  - Recommended for production to improve performance
  - Supports Redis Cloud, AWS ElastiCache, and self-hosted Redis

### REDIS_ENABLED
- **Type**: Boolean
- **Required**: No (default: true if REDIS_URL is set)
- **Description**: Enable/disable Redis caching
- **Example**: `true`
- **Validation**: Must be `true` or `false`
- **Notes**: Set to `false` to disable caching even if REDIS_URL is set

### REDIS_DEFAULT_TTL
- **Type**: Number
- **Required**: No (default: 300)
- **Description**: Default cache TTL in seconds
- **Example**: `300` (5 minutes)
- **Validation**: Must be positive number
- **Notes**: Used for general caching when specific TTL not provided

### REDIS_AVAILABILITY_TTL
- **Type**: Number
- **Required**: No (default: 60)
- **Description**: Cache TTL for availability data in seconds
- **Example**: `60` (1 minute)
- **Validation**: Must be positive number
- **Notes**: Shorter TTL for frequently changing availability data

### REDIS_TEBRA_TTL
- **Type**: Number
- **Required**: No (default: 300)
- **Description**: Cache TTL for Tebra API responses in seconds
- **Example**: `300` (5 minutes)
- **Validation**: Must be positive number
- **Notes**: Longer TTL for relatively stable Tebra data

---

## Email Verification Configuration

### EMAIL_VERIFICATION_ENABLED
- **Type**: Boolean
- **Required**: No (default: true)
- **Description**: Enable email verification for new registrations
- **Example**: `true`
- **Validation**: Must be `true` or `false`
- **Notes**: If disabled, users can register without email verification

### EMAIL_VERIFICATION_TOKEN_EXPIRY_HOURS
- **Type**: Number
- **Required**: No (default: 24)
- **Description**: Hours until verification token expires
- **Example**: `24`
- **Validation**: Must be positive number
- **Notes**: Tokens expire after this duration and must be regenerated

---

## Feature Flags

### AUTO_SYNC_TEBRA
- **Type**: Boolean
- **Required**: No (default: true)
- **Description**: Auto-sync Tebra patient creation on login/registration
- **Example**: `true`
- **Validation**: Must be `true` or `false`

### USE_QUALIPHY
- **Type**: Boolean
- **Required**: No (default: false)
- **Description**: Enable Qualiphy for consultation routing
- **Example**: `false`
- **Validation**: Must be `true` or `false`

---

## Logging Configuration

### LOG_LEVEL
- **Type**: String
- **Required**: No (default: info in production, debug in development)
- **Description**: Logging level
- **Example**: `info`
- **Validation**: Must be one of: `error`, `warn`, `info`, `debug`
- **Notes**: 
  - `error`: Only errors
  - `warn`: Errors and warnings
  - `info`: Errors, warnings, and info messages
  - `debug`: All messages including debug

---

## Webhook Retry Configuration

### WEBHOOK_MAX_RETRY_ATTEMPTS
- **Type**: Number
- **Required**: No (default: 5)
- **Description**: Maximum number of retry attempts for failed webhooks
- **Example**: `5`
- **Validation**: Must be between 1 and 20

### WEBHOOK_INITIAL_RETRY_DELAY_MS
- **Type**: Number
- **Required**: No (default: 60000)
- **Description**: Initial retry delay in milliseconds (exponential backoff starts here)
- **Example**: `60000` (1 minute)
- **Validation**: Must be positive number

### WEBHOOK_MAX_RETRY_DELAY_MS
- **Type**: Number
- **Required**: No (default: 3600000)
- **Description**: Maximum retry delay in milliseconds (caps exponential backoff)
- **Example**: `3600000` (1 hour)
- **Validation**: Must be positive number, should be >= initial delay

---

## Tebra SOAP Configuration

### TEBRA_USE_RAW_SOAP
- **Type**: Boolean
- **Required**: No (default: true)
- **Description**: Use raw SOAP XML instead of soap library
- **Example**: `true`
- **Validation**: Must be `true` or `false`
- **Notes**: Recommended to keep as `true` for better control

### TEBRA_BATCH_SIZE
- **Type**: Number
- **Required**: No (default: 5)
- **Description**: Batch size for Tebra API calls
- **Example**: `5`
- **Validation**: Must be between 1 and 50

### TEBRA_DELAY_BETWEEN_CALLS
- **Type**: Number
- **Required**: No (default: 200)
- **Description**: Delay between Tebra API calls in milliseconds
- **Example**: `200`
- **Validation**: Must be non-negative

### TEBRA_DELAY_BETWEEN_BATCHES
- **Type**: Number
- **Required**: No (default: 1000)
- **Description**: Delay between Tebra API batches in milliseconds
- **Example**: `1000`
- **Validation**: Must be non-negative

---

## CORS Configuration

### CORS_ALLOWED_ORIGINS
- **Type**: String (comma-separated)
- **Required**: No
- **Description**: Comma-separated list of allowed CORS origins
- **Example**: `https://your-store.myshopify.com,https://admin.yourdomain.com`
- **Validation**: Valid URLs separated by commas
- **Notes**: If not set, CORS will be more permissive (development mode)

---

## Validation Checklist

Before deploying to production, ensure:

- [ ] All required variables are set
- [ ] All secrets are strong and unique
- [ ] Database credentials are secure
- [ ] Webhook secrets are configured
- [ ] Admin API key is set and strong
- [ ] CORS origins are restricted to production domains
- [ ] NODE_ENV is set to `production`
- [ ] LOG_LEVEL is appropriate for production
- [ ] ALLOW_UNSIGNED_WEBHOOKS is `false` or not set
- [ ] All URLs point to production endpoints
- [ ] Redis is configured (optional but recommended)
- [ ] FRONTEND_URL is set for email verification
- [ ] SENDGRID_FROM email is verified in SendGrid
- [ ] ENCRYPTION_KEY is set for PII encryption (if using encryption)
- [ ] CSRF protection is enabled (CSRF_REQUIRED=true in production)
- [ ] CSRF_TOKEN_SECRET is set (or JWT_SECRET is used as fallback)

---

## Security Best Practices

1. **Never commit `.env` file** - Use `.env.example` as template
2. **Use strong secrets** - Generate with `openssl rand -hex 32`
3. **Rotate secrets regularly** - Especially after team member changes
4. **Use different values for each environment** - Dev, staging, production
5. **Restrict CORS origins** - Only allow trusted domains
6. **Enable webhook verification** - Always verify webhook signatures
7. **Use HTTPS** - All URLs should use HTTPS in production
8. **Monitor logs** - Watch for authentication failures

---

## Troubleshooting

### Common Issues

**"Missing required environment variable"**
- Check that all required variables are set
- Verify variable names match exactly (case-sensitive)
- Ensure `.env` file is in the correct location

**"Webhook verification failed"**
- Verify webhook secret matches the one configured in Shopify/RevenueHunt
- Check that `captureRawBody` middleware is before `express.json()`
- Ensure secret is not URL-encoded or modified

**"Database connection failed"**
- Verify DATABASE_URL or individual DB_* variables are correct
- Check database is running and accessible
- Verify network/firewall allows connection

**"Tebra API authentication failed"**
- Verify TEBRA_CUSTOMER_KEY, TEBRA_PASSWORD, TEBRA_USER are correct
- Check Tebra account is active
- Verify practice/provider IDs are valid

---

## Additional Resources

- [Tebra API Documentation](https://www.tebra.com/api-docs)
- [Shopify API Documentation](https://shopify.dev/docs/api)
- [SendGrid API Documentation](https://docs.sendgrid.com/api-reference)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
