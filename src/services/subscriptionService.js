// backend/src/services/subscriptionService.js
// Manages subscription records for monthly recurring billing

const { query } = require('../db/pg');

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  shopify_customer_id TEXT,
  shopify_order_id TEXT,
  shopify_product_id TEXT,
  shopify_variant_id TEXT,
  tebra_patient_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'USD',
  frequency TEXT DEFAULT 'monthly',
  status TEXT DEFAULT 'active',
  next_billing_date DATE NOT NULL,
  last_billing_date DATE,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shopify_customer_id, shopify_product_id, status)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_patient ON subscriptions(tebra_patient_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(shopify_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_next_billing ON subscriptions(next_billing_date) WHERE status = 'active';
`;

let initialized = false;
async function ensureInit() {
  if (initialized) return;
  try {
    console.log('📋 [SUBSCRIPTIONS] Initializing database table...');
    await query(INIT_SQL);
    console.log('✅ [SUBSCRIPTIONS] Database table initialized successfully');
    initialized = true;
  } catch (error) {
    console.error('❌ [SUBSCRIPTIONS] Error initializing database:', error);
    throw error;
  }
}

async function createSubscription(data) {
  await ensureInit();
  
  const {
    shopifyCustomerId,
    shopifyOrderId,
    shopifyProductId,
    shopifyVariantId,
    tebraPatientId,
    amountCents,
    currency = 'USD',
    frequency = 'monthly',
    status = 'active',
    nextBillingDate,
  } = data;

  // Check if subscription already exists for this customer + product
  if (shopifyCustomerId && shopifyProductId) {
    const existing = await query(
      `SELECT id FROM subscriptions 
       WHERE shopify_customer_id = $1 
       AND shopify_product_id = $2 
       AND status = 'active'`,
      [shopifyCustomerId, shopifyProductId]
    );
    if (existing.rows.length > 0) {
      console.log(`ℹ️ [SUBSCRIPTIONS] Subscription already exists for customer ${shopifyCustomerId}, product ${shopifyProductId}`);
      return existing.rows[0];
    }
  }

  const result = await query(
    `INSERT INTO subscriptions (
      shopify_customer_id, shopify_order_id, shopify_product_id, shopify_variant_id,
      tebra_patient_id, amount_cents, currency, frequency, status, next_billing_date
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      shopifyCustomerId || null,
      shopifyOrderId || null,
      shopifyProductId || null,
      shopifyVariantId || null,
      tebraPatientId,
      amountCents,
      currency,
      frequency,
      status,
      nextBillingDate,
    ]
  );

  console.log(`✅ [SUBSCRIPTIONS] Created subscription ID ${result.rows[0].id}`);
  return result.rows[0];
}

async function getActiveSubscriptions(tebraPatientId = null, shopifyCustomerId = null) {
  await ensureInit();
  
  let sql = `SELECT * FROM subscriptions WHERE status = 'active'`;
  const params = [];
  
  if (tebraPatientId) {
    sql += ` AND tebra_patient_id = $1`;
    params.push(tebraPatientId);
  } else if (shopifyCustomerId) {
    sql += ` AND shopify_customer_id = $1`;
    params.push(shopifyCustomerId);
  }
  
  sql += ` ORDER BY next_billing_date ASC`;
  
  const result = await query(sql, params);
  return result.rows;
}

async function getSubscriptionsDueForBilling(date = null) {
  await ensureInit();
  
  const billingDate = date || new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  
  const result = await query(
    `SELECT * FROM subscriptions 
     WHERE status = 'active' 
     AND next_billing_date <= $1
     ORDER BY next_billing_date ASC`,
    [billingDate]
  );
  
  return result.rows;
}

async function updateSubscriptionBillingDate(subscriptionId, nextBillingDate, lastBillingDate = null) {
  await ensureInit();
  
  const updates = [];
  const params = [];
  let paramIndex = 1;
  
  updates.push(`next_billing_date = $${paramIndex++}`);
  params.push(nextBillingDate);
  
  if (lastBillingDate) {
    updates.push(`last_billing_date = $${paramIndex++}`);
    params.push(lastBillingDate);
  }
  
  updates.push(`updated_at = NOW()`);
  
  params.push(subscriptionId);
  
  const result = await query(
    `UPDATE subscriptions 
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    params
  );
  
  return result.rows[0] || null;
}

async function cancelSubscription(subscriptionId, shopifyCustomerId = null, shopifyProductId = null) {
  await ensureInit();
  
  let sql = `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE `;
  const params = [];
  
  if (subscriptionId) {
    sql += `id = $1`;
    params.push(subscriptionId);
  } else if (shopifyCustomerId && shopifyProductId) {
    sql += `shopify_customer_id = $1 AND shopify_product_id = $2 AND status = 'active'`;
    params.push(shopifyCustomerId, shopifyProductId);
  } else {
    throw new Error('Must provide subscriptionId or both shopifyCustomerId and shopifyProductId');
  }
  
  sql += ` RETURNING *`;
  
  const result = await query(sql, params);
  return result.rows[0] || null;
}

module.exports = {
  createSubscription,
  getActiveSubscriptions,
  getSubscriptionsDueForBilling,
  updateSubscriptionBillingDate,
  cancelSubscription,
};

