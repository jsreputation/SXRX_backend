// backend/src/utils/logger.js
// Centralized logging utility with log levels and environment-aware output

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const LOG_LEVEL_NAMES = ['ERROR', 'WARN', 'INFO', 'DEBUG'];

// Get log level from environment (default: INFO in production, DEBUG in development)
const getLogLevel = () => {
  const envLevel = process.env.LOG_LEVEL?.toUpperCase();
  if (envLevel && LOG_LEVEL_NAMES.includes(envLevel)) {
    return LOG_LEVELS[envLevel];
  }
  return process.env.NODE_ENV === 'production' ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG;
};

const currentLogLevel = getLogLevel();

// Get correlation ID from current context (if available)
const getCorrelationId = () => {
  // Try to get from async local storage or request context
  // For now, return empty string (can be enhanced with async_hooks)
  return '';
};

// Format log message with timestamp, level, and correlation ID
const formatMessage = (level, message, ...args) => {
  const timestamp = new Date().toISOString();
  const levelName = LOG_LEVEL_NAMES[level];
  const correlationId = getCorrelationId();
  const corrPrefix = correlationId ? `[corr:${correlationId}]` : '';
  const formattedArgs = args.length > 0 ? ' ' + args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ') : '';
  return `[${timestamp}] [${levelName}]${corrPrefix} ${message}${formattedArgs}`;
};

// Logger object
const logger = {
  error: (message, ...args) => {
    if (currentLogLevel >= LOG_LEVELS.ERROR) {
      console.error(formatMessage(LOG_LEVELS.ERROR, message, ...args));
    }
  },
  
  warn: (message, ...args) => {
    if (currentLogLevel >= LOG_LEVELS.WARN) {
      console.warn(formatMessage(LOG_LEVELS.WARN, message, ...args));
    }
  },
  
  info: (message, ...args) => {
    if (currentLogLevel >= LOG_LEVELS.INFO) {
      console.log(formatMessage(LOG_LEVELS.INFO, message, ...args));
    }
  },
  
  debug: (message, ...args) => {
    if (currentLogLevel >= LOG_LEVELS.DEBUG) {
      console.log(formatMessage(LOG_LEVELS.DEBUG, message, ...args));
    }
  },
  
  // Convenience methods for common patterns
  log: (message, ...args) => logger.info(message, ...args),
  
  // Request logging helper with performance metrics
  request: (req, res, responseTime) => {
    const { method, url, id } = req;
    const { statusCode } = res;
    const requestSize = req.headers['content-length'] ? parseInt(req.headers['content-length']) : 0;
    const responseSize = res.get('content-length') ? parseInt(res.get('content-length')) : 0;
    
    const logData = {
      requestId: id,
      method,
      url,
      statusCode,
      responseTime,
      requestSize,
      responseSize,
      timestamp: new Date().toISOString()
    };
    
    // Log slow requests (>1s) at warn level
    if (responseTime > 1000) {
      logger.warn(`[PERFORMANCE] Slow request detected`, JSON.stringify(logData, null, 2));
    } else {
      logger.info(`[REQUEST] ${method} ${url} ${statusCode} - ${responseTime}ms reqId=${id}`, 
        requestSize > 0 || responseSize > 0 ? `reqSize=${requestSize} resSize=${responseSize}` : '');
    }
  },
  
  // Performance metrics logging
  performance: (operation, duration, metadata = {}) => {
    const logData = {
      operation,
      duration,
      timestamp: new Date().toISOString(),
      ...metadata
    };
    
    // Log slow operations (>500ms) at warn level
    if (duration > 500) {
      logger.warn(`[PERFORMANCE] Slow operation: ${operation}`, JSON.stringify(logData, null, 2));
    } else {
      logger.debug(`[PERFORMANCE] ${operation}`, `${duration}ms`, metadata && Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : '');
    }
  },
  
  // Error logging helper with context
  errorWithContext: (error, context = {}) => {
    const errorContext = {
      message: error.message,
      name: error.name,
      stack: error.stack,
      ...context
    };
    
    // Include request context if available
    if (context.req) {
      errorContext.request = {
        method: context.req.method,
        url: context.req.url,
        path: context.req.path,
        ip: context.req.ip,
        userAgent: context.req.get('user-agent'),
        requestId: context.req.id
      };
    }
    
    logger.error(`[ERROR] ${error.message}`, JSON.stringify(errorContext, null, 2));
  },
  
  // Request ID aware logging (for tracing requests across services)
  withRequestId: (requestId) => {
    return {
      error: (message, ...args) => logger.error(`[req:${requestId}] ${message}`, ...args),
      warn: (message, ...args) => logger.warn(`[req:${requestId}] ${message}`, ...args),
      info: (message, ...args) => logger.info(`[req:${requestId}] ${message}`, ...args),
      debug: (message, ...args) => logger.debug(`[req:${requestId}] ${message}`, ...args),
    };
  },
  
  // Structured logging for webhooks
  webhook: (webhookType, event, data = {}) => {
    const logData = {
      webhookType,
      event,
      timestamp: new Date().toISOString(),
      ...data
    };
    logger.info(`[WEBHOOK:${webhookType}] ${event}`, JSON.stringify(logData, null, 2));
  },
  
  // Structured logging for API calls
  apiCall: (service, method, endpoint, status, duration = null, error = null, requestId = null) => {
    const logData = {
      service,
      method,
      endpoint,
      status,
      duration,
      requestId: requestId || getCorrelationId(),
      timestamp: new Date().toISOString(),
      ...(error && { error: error.message, stack: error.stack })
    };
    const durationStr = duration ? ` (${duration}ms)` : '';
    const level = error ? 'error' : (duration && duration > 1000 ? 'warn' : 'info');
    logger[level](`[API:${service}] ${method} ${endpoint} - ${status}${durationStr}`, error ? JSON.stringify(logData, null, 2) : '');
  },
  
  // Structured logging for database operations
  database: (operation, table, duration = null, error = null, requestId = null) => {
    const logData = {
      operation,
      table,
      duration,
      requestId: requestId || getCorrelationId(),
      timestamp: new Date().toISOString(),
      ...(error && { error: error.message, stack: error.stack })
    };
    const durationStr = duration ? ` (${duration}ms)` : '';
    const level = error ? 'error' : (duration && duration > 500 ? 'warn' : 'info');
    logger[level](`[DB] ${operation} on ${table}${durationStr}`, error ? JSON.stringify(logData, null, 2) : '');
  },
  
  // Structured logging for business events
  businessEvent: (eventType, data = {}) => {
    const logData = {
      eventType,
      timestamp: new Date().toISOString(),
      ...data
    };
    logger.info(`[BUSINESS] ${eventType}`, JSON.stringify(logData, null, 2));
  }
};

module.exports = logger;

