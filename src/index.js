const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const dotenv = require('dotenv');
const geolocationMiddleware = require('./middleware/geolocation');
const requestId = require('./middleware/requestId');
const logger = require('./utils/logger');

// Load environment variables
dotenv.config();

// Suppress Redis version warnings globally
// These warnings come from the redis client library and BullMQ
// They're informational only and don't affect functionality
const originalWarn = console.warn;
const originalError = console.error;

console.warn = (...args) => {
  const message = args.join(' ');
  if (message.includes('highly recommended to use a minimum Redis version') || 
      message.includes('minimum Redis version of 6.2.0') ||
      message.includes('Current: 6.0.16')) {
    // Suppress Redis version warnings - they're informational only
    return;
  }
  originalWarn.apply(console, args);
};

console.error = (...args) => {
  const message = args.join(' ');
  if (message.includes('highly recommended to use a minimum Redis version') || 
      message.includes('minimum Redis version of 6.2.0') ||
      message.includes('Current: 6.0.16')) {
    // Suppress Redis version warnings - they're informational only
    return;
  }
  originalError.apply(console, args);
};

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
    // If no allowlist is configured, allow all (useful for local development).
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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'shopify_access_token', 'X-CSRF-Token'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
};

app.use(cors(corsOptions));
// Ensure preflight OPTIONS always returns CORS headers
app.options('*', cors(corsOptions));
app.use(requestId);
app.use(helmet());
// Performance monitoring middleware
const { performanceMonitor, getPerformanceMetrics, getPrometheusMetrics } = require('./middleware/performanceMonitor');
app.use(performanceMonitor);

// Performance metrics endpoint (JSON format)
app.get('/api/metrics', (req, res) => {
  getPerformanceMetrics(req, res);
});

// Prometheus metrics endpoint (text format for scraping)
app.get('/metrics', async (req, res) => {
  await getPrometheusMetrics(req, res);
});

// Initialize error tracking (Sentry)
const errorTracking = require('./utils/errorTracking');
errorTracking.initialize();
// Response compression (gzip) - compress responses > 1KB
app.use(compression({
  level: 6, // Compression level (0-9, 6 is a good balance)
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    // Don't compress if client doesn't support it
    if (req.headers['x-no-compression']) {
      return false;
    }
    // Use compression for all other responses
    return compression.filter(req, res);
  }
}));
app.use(morgan(':method :url :status :res[content-length] - :response-time ms reqId=:req[id]'));
// Global JSON parser with default limit (can be overridden per route)
app.use(express.json({ limit: '1mb' }));
app.use(geolocationMiddleware);

// CSRF protection (generate tokens for all requests, protect state-changing methods)
const { csrfTokenGenerator, csrfProtection, getCSRFToken } = require('./middleware/csrf');
const cookieParser = require('cookie-parser');
app.use(cookieParser());

// Generate CSRF tokens for all requests
app.use(csrfTokenGenerator());

// Apply CSRF protection to state-changing methods (exclude webhooks and public endpoints)
app.use(csrfProtection({
  requireToken: process.env.CSRF_REQUIRED !== 'false', // Can be disabled via env var
  excludedMethods: ['GET', 'HEAD', 'OPTIONS'],
  excludedPaths: [
    '/webhooks',
    '/api/webhooks',
    '/health',
    '/api/health',
    '/api/public',
    '/api/csrf-token' // Token endpoint itself
  ]
}));

// CSRF token endpoint
app.get('/api/csrf-token', getCSRFToken);

// API Documentation (Swagger)
const { swaggerSpec, swaggerUi } = require('./swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'SXRX API Documentation'
}));

// Routes
app.use('/api/shopify', require('./routes/shopifyRegistration'));
app.use('/api/shopify', require('./routes/shopify'));
app.use('/api/auth', require('./routes/shopifyAuth'));
app.use('/api/shopify-storefront', require('./routes/shopifyStorefrontAuth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/tebra', require('./routes/tebra'));
app.use('/api/availability', require('./routes/availability'));
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
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/business-metrics', require('./routes/businessMetrics'));
app.use('/api/email-verification', require('./routes/emailVerification'));
app.use('/api/2fa', require('./routes/twoFactorAuth'));
app.use('/webhooks', require('./routes/webhooks'));
// Development-only test routes (only available in dev mode)
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/dev-test', require('./routes/devTestRoutes'));
}
// Cache database module for health check
const dbModule = require('./db/pg');

