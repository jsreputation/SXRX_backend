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
- **Appointment Scheduling**: Manage appointments with availability checking
- **Billing & Subscriptions**: Handle one-time and recurring billing through Stripe and Tebra
- **Questionnaire Processing**: Handle patient questionnaires and store as documents
  - All quiz conditional logic validated and fixed (37 broken references fixed)
  - Supports follow-up questions and "Other" text inputs
  - Processes red flags and routes to consultation when needed
- **State-Based Routing**: Route patients to appropriate providers based on US state
- **Product Validation**: Validate checkout based on state restrictions and questionnaire completion
- **Telemedicine**: Create Google Meet links for virtual consultations
- **Pharmacy Integration**: Submit prescriptions via eRx providers (Tebra, Surescripts, DrFirst)
- **Monthly Billing Cron**: Automated recurring subscription billing
- **Webhook Handling**: Process webhooks from Shopify, Stripe, and RevenueHunt

### Security Features

- JWT-based authentication
- Shopify token authentication
- CORS configuration with allowed origins
- Helmet.js security headers
- Rate limiting middleware
- Request ID tracking for debugging

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

- **Integrations**
  - `stripe` (^18.3.0): Payment processing
  - `soap` (^1.3.0): SOAP client for Tebra/Kareo
  - `axios` (^1.6.0): HTTP client
  - `@sendgrid/mail` (^7.7.0): Email service

- **Utilities**
  - `moment-timezone` (^0.6.0): Date/time handling
  - `node-cron` (^3.0.3): Scheduled tasks
  - `uuid` (^9.0.0): Unique ID generation
  - `express-validator` (^7.2.1): Request validation
  - `yup` (^1.2.0): Schema validation

- **Development**
  - `nodemon` (^3.1.10): Development auto-reload
  - `jest` (^29.5.0): Testing framework
  - `morgan` (^1.10.0): HTTP request logging

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
│   │   ├── subscriptionService.js
│   │   ├── billingSyncService.js
│   │   └── ...
│   ├── utils/           # Utility functions
│   │   ├── locationUtils.js
│   │   └── productUtils.js
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
- `GET /api/tebra/users/:userId` - Get Tebra user
- `GET /api/tebra/patients` - Get Tebra patients
- `POST /api/tebra/test-connection` - Test Tebra connection

#### Patient Management
- `POST /api/tebra-patient/create` - Create patient in Tebra
- `GET /api/tebra-patient/:id` - Get patient details
- `PUT /api/tebra-patient/:id` - Update patient

#### Appointments
- `POST /api/tebra-appointment/create` - Create appointment
- `GET /api/tebra-appointment/:id` - Get appointment
- `GET /api/tebra-appointment/availability` - Get availability

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
- `POST /webhooks/revenue-hunt` - RevenueHunt questionnaire webhook
  - Processes questionnaire responses from RevenueHunt v2
  - Creates/updates patient in Tebra EHR
  - Stores questionnaire as consultation document
  - Handles red flags and routes to consultation if needed
  - Returns `action: "schedule_consultation"` if red flags detected
  - Returns `action: "proceed_to_checkout"` if no red flags (creates prescription and adds to cart)
  - Creates prescription if no red flags detected
  - All quiz conditional logic has been validated and fixed
- `POST /webhooks/shopify/orders/paid` - Shopify order paid webhook
- `POST /webhooks/telemedicine-appointment` - Create telemedicine appointment

#### Utility
- `GET /health` - Health check endpoint (database status, uptime)
- `GET /api/geolocation` - Get client geolocation
- `GET /api/products` - Get product information
- `GET /webhooks/practices` - List available practices
- `GET /webhooks/providers/:practiceId` - List providers for practice
- `GET /webhooks/availability/:state` - Get availability by state

### Development Endpoints

(Only available when `NODE_ENV !== 'production'`)
- `GET /api/dev-test/*` - Development test routes

## Database

### PostgreSQL

The application uses PostgreSQL as the primary database. The database connection is managed through a connection pool in `src/db/pg.js`.

#### Automatic Database Creation

The application automatically creates the database if it doesn't exist on startup. It connects to the default `postgres` database to create the target database.

#### Tables

The application creates the following tables automatically:

- **subscriptions**: Stores subscription records for recurring billing
- **customer_patient_mappings**: Maps Shopify customers to Tebra patients
- **encounters**: Stores encounter/visit records

### Legacy MongoDB

⚠️ **Note**: MongoDB has been removed from this project. Any references to MongoDB models are deprecated and kept only for backward compatibility.

## Services & Integrations

### Tebra Service (`src/services/tebraService.js`)

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

Tests are written using Jest. Test files should be placed alongside source files with `.test.js` or `.spec.js` extension.

### Example Test

```javascript
const request = require('supertest');
const app = require('../src/index');

describe('GET /', () => {
  it('should return welcome message', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('message');
  });
});
```

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

**Version**: 1.0.0  
**Last Updated**: 2025

