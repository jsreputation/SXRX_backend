// backend/src/services/questionnaireCompletionService.js
// Server-side questionnaire completion registry for secure validation
// Prevents guest users from bypassing questionnaire by manipulating cart properties

const { query } = require('../db/pg');

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS questionnaire_completions (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  customer_id BIGINT,
  product_id BIGINT NOT NULL,
  quiz_id TEXT NOT NULL,
  patient_id TEXT,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  red_flags_detected BOOLEAN DEFAULT FALSE,
  state VARCHAR(10),
  purchase_type VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qc_email ON questionnaire_completions(email);
CREATE INDEX IF NOT EXISTS idx_qc_customer ON questionnaire_completions(customer_id);
CREATE INDEX IF NOT EXISTS idx_qc_product ON questionnaire_completions(product_id);
CREATE INDEX IF NOT EXISTS idx_qc_patient ON questionnaire_completions(patient_id);
CREATE INDEX IF NOT EXISTS idx_qc_completed_at ON questionnaire_completions(completed_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qc_unique ON questionnaire_completions(email, product_id, completed_at);
`;

let initialized = false;
async function ensureInit() {
  if (initialized) return;
  await query(INIT_SQL);
  initialized = true;
}

/**
 * Record a questionnaire completion
 * @param {Object} params
 * @param {string} params.email - User email
 * @param {number|null} params.customerId - Shopify customer ID (null for guests)
 * @param {number} params.productId - Product ID
 * @param {string} params.quizId - Quiz ID
 * @param {string|null} params.patientId - Tebra patient ID
 * @param {boolean} params.redFlagsDetected - Whether red flags were detected
 * @param {string|null} params.state - State code
 * @param {string|null} params.purchaseType - Purchase type (subscription/one-time)
 * @returns {Promise<Object>} Created record
 */
async function recordCompletion({
  email,
  customerId = null,
  productId,
  quizId,
  patientId = null,
  redFlagsDetected = false,
  state = null,
  purchaseType = null
}) {
  await ensureInit();
  
  if (!email || !productId || !quizId) {
    throw new Error('Missing required fields: email, productId, quizId');
  }

  const sql = `
    INSERT INTO questionnaire_completions (
      email, customer_id, product_id, quiz_id, patient_id,
      red_flags_detected, state, purchase_type, completed_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
    RETURNING *
  `;
  
  const params = [
    email.toLowerCase().trim(),
    customerId || null,
    productId,
    quizId,
    patientId || null,
    redFlagsDetected,
    state ? state.toUpperCase() : null,
    purchaseType
  ];

  const { rows } = await query(sql, params);
  return rows[0];
}

/**
 * Check if questionnaire is completed for a product
 * @param {Object} params
 * @param {string} params.email - User email
 * @param {number|null} params.customerId - Shopify customer ID (optional)
 * @param {number} params.productId - Product ID
 * @param {number} params.maxAgeHours - Maximum age of completion in hours (default: 24)
 * @returns {Promise<Object|null>} Completion record or null
 */
async function checkCompletion({ email, customerId = null, productId, maxAgeHours = 24 }) {
  await ensureInit();
  
  if (!email || !productId) {
    return null;
  }

  const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  
  const where = [];
  const params = [];
  
  where.push(`email = $${params.length + 1}`);
  params.push(email.toLowerCase().trim());
  
  where.push(`product_id = $${params.length + 1}`);
  params.push(productId);
  
  if (customerId) {
    where.push(`(customer_id = $${params.length + 1} OR customer_id IS NULL)`);
    params.push(customerId);
  }
  
  where.push(`completed_at >= $${params.length + 1}`);
  params.push(cutoffTime.toISOString());
  
  const sql = `
    SELECT * FROM questionnaire_completions
    WHERE ${where.join(' AND ')}
    ORDER BY completed_at DESC
    LIMIT 1
  `;
  
  const { rows } = await query(sql, params);
  return rows[0] || null;
}

/**
 * Get latest questionnaire completion for a product (used by orderValidationService).
 * @param {Object} params
 * @param {string} params.email - User email
 * @param {number|null} params.customerId - Shopify customer ID (optional)
 * @param {number} params.productId - Product ID
 * @param {number} params.maxAgeHours - Maximum age in hours (default: 24)
 * @returns {Promise<Object|null>} Completion record or null
 */
async function getLatestCompletion({ email, customerId = null, productId, maxAgeHours = 24 }) {
  return checkCompletion({ email, customerId, productId, maxAgeHours });
}

/**
 * Validate questionnaire completion for checkout
 * @param {Object} params
 * @param {string} params.email - User email
 * @param {number|null} params.customerId - Shopify customer ID
 * @param {number} params.productId - Product ID
 * @returns {Promise<boolean>} True if valid completion exists
 */
async function validateForCheckout({ email, customerId = null, productId }) {
  const completion = await checkCompletion({ email, customerId, productId, maxAgeHours: 24 });
  
  if (!completion) {
    return false;
  }
  
  // If red flags were detected, require consultation (don't allow direct purchase)
  if (completion.red_flags_detected) {
    return false;
  }
  
  return true;
}

/**
 * Get completion history for a user
 * @param {Object} params
 * @param {string} params.email - User email
 * @param {number|null} params.customerId - Shopify customer ID (optional)
 * @param {number} params.limit - Maximum number of records (default: 50)
 * @returns {Promise<Array>} Array of completion records
 */
async function getCompletionHistory({ email, customerId = null, limit = 50 }) {
  await ensureInit();
  
  if (!email) {
    return [];
  }

  const where = [];
  const params = [];
  
  where.push(`email = $${params.length + 1}`);
  params.push(email.toLowerCase().trim());
  
  if (customerId) {
    where.push(`(customer_id = $${params.length + 1} OR customer_id IS NULL)`);
    params.push(customerId);
  }
  
  params.push(limit);
  
  const sql = `
    SELECT * FROM questionnaire_completions
    WHERE ${where.join(' AND ')}
    ORDER BY completed_at DESC
    LIMIT $${params.length}
  `;
  
  const { rows } = await query(sql, params);
  return rows;
}

/**
 * Link guest completion to customer account
 * @param {string} email - User email
 * @param {number} customerId - Shopify customer ID
 * @returns {Promise<number>} Number of records updated
 */
async function linkToCustomer(email, customerId) {
  await ensureInit();
  
  if (!email || !customerId) {
    return 0;
  }

  const sql = `
    UPDATE questionnaire_completions
    SET customer_id = $1, updated_at = NOW()
    WHERE email = $2 AND customer_id IS NULL
  `;
  
  const result = await query(sql, [customerId, email.toLowerCase().trim()]);
  return result.rowCount || 0;
}

module.exports = {
  ensureInit,
  recordCompletion,
  checkCompletion,
  getLatestCompletion,
  validateForCheckout,
  getCompletionHistory,
  linkToCustomer
};