// Run database migrations on startup
(async () => {
  try {
    const { runMigrations } = require('./db/migrate');
    await runMigrations();
  } catch (error) {
    console.error('[STARTUP] Migration failed:', error);
    // Don't crash the server, but log the error
  }
})();

// Graceful shutdown - close job queues
process.on('SIGTERM', async () => {
  logger.info('[SHUTDOWN] SIGTERM received, closing job queues...');
  try {
    const jobQueueService = require('./services/jobQueue');
    await jobQueueService.close();
  } catch (error) {
    logger.error('[SHUTDOWN] Error closing job queues', { error: error.message });
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('[SHUTDOWN] SIGINT received, closing job queues...');
  try {
    const jobQueueService = require('./services/jobQueue');
    await jobQueueService.close();
  } catch (error) {
    logger.error('[SHUTDOWN] Error closing job queues', { error: error.message });
  }
  process.exit(0);
});

// Global error handler (must be last)
app.use((error, req, res, next) => {
  errorTracking.errorHandler(error, req, res, next);
  
  // Send error response
  const statusCode = error.statusCode || error.status || 500;
  const message = error.message || 'Internal server error';
  
  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  logger.error('[UNHANDLED_REJECTION] Unhandled promise rejection', {
    reason: reason?.message || reason,
    stack: reason?.stack
  });
  errorTracking.captureException(reason instanceof Error ? reason : new Error(String(reason)), {
    tags: { type: 'unhandled_rejection' }
  });
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  logger.error('[UNCAUGHT_EXCEPTION] Uncaught exception', {
    error: error.message,
    stack: error.stack
  });
  errorTracking.captureException(error, {
    tags: { type: 'uncaught_exception' }
  });
  // Exit after logging
  setTimeout(() => process.exit(1), 1000);
});

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 database:
 *                   type: string
 *                   example: connected
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *       503:
 *         description: Service is degraded
 */
// Health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: APP_VERSION,
    checks: {}
  };

  let allHealthy = true;

  // Check database connection
  try {
    await dbModule.query('SELECT 1');
    health.checks.database = { status: 'healthy', message: 'connected' };
  } catch (error) {
    health.checks.database = { status: 'unhealthy', message: 'disconnected', error: error.message };
    health.status = 'degraded';
    allHealthy = false;
    logger.warn('Health check: Database disconnected', { error: error.message });
  }

  // Check Redis connectivity
  try {
    const cacheService = require('./services/cacheService');
    if (cacheService.enabled && cacheService.client) {
      try {
        await cacheService.client.ping();
        health.checks.redis = { status: 'healthy', message: 'connected' };
      } catch (redisError) {
        health.checks.redis = { status: 'unhealthy', message: 'disconnected', error: redisError.message };
        health.status = 'degraded';
        allHealthy = false;
        logger.warn('Health check: Redis disconnected', { error: redisError.message });
      }
    } else {
      health.checks.redis = { status: 'disabled', message: 'Redis caching is disabled' };
    }
  } catch (error) {
    health.checks.redis = { status: 'error', message: 'Failed to check Redis', error: error.message };
    health.status = 'degraded';
    allHealthy = false;
  }

  // Check Tebra API connectivity
  try {
    const tebraService = require('./services/tebraService');
    const connectionTest = await Promise.race([
      tebraService.testConnection(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]);
    if (connectionTest && connectionTest.success) {
      health.checks.tebra = { status: 'healthy', message: 'connected', mode: connectionTest.mode };
    } else {
      health.checks.tebra = { status: 'unhealthy', message: 'connection test failed' };
      health.status = 'degraded';
      allHealthy = false;
    }
  } catch (error) {
    health.checks.tebra = { status: 'unhealthy', message: 'connection failed', error: error.message };
    health.status = 'degraded';
    allHealthy = false;
    logger.warn('Health check: Tebra API disconnected', { error: error.message });
  }

  // Check Shopify API connectivity (optional, non-blocking)
  try {
    if (process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ACCESS_TOKEN) {
      const axios = require('axios');
      const shopifyUrl = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/shop.json`;
      const shopifyResponse = await Promise.race([
        axios.get(shopifyUrl, {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN
          },
          timeout: 3000
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      ]);
      if (shopifyResponse && shopifyResponse.status === 200) {
        health.checks.shopify = { status: 'healthy', message: 'connected' };
      } else {
        health.checks.shopify = { status: 'unhealthy', message: 'API call failed' };
      }
    } else {
      health.checks.shopify = { status: 'not_configured', message: 'Shopify credentials not configured' };
    }
  } catch (error) {
    health.checks.shopify = { status: 'unhealthy', message: 'connection failed', error: error.message };
    // Shopify check failure doesn't degrade overall status (non-critical)
    logger.warn('Health check: Shopify API check failed', { error: error.message });
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Webhook retry processor (runs every 5 minutes)
const cron = require('node-cron');
const webhookRetryService = require('./services/webhookRetryService');
const billingController = require('./controllers/billingController');
const revenueHuntWebhookController = require('./controllers/revenueHuntWebhookController');
const appointmentReminderService = require('./services/appointmentReminderService');
const alertingService = require('./services/alertingService');
const businessMetricsService = require('./services/businessMetricsService');
const metricsService = require('./services/metricsService');

// Schedule webhook retry processing every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  try {
    const handlers = {
      'shopify_order_created': billingController.handleShopifyOrderCreated,
      'shopify_order_paid': billingController.handleShopifyOrderPaid,
      'revenuehunt': revenueHuntWebhookController.handleRevenueHunt
    };
    
    await webhookRetryService.processPendingWebhooks(handlers);
  } catch (error) {
    console.error('[CRON] Webhook retry processing failed:', error);
  }
});

// Schedule appointment reminders
// 24-hour reminders (runs every hour, checks for appointments 24h from now)
cron.schedule('0 * * * *', async () => {
  try {
    await appointmentReminderService.processReminders(24);
  } catch (error) {
    console.error('[CRON] 24h appointment reminder processing failed:', error);
  }
});

// 2-hour reminders (runs every 15 minutes, checks for appointments 2h from now)
cron.schedule('*/15 * * * *', async () => {
  try {
    await appointmentReminderService.processReminders(2);
  } catch (error) {
    console.error('[CRON] 2h appointment reminder processing failed:', error);
  }
});

// Metrics and alerting check (runs every minute)
if (alertingService.enabled) {
  cron.schedule('* * * * *', async () => {
    try {
      const metrics = metricsService.getMetricsSummary();
      await alertingService.checkThresholds(metrics);
    } catch (error) {
      logger.error('[CRON] Metrics/alerting check failed', { 
        error: error?.message || error?.toString() || 'Unknown error',
        stack: error?.stack
      });
    }
  });
}

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

// Error handling middleware (standardized)
const { errorHandler } = require('./utils/errorHandler');
app.use(errorHandler);

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
  
  // Start email verification cleanup cron job (daily at 2 AM)
  try {
    const cron = require('node-cron');
    const emailVerificationService = require('./services/emailVerificationService');
    
    // Run daily at 2 AM to clean up expired verification tokens
    cron.schedule('0 2 * * *', async () => {
      try {
        const result = await emailVerificationService.cleanupExpiredTokens();
        logger.info('Email verification cleanup completed', { deleted: result.deleted });
      } catch (error) {
        logger.error('Email verification cleanup failed', { error: error.message });
      }
    });
    
    logger.info('Email verification cleanup cron job started');
  } catch (e) {
    logger.warn('Failed to start email verification cleanup cron job', { error: e?.message || e });
  }
  
  // Start cache warming (on startup and periodically)
  try {
    const cacheWarmingService = require('./services/cacheWarmingService');
    const cron = require('node-cron');
    
    // Warm cache on startup (after a short delay)
    setTimeout(async () => {
      try {
        await cacheWarmingService.warmAll();
      } catch (error) {
        logger.warn('Cache warming on startup failed', { error: error?.message || error });
      }
    }, 10000); // 10 seconds after startup
    
    // Warm cache every 30 minutes
    cron.schedule('*/30 * * * *', async () => {
      try {
        await cacheWarmingService.warmAll();
      } catch (error) {
        logger.error('Scheduled cache warming failed', { error: error.message });
      }
    });
    
    logger.info('Cache warming service started');
  } catch (e) {
    logger.warn('Failed to start cache warming service', { error: e?.message || e });
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
    // Close Redis cache connection
    try {
      const cacheService = require('./services/cacheService');
      await cacheService.close();
    } catch (error) {
      logger.warn('Error closing Redis connection', { error: error.message });
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