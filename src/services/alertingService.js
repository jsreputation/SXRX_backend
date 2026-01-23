// backend/src/services/alertingService.js
// Alerting service with configurable thresholds for monitoring and notifications

const logger = require('../utils/logger');
const notificationService = require('./notificationService');
const metricsService = require('./metricsService');

class AlertingService {
  constructor() {
    this.enabled = process.env.ALERTING_ENABLED !== 'false';
    this.thresholds = {
      // HTTP metrics
      httpErrorRate: parseFloat(process.env.ALERT_HTTP_ERROR_RATE) || 0.05, // 5% error rate
      httpResponseTime: parseInt(process.env.ALERT_HTTP_RESPONSE_TIME) || 5000, // 5 seconds
      httpRequestVolume: parseInt(process.env.ALERT_HTTP_REQUEST_VOLUME) || 1000, // 1000 requests/min
      
      // Database metrics
      dbQueryTime: parseInt(process.env.ALERT_DB_QUERY_TIME) || 2000, // 2 seconds
      dbErrorRate: parseFloat(process.env.ALERT_DB_ERROR_RATE) || 0.01, // 1% error rate
      dbConnectionPool: parseInt(process.env.ALERT_DB_CONNECTION_POOL) || 80, // 80% pool usage
      
      // External API metrics
      externalApiErrorRate: parseFloat(process.env.ALERT_EXTERNAL_API_ERROR_RATE) || 0.10, // 10% error rate
      externalApiResponseTime: parseInt(process.env.ALERT_EXTERNAL_API_RESPONSE_TIME) || 10000, // 10 seconds
      
      // System metrics
      memoryUsage: parseFloat(process.env.ALERT_MEMORY_USAGE) || 0.90, // 90% memory usage
      eventLoopLag: parseInt(process.env.ALERT_EVENT_LOOP_LAG) || 100, // 100ms lag
      cpuUsage: parseFloat(process.env.ALERT_CPU_USAGE) || 0.80, // 80% CPU usage
      
      // Business metrics
      appointmentFailureRate: parseFloat(process.env.ALERT_APPOINTMENT_FAILURE_RATE) || 0.05, // 5% failure rate
      webhookFailureRate: parseFloat(process.env.ALERT_WEBHOOK_FAILURE_RATE) || 0.10, // 10% failure rate
      subscriptionChurnRate: parseFloat(process.env.ALERT_SUBSCRIPTION_CHURN_RATE) || 0.20, // 20% churn rate
    };
    
    this.alertHistory = new Map(); // Track recent alerts to prevent spam
    this.alertCooldown = 5 * 60 * 1000; // 5 minutes cooldown between same alerts
    
    // Alert recipients
    this.alertRecipients = {
      email: process.env.ALERT_EMAIL?.split(',').map(e => e.trim()) || [],
      phone: process.env.ALERT_PHONE?.split(',').map(p => p.trim()) || []
    };
    
    if (this.enabled) {
      logger.info('[ALERTING] Alerting service initialized', {
        thresholds: this.thresholds,
        recipients: {
          emailCount: this.alertRecipients.email.length,
          phoneCount: this.alertRecipients.phone.length
        }
      });
    } else {
      logger.info('[ALERTING] Alerting service disabled via ALERTING_ENABLED=false');
    }
  }

  /**
   * Check metrics against thresholds and send alerts if needed
   * @param {Object} metrics - Current metrics from metricsService
   */
  async checkThresholds(metrics) {
    if (!this.enabled) return;

    const alerts = [];

    // Check HTTP error rate
    const httpErrorRate = this.calculateErrorRate(metrics.http?.requestsTotal || {});
    if (httpErrorRate > this.thresholds.httpErrorRate) {
      alerts.push({
        type: 'http_error_rate',
        severity: 'high',
        message: `HTTP error rate (${(httpErrorRate * 100).toFixed(2)}%) exceeds threshold (${(this.thresholds.httpErrorRate * 100).toFixed(2)}%)`,
        value: httpErrorRate,
        threshold: this.thresholds.httpErrorRate
      });
    }

    // Check HTTP response time
    const avgResponseTime = this.calculateAverage(metrics.http?.requestDurationAvg || {});
    if (avgResponseTime > this.thresholds.httpResponseTime) {
      alerts.push({
        type: 'http_response_time',
        severity: 'medium',
        message: `Average HTTP response time (${avgResponseTime}ms) exceeds threshold (${this.thresholds.httpResponseTime}ms)`,
        value: avgResponseTime,
        threshold: this.thresholds.httpResponseTime
      });
    }

    // Check database query time
    const avgDbQueryTime = this.calculateAverage(metrics.database?.queryDurationAvg || {});
    if (avgDbQueryTime > this.thresholds.dbQueryTime) {
      alerts.push({
        type: 'db_query_time',
        severity: 'high',
        message: `Average database query time (${avgDbQueryTime}ms) exceeds threshold (${this.thresholds.dbQueryTime}ms)`,
        value: avgDbQueryTime,
        threshold: this.thresholds.dbQueryTime
      });
    }

    // Check database error rate
    const dbErrorRate = this.calculateErrorRate(metrics.database?.queriesTotal || {});
    if (dbErrorRate > this.thresholds.dbErrorRate) {
      alerts.push({
        type: 'db_error_rate',
        severity: 'critical',
        message: `Database error rate (${(dbErrorRate * 100).toFixed(2)}%) exceeds threshold (${(this.thresholds.dbErrorRate * 100).toFixed(2)}%)`,
        value: dbErrorRate,
        threshold: this.thresholds.dbErrorRate
      });
    }

    // Check external API error rate
    const externalApiErrorRate = this.calculateErrorRate(metrics.externalApi?.callsTotal || {});
    if (externalApiErrorRate > this.thresholds.externalApiErrorRate) {
      alerts.push({
        type: 'external_api_error_rate',
        severity: 'high',
        message: `External API error rate (${(externalApiErrorRate * 100).toFixed(2)}%) exceeds threshold (${(this.thresholds.externalApiErrorRate * 100).toFixed(2)}%)`,
        value: externalApiErrorRate,
        threshold: this.thresholds.externalApiErrorRate
      });
    }

    // Check memory usage
    const memoryUsage = metrics.system?.memory || {};
    const heapUsagePercent = memoryUsage.heapTotal > 0 
      ? (memoryUsage.heapUsed / memoryUsage.heapTotal) 
      : 0;
    if (heapUsagePercent > this.thresholds.memoryUsage) {
      alerts.push({
        type: 'memory_usage',
        severity: 'high',
        message: `Memory usage (${(heapUsagePercent * 100).toFixed(2)}%) exceeds threshold (${(this.thresholds.memoryUsage * 100).toFixed(2)}%)`,
        value: heapUsagePercent,
        threshold: this.thresholds.memoryUsage
      });
    }

    // Check event loop lag
    const eventLoopLag = metrics.system?.eventLoopLag || 0;
    if (eventLoopLag > this.thresholds.eventLoopLag) {
      alerts.push({
        type: 'event_loop_lag',
        severity: 'medium',
        message: `Event loop lag (${eventLoopLag.toFixed(2)}ms) exceeds threshold (${this.thresholds.eventLoopLag}ms)`,
        value: eventLoopLag,
        threshold: this.thresholds.eventLoopLag
      });
    }

    // Send alerts
    for (const alert of alerts) {
      await this.sendAlert(alert);
    }
  }

