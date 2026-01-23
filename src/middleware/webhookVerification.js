// backend/src/middleware/webhookVerification.js
// Middleware to verify webhook signatures for Shopify
// Note: RevenueHunt v2 does not use webhook secrets/signatures

const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Verify Shopify webhook signature
 * Shopify sends webhooks with X-Shopify-Hmac-SHA256 header
 */
function verifyShopifyWebhook(req, res, next) {
  try {
    const hmacHeader = req.get('X-Shopify-Hmac-SHA256');
    const shopifySecret = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_API_SECRET_KEY;
    
    // If no secret configured, skip verification (development mode)
    if (!shopifySecret) {
      logger.warn('[WEBHOOK VERIFY] Shopify webhook secret not configured - skipping verification');
      return next();
    }
    
    // If no HMAC header, reject
    if (!hmacHeader) {
      logger.warn('[WEBHOOK VERIFY] Missing X-Shopify-Hmac-SHA256 header');
      return res.status(401).json({
        success: false,
        message: 'Missing webhook signature'
      });
    }
    
    // Calculate expected HMAC using raw body if available, otherwise stringify
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const calculatedHmac = crypto
      .createHmac('sha256', shopifySecret)
      .update(rawBody, 'utf8')
      .digest('base64');
    
    // Compare HMACs using constant-time comparison
    const isValid = crypto.timingSafeEqual(
      Buffer.from(hmacHeader),
      Buffer.from(calculatedHmac)
    );
    
    if (!isValid) {
      logger.warn('[WEBHOOK VERIFY] Invalid Shopify webhook signature', {
        path: req.path,
        shop: req.get('X-Shopify-Shop-Domain')
      });
      return res.status(401).json({
        success: false,
        message: 'Invalid webhook signature'
      });
    }
    
    logger.debug('[WEBHOOK VERIFY] Shopify webhook signature verified');
    next();
  } catch (error) {
    logger.errorWithContext(error, {
      operation: 'shopify_webhook_verification',
      path: req.path
    });
    return res.status(500).json({
      success: false,
      message: 'Webhook verification failed',
      error: error.message
    });
  }
}

/**
 * Verify RevenueHunt webhook
 * Note: RevenueHunt v2 does not use webhook secrets/signatures
 * This middleware simply logs the request and passes through
 */
function verifyRevenueHuntWebhook(req, res, next) {
  try {
    // RevenueHunt v2 does not provide webhook secrets
    // We accept all RevenueHunt webhooks without signature verification
    logger.debug('[WEBHOOK VERIFY] RevenueHunt v2 webhook received (no signature verification)', {
      path: req.path,
      method: req.method,
      hasBody: !!req.body
    });
    next();
  } catch (error) {
    logger.errorWithContext(error, {
      operation: 'revenuehunt_webhook_verification',
      path: req.path
    });
    return res.status(500).json({
      success: false,
      message: 'Webhook verification failed',
      error: error.message
    });
  }
}

/**
 * Middleware to capture raw body for webhook verification
 * Must be used before express.json() middleware
 * This middleware reads the raw body and stores it, then parses JSON
 */
function captureRawBody(req, res, next) {
  if (req.is('application/json') || req.is('application/x-www-form-urlencoded')) {
    let data = '';
    req.setEncoding('utf8');
    
    req.on('data', chunk => {
      data += chunk;
    });
    
    req.on('end', () => {
      req.rawBody = data;
      try {
        req.body = JSON.parse(data);
      } catch (e) {
        // If JSON parsing fails, try to parse as form data or leave as string
        req.body = data;
      }
      next();
    });
    
    req.on('error', (err) => {
      logger.errorWithContext(err, { operation: 'capture_raw_body' });
      return res.status(400).json({
        success: false,
        message: 'Error reading request body'
      });
    });
  } else {
    next();
  }
}

module.exports = {
  verifyShopifyWebhook,
  verifyRevenueHuntWebhook,
  captureRawBody
};
