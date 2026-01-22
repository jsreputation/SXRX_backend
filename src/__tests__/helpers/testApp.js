// Test helper to create Express app instance for testing
// This exports the app without starting the server

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const dotenv = require('dotenv');
const geolocationMiddleware = require('../middleware/geolocation');
const requestId = require('../middleware/requestId');

// Load test environment variables
dotenv.config({ path: '.env.test' });

const app = express();

// CORS configuration (simplified for tests)
const corsOptions = {
  origin: true,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'shopify_access_token'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(requestId);
app.use(helmet());
// Suppress morgan in tests unless DEBUG is set
if (!process.env.DEBUG) {
  app.use(morgan('test'));
}
app.use(express.json({ limit: '1mb' }));
app.use(geolocationMiddleware);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    database: 'connected',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'SXRX Backend API',
    version: '1.0.0',
    status: 'running'
  });
});

// Load routes (with mocked external services in tests)
app.use('/api/appointments', require('../routes/appointments'));
app.use('/api/availability', require('../routes/availability'));
app.use('/webhooks', require('../routes/webhooks'));
app.use('/api/admin', require('../routes/admin'));

// Error handling middleware
const { errorHandler } = require('../utils/errorHandler');
app.use(errorHandler());

module.exports = app;
