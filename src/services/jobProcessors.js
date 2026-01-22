// backend/src/services/jobProcessors.js
// Job processors for background jobs

const logger = require('../utils/logger');

/**
 * Process webhook job
 */
async function processWebhook(jobData) {
  const { webhookType, payload, headers } = jobData;
  logger.info(`[JOB_PROCESSOR] Processing webhook: ${webhookType}`, { webhookType });

  try {
    // Import webhook handlers
    const billingController = require('../controllers/billingController');
    
    // Create a mock request object for the handlers
    const mockReq = {
      body: payload,
      headers: headers || {}
    };
    const mockRes = {
      status: (code) => ({
        json: (data) => {
          logger.info(`[JOB_PROCESSOR] Webhook handler returned status ${code}`, data);
          return mockRes;
        }
      }),
      json: (data) => {
        logger.info(`[JOB_PROCESSOR] Webhook handler response`, data);
        return mockRes;
      }
    };
    
    // Route to appropriate handler based on webhook type
    switch (webhookType) {
      case 'shopify.order.created':
        await billingController.handleShopifyOrderCreated(mockReq, mockRes);
        break;
      case 'shopify.order.paid':
        await billingController.handleShopifyOrderPaid(mockReq, mockRes);
        break;
      default:
        logger.warn(`[JOB_PROCESSOR] Unknown webhook type: ${webhookType}`);
    }
    
    logger.info(`[JOB_PROCESSOR] Webhook ${webhookType} processed successfully`);
  } catch (error) {
    logger.error(`[JOB_PROCESSOR] Failed to process webhook ${webhookType}`, {
      error: error.message,
      stack: error.stack
    });
    throw error; // Re-throw to mark job as failed
  }
}

/**
 * Process email sending job
 */
async function sendEmail(jobData) {
  const { to, subject, text, html, from } = jobData;
  logger.info(`[JOB_PROCESSOR] Sending email to: ${to}`, { subject });

  try {
    const sgMail = require('@sendgrid/mail');
    const sgKey = process.env.SENDGRID_API_KEY;
    
    if (!sgKey) {
      throw new Error('SENDGRID_API_KEY not configured');
    }
    
    sgMail.setApiKey(sgKey);
    
    const msg = {
      to,
      from: from || process.env.SENDGRID_FROM || 'no-reply@example.com',
      subject,
      text,
      html
    };
    
    await sgMail.send(msg);
    logger.info(`[JOB_PROCESSOR] Email sent successfully to: ${to}`);
  } catch (error) {
    logger.error(`[JOB_PROCESSOR] Failed to send email to ${to}`, {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Process document creation job
 */
async function createDocument(jobData) {
  const { documentData } = jobData;
  logger.info(`[JOB_PROCESSOR] Creating document: ${documentData.name}`);

  try {
    const tebraService = require('./tebraService');
    const result = await tebraService.createDocument(documentData);
    logger.info(`[JOB_PROCESSOR] Document created successfully: ${result.id}`);
    return result;
  } catch (error) {
    logger.error(`[JOB_PROCESSOR] Failed to create document`, {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Process batch operations job
 */
async function processBatch(jobData) {
  const { operation, items } = jobData;
  logger.info(`[JOB_PROCESSOR] Processing batch operation: ${operation}`, { itemCount: items.length });

  try {
    // Process items in batches
    const batchSize = 10;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await Promise.all(batch.map(item => processBatchItem(operation, item)));
    }
    
    logger.info(`[JOB_PROCESSOR] Batch operation ${operation} completed successfully`);
  } catch (error) {
    logger.error(`[JOB_PROCESSOR] Failed to process batch operation ${operation}`, {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Process a single batch item
 */
async function processBatchItem(operation, item) {
  switch (operation) {
    case 'sync_patients':
      // Sync patient data
      const tebraService = require('./tebraService');
      await tebraService.updatePatient(item.patientId, item.data);
      break;
    default:
      logger.warn(`[JOB_PROCESSOR] Unknown batch operation: ${operation}`);
  }
}

// Export processors
module.exports = {
  processWebhook,
  sendEmail,
  createDocument,
  processBatch
};
