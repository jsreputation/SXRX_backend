// backend/src/routes/businessMetrics.js
// Routes for business metrics and dashboard endpoints

const express = require('express');
const router = express.Router();
const businessMetricsService = require('../services/businessMetricsService');
const { auth, authorize } = require('../middleware/shopifyTokenAuth');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/business-metrics/dashboard:
 *   get:
 *     summary: Get dashboard metrics (KPIs)
 *     tags: [Business Metrics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 timestamp:
 *                   type: string
 *                 appointments:
 *                   type: object
 *                 patients:
 *                   type: object
 *                 subscriptions:
 *                   type: object
 *                 revenue:
 *                   type: object
 *                 webhooks:
 *                   type: object
 */
router.get('/dashboard', auth, async (req, res) => {
  try {
    const metrics = await businessMetricsService.getDashboardMetrics();
    res.json({
      success: true,
      ...metrics
    });
  } catch (error) {
    logger.error('[BUSINESS_METRICS] Error getting dashboard metrics', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get dashboard metrics'
    });
  }
});

/**
 * @swagger
 * /api/business-metrics/funnel:
 *   get:
 *     summary: Get conversion funnel metrics
 *     tags: [Business Metrics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Conversion funnel metrics
 */
router.get('/funnel', auth, async (req, res) => {
  try {
    const funnel = await businessMetricsService.getConversionFunnel();
    res.json({
      success: true,
      funnel
    });
  } catch (error) {
    logger.error('[BUSINESS_METRICS] Error getting conversion funnel', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get conversion funnel'
    });
  }
});

/**
 * @swagger
 * /api/business-metrics/appointments:
 *   get:
 *     summary: Get appointment statistics
 *     tags: [Business Metrics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Appointment statistics
 */
router.get('/appointments', auth, async (req, res) => {
  try {
    const stats = await businessMetricsService.getAppointmentStats();
    res.json({
      success: true,
      appointments: stats
    });
  } catch (error) {
    logger.error('[BUSINESS_METRICS] Error getting appointment stats', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get appointment statistics'
    });
  }
});

/**
 * @swagger
 * /api/business-metrics/revenue:
 *   get:
 *     summary: Get revenue statistics
 *     tags: [Business Metrics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Revenue statistics
 */
router.get('/revenue', auth, async (req, res) => {
  try {
    const stats = await businessMetricsService.getRevenueStats();
    res.json({
      success: true,
      revenue: stats
    });
  } catch (error) {
    logger.error('[BUSINESS_METRICS] Error getting revenue stats', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get revenue statistics'
    });
  }
});

module.exports = router;
