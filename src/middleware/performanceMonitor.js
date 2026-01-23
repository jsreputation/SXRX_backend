// backend/src/middleware/performanceMonitor.js
// Middleware to track request/response times, DB queries, and external API calls

const logger = require('../utils/logger');
const metricsService = require('../services/metricsService');

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
      
      // Extract query type from SQL (SELECT, INSERT, UPDATE, DELETE)
      const queryType = (args[0]?.trim().substring(0, 6).toUpperCase() || 'UNKNOWN').split(' ')[0];
      
      // Record metrics
      metricsService.recordDbQuery(queryType, duration, 'success');
      
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
      const queryType = (args[0]?.trim().substring(0, 6).toUpperCase() || 'UNKNOWN').split(' ')[0];
      
      // Record error metric
      metricsService.recordDbQuery(queryType, duration, 'error');
      metricsService.recordError('database', error.code || 'unknown');
      
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
    
    // Extract service name from URL (tebra, shopify, stripe, etc.)
    const url = config.url || 'unknown';
    const service = url.includes('kareo') || url.includes('tebra') ? 'tebra' :
                    url.includes('shopify') ? 'shopify' :
                    url.includes('stripe') ? 'stripe' :
                    url.includes('revenuehunt') ? 'revenuehunt' : 'unknown';
    const endpoint = new URL(url).pathname || 'unknown';
    
    // Record metrics
    metricsService.recordExternalApiCall(service, endpoint, duration, response?.status || 200);
    
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
    const url = config.url || 'unknown';
    const service = url.includes('kareo') || url.includes('tebra') ? 'tebra' :
                    url.includes('shopify') ? 'shopify' :
                    url.includes('stripe') ? 'stripe' :
                    url.includes('revenuehunt') ? 'revenuehunt' : 'unknown';
    const endpoint = url.includes('://') ? new URL(url).pathname : 'unknown';
    
    // Record error metric
    metricsService.recordExternalApiCall(service, endpoint, duration, error.response?.status || 500);
    metricsService.recordError('external_api', error.code || 'unknown');
    
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
    
    // Record HTTP request metrics
    metricsService.recordHttpRequest(
      req.method,
      req.path || req.url,
      res.statusCode,
      responseTime,
      requestSize,
      responseSize
    );
    
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
 * Returns JSON summary of metrics (for API consumption)
 */
function getPerformanceMetrics(req, res) {
  const summary = metricsService.getMetricsSummary();
  res.json({
    success: true,
    ...summary
  });
}

/**
 * Get Prometheus metrics endpoint handler
 * Returns Prometheus text format (for scraping by Prometheus)
 */
async function getPrometheusMetrics(req, res) {
  try {
    const metrics = await metricsService.getPrometheusMetrics();
    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(metrics);
  } catch (error) {
    logger.error('[METRICS] Error getting Prometheus metrics', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get metrics'
    });
  }
}

module.exports = { performanceMonitor, getPerformanceMetrics, getPrometheusMetrics };
