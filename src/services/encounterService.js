// backend/src/services/encounterService.js
// PostgreSQL-backed minimal encounter persistence to correlate
// questionnaire → rx → order → appointment across systems.

const { query } = require('../db/pg');

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS encounters (
  id SERIAL PRIMARY KEY,
  submission_id TEXT,
  shopify_order_id TEXT,
  tebra_patient_id TEXT,
  rx_id TEXT,
  appointment_id TEXT,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_encounters_submission ON encounters(submission_id);
CREATE INDEX IF NOT EXISTS idx_encounters_order ON encounters(shopify_order_id);
CREATE INDEX IF NOT EXISTS idx_encounters_patient ON encounters(tebra_patient_id);
`;

let initialized = false;
async function ensureInit() {
  if (initialized) return;
  await query(INIT_SQL);
  initialized = true;
}

async function createOrUpdate(params = {}) {
  await ensureInit();
  const {
    submissionId = null,
    shopifyOrderId = null,
    tebraPatientId = null,
    rxId = null,
    appointmentId = null,
    status = null,
  } = params;

  // Try to find by submissionId or orderId
  let where = [];
  let whereParams = [];
  if (submissionId) { where.push(`submission_id = $${whereParams.length + 1}`); whereParams.push(submissionId); }
  if (shopifyOrderId) { where.push(`shopify_order_id = $${whereParams.length + 1}`); whereParams.push(shopifyOrderId); }

  let existing = null;
  if (where.length) {
    const sel = await query(`SELECT * FROM encounters WHERE ${where.join(' OR ')} ORDER BY updated_at DESC LIMIT 1`, whereParams);
    existing = sel.rows[0] || null;
  }

  if (!existing) {
    const ins = await query(
      `INSERT INTO encounters (submission_id, shopify_order_id, tebra_patient_id, rx_id, appointment_id, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [submissionId, shopifyOrderId, tebraPatientId, rxId, appointmentId, status]
    );
    return ins.rows[0];
  }

  // Merge updates
  const merged = {
    submission_id: existing.submission_id || submissionId,
    shopify_order_id: shopifyOrderId || existing.shopify_order_id,
    tebra_patient_id: tebraPatientId || existing.tebra_patient_id,
    rx_id: rxId || existing.rx_id,
    appointment_id: appointmentId || existing.appointment_id,
    status: status || existing.status,
  };
  const upd = await query(
    `UPDATE encounters SET submission_id=$1, shopify_order_id=$2, tebra_patient_id=$3, rx_id=$4, appointment_id=$5, status=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [merged.submission_id, merged.shopify_order_id, merged.tebra_patient_id, merged.rx_id, merged.appointment_id, merged.status, existing.id]
  );
  return upd.rows[0];
}

module.exports = { ensureInit, createOrUpdate };
