const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const dotenv = require('dotenv');
const geolocationMiddleware = require('./middleware/geolocation');
const requestId = require('./middleware/requestId');
const logger = require('./utils/logger');

// Load environment variables
dotenv.config();

// Cache package.json version
const packageJson = require('../package.json');
const APP_VERSION = packageJson.version;

const app = express();

// Stripe webhook must read raw body BEFORE json parser
app.use('/webhooks', require('./routes/stripeWebhook'));

// Middleware
// CORS with allowed origins from env (comma-separated)
function normalizeOrigin(input) {
  if (!input) return null;
  try {
    // If already an origin, normalize via URL
    const u = new URL(input);
    return u.origin;
  } catch (e) {
    // If it's a hostname like sxrx-ca.myshopify.com, add https://
    try {
      const u = new URL(`https://${String(input).replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`);
      return u.origin;
    } catch {
      return null;
    }
  }
}

const allowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(normalizeOrigin)
    .filter(Boolean)
);

// Helpful defaults to reduce misconfig:
// - FRONTEND_URL is already required for some flows (payments) and often equals your storefront domain.
const frontendOrigin = normalizeOrigin(process.env.FRONTEND_URL);
if (frontendOrigin) allowedOrigins.add(frontendOrigin);

// - Allow the permanent Shopify domain if provided in env
const shopDomain = process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN;
const shopOrigin = normalizeOrigin(shopDomain);
if (shopOrigin) allowedOrigins.add(shopOrigin);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow non-browser or same-origin

    const normalized = normalizeOrigin(origin) || origin;
    // If no allowlist is configured, allow all (useful for local/ngrok dev).
    if (allowedOrigins.size === 0) return cb(null, true);

    if (allowedOrigins.has(normalized)) return cb(null, true);

    // Common Shopify storefront domains (optional): allow *.myshopify.com if explicitly enabled
    if (String(process.env.CORS_ALLOW_MYSHOPIFY || 'false').toLowerCase() === 'true') {
      try {
        const host = new URL(normalized).hostname;
        if (host.endsWith('.myshopify.com')) return cb(null, true);
      } catch (e) {}
    }

    console.warn(`⚠️ [CORS] Blocked origin: ${origin}. Allowed: ${Array.from(allowedOrigins).join(', ') || '(none)'}`);
    return cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'shopify_access_token'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
};

app.use(cors(corsOptions));
// Ensure preflight OPTIONS always returns CORS headers
app.options('*', cors(corsOptions));
app.use(requestId);
app.use(helmet());
app.use(morgan(':method :url :status :res[content-length] - :response-time ms reqId=:req[id]'));
app.use(express.json());
app.use(geolocationMiddleware);

// Routes
app.use('/api/shopify', require('./routes/shopifyRegistration'));
app.use('/api/shopify', require('./routes/shopify'));
app.use('/api/auth', require('./routes/shopifyAuth'));
app.use('/api/shopify-storefront', require('./routes/shopifyStorefrontAuth'));
app.use('/api/tebra', require('./routes/tebra'));
app.use('/api/tebra-patient', require('./routes/tebraPatient'));
app.use('/api/tebra-appointment', require('./routes/tebraAppointment'));
app.use('/api/tebra-provider', require('./routes/tebraProvider'));
app.use('/api/tebra-document', require('./routes/tebraDocument'));
app.use('/api/tebra-appointment-reason', require('./routes/tebraAppointmentReason'));
app.use('/api/tebra-questionnaire', require('./routes/tebraQuestionnaire'));
app.use('/api/telemed', require('./routes/telemed'));
app.use('/api/products', require('./routes/products'));
app.use('/api/geolocation', require('./routes/geolocation'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/new-patient', require('./routes/newPatientForm'));
app.use('/webhooks', require('./routes/webhooks'));
// Development-only test routes (only available in dev mode)
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/dev-test', require('./routes/devTestRoutes'));
}
// Cache database module for health check
const dbModule = require('./db/pg');

// Health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: APP_VERSION,
  };

  // Check database connection
  try {
    await dbModule.query('SELECT 1');
    health.database = 'connected';
  } catch (error) {
    health.database = 'disconnected';
    health.status = 'degraded';
    logger.warn('Health check: Database disconnected', { error: error.message });
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Base route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Welcome to SXRX API',
    clientLocation: req.clientLocation,
    corsAllowedOrigins: allowedOrigins,
    version: APP_VERSION,
    health: '/health'
  });
});

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    message: 'Route not found',
    path: req.path,
    method: req.method
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  // Log error details
  logger.errorWithContext(err, {
    path: req.path,
    method: req.method,
    requestId: req.id,
    status: err.status || err.statusCode || 500
  });

  // Determine status code
  const statusCode = err.status || err.statusCode || 500;
  
  // Prepare error response
  const errorResponse = {
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      details: err.details
    })
  };

  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      ...errorResponse,
      message: 'Validation error',
      errors: err.errors
    });
  }

  if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      ...errorResponse,
      message: 'Authentication failed'
    });
  }

  // Default error response
  res.status(statusCode).json(errorResponse);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason, promise });
  // In production, you might want to exit the process
  // process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.errorWithContext(error, { type: 'uncaughtException' });
  // In production, you might want to exit the process
  // process.exit(1);
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`, { 
    environment: process.env.NODE_ENV || 'development',
    version: APP_VERSION 
  });
  
  // Validate critical environment variables
  console.log('\n🔍 [STARTUP] Checking critical environment variables...');
  if (process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN) {
    console.log(`✅ SHOPIFY_STORE: ${process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN}`);
  } else {
    console.log('❌ SHOPIFY_STORE or SHOPIFY_STORE_DOMAIN: NOT SET');
  }
  
  if (process.env.SHOPIFY_ACCESS_TOKEN) {
    const tokenPreview = process.env.SHOPIFY_ACCESS_TOKEN.length > 10 
      ? `${process.env.SHOPIFY_ACCESS_TOKEN.substring(0, 8)}...${process.env.SHOPIFY_ACCESS_TOKEN.substring(process.env.SHOPIFY_ACCESS_TOKEN.length - 4)}`
      : 'INVALID';
    console.log(`✅ SHOPIFY_ACCESS_TOKEN: ${tokenPreview} (length: ${process.env.SHOPIFY_ACCESS_TOKEN.length})`);
  } else {
    console.log('❌ SHOPIFY_ACCESS_TOKEN: NOT SET');
  }
  console.log('');
  
  // Start monthly billing cron job
  try {
    const { startMonthlyBillingCron } = require('./services/monthlyBillingCron');
    startMonthlyBillingCron();
    logger.info('Monthly billing cron job started');
  } catch (e) {
    logger.warn('Failed to start monthly billing cron job', { error: e?.message || e });
  }
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  logger.info(`${signal} signal received: closing HTTP server`);
  server.close(async () => {
    logger.info('HTTP server closed');
    // Close database connections
    try {
      const { ensurePool } = require('./db/pg');
      const pool = await ensurePool();
      if (pool) {
        await pool.end();
        logger.info('Database connections closed');
      }
    } catch (error) {
      logger.warn('Error closing database connections', { error: error.message });
    }
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT')); 