// backend/src/services/deadLetterQueue.js
// Dead Letter Queue service for permanently failed webhooks

const { query } = require('../db/pg');
const logger = require('../utils/logger');

/**
 * Move webhook to dead letter queue (permanently failed)
 * @param {number} webhookId - Failed webhook ID
 * @param {string} reason - Reason for permanent failure
 */
async function moveToDeadLetterQueue(webhookId, reason = 'Max retry attempts exceeded') {
  try {
    // Update status to 'failed' (which indicates permanent failure)
    await query(
      `UPDATE failed_webhooks 
       SET status = 'failed', 
           error_message = COALESCE(error_message || ' | ', '') || $1,
           updated_at = NOW()
       WHERE id = $2`,
      [reason, webhookId]
    );
    
    logger.warn('[DEAD LETTER QUEUE] Moved webhook to DLQ', {
      webhookId,
      reason
    });
    
    return { success: true, webhookId };
  } catch (error) {
    logger.error('[DEAD LETTER QUEUE] Failed to move webhook to DLQ:', error);
    throw error;
  }
}

/**
 * Get all permanently failed webhooks (dead letter queue)
 * @param {Object} options
 * @param {number} options.limit - Maximum number of records to return
 * @param {number} options.offset - Offset for pagination
 * @param {string} options.webhookType - Filter by webhook type (optional)
 * @returns {Promise<Array>} Array of failed webhook records
 */
async function getDeadLetterQueue({ limit = 50, offset = 0, webhookType = null } = {}) {
  try {
    let sql = `SELECT * FROM failed_webhooks 
               WHERE status = 'failed' 
               AND attempt_count >= max_attempts`;
    const params = [];
    let paramIndex = 1;
    
    if (webhookType) {
      sql += ` AND webhook_type = $${paramIndex++}`;
      params.push(webhookType);
    }
    
    sql += ` ORDER BY updated_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);
    
    const { rows } = await query(sql, params);
    return rows;
  } catch (error) {
    logger.error('[DEAD LETTER QUEUE] Failed to get DLQ records:', error);
    return [];
  }
}

/**
 * Get count of permanently failed webhooks
 * @param {string} webhookType - Filter by webhook type (optional)
 * @returns {Promise<number>} Count of failed webhooks
 */
async function getDeadLetterQueueCount(webhookType = null) {
  try {
    let sql = `SELECT COUNT(*) as count FROM failed_webhooks 
               WHERE status = 'failed' 
               AND attempt_count >= max_attempts`;
    const params = [];
    
    if (webhookType) {
      sql += ` AND webhook_type = $1`;
      params.push(webhookType);
    }
    
    const { rows } = await query(sql, params);
    return parseInt(rows[0]?.count || 0);
  } catch (error) {
    logger.error('[DEAD LETTER QUEUE] Failed to get DLQ count:', error);
    return 0;
  }
}

/**
 * Replay a webhook from dead letter queue
 * @param {number} webhookId - Webhook ID to replay
 * @param {Function} handlerFunction - Handler function to process the webhook
 * @returns {Promise<Object>} Result of replay attempt
 */
async function replayWebhook(webhookId, handlerFunction) {
  try {
    const { rows } = await query(
      'SELECT * FROM failed_webhooks WHERE id = $1 AND status = $2',
      [webhookId, 'failed']
    );
    
    if (rows.length === 0) {
      throw new Error(`Webhook ${webhookId} not found in dead letter queue`);
    }
    
    const webhook = rows[0];
    
    // Reset webhook to pending status for retry
    await query(
      `UPDATE failed_webhooks 
       SET status = 'pending',
           attempt_count = 0,
           next_retry_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [webhookId]
    );
    
    logger.info('[DEAD LETTER QUEUE] Replayed webhook from DLQ', { webhookId });
    
    // Process the webhook immediately
    const webhookRetryService = require('./webhookRetryService');
    const result = await webhookRetryService.processWebhookRetry(webhook, handlerFunction);
    
    return result;
  } catch (error) {
    logger.error('[DEAD LETTER QUEUE] Failed to replay webhook:', error);
    throw error;
  }
}

/**
 * Delete webhook from dead letter queue
 * @param {number} webhookId - Webhook ID to delete
 */
async function deleteFromDeadLetterQueue(webhookId) {
  try {
    await query('DELETE FROM failed_webhooks WHERE id = $1 AND status = $2', [webhookId, 'failed']);
    logger.info('[DEAD LETTER QUEUE] Deleted webhook from DLQ', { webhookId });
    return { success: true, webhookId };
  } catch (error) {
    logger.error('[DEAD LETTER QUEUE] Failed to delete webhook from DLQ:', error);
    throw error;
  }
}

/**
 * Get webhook statistics
 * @returns {Promise<Object>} Statistics about webhooks
 */
async function getWebhookStatistics() {
  try {
    const { rows } = await query(`
      SELECT 
        status,
        webhook_type,
        COUNT(*) as count
      FROM failed_webhooks
      GROUP BY status, webhook_type
      ORDER BY status, webhook_type
    `);
    
    const stats = {
      pending: 0,
      processing: 0,
      succeeded: 0,
      failed: 0,
      byType: {}
    };
    
    rows.forEach(row => {
      const status = row.status;
      const type = row.webhook_type;
      const count = parseInt(row.count);
      
      if (stats[status] !== undefined) {
        stats[status] += count;
      }
      
      if (!stats.byType[type]) {
        stats.byType[type] = { pending: 0, processing: 0, succeeded: 0, failed: 0 };
      }
      stats.byType[type][status] = count;
    });
    
    return stats;
  } catch (error) {
    logger.error('[DEAD LETTER QUEUE] Failed to get webhook statistics:', error);
    return {
      pending: 0,
      processing: 0,
      succeeded: 0,
      failed: 0,
      byType: {}
    };
  }
}

module.exports = {
  moveToDeadLetterQueue,
  getDeadLetterQueue,
  getDeadLetterQueueCount,
  replayWebhook,
  deleteFromDeadLetterQueue,
  getWebhookStatistics
};
