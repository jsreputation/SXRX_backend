// backend/src/routes/admin.js
// Admin routes for viewing and managing failed webhooks and dead letter queue

const express = require('express');
const router = express.Router();
const { verifyAdminApiKey } = require('../middleware/adminAuth');
const deadLetterQueue = require('../services/deadLetterQueue');
const webhookRetryService = require('../services/webhookRetryService');
const billingController = require('../controllers/billingController');
const revenueHuntWebhookController = require('../controllers/revenueHuntWebhookController');

// Get dead letter queue (permanently failed webhooks)
router.get('/dlq', verifyAdminApiKey, async (req, res) => {
  try {
    const { limit = 50, offset = 0, webhookType } = req.query;
    
    const webhooks = await deadLetterQueue.getDeadLetterQueue({
      limit: parseInt(limit),
      offset: parseInt(offset),
      webhookType: webhookType || null
    });
    
    const count = await deadLetterQueue.getDeadLetterQueueCount(webhookType || null);
    
    res.json({
      success: true,
      webhooks,
      count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error getting dead letter queue:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dead letter queue',
      error: error.message
    });
  }
});

// Get webhook statistics
router.get('/webhooks/stats', verifyAdminApiKey, async (req, res) => {
  try {
    const stats = await deadLetterQueue.getWebhookStatistics();
    res.json({
      success: true,
      statistics: stats
    });
  } catch (error) {
    console.error('Error getting webhook statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get webhook statistics',
      error: error.message
    });
  }
});

// Replay a webhook from dead letter queue
router.post('/dlq/:webhookId/replay', verifyAdminApiKey, async (req, res) => {
  try {
    const { webhookId } = req.params;
    const webhookIdNum = parseInt(webhookId);
    
    if (isNaN(webhookIdNum)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid webhook ID'
      });
    }
    
    // Get webhook to determine handler
    const { rows } = await require('../db/pg').query(
      'SELECT * FROM failed_webhooks WHERE id = $1',
      [webhookIdNum]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Webhook not found'
      });
    }
    
    const webhook = rows[0];
    const handlers = {
      'shopify_order_created': billingController.handleShopifyOrderCreated,
      'shopify_order_paid': billingController.handleShopifyOrderPaid,
      'revenuehunt': revenueHuntWebhookController.handleRevenueHunt
    };
    
    const handler = handlers[webhook.webhook_type];
    
    if (!handler) {
      return res.status(400).json({
        success: false,
        message: `No handler available for webhook type: ${webhook.webhook_type}`
      });
    }
    
    const result = await deadLetterQueue.replayWebhook(webhookIdNum, handler);
    
    res.json({
      success: true,
      message: 'Webhook replayed',
      result
    });
  } catch (error) {
    console.error('Error replaying webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to replay webhook',
      error: error.message
    });
  }
});

// Delete webhook from dead letter queue
router.delete('/dlq/:webhookId', verifyAdminApiKey, async (req, res) => {
  try {
    const { webhookId } = req.params;
    const webhookIdNum = parseInt(webhookId);
    
    if (isNaN(webhookIdNum)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid webhook ID'
      });
    }
    
    await deadLetterQueue.deleteFromDeadLetterQueue(webhookIdNum);
    
    res.json({
      success: true,
      message: 'Webhook deleted from dead letter queue'
    });
  } catch (error) {
    console.error('Error deleting webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete webhook',
      error: error.message
    });
  }
});

// Manually trigger webhook retry processing
router.post('/webhooks/retry/process', verifyAdminApiKey, async (req, res) => {
  try {
    const handlers = {
      'shopify_order_created': billingController.handleShopifyOrderCreated,
      'shopify_order_paid': billingController.handleShopifyOrderPaid,
      'revenuehunt': revenueHuntWebhookController.handleRevenueHunt
    };
    
    const result = await webhookRetryService.processPendingWebhooks(handlers);
    
    res.json({
      success: true,
      message: 'Webhook retry processing completed',
      result
    });
  } catch (error) {
    console.error('Error processing webhook retries:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process webhook retries',
      error: error.message
    });
  }
});

module.exports = router;
