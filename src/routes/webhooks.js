const express = require('express');
const router = express.Router();

const { handleRevenueHunt, createTelemedicineAppointment } = require('../controllers/revenueHuntWebhookController');
const { handleShopifyAppointment, shopifyHealthCheck } = require('../controllers/shopifyController');
const tebraService = require('../services/tebraService');
const providerMapping = require('../config/providerMapping');

// RevenueHunt sends questionnaire results via webhook
router.post('/revenue-hunt', express.json({ limit: '2mb' }), handleRevenueHunt);

// Create telemedicine appointment with Google Meet link
router.post('/telemedicine-appointment', express.json(), createTelemedicineAppointment);

// Shopify appointment booking endpoints
router.post('/shopify/consultancy', express.json({ limit: '2mb' }), handleShopifyAppointment);
router.get('/shopify/health', shopifyHealthCheck);

// Helper endpoints to discover Practice and Provider IDs
router.get('/practices', async (req, res) => {
  try {
    const practices = await tebraService.getPractices();
    res.json({
      success: true,
      practices: practices.practices,
      totalCount: practices.totalCount,
      message: 'Use these practice IDs in your environment variables'
    });
  } catch (error) {
    console.error('Get practices error', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal error', 
      error: error.message 
    });
  }
});

router.get('/providers/:practiceId', async (req, res) => {
  try {
    const { practiceId } = req.params;
    const providers = await tebraService.getProviders({ practiceId });
    res.json({
      success: true,
      providers: providers.providers,
      totalCount: providers.totalCount,
      practiceId,
      message: 'Use these provider IDs in your environment variables'
    });
  } catch (error) {
    console.error('Get providers error', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal error', 
      error: error.message 
    });
  }
});

// Get availability for Easy Appointment plugin
router.get('/availability/:state', async (req, res) => {
  try {
    const { state } = req.params;
    const { fromDate, toDate, providerId } = req.query;
    
    const mapping = providerMapping[state.toUpperCase()];
    if (!mapping) {
      return res.status(400).json({ 
        success: false, 
        message: `Unsupported state: ${state}` 
      });
    }

    const availability = await tebraService.getAvailability({
      practiceId: mapping.practiceId,
      providerId: providerId || mapping.defaultProviderId,
      isAvailable: true,
      fromDate: fromDate || new Date().toISOString().split('T')[0],
      toDate: toDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    });

    res.json({
      success: true,
      availability: availability.availability,
      totalCount: availability.totalCount,
      state: state.toUpperCase(),
      practiceId: mapping.practiceId,
      providerId: providerId || mapping.defaultProviderId
    });
  } catch (error) {
    console.error('Get availability error', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal error', 
      error: error.message 
    });
  }
});

// Shopify order webhook endpoints
const billingController = require('../controllers/billingController');
router.post('/shopify/orders/paid', express.json({ limit: '1mb' }), billingController.handleShopifyOrderPaid);
router.post('/shopify/orders/created', express.json({ limit: '1mb' }), billingController.handleShopifyOrderCreated);

// Cowlendar webhook endpoints
// NOTE: Cowlendar does NOT have direct webhook configuration in their app settings.
// These endpoints are for potential future direct webhook support or manual API integration.
// PRIMARY INTEGRATION: Cowlendar bookings are handled through Shopify Order Created webhook
// (see billingController.handleShopifyOrderCreated at /webhooks/shopify/orders/created)
const cowlendarWebhookController = require('../controllers/cowlendarWebhookController');
router.post('/cowlendar/appointment-created', express.json({ limit: '1mb' }), cowlendarWebhookController.handleAppointmentCreated);
router.post('/cowlendar/appointment-updated', express.json({ limit: '1mb' }), cowlendarWebhookController.handleAppointmentUpdated);

// Test endpoint to verify webhook connectivity
router.get('/shopify/orders/created/test', (req, res) => {
  res.json({
    success: true,
    message: 'Webhook endpoint is accessible',
    endpoint: '/webhooks/shopify/orders/created',
    timestamp: new Date().toISOString(),
    instructions: 'This endpoint confirms your webhook URL is reachable. Make sure Shopify webhook points to POST /webhooks/shopify/orders/created'
  });
});

module.exports = router;



