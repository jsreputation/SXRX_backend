// backend/src/services/metricsService.js
// Prometheus-compatible metrics service for performance and system monitoring

const logger = require('../utils/logger');

class MetricsService {
  constructor() {
    this.enabled = process.env.METRICS_ENABLED !== 'false';
    this.prometheusClient = null;
    this.metrics = {
      // HTTP request metrics
      httpRequestsTotal: new Map(), // Counter: method, route, status
      httpRequestDuration: new Map(), // Histogram: method, route
      httpRequestSize: new Map(), // Histogram: method, route
      
      // Database metrics
      dbQueriesTotal: new Map(), // Counter: query_type, status
      dbQueryDuration: new Map(), // Histogram: query_type
      dbConnections: { active: 0, idle: 0, total: 0 },
      
      // External API metrics
      externalApiCallsTotal: new Map(), // Counter: service, endpoint, status
      externalApiDuration: new Map(), // Histogram: service, endpoint
      
      // Cache metrics
      cacheHits: new Map(), // Counter: cache_type
      cacheMisses: new Map(), // Counter: cache_type
      cacheOperations: new Map(), // Counter: operation, cache_type
      
      // System metrics
      memoryUsage: { heapUsed: 0, heapTotal: 0, rss: 0, external: 0 },
      cpuUsage: { user: 0, system: 0 },
      eventLoopLag: 0,
      
      // Business metrics
      appointmentsCreated: 0,
      patientsCreated: 0,
      webhooksProcessed: new Map(), // Counter: webhook_type, status
      subscriptionsActive: 0,
      
      // Error metrics
      errorsTotal: new Map(), // Counter: error_type, error_code
    };
    
    // Initialize Prometheus client if enabled
    if (this.enabled) {
      try {
        const client = require('prom-client');
        this.prometheusClient = client;
        this.register = new client.Registry();
        
        // Register default metrics (CPU, memory, event loop, etc.)
        client.collectDefaultMetrics({ register: this.register });
        
        // Create custom metrics
        this.createCustomMetrics();
        
        logger.info('[METRICS] Prometheus metrics service initialized');
      } catch (error) {
        logger.warn('[METRICS] Prometheus client not available, metrics disabled', { error: error.message });
        this.enabled = false;
      }
    } else {
      logger.info('[METRICS] Metrics service disabled via METRICS_ENABLED=false');
    }
    
    // Start periodic metric collection
    if (this.enabled) {
      this.startMetricCollection();
    }
  }

