// backend/src/services/businessMetricsService.js
// Business metrics service for tracking key business indicators and KPIs

const { query } = require('../db/pg');
const metricsService = require('./metricsService');
const logger = require('../utils/logger');

class BusinessMetricsService {
  constructor() {
    this.enabled = process.env.BUSINESS_METRICS_ENABLED !== 'false';
    this.cache = new Map();
    this.cacheTTL = 60 * 1000; // 1 minute cache
  }

  /**
   * Get dashboard metrics (aggregated business KPIs)
   * @returns {Promise<Object>} Dashboard metrics
   */
  async getDashboardMetrics() {
    try {
      const cacheKey = 'dashboard_metrics';
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }

      const [
        appointmentStats,
        patientStats,
        subscriptionStats,
        revenueStats,
        webhookStats
      ] = await Promise.all([
        this.getAppointmentStats(),
        this.getPatientStats(),
        this.getSubscriptionStats(),
        this.getRevenueStats(),
        this.getWebhookStats()
      ]);

      const metrics = {
        timestamp: new Date().toISOString(),
        appointments: appointmentStats,
        patients: patientStats,
        subscriptions: subscriptionStats,
        revenue: revenueStats,
        webhooks: webhookStats
      };

      this.cache.set(cacheKey, { data: metrics, timestamp: Date.now() });
      return metrics;
    } catch (error) {
      logger.error('[BUSINESS_METRICS] Error getting dashboard metrics', { error: error.message });
      throw error;
    }
  }

  /**
   * Get appointment statistics
   * @returns {Promise<Object>} Appointment stats
   */
  async getAppointmentStats() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const thisWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const thisMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Count appointments by status and time period
      const { rows: todayStats } = await query(
        `SELECT 
          COUNT(*) FILTER (WHERE created_at::date = $1) as today,
          COUNT(*) FILTER (WHERE created_at >= $2) as this_week,
          COUNT(*) FILTER (WHERE created_at >= $3) as this_month,
          COUNT(*) as total
         FROM tebra_appointments`,
        [today, thisWeek, thisMonth]
      );

      const { rows: statusStats } = await query(
        `SELECT 
          status,
          COUNT(*) as count
         FROM tebra_appointments
         GROUP BY status`,
        []
      );

      return {
        today: parseInt(todayStats[0]?.today || 0),
        thisWeek: parseInt(todayStats[0]?.this_week || 0),
        thisMonth: parseInt(todayStats[0]?.this_month || 0),
        total: parseInt(todayStats[0]?.total || 0),
        byStatus: statusStats.reduce((acc, row) => {
          acc[row.status] = parseInt(row.count);
          return acc;
        }, {})
      };
    } catch (error) {
      logger.error('[BUSINESS_METRICS] Error getting appointment stats', { error: error.message });
      return { today: 0, thisWeek: 0, thisMonth: 0, total: 0, byStatus: {} };
    }
  }

  /**
   * Get patient statistics
   * @returns {Promise<Object>} Patient stats
   */
  async getPatientStats() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const thisWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const thisMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const { rows } = await query(
        `SELECT 
          COUNT(*) FILTER (WHERE created_at::date = $1) as today,
          COUNT(*) FILTER (WHERE created_at >= $2) as this_week,
          COUNT(*) FILTER (WHERE created_at >= $3) as this_month,
          COUNT(*) as total
         FROM customer_patient_mappings
         WHERE patient_id IS NOT NULL`,
        [today, thisWeek, thisMonth]
      );

      return {
        today: parseInt(rows[0]?.today || 0),
        thisWeek: parseInt(rows[0]?.this_week || 0),
        thisMonth: parseInt(rows[0]?.this_month || 0),
        total: parseInt(rows[0]?.total || 0)
      };
    } catch (error) {
      logger.error('[BUSINESS_METRICS] Error getting patient stats', { error: error.message });
      return { today: 0, thisWeek: 0, thisMonth: 0, total: 0 };
    }
  }

  /**
   * Get subscription statistics
   * @returns {Promise<Object>} Subscription stats
   */
  async getSubscriptionStats() {
    try {
      const { rows: activeStats } = await query(
        `SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active'`,
        []
      );

      const { rows: revenueStats } = await query(
        `SELECT 
          COUNT(*) as count,
          SUM(amount_cents) as total_revenue_cents
         FROM subscriptions
         WHERE status = 'active'`,
        []
      );

      const activeCount = parseInt(activeStats[0]?.count || 0);
      const monthlyRecurringRevenue = parseInt(revenueStats[0]?.total_revenue_cents || 0) / 100;

      // Update Prometheus gauge
      metricsService.updateSubscriptionsActive(activeCount);

      return {
        active: activeCount,
        monthlyRecurringRevenue,
        averageRevenuePerSubscription: activeCount > 0 ? monthlyRecurringRevenue / activeCount : 0
      };
    } catch (error) {
      logger.error('[BUSINESS_METRICS] Error getting subscription stats', { error: error.message });
      return { active: 0, monthlyRecurringRevenue: 0, averageRevenuePerSubscription: 0 };
    }
  }

  /**
   * Get revenue statistics
   * @returns {Promise<Object>} Revenue stats
   */
  async getRevenueStats() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const thisWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const thisMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const { rows } = await query(
        `SELECT 
          COALESCE(SUM(amount_cents), 0) FILTER (WHERE created_at::date = $1) as today_cents,
          COALESCE(SUM(amount_cents), 0) FILTER (WHERE created_at >= $2) as this_week_cents,
          COALESCE(SUM(amount_cents), 0) FILTER (WHERE created_at >= $3) as this_month_cents,
          COALESCE(SUM(amount_cents), 0) as total_cents,
          COUNT(*) FILTER (WHERE created_at::date = $1) as today_count,
          COUNT(*) FILTER (WHERE created_at >= $2) as this_week_count,
          COUNT(*) FILTER (WHERE created_at >= $3) as this_month_count,
          COUNT(*) as total_count
         FROM billing_sync
         WHERE status = 'completed'`,
        [today, thisWeek, thisMonth]
      );

      return {
        today: {
          revenue: (parseInt(rows[0]?.today_cents || 0) / 100).toFixed(2),
          transactions: parseInt(rows[0]?.today_count || 0)
        },
        thisWeek: {
          revenue: (parseInt(rows[0]?.this_week_cents || 0) / 100).toFixed(2),
          transactions: parseInt(rows[0]?.this_week_count || 0)
        },
        thisMonth: {
          revenue: (parseInt(rows[0]?.this_month_cents || 0) / 100).toFixed(2),
          transactions: parseInt(rows[0]?.this_month_count || 0)
        },
        total: {
          revenue: (parseInt(rows[0]?.total_cents || 0) / 100).toFixed(2),
          transactions: parseInt(rows[0]?.total_count || 0)
        }
      };
    } catch (error) {
      logger.error('[BUSINESS_METRICS] Error getting revenue stats', { error: error.message });
      return {
        today: { revenue: '0.00', transactions: 0 },
        thisWeek: { revenue: '0.00', transactions: 0 },
        thisMonth: { revenue: '0.00', transactions: 0 },
        total: { revenue: '0.00', transactions: 0 }
      };
    }
  }

  /**
   * Get webhook processing statistics
   * @returns {Promise<Object>} Webhook stats
   */
  async getWebhookStats() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const thisWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const { rows } = await query(
        `SELECT 
          webhook_type,
          status,
          COUNT(*) as count,
          COUNT(*) FILTER (WHERE created_at::date = $1) as today_count,
          COUNT(*) FILTER (WHERE created_at >= $2) as this_week_count
         FROM webhook_retries
         GROUP BY webhook_type, status`,
        [today, thisWeek]
      );

      const stats = {
        today: { total: 0, byType: {}, byStatus: {} },
        thisWeek: { total: 0, byType: {}, byStatus: {} },
        total: { byType: {}, byStatus: {} }
      };

      rows.forEach(row => {
        const type = row.webhook_type || 'unknown';
        const status = row.status || 'unknown';
        const count = parseInt(row.count);
        const todayCount = parseInt(row.today_count || 0);
        const weekCount = parseInt(row.this_week_count || 0);

        stats.today.total += todayCount;
        stats.thisWeek.total += weekCount;

        stats.today.byType[type] = (stats.today.byType[type] || 0) + todayCount;
        stats.thisWeek.byType[type] = (stats.thisWeek.byType[type] || 0) + weekCount;
        stats.total.byType[type] = (stats.total.byType[type] || 0) + count;

        stats.today.byStatus[status] = (stats.today.byStatus[status] || 0) + todayCount;
        stats.thisWeek.byStatus[status] = (stats.thisWeek.byStatus[status] || 0) + weekCount;
        stats.total.byStatus[status] = (stats.total.byStatus[status] || 0) + count;
      });

      return stats;
    } catch (error) {
      logger.error('[BUSINESS_METRICS] Error getting webhook stats', { error: error.message });
      return {
        today: { total: 0, byType: {}, byStatus: {} },
        thisWeek: { total: 0, byType: {}, byStatus: {} },
        total: { byType: {}, byStatus: {} }
      };
    }
  }

  /**
   * Get conversion funnel metrics
   * @returns {Promise<Object>} Funnel metrics
   */
  async getConversionFunnel() {
    try {
      // Questionnaire completions
      const { rows: questionnaireStats } = await query(
        `SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE red_flags_detected = true) as with_red_flags,
          COUNT(*) FILTER (WHERE red_flags_detected = false) as without_red_flags
         FROM questionnaire_completions`,
        []
      );

      // Patients created
      const { rows: patientStats } = await query(
        `SELECT COUNT(DISTINCT patient_id) as count
         FROM customer_patient_mappings
         WHERE patient_id IS NOT NULL`,
        []
      );

      // Appointments booked
      const { rows: appointmentStats } = await query(
        `SELECT COUNT(*) as count FROM tebra_appointments`,
        []
      );

      const questionnaireTotal = parseInt(questionnaireStats[0]?.total || 0);
      const patientsCreated = parseInt(patientStats[0]?.count || 0);
      const appointmentsBooked = parseInt(appointmentStats[0]?.count || 0);

      return {
        questionnaireCompletions: questionnaireTotal,
        patientsCreated: patientsCreated,
        appointmentsBooked: appointmentsBooked,
        conversionRates: {
          questionnaireToPatient: questionnaireTotal > 0 ? (patientsCreated / questionnaireTotal * 100).toFixed(2) : '0.00',
          patientToAppointment: patientsCreated > 0 ? (appointmentsBooked / patientsCreated * 100).toFixed(2) : '0.00',
          overall: questionnaireTotal > 0 ? (appointmentsBooked / questionnaireTotal * 100).toFixed(2) : '0.00'
        },
        redFlags: {
          withRedFlags: parseInt(questionnaireStats[0]?.with_red_flags || 0),
          withoutRedFlags: parseInt(questionnaireStats[0]?.without_red_flags || 0),
          redFlagRate: questionnaireTotal > 0 
            ? (parseInt(questionnaireStats[0]?.with_red_flags || 0) / questionnaireTotal * 100).toFixed(2)
            : '0.00'
        }
      };
    } catch (error) {
      logger.error('[BUSINESS_METRICS] Error getting conversion funnel', { error: error.message });
      return {
        questionnaireCompletions: 0,
        patientsCreated: 0,
        appointmentsBooked: 0,
        conversionRates: {
          questionnaireToPatient: '0.00',
          patientToAppointment: '0.00',
          overall: '0.00'
        },
        redFlags: {
          withRedFlags: 0,
          withoutRedFlags: 0,
          redFlagRate: '0.00'
        }
      };
    }
  }

  /**
   * Clear cache (useful for testing or forced refresh)
   */
  clearCache() {
    this.cache.clear();
  }
}

// Export singleton instance
module.exports = new BusinessMetricsService();
