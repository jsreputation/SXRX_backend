// backend/src/services/billingSyncService.js
// Tracks Stripe payments -> Tebra accounting sync results

const { query } = require('../db/pg');

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS billing_sync (
  id SERIAL PRIMARY KEY,
  stripe_event_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  stripe_customer_email TEXT,
  tebra_patient_id TEXT,
  tebra_practice_id TEXT,
  tebra_charge_id TEXT,
  tebra_payment_id TEXT,
  amount_cents INTEGER,
  currency TEXT,
  status TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_sync_patient ON billing_sync(tebra_patient_id);
CREATE INDEX IF NOT EXISTS idx_billing_sync_pi ON billing_sync(stripe_payment_intent_id);
`;

let initialized = false;
async function ensureInit() {
  if (initialized) return;
  try {
    console.log('📋 [BILLING SYNC] Initializing database table...');
    await query(INIT_SQL);
    console.log('✅ [BILLING SYNC] Database table initialized successfully');
    initialized = true;
  } catch (error) {
    console.error('❌ [BILLING SYNC] Error initializing database:', error);
    console.error('❌ [BILLING SYNC] Error details:', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack
    });
    // Don't set initialized to true if init failed
    throw error;
  }
}

async function upsertByEventId(eventId, data) {
  await ensureInit();
  const existing = await query('SELECT * FROM billing_sync WHERE stripe_event_id=$1', [eventId]);
  if (existing.rows[0]) {
    const row = existing.rows[0];
    const merged = {
      stripe_event_id: row.stripe_event_id,
      stripe_payment_intent_id: data.stripe_payment_intent_id || row.stripe_payment_intent_id,
      stripe_customer_email: data.stripe_customer_email || row.stripe_customer_email,
      tebra_patient_id: data.tebra_patient_id || row.tebra_patient_id,
      tebra_practice_id: data.tebra_practice_id || row.tebra_practice_id,
      tebra_charge_id: data.tebra_charge_id || row.tebra_charge_id,
      tebra_payment_id: data.tebra_payment_id || row.tebra_payment_id,
      amount_cents: data.amount_cents ?? row.amount_cents,
      currency: data.currency || row.currency,
      status: data.status || row.status,
      error: data.error || row.error,
    };
    const upd = await query(
      `UPDATE billing_sync SET stripe_payment_intent_id=$1, stripe_customer_email=$2, tebra_patient_id=$3, tebra_practice_id=$4, tebra_charge_id=$5, tebra_payment_id=$6, amount_cents=$7, currency=$8, status=$9, error=$10, updated_at=NOW() WHERE stripe_event_id=$11 RETURNING *`,
      [merged.stripe_payment_intent_id, merged.stripe_customer_email, merged.tebra_patient_id, merged.tebra_practice_id, merged.tebra_charge_id, merged.tebra_payment_id, merged.amount_cents, merged.currency, merged.status, merged.error, eventId]
    );
    return upd.rows[0];
  }
  const ins = await query(
    `INSERT INTO billing_sync (stripe_event_id, stripe_payment_intent_id, stripe_customer_email, tebra_patient_id, tebra_practice_id, tebra_charge_id, tebra_payment_id, amount_cents, currency, status, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [eventId, data.stripe_payment_intent_id || null, data.stripe_customer_email || null, data.tebra_patient_id || null, data.tebra_practice_id || null, data.tebra_charge_id || null, data.tebra_payment_id || null, data.amount_cents ?? null, data.currency || null, data.status || null, data.error || null]
  );
  return ins.rows[0];
}

