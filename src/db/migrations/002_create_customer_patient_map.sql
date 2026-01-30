-- Migration: Create customer_patient_map table
-- This table maps Shopify customers to Tebra patients for booking and chart lookups.

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
