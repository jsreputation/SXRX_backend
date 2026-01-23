const express = require('express');
const router = express.Router();
const { verifyShopifyWebhook, verifyRevenueHuntWebhook, captureRawBody } = require('../middleware/webhookVerification');
const logger = require('../utils/logger');

const { handleRevenueHunt, createTelemedicineAppointment } = require('../controllers/revenueHuntWebhookController');
const { handleShopifyAppointment, shopifyHealthCheck } = require('../controllers/shopifyController');
const tebraService = require('../services/tebraService');
const providerMapping = require('../config/providerMapping');

// Initialize job queue workers
const jobQueueService = require('../services/jobQueue');
const jobProcessors = require('../services/jobProcessors');

// Create workers for background job processing
if (jobQueueService.enabled) {
  jobQueueService.createWorker('webhooks', async (job) => {
    return await jobProcessors.processWebhook(job.data);
  });
  
  jobQueueService.createWorker('emails', async (job) => {
    return await jobProcessors.sendEmail(job.data);
  });
  
  jobQueueService.createWorker('documents', async (job) => {
    return await jobProcessors.createDocument(job.data);
  });
  
  logger.info('[WEBHOOKS] Job queue workers initialized');
}

// RevenueHunt v2 sends questionnaire results via webhook
// Note: RevenueHunt v2 does not use webhook secrets/signatures, so verification is skipped
// captureRawBody is kept for consistency but not required for signature verification
router.post('/revenue-hunt', captureRawBody, express.json({ limit: '2mb' }), verifyRevenueHuntWebhook, handleRevenueHunt);

// Create telemedicine appointment with Google Meet link
router.post('/telemedicine-appointment', express.json(), createTelemedicineAppointment);

// Shopify appointment booking endpoints
router.post('/shopify/consultancy', express.json({ limit: '2mb' }), handleShopifyAppointment);
router.get('/shopify/health', shopifyHealthCheck);