async function upsertByPaymentIntentId(paymentIntentId, data) {
  await ensureInit();
  // First check if record exists by payment intent ID
  const existing = await query('SELECT * FROM billing_sync WHERE stripe_payment_intent_id=$1 ORDER BY created_at DESC LIMIT 1', [paymentIntentId]);
  
  if (existing.rows[0]) {
    // Update existing record using its event ID
    const row = existing.rows[0];
    const eventId = row.stripe_event_id;
    const merged = {
      stripe_event_id: eventId,
      stripe_payment_intent_id: paymentIntentId,
      stripe_customer_email: data.stripe_customer_email || row.stripe_customer_email,
      tebra_patient_id: data.tebra_patient_id ?? row.tebra_patient_id,
      tebra_practice_id: data.tebra_practice_id ?? row.tebra_practice_id,
      tebra_charge_id: data.tebra_charge_id ?? row.tebra_charge_id,
      tebra_payment_id: data.tebra_payment_id ?? row.tebra_payment_id,
      amount_cents: data.amount_cents ?? row.amount_cents,
      currency: data.currency || row.currency,
      status: data.status || row.status,
      error: data.error ?? row.error,
    };
    const upd = await query(
      `UPDATE billing_sync SET stripe_customer_email=$1, tebra_patient_id=$2, tebra_practice_id=$3, tebra_charge_id=$4, tebra_payment_id=$5, amount_cents=$6, currency=$7, status=$8, error=$9, updated_at=NOW() WHERE stripe_event_id=$10 RETURNING *`,
      [merged.stripe_customer_email, merged.tebra_patient_id, merged.tebra_practice_id, merged.tebra_charge_id, merged.tebra_payment_id, merged.amount_cents, merged.currency, merged.status, merged.error, eventId]
    );
    return upd.rows[0];
  }
  
  // No existing record, create new one with provided event ID or generate one
  const eventId = data.stripe_event_id || `evt_sync_${paymentIntentId}_${Date.now()}`;
  const ins = await query(
    `INSERT INTO billing_sync (stripe_event_id, stripe_payment_intent_id, stripe_customer_email, tebra_patient_id, tebra_practice_id, tebra_charge_id, tebra_payment_id, amount_cents, currency, status, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [eventId, paymentIntentId, data.stripe_customer_email || null, data.tebra_patient_id || null, data.tebra_practice_id || null, data.tebra_charge_id || null, data.tebra_payment_id || null, data.amount_cents ?? null, data.currency || null, data.status || null, data.error || null]
  );
  return ins.rows[0];
}

async function getRecentForEmail(email, limit = 20) {
  try {
    await ensureInit();
    console.log('📋 [BILLING SYNC] Querying billing records for email:', email, 'limit:', limit);
    // Use a subquery with ROW_NUMBER to get only the most recent record per payment intent ID
    // This ensures we get truly unique records even if there are multiple event IDs for the same payment intent
    const res = await query(
      `SELECT * FROM (
        SELECT *, 
               ROW_NUMBER() OVER (PARTITION BY stripe_payment_intent_id ORDER BY created_at DESC) as rn
        FROM billing_sync 
        WHERE stripe_customer_email=$1 
          AND stripe_payment_intent_id IS NOT NULL
      ) ranked
      WHERE rn = 1
      ORDER BY created_at DESC
      LIMIT $2`,
      [email, limit]
    );
    console.log('✅ [BILLING SYNC] Query successful, found', res?.rows?.length || 0, 'unique records');
    return res.rows || [];
  } catch (error) {
    console.error('❌ [BILLING SYNC] Error in getRecentForEmail:', error);
    console.error('❌ [BILLING SYNC] Error details:', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack
    });
    throw error;
  }
}

async function getByEventId(eventId){
  await ensureInit();
  const res = await query('SELECT * FROM billing_sync WHERE stripe_event_id=$1', [eventId]);
  return res.rows[0] || null;
}

async function updateByEventId(eventId, data){
  await ensureInit();
  const existing = await getByEventId(eventId);
  if (!existing) return null;
  const merged = {
    stripe_payment_intent_id: data.stripe_payment_intent_id || existing.stripe_payment_intent_id,
    stripe_customer_email: data.stripe_customer_email || existing.stripe_customer_email,
    tebra_patient_id: data.tebra_patient_id || existing.tebra_patient_id,
    tebra_practice_id: data.tebra_practice_id || existing.tebra_practice_id,
    tebra_charge_id: data.tebra_charge_id || existing.tebra_charge_id,
    tebra_payment_id: data.tebra_payment_id || existing.tebra_payment_id,
    amount_cents: data.amount_cents ?? existing.amount_cents,
    currency: data.currency || existing.currency,
    status: data.status || existing.status,
    error: data.error || existing.error,
  };
  const upd = await query(
    `UPDATE billing_sync SET stripe_payment_intent_id=$1, stripe_customer_email=$2, tebra_patient_id=$3, tebra_practice_id=$4, tebra_charge_id=$5, tebra_payment_id=$6, amount_cents=$7, currency=$8, status=$9, error=$10, updated_at=NOW() WHERE stripe_event_id=$11 RETURNING *`,
    [merged.stripe_payment_intent_id, merged.stripe_customer_email, merged.tebra_patient_id, merged.tebra_practice_id, merged.tebra_charge_id, merged.tebra_payment_id, merged.amount_cents, merged.currency, merged.status, merged.error, eventId]
  );
  return upd.rows[0];
}

module.exports = { ensureInit, upsertByEventId, upsertByPaymentIntentId, getRecentForEmail, getByEventId, updateByEventId };
