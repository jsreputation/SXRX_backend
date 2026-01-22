// backend/src/middleware/webhookVerification.js
// Middleware to verify webhook signatures for Shopify and RevenueHunt

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
 * Verify RevenueHunt webhook signature
 * RevenueHunt may send webhooks with signature in header or body
 */
function verifyRevenueHuntWebhook(req, res, next) {
  try {
    const revenueHuntSecret = process.env.REVENUEHUNT_WEBHOOK_SECRET;
    
    // If no secret configured, skip verification (development mode)
    if (!revenueHuntSecret) {
      logger.warn('[WEBHOOK VERIFY] RevenueHunt webhook secret not configured - skipping verification');
      return next();
    }
    
    // Check for signature in header (X-RevenueHunt-Signature) or body
    const signatureHeader = req.get('X-RevenueHunt-Signature') || 
                           req.get('X-Signature') ||
                           req.body?.signature;
    
    if (!signatureHeader) {
      logger.warn('[WEBHOOK VERIFY] Missing RevenueHunt webhook signature');
      // In development, allow without signature if explicitly enabled
      if (process.env.NODE_ENV === 'development' && process.env.ALLOW_UNSIGNED_WEBHOOKS === 'true') {
        logger.warn('[WEBHOOK VERIFY] Allowing unsigned webhook in development mode');
        return next();
      }
      return res.status(401).json({
        success: false,
        message: 'Missing webhook signature'
      });
    }
    
    // Calculate expected signature
    // RevenueHunt typically uses HMAC-SHA256 with the request body
    const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    const calculatedSignature = crypto
      .createHmac('sha256', revenueHuntSecret)
      .update(rawBody, 'utf8')
      .digest('hex');
    
    // Compare signatures
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(calculatedSignature)
    );
    
    if (!isValid) {
      logger.warn('[WEBHOOK VERIFY] Invalid RevenueHunt webhook signature', {
        path: req.path
      });
      return res.status(401).json({
        success: false,
        message: 'Invalid webhook signature'
      });
    }
    
    logger.debug('[WEBHOOK VERIFY] RevenueHunt webhook signature verified');
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
