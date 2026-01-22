// backend/src/services/webhookRetryService.js
// Service to handle webhook retry logic with exponential backoff

const { query } = require('../db/pg');
const logger = require('../utils/logger');

const MAX_ATTEMPTS = parseInt(process.env.WEBHOOK_MAX_RETRY_ATTEMPTS) || 5;
const INITIAL_RETRY_DELAY_MS = parseInt(process.env.WEBHOOK_INITIAL_RETRY_DELAY_MS) || 60000; // 1 minute
const MAX_RETRY_DELAY_MS = parseInt(process.env.WEBHOOK_MAX_RETRY_DELAY_MS) || 3600000; // 1 hour

/**
 * Calculate next retry delay using exponential backoff
 * @param {number} attemptCount - Current attempt number (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function calculateRetryDelay(attemptCount) {
  const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attemptCount);
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

/**
 * Store failed webhook for retry
 * @param {Object} params
 * @param {string} params.webhookType - Type of webhook ('shopify_order_created', 'revenuehunt', etc.)
 * @param {string} params.webhookUrl - URL or endpoint identifier
 * @param {Object} params.payload - Webhook payload
 * @param {Object} params.headers - Webhook headers (optional)
 * @param {Error} params.error - Error that occurred
 */
async function storeFailedWebhook({ webhookType, webhookUrl, payload, headers, error }) {
  try {
    const nextRetryAt = new Date(Date.now() + calculateRetryDelay(0));
    
    await query(
      `INSERT INTO failed_webhooks 
       (webhook_type, webhook_url, payload, headers, attempt_count, next_retry_at, error_message, error_stack, status)
       VALUES ($1, $2, $3, $4, 0, $5, $6, $7, 'pending')
       ON CONFLICT DO NOTHING`,
      [
        webhookType,
        webhookUrl,
        JSON.stringify(payload),
        headers ? JSON.stringify(headers) : null,
        nextRetryAt.toISOString(),
        error?.message || 'Unknown error',
        error?.stack || null
      ]
    );
    
    logger.warn(`[WEBHOOK RETRY] Stored failed webhook for retry`, {
      webhookType,
      webhookUrl,
      nextRetryAt: nextRetryAt.toISOString()
    });
  } catch (dbError) {
    logger.error('[WEBHOOK RETRY] Failed to store failed webhook:', dbError);
    // Don't throw - we don't want to fail the original request
  }
}

/**
 * Get pending webhooks ready for retry
 * @param {number} limit - Maximum number of webhooks to fetch
 * @returns {Promise<Array>} Array of webhook records
 */
async function getPendingWebhooks(limit = 10) {
  try {
    const { rows } = await query(
      `SELECT * FROM failed_webhooks 
       WHERE status = 'pending' 
       AND next_retry_at <= NOW()
       AND attempt_count < max_attempts
       ORDER BY next_retry_at ASC
       LIMIT $1`,
      [limit]
    );
    
    return rows;
  } catch (error) {
    logger.error('[WEBHOOK RETRY] Failed to get pending webhooks:', error);
    return [];
  }
}

/**
 * Update webhook retry status
 * @param {number} webhookId - Webhook record ID
 * @param {Object} updates - Fields to update
 */
async function updateWebhookStatus(webhookId, updates) {
  try {
    const setClauses = [];
    const values = [];
    let paramIndex = 1;
    
    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    
    if (updates.attemptCount !== undefined) {
      setClauses.push(`attempt_count = $${paramIndex++}`);
      values.push(updates.attemptCount);
    }
    
    if (updates.nextRetryAt !== undefined) {
      setClauses.push(`next_retry_at = $${paramIndex++}`);
      values.push(updates.nextRetryAt);
    }
    
    if (updates.errorMessage !== undefined) {
      setClauses.push(`error_message = $${paramIndex++}`);
      values.push(updates.errorMessage);
    }
    
    if (updates.errorStack !== undefined) {
      setClauses.push(`error_stack = $${paramIndex++}`);
      values.push(updates.errorStack);
    }
    
    if (setClauses.length === 0) return;
    
    setClauses.push(`updated_at = NOW()`);
    values.push(webhookId);
    
    await query(
      `UPDATE failed_webhooks 
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex}`,
      values
    );
  } catch (error) {
    logger.error('[WEBHOOK RETRY] Failed to update webhook status:', error);
    throw error;
  }
}

/**
 * Process a single webhook retry
 * @param {Object} webhookRecord - Webhook record from database
 * @param {Function} handlerFunction - Function to call to process the webhook
 */
