# SXRX Backend API

A comprehensive healthcare telemedicine backend API that integrates Shopify e-commerce, Tebra (Kareo) EHR system, payment processing, and various healthcare services to provide a complete patient management and appointment scheduling solution.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Technology Stack](#technology-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Endpoints](#api-endpoints)
- [Database](#database)
- [Services & Integrations](#services--integrations)
- [Development](#development)
- [Testing](#testing)
- [Deployment](#deployment)

## Overview

SXRX Backend is a Node.js/Express API that serves as the central integration layer for a healthcare telemedicine platform. It connects Shopify storefronts with Tebra (Kareo) practice management systems, handles patient onboarding, appointment scheduling, billing, and manages various healthcare workflows including questionnaires, prescriptions, and telemedicine consultations.

### Key Integrations

- **Shopify**: E-commerce platform for product sales and customer management
- **Tebra/Kareo**: Electronic Health Records (EHR) and Practice Management System
- **Stripe**: Payment processing and subscription management
- **Google Meet**: Telemedicine video consultations
- **SendGrid**: Email notifications
- **RevenueHunt**: Questionnaire and form submissions

## Features

### Core Functionality

- **Patient Management**: Create and sync patients between Shopify and Tebra
- **Appointment Scheduling**: Manage appointments with availability checking, cancellation, and rescheduling
- **Billing & Subscriptions**: Handle one-time and recurring billing through Stripe and Tebra
- **Questionnaire Processing**: Handle patient questionnaires and store as documents
  - All quiz conditional logic validated and fixed (37 broken references fixed)
  - Supports follow-up questions and "Other" text inputs
  - Processes red flags and routes to consultation when needed
- **Email Verification**: Email verification system for new user registrations
- **State-Based Routing**: Route patients to appropriate providers based on US state
- **Product Validation**: Validate checkout based on state restrictions and questionnaire completion
- **Telemedicine**: Create Google Meet links for virtual consultations
- **Pharmacy Integration**: Submit prescriptions via eRx providers (Tebra, Surescripts, DrFirst)
- **Monthly Billing Cron**: Automated recurring subscription billing
- **Webhook Handling**: Process webhooks from Shopify, Stripe, and RevenueHunt with retry logic and dead letter queue
- **Availability Management**: Configurable business hours, blocked dates, and time slots with PostgreSQL persistence
- **Performance Optimization**: Redis caching for Tebra responses and availability data
- **Metrics & Monitoring**: Prometheus-compatible metrics, business KPIs dashboard, and configurable alerting

### Security Features

- **JWT-based authentication** with refresh token rotation
- **Shopify token authentication**
- **CSRF protection** with token generation and verification
- **Data encryption at rest** (AES-256-GCM) for sensitive PII fields
- **Two-Factor Authentication (2FA)** - TOTP-based with QR codes and backup codes
- **CORS configuration** with allowed origins
- **Helmet.js security headers**
- **Rate limiting middleware** (Redis-backed for distributed systems)
- **Request ID tracking** for debugging
- **Webhook signature verification** (HMAC) for Shopify and RevenueHunt
- **Input validation** using express-validator
- **XSS protection** via input sanitization
- **Admin API key authentication** for protected endpoints
- **SQL injection prevention** via parameterized queries

## Technology Stack

### Core Dependencies

- **Express.js** (^4.21.2): Web framework
- **PostgreSQL** (pg ^8.11.3): Primary database
- **Node.js**: Runtime environment

### Key Libraries

- **Authentication & Security**
  - `jsonwebtoken` (^9.0.0): JWT token handling
  - `bcryptjs` (^2.4.3): Password hashing
  - `helmet` (^7.0.0): Security headers
  - `cors` (^2.8.5): Cross-origin resource sharing
  - `express-validator` (^7.2.1): Request validation and sanitization

- **Integrations**
  - `stripe` (^18.3.0): Payment processing
  - `soap` (^1.3.0): SOAP client for Tebra/Kareo
  - `axios` (^1.6.0): HTTP client
  - `@sendgrid/mail` (^8.1.6): Email service
  - `redis` (^4.6.0): Caching layer for performance

- **Utilities**
  - `moment-timezone` (^0.6.0): Date/time handling
  - `node-cron` (^3.0.3): Scheduled tasks
  - `uuid` (^9.0.0): Unique ID generation
  - `yup` (^1.2.0): Schema validation
  - `cookie-parser` (^1.4.6): Cookie parsing for CSRF tokens
  - `compression` (^1.8.1): Response compression
  - `bullmq` (^5.66.6): Background job queue
  - `@sentry/node` (^10.36.0): Error tracking
  - `speakeasy` (^2.0.0): TOTP 2FA implementation
  - `qrcode` (^1.5.3): QR code generation for 2FA
  - `prom-client` (^15.1.0): Prometheus metrics client

- **Development & Testing**
  - `nodemon` (^3.1.10): Development auto-reload
  - `jest` (^29.5.0): Testing framework
  - `supertest` (^6.3.3): HTTP assertion library
  - `morgan` (^1.10.0): HTTP request logging
  - `swagger-jsdoc` (^6.2.8): API documentation
  - `swagger-ui-express` (^5.0.1): Swagger UI

## Architecture

### Project Structure

```
backend/
├── src/
│   ├── config/          # Configuration files
│   │   ├── database.js
│   │   └── providerMapping.js
│   ├── controllers/     # Request handlers
│   │   ├── appointmentController.js
│   │   ├── billingController.js
│   │   ├── shopifyController.js
│   │   ├── tebraController.js
│   │   └── ...
│   ├── db/              # Database utilities
│   │   └── pg.js
│   ├── middleware/      # Express middleware
│   │   ├── auth.js
│   │   ├── shopifyAuth.js
│   │   ├── rateLimit.js
│   │   └── ...
│   ├── models/          # Data models (legacy MongoDB, now deprecated)
│   ├── routes/          # API route definitions
│   │   ├── shopify.js
│   │   ├── tebra.js
│   │   ├── billing.js
│   │   └── ...
│   ├── services/        # Business logic services
│   │   ├── tebraService.js
│   │   ├── tebraService/  # Modular Tebra service
│   │   │   ├── soapClient.js
│   │   │   ├── soapUtils.js
│   │   │   ├── soapXmlGenerators.js
│   │   │   ├── patientMethods.js
│   │   │   └── index.js
│   │   ├── subscriptionService.js
│   │   ├── billingSyncService.js
│   │   ├── availabilityService.js
│   │   ├── emailVerificationService.js
│   │   ├── metricsService.js
│   │   ├── businessMetricsService.js
│   │   └── alertingService.js
│   │   ├── cacheService.js
│   │   └── ...
│   ├── utils/           # Utility functions
│   │   ├── locationUtils.js
│   │   ├── productUtils.js
│   │   ├── errorHandler.js
│   │   ├── pagination.js
│   │   └── logger.js
│   ├── db/              # Database utilities and migrations
│   │   ├── pg.js
│   │   ├── migrate.js
│   │   └── migrations/
│   │       ├── 001_create_availability_settings.sql
│   │       ├── 002_create_failed_webhooks.sql
│   │       ├── 003_add_performance_indexes.sql
│   │       ├── 004_create_email_verifications.sql
│   │       └── 005_create_tebra_documents.sql
│   ├── __tests__/       # Test files
│   │   ├── helpers/
│   │   ├── integration/
│   │   ├── e2e/
│   │   └── ...
│   └── index.js         # Application entry point
├── package.json
└── README.md
```

### Data Flow

1. **Customer Purchase Flow**:
   - Customer purchases product on Shopify
   - Webhook triggers patient creation in Tebra
   - Questionnaire data stored as document
   - Subscription created for recurring products
   - Billing synced to Tebra

2. **Appointment Flow**:
   - Customer requests appointment
   - System checks provider availability
   - Appointment created in Tebra
   - Google Meet link generated
   - Notifications sent via SendGrid

3. **Billing Flow**:
   - Monthly cron job processes due subscriptions
   - Charges created in Tebra
   - Payments recorded
   - Billing summaries generated

## Getting Started

### Prerequisites

- Node.js (v14 or higher recommended)
- PostgreSQL (v12 or higher)
- npm or yarn package manager

### Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd backend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   Create a `.env` file in the root directory (see [Environment Variables](#environment-variables) section)

4. **Set up PostgreSQL database**:
   The application will automatically create the database if it doesn't exist. Ensure PostgreSQL is running and accessible.

5. **Start the server**:
   ```bash
   # Development mode (with auto-reload)
   npm run dev

   # Production mode
   npm start
   ```

The server will start on port 5000 (or the port specified in `PORT` environment variable).

## Environment Variables

### Required Variables

#### Server Configuration
```env
PORT=5000
NODE_ENV=development
JWT_SECRET=your-jwt-secret-key
```

#### Database (PostgreSQL)
```env
# Option 1: Connection string
DATABASE_URL=postgresql://user:password@host:port/database

# Option 2: Individual parameters
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=sxrx
PGSSL=false
```

#### Shopify Integration
```env
SHOPIFY_STORE=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=your-access-token
SHOPIFY_API_VERSION=2024-01
```

#### Tebra/Kareo SOAP Integration

**Status:** ✅ Fully compliant with Tebra SOAP 2.1 API

**Implemented Methods (32 total):**
- **Patient Management:** createPatient, getPatient, getPatients, updatePatient, deactivatePatient, searchPatients
- **Appointment Management:** createAppointment, getAppointment, getAppointments, updateAppointment, deleteAppointment
- **Encounter Management:** createEncounter, getEncounterDetails, updateEncounterStatus
- **Billing Operations:** createPayments, getCharges, getPayments
- **Service Management:** getServiceLocations, getProcedureCode, getTransactions, updatePrimaryPatientCase
- **Document Management:** createDocument, deleteDocument, getDocuments (database workaround), getDocumentContent (database workaround)
- **Practice & Provider:** getPractices, getProviders
- **Availability:** getAvailability (⚠️ Not available in SOAP 2.1 - returns empty result for backward compatibility)
- **Appointment Reasons:** createAppointmentReason, getAppointmentReasons

**Key Features:**
- ✅ All methods use official Tebra SOAP 2.1 API
- ✅ XML escaping for security
- ✅ Document retrieval via database workaround (fully functional)
- ✅ Billing uses official CreateEncounter/CreatePayments methods
- ✅ Comprehensive error handling
- ✅ Response normalization
```env
TEBRA_SOAP_WSDL=https://webservice.kareo.com/services/soap/2.1/KareoServices.svc?wsdl
TEBRA_SOAP_ENDPOINT=https://webservice.kareo.com/services/soap/2.1/KareoServices.svc
TEBRA_CUSTOMER_KEY=your-customer-key
TEBRA_USER=your-username
TEBRA_PASSWORD=your-password
TEBRA_PRACTICE_NAME=Your Practice Name
TEBRA_SOAP_NAMESPACE=http://www.kareo.com/api/schemas/
TEBRA_USE_RAW_SOAP=true

# State-specific practice configuration
TEBRA_PRACTICE_ID_CA=california-practice-id
TEBRA_PRACTICE_NAME_CA=California Practice
TEBRA_PROVIDER_ID_CA=california-provider-id

TEBRA_PRACTICE_ID_TX=texas-practice-id
TEBRA_PRACTICE_NAME_TX=Texas Practice
TEBRA_PROVIDER_ID_TX=texas-provider-id
```

#### Stripe
```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

#### SendGrid
```env
SENDGRID_API_KEY=SG....
SENDGRID_FROM=no-reply@yourdomain.com
```

#### Redis (Optional - for caching)
```env
REDIS_URL=redis://localhost:6379
REDIS_ENABLED=true
REDIS_DEFAULT_TTL=300  # 5 minutes default
REDIS_AVAILABILITY_TTL=60  # 1 minute for availability
REDIS_TEBRA_TTL=300  # 5 minutes for Tebra responses
```

#### Email Verification
```env
FRONTEND_URL=https://your-shopify-store.myshopify.com
```

#### CORS
```env
CORS_ALLOWED_ORIGINS=https://your-frontend.com,https://your-shopify-store.com
```

#### Pharmacy/eRx (Optional)
```env
ERX_PROVIDER=tebra  # Options: tebra, surescripts, drfirst, stub
ERX_API_KEY=your-api-key
ERX_API_SECRET=your-api-secret
ERX_BASE_URL=https://api.example.com
```

#### Google Meet (Telemedicine)
```env
GOOGLE_MEET_API_KEY=your-api-key
GOOGLE_MEET_CREDENTIALS=path-to-credentials.json
```

### Optional Configuration

```env
# Tebra API rate limiting
TEBRA_BATCH_SIZE=5
TEBRA_DELAY_BETWEEN_CALLS=200
TEBRA_DELAY_BETWEEN_BATCHES=1000
TEBRA_DELAY_AFTER_GET_IDS=500
```

## API Endpoints

### Base URL
```
http://localhost:5000/api
```

### Authentication

Most endpoints require authentication via:
- **JWT Token**: `Authorization: Bearer <token>`
- **Shopify Token**: `shopify_access_token: <token>` (for Shopify-specific endpoints)

### Main Endpoints

#### Shopify Integration
- `POST /api/shopify/checkout/validate` - Validate checkout before purchase
- `POST /api/shopify/register` - Register Shopify customer
- `GET /api/shopify/products` - Get available products

#### Tebra Integration
- `POST /api/tebra/users/:userId/sync` - Sync user to Tebra
- `GET /api/tebra/documents` - Get patient documents (uses database workaround)
- `GET /api/tebra/documents/:id` - Get document content (uses database workaround)
- `POST /api/tebra/documents` - Create document (stores in Tebra + database)
- `DELETE /api/tebra/documents/:id` - Delete document (removes from Tebra + database)

**Note:** Document retrieval (`getDocuments`, `getDocumentContent`) uses a database-backed workaround since Tebra SOAP 2.1 doesn't support these operations. Documents are automatically stored in PostgreSQL when created. See `TEBRA_DOCUMENT_WORKAROUND.md` for details.
- `GET /api/tebra/users/:userId` - Get Tebra user
- `GET /api/tebra/patients` - Get Tebra patients
- `POST /api/tebra/test-connection` - Test Tebra connection

#### Monitoring & Metrics
- `GET /metrics` - Prometheus metrics endpoint (text format)
- `GET /api/metrics` - JSON metrics summary
- `GET /api/business-metrics/dashboard` - Business KPIs dashboard (requires auth)
- `GET /api/business-metrics/funnel` - Conversion funnel metrics (requires auth)
- `GET /api/business-metrics/appointments` - Appointment statistics (requires auth)
- `GET /api/business-metrics/revenue` - Revenue statistics (requires auth)

#### Patient Management
- `POST /api/tebra-patient/create` - Create patient in Tebra
- `GET /api/tebra-patient/:id` - Get patient details
- `PUT /api/tebra-patient/:id` - Update patient

#### Appointments
- `POST /api/appointments/book` - Book appointment directly
- `DELETE /api/appointments/:appointmentId` - Cancel appointment
- `PUT /api/appointments/:appointmentId/reschedule` - Reschedule appointment
- `GET /api/availability/:state` - Get filtered availability (with caching)
- `GET /api/availability/settings` - Get availability settings (admin only)
- `PUT /api/availability/settings` - Update availability settings (admin only)

#### Billing
- `POST /api/billing/charge` - Create charge
- `GET /api/billing/summary` - Get billing summary
- `POST /api/billing/sync` - Sync billing to Tebra

#### Payments
- `POST /api/payments/process` - Process payment
- `GET /api/payments/:id` - Get payment details

#### Telemedicine
- `POST /api/telemed/create-meeting` - Create Google Meet link
- `GET /api/telemed/meeting/:id` - Get meeting details

#### Webhooks
- `POST /webhooks/stripe` - Stripe webhook handler
- `POST /webhooks/revenue-hunt` - RevenueHunt v2 questionnaire webhook
  - Processes questionnaire responses from RevenueHunt v2
  - **Note:** RevenueHunt v2 does not use webhook secrets/signatures - all webhooks are accepted
  - Creates/updates patient in Tebra EHR
  - Stores questionnaire as consultation document
  - Handles red flags and routes to consultation if needed
  - Returns `action: "schedule_consultation"` if red flags detected
  - Returns `action: "proceed_to_checkout"` if no red flags (creates prescription and adds to cart)
  - Creates prescription if no red flags detected
  - All quiz conditional logic has been validated and fixed
  - Includes retry logic with exponential backoff
  - Dead letter queue for permanently failed webhooks
- `POST /webhooks/shopify/orders/paid` - Shopify order paid webhook
- `POST /webhooks/shopify/orders/created` - Shopify order created webhook
- `POST /webhooks/telemedicine-appointment` - Create telemedicine appointment
- `GET /webhooks/availability/:state` - Get availability by state (with caching)

#### Email Verification
- `POST /api/email-verification/verify` - Verify email with token
- `POST /api/email-verification/resend` - Resend verification email
- `GET /api/email-verification/status` - Check verification status

#### Two-Factor Authentication (2FA)
- `POST /api/2fa/generate` - Generate 2FA secret and QR code
- `POST /api/2fa/enable` - Enable 2FA after verification
- `POST /api/2fa/disable` - Disable 2FA (requires token)
- `POST /api/2fa/verify` - Verify TOTP token
- `GET /api/2fa/status` - Check if 2FA is enabled
- `POST /api/2fa/regenerate-backup-codes` - Regenerate backup codes

#### CSRF Protection
- `GET /api/csrf-token` - Get CSRF token for state-changing requests

#### Utility
- `GET /health` - Health check endpoint (database status, uptime)
- `GET /` - Root endpoint with API information
- `GET /api/geolocation` - Get client geolocation
- `GET /api/products` - Get product information
- `GET /webhooks/practices` - List available practices
  - Returns all practices with IDs, names, and basic information
  - Uses Raw SOAP API (works better with Tebra v2)
  - Response: `{ success: true, practices: [...], totalCount: N }`
- `GET /webhooks/providers/:practiceId` - List providers for practice
  - Returns all providers for a specific practice ID
  - Uses Raw SOAP API (works better with Tebra v2)
  - Response: `{ success: true, providers: [...], totalCount: N, practiceId: "..." }`
- `GET /webhooks/availability/:state` - Get availability by state (with Redis caching)

### API Documentation
- `GET /api-docs` - Swagger/OpenAPI documentation interface
- Interactive API documentation with request/response examples
- Authentication testing interface

### Development Endpoints

(Only available when `NODE_ENV !== 'production'`)
- `GET /api/dev-test/*` - Development test routes

## Database

### PostgreSQL

The application uses PostgreSQL as the primary database. The database connection is managed through a connection pool in `src/db/pg.js`.

#### Automatic Database Creation

The application automatically creates the database if it doesn't exist on startup. It connects to the default `postgres` database to create the target database.

#### Tables

The application creates the following tables automatically via migrations:

- **subscriptions**: Stores subscription records for recurring billing
- **customer_patient_mappings**: Maps Shopify customers to Tebra patients
- **encounters**: Stores encounter/visit records
- **availability_settings**: Stores business hours, blocked dates, and availability configuration
- **failed_webhooks**: Dead letter queue for failed webhook processing
- **email_verifications**: Email verification tokens and status
- **questionnaire_completions**: Tracks questionnaire completions for validation
- **tebra_documents**: Stores document metadata and content (for GetDocuments/GetDocumentContent workaround)
- **user_2fa**: Two-factor authentication secrets and backup codes (encrypted)

#### Database Migrations

The application includes an automatic migration system (`src/db/migrate.js`) that runs on startup:
- Migrations are stored in `src/db/migrations/`
- Migrations are executed in order based on filename
- Failed migrations are logged and don't crash the application
- Migrations are idempotent (safe to run multiple times)

### Legacy MongoDB

⚠️ **Note**: MongoDB has been removed from this project. Any references to MongoDB models are deprecated and kept only for backward compatibility.

## Services & Integrations

### Tebra Service (`src/services/tebraService.js`)

**Status:** ✅ Fully compliant with Tebra SOAP 2.1 API

**Key Features:**
- ✅ 32 API methods implemented and functional
- ✅ All methods use official Tebra SOAP 2.1 API
- ✅ XML escaping for security
- ✅ Document retrieval via database workaround
- ✅ Comprehensive error handling
- ✅ Response normalization

**Document Management:**
- Documents are stored in Tebra via `CreateDocument`
- Document metadata and content are also stored in PostgreSQL `tebra_documents` table
- `getDocuments()` and `getDocumentContent()` retrieve from local database
- Fully functional workaround for SOAP 2.1 limitations

**See:** `TEBRA_API_COMPLETE_VERIFICATION.md` for complete API list

Main service for interacting with Tebra/Kareo SOAP API. Handles:
- Patient CRUD operations
- Appointment management
- Provider and practice queries
- Availability checking
- Document management
- Billing operations

### Subscription Service (`src/services/subscriptionService.js`)

Manages recurring subscriptions:
- Create/update/cancel subscriptions
- Track billing dates
- Query subscriptions due for billing

### Billing Sync Service (`src/services/billingSyncService.js`)

Synchronizes billing between Shopify/Stripe and Tebra:
- Creates charges in Tebra
- Records payments
- Handles refunds

### Monthly Billing Cron (`src/services/monthlyBillingCron.js`)

Automated cron job that:
- Runs daily to check for subscriptions due
- Creates charges in Tebra
- Records payments
- Updates subscription billing dates

### Pharmacy Service (`src/services/pharmacyService.js`)

Handles prescription submissions via eRx providers:
- Tebra native eRx
- Surescripts
- DrFirst
- Stub mode for testing

### Shopify User Service (`src/services/shopifyUserService.js`)

Manages Shopify customer data and synchronization with Tebra.

### Provider Routing Service (`src/services/providerRoutingService.js`)

Routes patients to appropriate providers based on:
- US state
- Product type
- Provider availability

### Availability Service (`src/services/availabilityService.js`)

Manages appointment availability with PostgreSQL persistence:
- Business hours configuration
- Blocked dates and time slots
- Advance booking windows
- State-based filtering
- Integration with Tebra availability API

### Email Verification Service (`src/services/emailVerificationService.js`)

Handles email verification for new user registrations:
- Token generation and validation
- Email sending via SendGrid
- Verification status tracking
- Automatic token cleanup (cron job)

### Cache Service (`src/services/cacheService.js`)

Redis-based caching layer for performance optimization:
- Caches Tebra API responses
- Caches filtered availability data
- Automatic cache invalidation on appointment changes
- Configurable TTLs per cache type
- Graceful fallback if Redis unavailable
- Cache versioning support for schema changes

### Cache Invalidation Service (`src/services/cacheInvalidationService.js`)

Intelligent cache invalidation system:
- Tag-based cache invalidation
- Dependency tracking for related cache keys
- Patient and appointment-specific invalidation
- Pattern-based key deletion

### Cache Warming Service (`src/services/cacheWarmingService.js`)

Pre-populates frequently accessed data:
- Provider cache warming on startup
- Availability cache warming for common states
- Runs automatically on startup and every 30 minutes
- Reduces initial load times

### Encryption Service (`src/services/encryptionService.js`)

Data encryption at rest for sensitive PII:
- AES-256-GCM encryption
- Field-level encryption support
- Automatic encrypt/decrypt middleware
- Configurable via ENCRYPTION_KEY environment variable

### Two-Factor Authentication Service (`src/services/twoFactorAuthService.js`)

TOTP-based 2FA implementation:
- QR code generation for authenticator apps
- Backup code generation and management
- Token verification with time window support
- Enable/disable 2FA functionality

## Development

### Running in Development Mode

```bash
npm run dev
```

This uses `nodemon` to automatically restart the server on file changes.

### Code Structure Guidelines

- **Controllers**: Handle HTTP requests/responses, input validation
- **Services**: Contain business logic and external API calls
- **Routes**: Define API endpoints and middleware chain
- **Middleware**: Request processing (auth, validation, logging)
- **Utils**: Reusable utility functions
- **Models**: Data models (currently deprecated for MongoDB)

### Logging

The application uses `morgan` for HTTP request logging. Logs include:
- Request method and URL
- Response status and size
- Response time
- Request ID for tracing

### Error Handling

Global error handling middleware catches unhandled errors and returns a 500 status with a generic error message. For production, consider implementing more detailed error logging and user-friendly error messages.

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Test Structure

The test suite includes comprehensive coverage:

- **Unit Tests** (`src/utils/__tests__/`, `src/services/__tests__/`):
  - Utility functions (errorHandler, productUtils, locationUtils)
  - Service layer (availabilityService)
  - Isolated testing with mocked dependencies

- **Integration Tests** (`src/__tests__/integration/`):
  - API endpoints (appointments, availability, webhooks, health)
  - End-to-end request/response flows
  - Uses `testApp.js` helper for Express app instance

- **E2E Tests** (`src/__tests__/e2e/`):
  - Complete user journeys (registration, questionnaire, booking)
  - Multi-endpoint flows
  - External service mocking

### Test Helpers

- `src/__tests__/helpers/testApp.js`: Exports Express app instance for testing without starting server
- Jest setup file: `jest.setup.js` - Configures test environment

### Example Test

```javascript
const request = require('supertest');
const app = require('../helpers/testApp');

describe('GET /health', () => {
  it('should return health status', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });
});
```

### Coverage Target

The project aims for 60%+ code coverage. Run `npm run test:coverage` to view coverage reports.

## Deployment

### Production Considerations

1. **Environment Variables**: Ensure all required environment variables are set
2. **Database**: Set up PostgreSQL with proper backups
3. **SSL**: Configure SSL for database connections if required
4. **CORS**: Update `CORS_ALLOWED_ORIGINS` with production frontend URLs
5. **Logging**: Set up proper logging infrastructure
6. **Monitoring**: Implement application monitoring and error tracking
7. **Rate Limiting**: Configure appropriate rate limits for production traffic
8. **Security**: Review and update security headers and authentication

### Process Management

For production, consider using:
- **PM2**: Process manager for Node.js
- **Docker**: Containerization
- **Kubernetes**: Orchestration (for larger deployments)

### Example PM2 Configuration

```json
{
  "name": "sxrx-backend",
  "script": "src/index.js",
  "instances": 2,
  "exec_mode": "cluster",
  "env": {
    "NODE_ENV": "production"
  }
}
```

## Additional Notes

### Health Check Endpoint

The application includes a health check endpoint at `GET /health` that returns:
- Application status
- Database connection status
- Server uptime
- Environment information
- API version

This endpoint is useful for monitoring and load balancer health checks.

### Deprecated Code

Some legacy code from the MongoDB migration is still present but deprecated. See `DEPRECATED.md` for details on files that should not be used.

### Socket.io

Socket.io is included in dependencies but is not currently used in the application. It may be reserved for future real-time features. If not needed, it can be removed from `package.json`.

### State-Based Provider Mapping

The application supports state-based provider routing through `src/config/providerMapping.js`. Currently configured for:
- **California (CA)**: Standard practice, Ketamine not allowed
- **Texas (TX)**: Standard practice, Ketamine allowed

### Webhook Security

Webhook endpoints should be secured:
- Stripe webhooks use signature verification
- Shopify webhooks should verify HMAC signatures
- Consider IP whitelisting for webhook endpoints

### Rate Limiting

Tebra API calls are rate-limited to prevent overwhelming the SOAP service. Configuration is available through environment variables.

### Support

For issues, questions, or contributions, please refer to the project's issue tracker or contact the development team.

---

**Version**: 3.1.0  
**Last Updated**: January 2026

### Recent Updates (v3.1.0)

#### Monitoring & Observability
- ✅ **Prometheus Metrics**: Full Prometheus-compatible metrics with `/metrics` endpoint
- ✅ **Business Metrics Dashboard**: KPI tracking for appointments, patients, revenue, subscriptions
- ✅ **Configurable Alerting**: Threshold-based alerting with email/SMS notifications
- ✅ **Performance Metrics**: HTTP requests, database queries, external API calls, cache performance
- ✅ **System Metrics**: Memory usage, CPU, event loop lag monitoring
- ✅ **Error Tracking**: Categorized error metrics by type and code

#### Documentation & Code Quality
- ✅ **Swagger/OpenAPI**: Comprehensive API documentation for all endpoints
- ✅ **Inline Code Comments**: Detailed documentation for complex algorithms
- ✅ **Architecture Decision Records**: 6 ADRs documenting major architectural choices
- ✅ **Code Organization**: Modularized TebraService, removed legacy MongoDB references

#### Testing
- ✅ **Comprehensive Test Suite**: Unit, integration, and E2E tests for all major flows
- ✅ **Webhook Tests**: Integration tests for RevenueHunt, Stripe, and Shopify webhooks
- ✅ **Controller Tests**: Unit tests for appointment, patient, and billing controllers
- ✅ **Service Tests**: Unit tests for cache, email verification, billing sync, subscriptions

### Previous Updates (v3.0.0)

#### Security Enhancements
- ✅ **CSRF Protection**: Token-based CSRF protection with configurable exclusions
- ✅ **Data Encryption**: AES-256-GCM encryption for sensitive PII fields at rest
- ✅ **Two-Factor Authentication**: TOTP-based 2FA with QR code generation and backup codes
- ✅ **Refresh Token System**: Token rotation and session timeout management

#### Performance & Infrastructure
- ✅ **Advanced Caching**: Tag-based cache invalidation, cache warming, and versioning
- ✅ **Background Job Queue**: BullMQ integration for async processing
- ✅ **Error Tracking**: Sentry integration with context-rich error reporting
- ✅ **Performance Monitoring**: Request timing, DB queries, external API call tracking
- ✅ **Service Worker**: Offline support and API response caching (frontend)

#### Previous Updates (v2.0.0)
- ✅ **Email Verification System**: Complete email verification flow for new registrations
- ✅ **Redis Caching**: Performance optimization with Redis caching layer
- ✅ **Comprehensive Testing**: Unit, integration, and E2E test suites
- ✅ **Code Modularization**: Refactored large files into focused modules
- ✅ **Enhanced Error Handling**: Standardized error responses with user-friendly messages
- ✅ **Database Migrations**: Automatic migration system for schema changes
- ✅ **API Documentation**: Swagger/OpenAPI documentation with interactive UI
- ✅ **Performance Indexes**: Database indexes for query optimization
- ✅ **Webhook Retry Logic**: Exponential backoff and dead letter queue
- ✅ **Availability Management**: PostgreSQL-backed availability settings

