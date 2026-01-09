// backend/src/services/customerPatientMapService.js
// PostgreSQL-backed mapping between Shopify customers and Tebra patients.
// Minimal footprint: creates table if not exists on first use.

const { query } = require('../db/pg');

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS customer_patient_map (
  id SERIAL PRIMARY KEY,
  shopify_customer_id TEXT,
  email TEXT,
  tebra_patient_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cpm_shopify_customer_id ON customer_patient_map(shopify_customer_id);
CREATE INDEX IF NOT EXISTS idx_cpm_email ON customer_patient_map(email);
CREATE INDEX IF NOT EXISTS idx_cpm_tebra_patient_id ON customer_patient_map(tebra_patient_id);
`;

let initialized = false;
async function ensureInit() {
  if (initialized) return;
  await query(INIT_SQL);
  initialized = true;
}

async function getByShopifyIdOrEmail(shopifyCustomerId, email) {
  await ensureInit();
  const where = [];
  const params = [];
  if (shopifyCustomerId) { params.push(shopifyCustomerId); where.push(`shopify_customer_id = $${params.length}`); }
  if (email) { params.push(email); where.push(`email = $${params.length}`); }
  if (!where.length) return null;
  const sql = `SELECT shopify_customer_id, email, tebra_patient_id, updated_at FROM customer_patient_map WHERE ${where.join(' OR ')} ORDER BY updated_at DESC LIMIT 1`;
  const { rows } = await query(sql, params);
  return rows[0] || null;
}

async function upsert(shopifyCustomerId, email, tebraPatientId) {
  await ensureInit();
  // Upsert by coalescing on either shopify id or email when present.
  // If both provided, prefer matching existing row by either.
  const sql = `
    INSERT INTO customer_patient_map (shopify_customer_id, email, tebra_patient_id, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT DO NOTHING
  `;
  await query(sql, [shopifyCustomerId || null, email || null, tebraPatientId || null]);

  const updateParts = [];
  const params = [];
  if (shopifyCustomerId) { params.push(shopifyCustomerId); updateParts.push(`shopify_customer_id = $${params.length}`); }
  if (email) { params.push(email); updateParts.push(`email = $${params.length}`); }
  if (tebraPatientId) { params.push(tebraPatientId); updateParts.push(`tebra_patient_id = $${params.length}`); }
  if (!updateParts.length) return;

  const where = [];
  if (shopifyCustomerId) { params.push(shopifyCustomerId); where.push(`shopify_customer_id = $${params.length}`); }
  if (email) { params.push(email); where.push(`email = $${params.length}`); }
  const sqlUpdate = `UPDATE customer_patient_map SET ${updateParts.join(', ')}, updated_at = NOW() WHERE ${where.join(' OR ')}`;
  await query(sqlUpdate, params);
}

async function deleteByShopifyIdOrEmail(shopifyCustomerId, email) {
  await ensureInit();
  const where = [];
  const params = [];
  if (shopifyCustomerId) { params.push(shopifyCustomerId); where.push(`shopify_customer_id = $${params.length}`); }
  if (email) { params.push(email); where.push(`email = $${params.length}`); }
  if (!where.length) return { deleted: 0 };
  
  const sql = `DELETE FROM customer_patient_map WHERE ${where.join(' OR ')}`;
  const result = await query(sql, params);
  return { deleted: result.rowCount || 0 };
}

module.exports = { ensureInit, getByShopifyIdOrEmail, upsert, deleteByShopifyIdOrEmail };