async function processWebhookRetry(webhookRecord, handlerFunction) {
  const { id, webhook_type, payload, headers, attempt_count } = webhookRecord;
  
  logger.info(`[WEBHOOK RETRY] Processing retry ${attempt_count + 1}/${MAX_ATTEMPTS} for webhook ${id}`, {
    webhookType: webhook_type,
    attemptCount: attempt_count + 1
  });
  
  try {
    // Mark as processing
    await updateWebhookStatus(id, { status: 'processing' });
    
    // Parse payload and headers
    const parsedPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const parsedHeaders = headers ? (typeof headers === 'string' ? JSON.parse(headers) : headers) : {};
    
    // Create mock request/response objects for handler
    const mockReq = {
      body: parsedPayload,
      get: (headerName) => parsedHeaders[headerName.toLowerCase()] || null,
      headers: parsedHeaders,
      rawBody: JSON.stringify(parsedPayload)
    };
    
    const mockRes = {
      status: (code) => ({
        json: (data) => {
          if (code >= 200 && code < 300) {
            return Promise.resolve({ statusCode: code, data });
          }
          throw new Error(`Handler returned status ${code}`);
        }
      }),
      json: (data) => Promise.resolve({ statusCode: 200, data })
    };
    
    // Call the handler function
    await handlerFunction(mockReq, mockRes);
    
    // Mark as succeeded
    await updateWebhookStatus(id, {
      status: 'succeeded',
      attemptCount: attempt_count + 1
    });
    
    logger.info(`[WEBHOOK RETRY] ✅ Webhook ${id} retry succeeded`);
    return { success: true, webhookId: id };
    
  } catch (error) {
    const newAttemptCount = attempt_count + 1;
    const isFinalAttempt = newAttemptCount >= MAX_ATTEMPTS;
    
    if (isFinalAttempt) {
      // Move to dead letter queue
      const deadLetterQueue = require('./deadLetterQueue');
      await deadLetterQueue.moveToDeadLetterQueue(id, `Max retry attempts (${MAX_ATTEMPTS}) exceeded`);
      
      logger.error(`[WEBHOOK RETRY] ❌ Webhook ${id} permanently failed after ${newAttemptCount} attempts - moved to DLQ`);
      return { success: false, webhookId: id, permanent: true };
    } else {
      // Schedule next retry
      const nextRetryDelay = calculateRetryDelay(newAttemptCount);
      const nextRetryAt = new Date(Date.now() + nextRetryDelay);
      
      await updateWebhookStatus(id, {
        status: 'pending',
        attemptCount: newAttemptCount,
        nextRetryAt: nextRetryAt.toISOString(),
        errorMessage: error.message,
        errorStack: error.stack
      });
      
      logger.warn(`[WEBHOOK RETRY] ⏳ Webhook ${id} scheduled for retry ${newAttemptCount + 1} at ${nextRetryAt.toISOString()}`);
      return { success: false, webhookId: id, nextRetryAt: nextRetryAt.toISOString() };
    }
  }
}

/**
 * Process all pending webhooks
 * @param {Object} handlers - Map of webhook types to handler functions
 */
async function processPendingWebhooks(handlers = {}) {
  const pending = await getPendingWebhooks(20);
  
  if (pending.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, rescheduled: 0 };
  }
  
  logger.info(`[WEBHOOK RETRY] Processing ${pending.length} pending webhook(s)`);
  
  let succeeded = 0;
  let failed = 0;
  let rescheduled = 0;
  
  for (const webhook of pending) {
    const handler = handlers[webhook.webhook_type];
    
    if (!handler) {
      logger.warn(`[WEBHOOK RETRY] No handler for webhook type: ${webhook.webhook_type}`);
      await updateWebhookStatus(webhook.id, { status: 'failed', errorMessage: 'No handler function provided' });
      failed++;
      continue;
    }
    
    const result = await processWebhookRetry(webhook, handler);
    
    if (result.success) {
      succeeded++;
    } else if (result.permanent) {
      failed++;
    } else {
      rescheduled++;
    }
  }
  
  logger.info(`[WEBHOOK RETRY] Processed ${pending.length} webhook(s): ${succeeded} succeeded, ${failed} failed, ${rescheduled} rescheduled`);
  
  return {
    processed: pending.length,
    succeeded,
    failed,
    rescheduled
  };
}

module.exports = {
  storeFailedWebhook,
  getPendingWebhooks,
  updateWebhookStatus,
  processWebhookRetry,
  processPendingWebhooks,
  calculateRetryDelay,
  MAX_ATTEMPTS
};
