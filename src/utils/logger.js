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

// Format log message with timestamp and level
const formatMessage = (level, message, ...args) => {
  const timestamp = new Date().toISOString();
  const levelName = LOG_LEVEL_NAMES[level];
  const formattedArgs = args.length > 0 ? ' ' + args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ') : '';
  return `[${timestamp}] [${levelName}] ${message}${formattedArgs}`;
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
  
  // Request logging helper
  request: (req, res, responseTime) => {
    const { method, url, id } = req;
    const { statusCode } = res;
    logger.info(`${method} ${url} ${statusCode} - ${responseTime}ms reqId=${id}`);
  },
  
  // Error logging helper with context
  errorWithContext: (error, context = {}) => {
    logger.error(error.message, {
      stack: error.stack,
      ...context
    });
  }
};

module.exports = logger;

