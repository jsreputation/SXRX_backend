// backend/src/utils/errorTracking.js
// Error tracking integration with Sentry

const logger = require('./logger');

let Sentry = null;
let isInitialized = false;

/**
 * Initialize error tracking (Sentry)
 */
function initialize() {
  if (isInitialized) return;
  
  const sentryDsn = process.env.SENTRY_DSN;
  if (!sentryDsn) {
    logger.info('[ERROR_TRACKING] Sentry DSN not configured, error tracking disabled');
    return;
  }

  try {
    Sentry = require('@sentry/node');
    
    Sentry.init({
      dsn: sentryDsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1, // 10% of transactions
      beforeSend(event, hint) {
        // Filter out sensitive data
        if (event.request) {
          // Remove sensitive headers
          if (event.request.headers) {
            delete event.request.headers['authorization'];
            delete event.request.headers['x-shopify-access-token'];
            delete event.request.headers['x-shopify-hmac-sha256'];
          }
          
          // Remove sensitive query params
          if (event.request.query_string) {
            const params = new URLSearchParams(event.request.query_string);
            params.delete('token');
            params.delete('access_token');
            event.request.query_string = params.toString();
          }
        }
        
        return event;
      }
    });
    
    isInitialized = true;
    logger.info('[ERROR_TRACKING] Sentry initialized successfully');
  } catch (error) {
    logger.warn('[ERROR_TRACKING] Failed to initialize Sentry', { error: error.message });
  }
}

/**
 * Capture an exception
 * @param {Error} error - Error object
 * @param {Object} context - Additional context
 */
function captureException(error, context = {}) {
  if (!isInitialized || !Sentry) {
    logger.error('[ERROR_TRACKING] Error not captured (Sentry not initialized)', {
      error: error.message,
      context
    });
    return;
  }

  try {
    Sentry.withScope((scope) => {
      // Add context
      if (context.user) {
        scope.setUser(context.user);
      }
      if (context.tags) {
        Object.entries(context.tags).forEach(([key, value]) => {
          scope.setTag(key, value);
        });
      }
      if (context.extra) {
        Object.entries(context.extra).forEach(([key, value]) => {
          scope.setExtra(key, value);
        });
      }
      if (context.request) {
        scope.setContext('request', {
          method: context.request.method,
          url: context.request.url,
          path: context.request.path,
          ip: context.request.ip,
          userAgent: context.request.get('user-agent')
        });
      }
      
      Sentry.captureException(error);
    });
  } catch (err) {
    logger.warn('[ERROR_TRACKING] Failed to capture exception', { error: err.message });
  }
}

/**
 * Capture a message
 * @param {string} message - Message to capture
 * @param {string} level - Log level (info, warning, error)
 * @param {Object} context - Additional context
 */
function captureMessage(message, level = 'info', context = {}) {
  if (!isInitialized || !Sentry) {
    logger[level]('[ERROR_TRACKING] Message not captured (Sentry not initialized)', { message, context });
    return;
  }

  try {
    Sentry.withScope((scope) => {
      if (context.tags) {
        Object.entries(context.tags).forEach(([key, value]) => {
          scope.setTag(key, value);
        });
      }
      if (context.extra) {
        Object.entries(context.extra).forEach(([key, value]) => {
          scope.setExtra(key, value);
        });
      }
      
      Sentry.captureMessage(message, level);
    });
  } catch (err) {
    logger.warn('[ERROR_TRACKING] Failed to capture message', { error: err.message });
  }
}

/**
 * Add breadcrumb for debugging
 * @param {string} message - Breadcrumb message
 * @param {string} category - Breadcrumb category
 * @param {string} level - Log level
 * @param {Object} data - Additional data
 */
function addBreadcrumb(message, category = 'default', level = 'info', data = {}) {
  if (!isInitialized || !Sentry) {
    return;
  }

  try {
    Sentry.addBreadcrumb({
      message,
      category,
      level,
      data,
      timestamp: Date.now() / 1000
    });
  } catch (err) {
    logger.warn('[ERROR_TRACKING] Failed to add breadcrumb', { error: err.message });
  }
}

/**
 * Set user context
 * @param {Object} user - User information
 */
function setUser(user) {
  if (!isInitialized || !Sentry) {
    return;
  }

  try {
    Sentry.setUser(user);
  } catch (err) {
    logger.warn('[ERROR_TRACKING] Failed to set user', { error: err.message });
  }
}

/**
 * Express error handler middleware
 */
function errorHandler(error, req, res, next) {
  // Capture error with context
  captureException(error, {
    request: req,
    user: req.user ? {
      id: req.user.id,
      email: req.user.email,
      customerId: req.user.customerId
    } : null,
    tags: {
      route: req.path,
      method: req.method
    },
    extra: {
      requestId: req.id,
      body: req.body,
      query: req.query
    }
  });

  // Call next error handler
  next(error);
}

// Initialize on module load
initialize();

module.exports = {
  initialize,
  captureException,
  captureMessage,
  addBreadcrumb,
  setUser,
  errorHandler
};
