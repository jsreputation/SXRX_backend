-- Migration: Add performance indexes to improve query performance
-- This migration adds indexes to frequently queried columns

-- Indexes for customer_patient_map table (already has some, but ensure all are present)
CREATE INDEX IF NOT EXISTS idx_cpm_shopify_customer_id ON customer_patient_map(shopify_customer_id);
CREATE INDEX IF NOT EXISTS idx_cpm_email ON customer_patient_map(email);
CREATE INDEX IF NOT EXISTS idx_cpm_tebra_patient_id ON customer_patient_map(tebra_patient_id);
CREATE INDEX IF NOT EXISTS idx_cpm_updated_at ON customer_patient_map(updated_at);

-- Composite index for common lookup pattern (shopify_customer_id OR email)
-- Note: PostgreSQL can use multiple indexes with bitmap scans, but composite can help
CREATE INDEX IF NOT EXISTS idx_cpm_shopify_or_email ON customer_patient_map(shopify_customer_id, email) WHERE shopify_customer_id IS NOT NULL OR email IS NOT NULL;

-- Create questionnaire_completions table if it doesn't exist (created lazily in service, but needed for indexes)
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

-- Indexes for questionnaire_completions table
CREATE INDEX IF NOT EXISTS idx_qc_email ON questionnaire_completions(email);
CREATE INDEX IF NOT EXISTS idx_qc_customer_id ON questionnaire_completions(customer_id);
CREATE INDEX IF NOT EXISTS idx_qc_product_id ON questionnaire_completions(product_id);
CREATE INDEX IF NOT EXISTS idx_qc_completed_at ON questionnaire_completions(completed_at);
CREATE INDEX IF NOT EXISTS idx_qc_state ON questionnaire_completions(state);

-- Composite index for common query: email + product_id + completed_at (for recent completions)
CREATE INDEX IF NOT EXISTS idx_qc_email_product_completed ON questionnaire_completions(email, product_id, completed_at DESC);

-- Indexes for failed_webhooks table (already created in migration 002, but ensure they exist)
CREATE INDEX IF NOT EXISTS idx_failed_webhooks_status ON failed_webhooks(status);
CREATE INDEX IF NOT EXISTS idx_failed_webhooks_next_retry ON failed_webhooks(next_retry_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_failed_webhooks_webhook_type ON failed_webhooks(webhook_type);
CREATE INDEX IF NOT EXISTS idx_failed_webhooks_created_at ON failed_webhooks(created_at);

-- Composite index for retry processing queries
CREATE INDEX IF NOT EXISTS idx_failed_webhooks_retry_query ON failed_webhooks(status, next_retry_at, attempt_count) WHERE status = 'pending' AND attempt_count < max_attempts;

-- Indexes for availability_settings table (if needed for future queries)
CREATE INDEX IF NOT EXISTS idx_availability_settings_updated_at ON availability_settings(updated_at);

-- Indexes for subscriptions table (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'subscriptions') THEN
    CREATE INDEX IF NOT EXISTS idx_subscriptions_shopify_customer_id ON subscriptions(shopify_customer_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_tebra_patient_id ON subscriptions(tebra_patient_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_next_billing_date ON subscriptions(next_billing_date);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_created_at ON subscriptions(created_at);
  END IF;
END $$;

-- Indexes for billing_sync table (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'billing_sync') THEN
    CREATE INDEX IF NOT EXISTS idx_billing_sync_stripe_event_id ON billing_sync(stripe_event_id);
    CREATE INDEX IF NOT EXISTS idx_billing_sync_stripe_payment_intent_id ON billing_sync(stripe_payment_intent_id);
    CREATE INDEX IF NOT EXISTS idx_billing_sync_created_at ON billing_sync(created_at);
    CREATE INDEX IF NOT EXISTS idx_billing_sync_status ON billing_sync(status);
  END IF;
END $$;

-- Indexes for encounters table (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'encounters') THEN
    CREATE INDEX IF NOT EXISTS idx_encounters_shopify_order_id ON encounters(shopify_order_id);
    CREATE INDEX IF NOT EXISTS idx_encounters_tebra_patient_id ON encounters(tebra_patient_id);
    CREATE INDEX IF NOT EXISTS idx_encounters_status ON encounters(status);
    CREATE INDEX IF NOT EXISTS idx_encounters_updated_at ON encounters(updated_at);
  END IF;
END $$;

-- Analyze tables to update statistics (only if tables exist)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'customer_patient_map') THEN
    ANALYZE customer_patient_map;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'questionnaire_completions') THEN
    ANALYZE questionnaire_completions;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'failed_webhooks') THEN
    ANALYZE failed_webhooks;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'availability_settings') THEN
    ANALYZE availability_settings;
  END IF;
END $$;
