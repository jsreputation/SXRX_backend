// backend/src/swagger.js
// Swagger/OpenAPI documentation configuration

const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'SXRX Backend API',
      version: '1.0.0',
      description: 'API documentation for SXRX telemedicine platform',
      contact: {
        name: 'SXRX Support',
        email: 'support@sxrx.com'
      },
      license: {
        name: 'Proprietary',
        url: 'https://sxrx.com'
      }
    },
    servers: [
      {
        url: process.env.BACKEND_URL || 'http://localhost:3000',
        description: 'Backend API Server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT access token obtained from login endpoint'
        },
        AdminApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Admin-API-Key',
          description: 'Admin API key for protected endpoints'
        },
        ShopifyToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Shopify-Storefront-Access-Token',
          description: 'Shopify Storefront API access token'
        }
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            message: {
              type: 'string',
              example: 'Error message'
            },
            error: {
              type: 'string',
              example: 'Technical error details (development only)'
            },
            code: {
              type: 'string',
              example: 'VALIDATION_ERROR'
            },
            requestId: {
              type: 'string',
              example: 'req-123456'
            }
          }
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            message: {
              type: 'string',
              example: 'Operation successful'
            },
            requestId: {
              type: 'string',
              example: 'req-123456'
            }
          }
        },
        Appointment: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            patientId: { type: 'string' },
            startTime: { type: 'string', format: 'date-time' },
            endTime: { type: 'string', format: 'date-time' },
            appointmentName: { type: 'string' },
            appointmentStatus: { type: 'string' },
            providerId: { type: 'string' },
            practiceId: { type: 'string' }
          }
        },
        AvailabilitySlot: {
          type: 'object',
          properties: {
            startTime: { type: 'string', format: 'date-time' },
            endTime: { type: 'string', format: 'date-time' },
            providerId: { type: 'string' },
            practiceId: { type: 'string' }
          }
        },
        PaginatedResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array' },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total: { type: 'integer' },
                totalPages: { type: 'integer' },
                hasNextPage: { type: 'boolean' },
                hasPreviousPage: { type: 'boolean' }
              }
            }
          }
        }
      }
    },
    tags: [
      {
        name: 'Appointments',
        description: 'Appointment booking and management'
      },
      {
        name: 'Patients',
        description: 'Patient management and operations'
      },
      {
        name: 'Authentication',
        description: 'User authentication, email verification, and 2FA'
      },
      {
        name: 'Availability',
        description: 'Appointment availability management'
      },
      {
        name: 'Webhooks',
        description: 'Webhook endpoints for external services'
      },
      {
        name: 'Billing',
        description: 'Billing and payment operations'
      },
      {
        name: 'Documents',
        description: 'Document management in Tebra'
      },
      {
        name: 'Providers',
        description: 'Healthcare provider information'
      },
      {
        name: 'Admin',
        description: 'Admin-only endpoints'
      },
      {
        name: 'Health',
        description: 'Health check and system status'
      }
    ]
  },
  apis: [
    './src/routes/*.js',
    './src/controllers/*.js',
    './src/index.js'
  ]
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = {
  swaggerSpec,
  swaggerUi
};