  /**
   * Send alert notification
   * @param {Object} alert - Alert object
   */
  async sendAlert(alert) {
    // Check cooldown to prevent alert spam
    const alertKey = `${alert.type}_${alert.severity}`;
    const lastAlert = this.alertHistory.get(alertKey);
    if (lastAlert && Date.now() - lastAlert < this.alertCooldown) {
      return; // Skip if within cooldown period
    }

    this.alertHistory.set(alertKey, Date.now());

    const subject = `[${alert.severity.toUpperCase()}] SXRX Alert: ${alert.type}`;
    const message = `
Alert Type: ${alert.type}
Severity: ${alert.severity}
Message: ${alert.message}
Current Value: ${alert.value}
Threshold: ${alert.threshold}
Timestamp: ${new Date().toISOString()}
    `.trim();

    // Send email alerts
    if (this.alertRecipients.email.length > 0) {
      try {
        await notificationService.sendEmail({
          to: this.alertRecipients.email.join(','),
          subject,
          text: message,
          html: `<pre>${message}</pre>`
        });
        logger.info('[ALERTING] Alert email sent', { type: alert.type, severity: alert.severity });
      } catch (error) {
        logger.error('[ALERTING] Failed to send alert email', { error: error.message });
      }
    }

    // Send SMS alerts for critical issues
    if (alert.severity === 'critical' && this.alertRecipients.phone.length > 0) {
      try {
        for (const phone of this.alertRecipients.phone) {
          await notificationService.sendSMS({
            to: phone,
            message: `[CRITICAL] ${alert.type}: ${alert.message}`
          });
        }
        logger.info('[ALERTING] Alert SMS sent', { type: alert.type });
      } catch (error) {
        logger.error('[ALERTING] Failed to send alert SMS', { error: error.message });
      }
    }

    // Log alert
    logger.warn('[ALERTING] Alert triggered', {
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      value: alert.value,
      threshold: alert.threshold
    });
  }

  /**
   * Calculate error rate from metrics
   * @param {Object} metrics - Metrics object with success/error counts
   * @returns {number} Error rate (0-1)
   */
  calculateErrorRate(metrics) {
    let total = 0;
    let errors = 0;

    for (const [key, value] of Object.entries(metrics)) {
      const count = typeof value === 'number' ? value : parseInt(value) || 0;
      total += count;
      if (key.includes('error') || key.includes('5') || key.includes('4')) {
        errors += count;
      }
    }

    return total > 0 ? errors / total : 0;
  }

  /**
   * Calculate average from metrics object
   * @param {Object} metrics - Metrics object with numeric values
   * @returns {number} Average value
   */
  calculateAverage(metrics) {
    const values = Object.values(metrics).filter(v => typeof v === 'number' && !isNaN(v));
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Update thresholds
   * @param {Object} newThresholds - New threshold values
   */
  updateThresholds(newThresholds) {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    logger.info('[ALERTING] Thresholds updated', { thresholds: this.thresholds });
  }

  /**
   * Get current thresholds
   * @returns {Object} Current thresholds
   */
  getThresholds() {
    return { ...this.thresholds };
  }

  /**
   * Clear alert history (useful for testing)
   */
  clearHistory() {
    this.alertHistory.clear();
  }
}

// Export singleton instance
module.exports = new AlertingService();