// Helper endpoints to discover Practice and Provider IDs
router.get('/practices', async (req, res) => {
  try {
    // Check cache for practices list
    const cacheService = require('../services/cacheService');
    const cacheKey = cacheService.generateKey('practices', {});
    const cachedPractices = await cacheService.get(cacheKey);
    if (cachedPractices) {
      console.log(`✅ [PRACTICES] Returning cached practices list`);
      return res.json(cachedPractices);
    }
    
    const practices = await tebraService.getPractices();
    const response = {
      success: true,
      practices: practices.practices,
      totalCount: practices.totalCount,
      message: 'Use these practice IDs in your environment variables'
    };
    
    // Cache practices list for 10 minutes (600 seconds) - practices don't change often
    await cacheService.set(cacheKey, response, 600);
    
    res.json(response);
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
    
    // Check cache for providers list
    const cacheService = require('../services/cacheService');
    const cacheKey = cacheService.generateKey('providers', { practiceId });
    const cachedProviders = await cacheService.get(cacheKey);
    if (cachedProviders) {
      console.log(`✅ [PROVIDERS] Returning cached providers list for practice ${practiceId}`);
      return res.json(cachedProviders);
    }
    
    const providers = await tebraService.getProviders({ practiceId });
    const response = {
      success: true,
      providers: providers.providers,
      totalCount: providers.totalCount,
      practiceId,
      message: 'Use these provider IDs in your environment variables'
    };
    
    // Cache providers list for 10 minutes (600 seconds) - providers don't change often
    await cacheService.set(cacheKey, response, 600);
    
    res.json(response);
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
const { validateAvailabilityState } = require('../middleware/validation');
const { parsePaginationParams, createPaginationMeta, createPaginatedResponse } = require('../utils/pagination');
router.get('/availability/:state', validateAvailabilityState, async (req, res) => {
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

    const availabilityService = require('../services/availabilityService');
    
    // Parse pagination params
    const pagination = parsePaginationParams(req, { defaultLimit: 50, maxLimit: 200 });
    
    // Check cache for filtered availability
    const cacheService = require('../services/cacheService');
    const cacheKey = {
      state: state.toUpperCase(),
      practiceId: mapping.practiceId,
      providerId: providerId || mapping.defaultProviderId,
      fromDate: fromDate || new Date().toISOString().split('T')[0],
      toDate: toDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    };
    
    const cachedFiltered = await cacheService.getCachedAvailability(cacheKey);
    if (cachedFiltered) {
      // Apply pagination to cached filtered slots
      const total = cachedFiltered.length;
      const paginatedSlots = cachedFiltered.slice(pagination.offset, pagination.offset + pagination.limit);
      const paginationMeta = createPaginationMeta({ ...pagination, total });

      return res.json(createPaginatedResponse(paginatedSlots, paginationMeta, {
        rawCount: cachedFiltered.rawCount || 0,
        state: state.toUpperCase(),
        practiceId: mapping.practiceId,
        providerId: providerId || mapping.defaultProviderId,
        filtersApplied: true,
        cached: true
      }));
    }

    // Fetch raw availability from Tebra
    const rawAvailability = await tebraService.getAvailability({
      practiceId: mapping.practiceId,
      providerId: providerId || mapping.defaultProviderId,
      isAvailable: true,
      fromDate: fromDate || new Date().toISOString().split('T')[0],
      toDate: toDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    });

    // Apply business rules and filters (now async)
    const allFilteredSlots = await availabilityService.filterAvailability(
      rawAvailability.availability || [],
      {
        state: state.toUpperCase(),
        practiceId: mapping.practiceId,
        providerId: providerId || mapping.defaultProviderId
      }
    );

    // Cache filtered availability
    await cacheService.cacheAvailability(cacheKey, allFilteredSlots);

    // Apply pagination
    const total = allFilteredSlots.length;
    const paginatedSlots = allFilteredSlots.slice(pagination.offset, pagination.offset + pagination.limit);
    const paginationMeta = createPaginationMeta({ ...pagination, total });

    res.json(createPaginatedResponse(paginatedSlots, paginationMeta, {
      rawCount: rawAvailability.totalCount || 0,
      state: state.toUpperCase(),
      practiceId: mapping.practiceId,
      providerId: providerId || mapping.defaultProviderId,
      filtersApplied: true
    }));
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
// Note: captureRawBody must come before express.json() to preserve raw body for signature verification
const billingController = require('../controllers/billingController');

// Queue webhook processing as background jobs
router.post('/shopify/orders/paid', captureRawBody, express.json({ limit: '1mb' }), verifyShopifyWebhook, async (req, res) => {
  try {
    // Queue webhook processing as background job
    if (jobQueueService.enabled) {
      await jobQueueService.addJob('webhooks', 'processWebhook', {
        webhookType: 'shopify.order.paid',
        payload: req.body,
        headers: req.headers
      });
      
      // Return immediately - processing happens in background
      return res.status(200).json({ 
        success: true, 
        message: 'Webhook queued for processing' 
      });
    }
    
    // Fallback: process synchronously if job queue is disabled
    return await billingController.handleShopifyOrderPaid(req, res);
  } catch (error) {
    logger.error('[WEBHOOKS] Error queuing order paid webhook', { error: error.message });
    // Fallback to synchronous processing on error
    return await billingController.handleShopifyOrderPaid(req, res);
  }
});

router.post('/shopify/orders/created', captureRawBody, express.json({ limit: '1mb' }), verifyShopifyWebhook, async (req, res) => {
  try {
    // Queue webhook processing as background job
    if (jobQueueService.enabled) {
      await jobQueueService.addJob('webhooks', 'processWebhook', {
        webhookType: 'shopify.order.created',
        payload: req.body,
        headers: req.headers
      });
      
      // Return immediately - processing happens in background
      return res.status(200).json({ 
        success: true, 
        message: 'Webhook queued for processing' 
      });
    }
    
    // Fallback: process synchronously if job queue is disabled
    return await billingController.handleShopifyOrderCreated(req, res);
  } catch (error) {
    logger.error('[WEBHOOKS] Error queuing order created webhook', { error: error.message });
    // Fallback to synchronous processing on error
    return await billingController.handleShopifyOrderCreated(req, res);
  }
});

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



