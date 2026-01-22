// backend/src/middleware/performanceMonitor.js
// Middleware to track request/response times, DB queries, and external API calls

const logger = require('../utils/logger');

// Track database query times
const dbQueryTimes = new Map();
const originalQuery = require('../db/pg').query;

// Wrap database query to track performance
if (originalQuery) {
  const dbModule = require('../db/pg');
  const originalQueryFn = dbModule.query;
  
  dbModule.query = async function(...args) {
    const startTime = Date.now();
    const queryId = `${Date.now()}-${Math.random()}`;
    
    try {
      const result = await originalQueryFn.apply(this, args);
      const duration = Date.now() - startTime;
      
      // Log slow queries (>500ms)
      if (duration > 500) {
        logger.performance('database_query', duration, {
          query: args[0]?.substring(0, 100) || 'unknown',
          duration,
          rows: result?.rowCount || 0
        });
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.performance('database_query', duration, {
        query: args[0]?.substring(0, 100) || 'unknown',
        duration,
        error: error.message
      });
      throw error;
    }
  };
}

// Track external API calls
const axios = require('axios');
const originalAxiosRequest = axios.request;

axios.request = async function(config) {
  const startTime = Date.now();
  const requestId = `${Date.now()}-${Math.random()}`;
  
  try {
    const response = await originalAxiosRequest.call(this, config);
    const duration = Date.now() - startTime;
    
    // Log slow API calls (>1000ms)
    if (duration > 1000) {
      logger.performance('external_api_call', duration, {
        method: config.method || 'GET',
        url: config.url || 'unknown',
        status: response?.status,
        duration
      });
    }
    
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.performance('external_api_call', duration, {
      method: config.method || 'GET',
      url: config.url || 'unknown',
      duration,
      error: error.message
    });
    throw error;
  }
};

/**
 * Performance monitoring middleware
 * Tracks request/response times and logs performance metrics
 */
function performanceMonitor(req, res, next) {
  const startTime = Date.now();
  const requestId = req.id || 'unknown';
  
  // Track request size
  const requestSize = req.headers['content-length'] ? parseInt(req.headers['content-length']) : 0;
  
  // Override res.json to track response size
  const originalJson = res.json.bind(res);
  res.json = function(data) {
    const responseSize = JSON.stringify(data).length;
    res.set('X-Response-Size', responseSize);
    return originalJson(data);
  };
  
  // Track response time when response finishes
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    const responseSize = res.get('content-length') ? parseInt(res.get('content-length')) : 0;
    
    // Log performance metrics
    logger.performance('request', responseTime, {
      requestId,
      method: req.method,
      url: req.url,
      path: req.path,
      statusCode: res.statusCode,
      requestSize,
      responseSize
    });
    
    // Also use the request logger for consistency
    logger.request(req, res, responseTime);
  });
  
  next();
}

/**
 * Get performance metrics endpoint handler
 */
function getPerformanceMetrics(req, res) {
  // This would collect metrics from the monitoring system
  // For now, return basic stats
  res.json({
    success: true,
    metrics: {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      note: 'Detailed metrics collection can be enhanced with APM tools like New Relic, Datadog, etc.'
    }
  });
}

module.exports = { performanceMonitor, getPerformanceMetrics };