  /**
   * Create custom Prometheus metrics
   */
  createCustomMetrics() {
    if (!this.prometheusClient) return;

    // HTTP request metrics
    this.httpRequestsCounter = new this.prometheusClient.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status'],
      registers: [this.register]
    });

    this.httpRequestDurationHistogram = new this.prometheusClient.Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
      registers: [this.register]
    });

    this.httpRequestSizeHistogram = new this.prometheusClient.Histogram({
      name: 'http_request_size_bytes',
      help: 'HTTP request size in bytes',
      labelNames: ['method', 'route'],
      buckets: [100, 500, 1000, 5000, 10000, 50000, 100000],
      registers: [this.register]
    });

    // Database metrics
    this.dbQueriesCounter = new this.prometheusClient.Counter({
      name: 'db_queries_total',
      help: 'Total number of database queries',
      labelNames: ['query_type', 'status'],
      registers: [this.register]
    });

    this.dbQueryDurationHistogram = new this.prometheusClient.Histogram({
      name: 'db_query_duration_seconds',
      help: 'Database query duration in seconds',
      labelNames: ['query_type'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.register]
    });

    this.dbConnectionsGauge = new this.prometheusClient.Gauge({
      name: 'db_connections',
      help: 'Database connection pool status',
      labelNames: ['state'],
      registers: [this.register]
    });

    // External API metrics
    this.externalApiCallsCounter = new this.prometheusClient.Counter({
      name: 'external_api_calls_total',
      help: 'Total number of external API calls',
      labelNames: ['service', 'endpoint', 'status'],
      registers: [this.register]
    });

    this.externalApiDurationHistogram = new this.prometheusClient.Histogram({
      name: 'external_api_duration_seconds',
      help: 'External API call duration in seconds',
      labelNames: ['service', 'endpoint'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60],
      registers: [this.register]
    });

    // Cache metrics
    this.cacheHitsCounter = new this.prometheusClient.Counter({
      name: 'cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['cache_type'],
      registers: [this.register]
    });

    this.cacheMissesCounter = new this.prometheusClient.Counter({
      name: 'cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['cache_type'],
      registers: [this.register]
    });

    // Business metrics
    this.appointmentsCreatedCounter = new this.prometheusClient.Counter({
      name: 'appointments_created_total',
      help: 'Total number of appointments created',
      registers: [this.register]
    });

    this.patientsCreatedCounter = new this.prometheusClient.Counter({
      name: 'patients_created_total',
      help: 'Total number of patients created',
      registers: [this.register]
    });

    this.webhooksProcessedCounter = new this.prometheusClient.Counter({
      name: 'webhooks_processed_total',
      help: 'Total number of webhooks processed',
      labelNames: ['webhook_type', 'status'],
      registers: [this.register]
    });

    this.subscriptionsActiveGauge = new this.prometheusClient.Gauge({
      name: 'subscriptions_active',
      help: 'Number of active subscriptions',
      registers: [this.register]
    });

    // Error metrics
    this.errorsCounter = new this.prometheusClient.Counter({
      name: 'errors_total',
      help: 'Total number of errors',
      labelNames: ['error_type', 'error_code'],
      registers: [this.register]
    });
  }

  /**
   * Record HTTP request metric
   * @param {string} method - HTTP method
   * @param {string} route - Route path
   * @param {number} statusCode - HTTP status code
   * @param {number} duration - Request duration in milliseconds
   * @param {number} requestSize - Request size in bytes
   * @param {number} responseSize - Response size in bytes
   */
  recordHttpRequest(method, route, statusCode, duration, requestSize = 0, responseSize = 0) {
    if (!this.enabled) return;

    const normalizedRoute = this.normalizeRoute(route);
    const status = Math.floor(statusCode / 100) * 100; // Group by status class (2xx, 4xx, 5xx)

    // Update internal metrics
    const key = `${method}:${normalizedRoute}:${status}`;
    this.metrics.httpRequestsTotal.set(key, (this.metrics.httpRequestsTotal.get(key) || 0) + 1);
    
    const durationKey = `${method}:${normalizedRoute}`;
    if (!this.metrics.httpRequestDuration.has(durationKey)) {
      this.metrics.httpRequestDuration.set(durationKey, []);
    }
    this.metrics.httpRequestDuration.get(durationKey).push(duration);

    // Update Prometheus metrics
    if (this.prometheusClient) {
      this.httpRequestsCounter.inc({ method, route: normalizedRoute, status: String(status) });
      this.httpRequestDurationHistogram.observe(
        { method, route: normalizedRoute, status: String(status) },
        duration / 1000 // Convert ms to seconds
      );
      if (requestSize > 0) {
        this.httpRequestSizeHistogram.observe(
          { method, route: normalizedRoute },
          requestSize
        );
      }
    }
  }

  /**
   * Record database query metric
   * @param {string} queryType - Type of query (SELECT, INSERT, UPDATE, DELETE)
   * @param {number} duration - Query duration in milliseconds
   * @param {string} status - Query status (success, error)
   */
  recordDbQuery(queryType, duration, status = 'success') {
    if (!this.enabled) return;

    const key = `${queryType}:${status}`;
    this.metrics.dbQueriesTotal.set(key, (this.metrics.dbQueriesTotal.get(key) || 0) + 1);
    
    if (!this.metrics.dbQueryDuration.has(queryType)) {
      this.metrics.dbQueryDuration.set(queryType, []);
    }
    this.metrics.dbQueryDuration.get(queryType).push(duration);

    // Update Prometheus metrics
    if (this.prometheusClient) {
      this.dbQueriesCounter.inc({ query_type: queryType, status });
      this.dbQueryDurationHistogram.observe(
        { query_type: queryType },
        duration / 1000 // Convert ms to seconds
      );
    }
  }

  /**
   * Record external API call metric
   * @param {string} service - Service name (e.g., 'tebra', 'shopify', 'stripe')
   * @param {string} endpoint - API endpoint
   * @param {number} duration - Call duration in milliseconds
   * @param {number} statusCode - HTTP status code
   */
  recordExternalApiCall(service, endpoint, duration, statusCode) {
    if (!this.enabled) return;

    const status = statusCode >= 200 && statusCode < 300 ? 'success' : 'error';
    const key = `${service}:${endpoint}:${status}`;
    this.metrics.externalApiCallsTotal.set(key, (this.metrics.externalApiCallsTotal.get(key) || 0) + 1);
    
    const durationKey = `${service}:${endpoint}`;
    if (!this.metrics.externalApiDuration.has(durationKey)) {
      this.metrics.externalApiDuration.set(durationKey, []);
    }
    this.metrics.externalApiDuration.get(durationKey).push(duration);

    // Update Prometheus metrics
    if (this.prometheusClient) {
      this.externalApiCallsCounter.inc({ service, endpoint, status });
      this.externalApiDurationHistogram.observe(
        { service, endpoint },
        duration / 1000 // Convert ms to seconds
      );
    }
  }

  /**
   * Record cache operation
   * @param {string} operation - Operation type (hit, miss, set, delete)
   * @param {string} cacheType - Cache type (availability, tebra, chart)
   */
  recordCacheOperation(operation, cacheType) {
    if (!this.enabled) return;

    if (operation === 'hit') {
      this.metrics.cacheHits.set(cacheType, (this.metrics.cacheHits.get(cacheType) || 0) + 1);
      if (this.prometheusClient) {
        this.cacheHitsCounter.inc({ cache_type: cacheType });
      }
    } else if (operation === 'miss') {
      this.metrics.cacheMisses.set(cacheType, (this.metrics.cacheMisses.get(cacheType) || 0) + 1);
      if (this.prometheusClient) {
        this.cacheMissesCounter.inc({ cache_type: cacheType });
      }
    }
  }

  /**
   * Record business metric
   * @param {string} metric - Metric name (appointments_created, patients_created, etc.)
   * @param {number} value - Metric value (default: 1 for counters)
   */
  recordBusinessMetric(metric, value = 1) {
    if (!this.enabled) return;

    switch (metric) {
      case 'appointment_created':
        this.metrics.appointmentsCreated += value;
        if (this.prometheusClient) {
          this.appointmentsCreatedCounter.inc(value);
        }
        break;
      case 'patient_created':
        this.metrics.patientsCreated += value;
        if (this.prometheusClient) {
          this.patientsCreatedCounter.inc(value);
        }
        break;
      case 'webhook_processed':
        // Value should be object: { type, status }
        if (value && typeof value === 'object') {
          const key = `${value.type}:${value.status}`;
          this.metrics.webhooksProcessed.set(key, (this.metrics.webhooksProcessed.get(key) || 0) + 1);
          if (this.prometheusClient) {
            this.webhooksProcessedCounter.inc({ webhook_type: value.type, status: value.status });
          }
        }
        break;
    }
  }

  /**
   * Record error metric
   * @param {string} errorType - Error type (validation, authentication, database, external_api)
   * @param {string} errorCode - Error code (optional)
   */
  recordError(errorType, errorCode = 'unknown') {
    if (!this.enabled) return;

    const key = `${errorType}:${errorCode}`;
    this.metrics.errorsTotal.set(key, (this.metrics.errorsTotal.get(key) || 0) + 1);

    if (this.prometheusClient) {
      this.errorsCounter.inc({ error_type: errorType, error_code: errorCode });
    }
  }

  /**
   * Update subscription count gauge
   * @param {number} count - Number of active subscriptions
   */
  updateSubscriptionsActive(count) {
    if (!this.enabled) return;

    this.metrics.subscriptionsActive = count;

    if (this.prometheusClient) {
      this.subscriptionsActiveGauge.set(count);
    }
  }

  /**
   * Update database connection pool metrics
   * @param {Object} poolStats - Connection pool statistics
   */
  updateDbConnections(poolStats) {
    if (!this.enabled) return;

    this.metrics.dbConnections = {
      active: poolStats.active || 0,
      idle: poolStats.idle || 0,
      total: poolStats.total || 0
    };

    if (this.prometheusClient) {
      this.dbConnectionsGauge.set({ state: 'active' }, poolStats.active || 0);
      this.dbConnectionsGauge.set({ state: 'idle' }, poolStats.idle || 0);
      this.dbConnectionsGauge.set({ state: 'total' }, poolStats.total || 0);
    }
  }

  /**
   * Get Prometheus metrics in text format
   * @returns {Promise<string>} Prometheus metrics text
   */
  async getPrometheusMetrics() {
    if (!this.enabled || !this.register) {
      return '# Metrics disabled\n';
    }

    return await this.register.metrics();
  }

  /**
   * Get metrics summary (for JSON API)
   * @returns {Object} Metrics summary
   */
  getMetricsSummary() {
    if (!this.enabled) {
      return { enabled: false };
    }

    // Calculate averages from histograms
    const calculateAverage = (values) => {
      if (!values || values.length === 0) return 0;
      return values.reduce((sum, val) => sum + val, 0) / values.length;
    };

    return {
      enabled: true,
      timestamp: new Date().toISOString(),
      http: {
        requestsTotal: Object.fromEntries(this.metrics.httpRequestsTotal),
        requestDurationAvg: Object.fromEntries(
          Array.from(this.metrics.httpRequestDuration.entries()).map(([key, values]) => [
            key,
            calculateAverage(values)
          ])
        )
      },
      database: {
        queriesTotal: Object.fromEntries(this.metrics.dbQueriesTotal),
        queryDurationAvg: Object.fromEntries(
          Array.from(this.metrics.dbQueryDuration.entries()).map(([key, values]) => [
            key,
            calculateAverage(values)
          ])
        ),
        connections: this.metrics.dbConnections
      },
      externalApi: {
        callsTotal: Object.fromEntries(this.metrics.externalApiCallsTotal),
        durationAvg: Object.fromEntries(
          Array.from(this.metrics.externalApiDuration.entries()).map(([key, values]) => [
            key,
            calculateAverage(values)
          ])
        )
      },
      cache: {
        hits: Object.fromEntries(this.metrics.cacheHits),
        misses: Object.fromEntries(this.metrics.cacheMisses),
        hitRate: this.calculateCacheHitRate()
      },
      business: {
        appointmentsCreated: this.metrics.appointmentsCreated,
        patientsCreated: this.metrics.patientsCreated,
        subscriptionsActive: this.metrics.subscriptionsActive,
        webhooksProcessed: Object.fromEntries(this.metrics.webhooksProcessed)
      },
      errors: {
        total: Object.fromEntries(this.metrics.errorsTotal)
      },
      system: {
        memory: this.metrics.memoryUsage,
        cpu: this.metrics.cpuUsage,
        eventLoopLag: this.metrics.eventLoopLag,
        uptime: process.uptime()
      }
    };
  }

  /**
   * Calculate cache hit rate
   * @returns {Object} Hit rates by cache type
   */
  calculateCacheHitRate() {
    const hitRates = {};
    
    for (const [cacheType, hits] of this.metrics.cacheHits.entries()) {
      const misses = this.metrics.cacheMisses.get(cacheType) || 0;
      const total = hits + misses;
      hitRates[cacheType] = total > 0 ? (hits / total) * 100 : 0;
    }
    
    return hitRates;
  }

  /**
   * Normalize route path for metrics (remove IDs, etc.)
   * @param {string} route - Route path
   * @returns {string} Normalized route
   */
  normalizeRoute(route) {
    if (!route) return 'unknown';
    
    // Remove query parameters
    route = route.split('?')[0];
    
    // Replace IDs with placeholders
    route = route.replace(/\/\d+/g, '/:id');
    route = route.replace(/\/[a-f0-9-]{36}/gi, '/:uuid'); // UUIDs
    route = route.replace(/\/[a-zA-Z0-9_-]{20,}/g, '/:id'); // Long IDs
    
    return route || 'root';
  }

  /**
   * Start periodic metric collection
   */
  startMetricCollection() {
    // Update system metrics every 5 seconds
    setInterval(() => {
      const memUsage = process.memoryUsage();
      this.metrics.memoryUsage = {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        rss: memUsage.rss,
        external: memUsage.external
      };

      // Calculate event loop lag (simplified)
      const start = process.hrtime.bigint();
      setImmediate(() => {
        const delta = process.hrtime.bigint() - start;
        this.metrics.eventLoopLag = Number(delta) / 1000000; // Convert to milliseconds
      });
    }, 5000);
  }

  /**
   * Reset metrics (useful for testing)
   */
  reset() {
    this.metrics = {
      httpRequestsTotal: new Map(),
      httpRequestDuration: new Map(),
      httpRequestSize: new Map(),
      dbQueriesTotal: new Map(),
      dbQueryDuration: new Map(),
      dbConnections: { active: 0, idle: 0, total: 0 },
      externalApiCallsTotal: new Map(),
      externalApiDuration: new Map(),
      cacheHits: new Map(),
      cacheMisses: new Map(),
      cacheOperations: new Map(),
      memoryUsage: { heapUsed: 0, heapTotal: 0, rss: 0, external: 0 },
      cpuUsage: { user: 0, system: 0 },
      eventLoopLag: 0,
      appointmentsCreated: 0,
      patientsCreated: 0,
      webhooksProcessed: new Map(),
      subscriptionsActive: 0,
      errorsTotal: new Map()
    };

    if (this.prometheusClient && this.register) {
      this.register.resetMetrics();
      this.createCustomMetrics();
    }
  }
}

// Export singleton instance
module.exports = new MetricsService();
